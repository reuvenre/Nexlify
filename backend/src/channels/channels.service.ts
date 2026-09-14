import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import axios from 'axios';
import { Channel } from './channel.entity';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';
import { encrypt, decrypt, mask, normalizeTelegramChatId } from '../common/crypto';
import { SubscriptionService } from '../subscription/subscription.service';
import { CredentialsService, GRAPH_VERSION } from '../credentials/credentials.service';
import { verifyFacebookPage } from '../common/meta-token';
import { facebookErrorText } from '../common/facebook-errors';
import { classifyChannelChats, ChannelSupport } from './whatsapp-channel-support';
import { describeGreenSendResult, GreenSendResult } from './green-send-result';
import {
  canPublish, describeMissingScopes, missingScopes, parseGrantedScopes,
} from '../pinterest/pinterest-scopes';
import { daysUntil, resolveMetaTokenExpiry } from '../common/meta-token';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectRepository(Channel)
    private readonly repo: Repository<Channel>,
    private readonly subscription: SubscriptionService,
    private readonly credentials: CredentialsService,
  ) {}

  async list(userId: string) {
    const channels = await this.repo.find({
      where: { user_id: userId },
      order: { created_at: 'ASC' },
    });

    // Refresh member counts from Telegram in the background (fire-and-forget)
    this.refreshMemberCounts(channels).catch(() => {});
    // Same for token expiries that were never resolved — tokens saved before this was
    // tracked. In the background so opening the Groups screen never waits on Graph; the
    // countdown appears on the next load, which is soon enough for a 60-day clock.
    this.backfillTokenExpiries(channels).catch(() => {});

    return channels.map((c) => this.toPublic(c));
  }

  /**
   * Resolve `facebook_token_expires_at` for group tokens that have none.
   *
   * Lazy rather than a migration: resolving means one Graph call per token, and a migration
   * is the wrong place to depend on a third party answering. Only ever fills a BLANK — a
   * known expiry is left alone, so this cannot churn on every list.
   */
  private async backfillTokenExpiries(channels: Channel[]): Promise<void> {
    for (const c of channels) {
      if (!c.facebook_page_token_enc || c.facebook_token_expires_at) continue;
      try {
        const exp = await resolveMetaTokenExpiry(decrypt(c.facebook_page_token_enc));
        if (exp) await this.repo.update(c.id, { facebook_token_expires_at: exp });
      } catch (err: any) {
        this.logger.warn(`token expiry backfill failed for channel ${c.id}: ${err?.message}`);
      }
    }
  }

  async create(userId: string, dto: CreateChannelDto) {
    // Plan enforcement: each plan allows a max number of channels/groups.
    const maxGroups = await this.subscription.getMaxGroups(userId);
    if (maxGroups !== null) {
      const count = await this.repo.count({ where: { user_id: userId } });
      if (count >= maxGroups) {
        throw new BadRequestException(
          `הגעת למגבלת ${maxGroups} הקבוצות של התוכנית שלך — שדרג תוכנית בהגדרות ← מנוי כדי להוסיף עוד`,
        );
      }
    }

    const channel = this.repo.create({
      user_id: userId,
      name: dto.name,
      platform: dto.platform || 'telegram',
      channel_id: dto.channel_id,
      description: dto.description,
      body_template_id: dto.body_template_id || null,
      footer_template_id: dto.footer_template_id || null,
      facebook_page_id: dto.facebook_page_id?.trim() || null,
      instagram_business_id: dto.instagram_business_id?.trim() || null,
      bot_token_enc: dto.bot_token ? encrypt(dto.bot_token) : null,
      facebook_page_token_enc: dto.facebook_page_token?.trim() ? encrypt(dto.facebook_page_token.trim()) : null,
    });
    // Ask Graph when this token dies, so the countdown and the warning email have something
    // to work with from the first save. Best-effort: an unreachable Graph leaves it null
    // ("unknown"), which the lazy backfill in list() resolves later.
    if (dto.facebook_page_token?.trim()) {
      channel.facebook_token_expires_at = await resolveMetaTokenExpiry(dto.facebook_page_token.trim());
    }
    await this.repo.save(channel);
    return this.toPublic(channel);
  }

  async update(userId: string, id: string, dto: UpdateChannelDto) {
    const channel = await this.findOwned(userId, id);
    if (dto.name !== undefined) channel.name = dto.name;
    if (dto.channel_id !== undefined) channel.channel_id = dto.channel_id;
    if (dto.description !== undefined) channel.description = dto.description;
    if (dto.is_active !== undefined) channel.is_active = dto.is_active;
    if (dto.body_template_id !== undefined) channel.body_template_id = dto.body_template_id || null;
    if (dto.footer_template_id !== undefined) channel.footer_template_id = dto.footer_template_id || null;
    if (dto.facebook_page_id !== undefined) channel.facebook_page_id = dto.facebook_page_id?.trim() || null;
    if (dto.instagram_business_id !== undefined) channel.instagram_business_id = dto.instagram_business_id?.trim() || null;
    if (dto.bot_token?.trim()) channel.bot_token_enc = encrypt(dto.bot_token.trim());
    // Only overwrite the FB token when a new one is actually provided (the form sends the
    // field blank unless the user re-enters it), so editing other fields never wipes it.
    if (dto.facebook_page_token?.trim()) {
      channel.facebook_page_token_enc = encrypt(dto.facebook_page_token.trim());
      channel.facebook_token_expires_at = await resolveMetaTokenExpiry(dto.facebook_page_token.trim());
      // A fresh token restarts the warning cycle — otherwise the 3-day throttle would keep
      // the owner silent right after they fixed the thing we nagged them about.
      channel.facebook_token_notified_at = null;
    }
    if (dto.smart_timing !== undefined) channel.smart_timing = dto.smart_timing === true;
    // Per-group queue overrides — an explicit null clears the override (back to inherit).
    if (dto.schedule_enabled !== undefined) channel.schedule_enabled = dto.schedule_enabled;
    if (dto.schedule_interval_minutes !== undefined) channel.schedule_interval_minutes = dto.schedule_interval_minutes;
    if (dto.schedule_start_hour !== undefined) channel.schedule_start_hour = dto.schedule_start_hour;
    if (dto.schedule_end_hour !== undefined) channel.schedule_end_hour = dto.schedule_end_hour;
    await this.repo.save(channel);
    return this.toPublic(channel);
  }

  async delete(userId: string, id: string) {
    const channel = await this.findOwned(userId, id);
    await this.repo.remove(channel);
    return { deleted: true };
  }

  async test(userId: string, id: string) {
    const channel = await this.findOwned(userId, id);
    // Resolve the token the SAME way the real send path does: the channel's own bot if
    // it has one, otherwise the user's default bot from Settings. Testing only the
    // per-channel token (as before) wrongly failed groups that rely on the shared bot.
    const ownToken = channel.bot_token_enc ? decrypt(channel.bot_token_enc) : null;
    const token = ownToken || (await this.credentials.getTelegramToken(userId).catch(() => null));
    if (!token) {
      return { ok: false, error: 'לא הוגדר טוקן בוט. הוסף טוקן מ-@BotFather לקבוצה, או טוקן כללי בהגדרות ← אינטגרציות.' };
    }
    if (!channel.channel_id) {
      return { ok: false, error: 'חסר מזהה ערוץ (Channel ID) לקבוצה הזו.' };
    }
    const chatId = normalizeTelegramChatId(channel.channel_id);
    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text: '✅ Nexlify — test connection successful!' },
        { timeout: 10000 },
      );

      // Also refresh member count on successful test
      if (res.data?.ok === true) {
        this.fetchMemberCount(token, chatId)
          .then((count) => {
            if (count !== null) {
              this.repo.update(channel.id, { members_count: count });
            }
          })
          .catch(() => {});
      }

      return { ok: res.data?.ok === true };
    } catch (err: any) {
      return { ok: false, error: this.explainTelegramError(err) };
    }
  }

  /**
   * Turn Telegram's terse English API errors into a clear, actionable Hebrew message.
   * "Unauthorized" (a rejected/revoked bot token) in particular was meaningless to users.
   */
  private explainTelegramError(err: any): string {
    const desc: string = err?.response?.data?.description || err?.message || '';
    const d = desc.toLowerCase();
    if (d.includes('unauthorized')) {
      return 'הטוקן של הבוט שגוי או בוטל. פתח את @BotFather, העתק מחדש את הטוקן של הבוט, וערוך את הקבוצה כדי להזין אותו.';
    }
    if (d.includes('chat not found')) {
      return 'הבוט לא בקבוצה/ערוץ הזה, או שמזהה הערוץ (Channel ID) שגוי. הוסף את הבוט כמנהל וּודא שה-Channel ID נכון.';
    }
    if (d.includes('kicked') || d.includes('not a member') || d.includes('forbidden')) {
      return 'הבוט הוסר מהקבוצה או אינו חבר בה. הוסף אותו מחדש כמנהל עם הרשאת פרסום.';
    }
    if (d.includes('not enough rights') || d.includes('need administrator') || d.includes('administrator rights')) {
      return 'לבוט אין הרשאות מנהל בקבוצה. הפוך אותו למנהל עם הרשאה לפרסם הודעות.';
    }
    return desc || 'הבדיקה נכשלה.';
  }

  /**
   * Verify the Facebook Page configured for THIS channel — the per-channel page override,
   * falling back to the account's default page. Non-destructive: it reads the page with the
   * saved Page token and checks PUBLISH capability, so a token that can only READ the page is
   * reported as not-publishable instead of a false "OK". Shares that check with the
   * Settings → Integrations one (verifyFacebookPage) and differs only in the remedy it offers:
   * here a user token can be converted in place, because there is a channel row to save it to.
   */
  async testFacebook(userId: string, id: string) {
    const channel = await this.findOwned(userId, id);
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const pageId = (channel.facebook_page_id || creds?.facebook_page_id || '').trim();
    // Prefer THIS channel's own Page token; fall back to the account's global token.
    const ownToken = channel.facebook_page_token_enc ? decrypt(channel.facebook_page_token_enc) : null;
    const token = ownToken || creds?.facebook_page_token || '';
    if (!pageId) {
      return { ok: false, error: 'לא הוגדר דף פייסבוק לערוץ הזה (ולא דף ברירת מחדל בהגדרות ← אינטגרציות).' };
    }
    if (!token) {
      return { ok: false, error: 'לא הוגדר Page Access Token בהגדרות ← אינטגרציות.' };
    }
    try {
      // The read + publish-capability check is shared with Settings → Integrations — see
      // verifyFacebookPage, including why it must not ask Graph for `tasks`. Only the REMEDY
      // differs between the two screens, and that is what the branches below are.
      const verdict = await verifyFacebookPage(pageId, token);

      if (verdict.problem === 'graph') {
        const msg = verdict.graphError?.message || 'unknown error';
        // Object not found / wrong node type: usually the saved Page ID is stale, or is the
        // profile.php number from the URL, or an Instagram id pasted into the wrong field.
        if (/nonexisting|does not exist|Unsupported|cannot be loaded/i.test(msg)) {
          // Offer the real ids when we can reach them. Pointing at /me/accounts is useless
          // for a Business Portfolio account, where that endpoint answers with an empty list
          // however correct the setup is — so name the Pages if possible, and otherwise say
          // where to find the id in the UI rather than repeating an API call that won't help.
          const pages = await this.listPagesForToken(token);
          const hint = pages?.length
            ? `הדפים הזמינים לך: ${pages.map((p) => `"${p.name}" (ID ${p.id})`).join(', ')}.`
            : 'את ה-Page ID הנכון אפשר למצוא בדף עצמו ← מידע/שקיפות הדף, או ב-Meta Business Suite ← הגדרות ← דפים.';
          return {
            ok: false,
            error: `הדף עם המזהה ${pageId} לא נמצא, או שהטוקן לא מכסה אותו. ${hint}`,
          };
        }
        // Anything else: reuse the publish path's Hebrew mapping instead of echoing Graph's
        // English paragraph. The owner reads this button's answer far more often than a failed
        // post's error, so it must say the same actionable sentence. This channel's own token
        // is the one under test, so the message names the group's screen, not Settings.
        return {
          ok: false,
          error: facebookErrorText({ error: verdict.graphError }, 'facebook', pageId, ownToken ? 'channel' : 'account'),
        };
      }

      if (verdict.problem === 'user-token') {
        // Self-heal rather than send the owner back to Graph Explorer. A user token that can
        // already read the page can also read that page's OWN token from the page node, and
        // that works even when /me/accounts comes back empty — which is what happens when the
        // pages live in a Business Portfolio rather than under a classic admin role.
        const derived = await this.derivePageToken(token, pageId);
        if (derived) {
          await this.repo.update(channel.id, { facebook_page_token_enc: encrypt(derived) });
          return {
            ok: true,
            page_name: verdict.pageName,
            note: 'נשמר טוקן משתמש — הומר אוטומטית ל-Page Access Token של הדף. הפרסום אמור לעבוד כעת.',
          };
        }
        return {
          ok: false,
          page_name: verdict.pageName,
          error: 'זהו טוקן משתמש (User Token) ולא Page Access Token, ולא הצלחנו להמיר אותו אוטומטית. '
            + 'ודא שבמסך האישור של פייסבוק סומן הדף הזה ואושרה ההרשאה "Create and manage content on your Page".',
        };
      }

      if (verdict.problem === 'scopes') {
        return {
          ok: false,
          page_name: verdict.pageName,
          error: `לטוקן חסרות ההרשאות: ${verdict.missing.join(', ')}. יש להפיק מחדש Page Access Token של אדמין הדף עם ההרשאות האלה.`,
        };
      }

      return { ok: true, page_name: verdict.pageName };
    } catch (err: any) {
      return { ok: false, error: err?.response?.data?.error?.message || err?.message || 'הבדיקה נכשלה.' };
    }
  }

  /**
   * Pages this token can see, best effort, or null when nothing could be enumerated.
   *
   * /me/accounts is the documented route and answers for classic admin roles. It returns an
   * empty list for Pages held in a Business Portfolio, so that case falls through to the
   * business endpoints — which need `business_management` and will simply fail without it.
   * Returning null there is honest: "we could not list your Pages" is a different claim from
   * "you have none", and the caller words the message accordingly.
   */
  private async listPagesForToken(token: string): Promise<Array<{ id: string; name: string }> | null> {
    const get = async (path: string, params: Record<string, string>) => {
      const res = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
        params: { ...params, access_token: token }, timeout: 6000, validateStatus: () => true,
      });
      return res.data?.error || !Array.isArray(res.data?.data) ? null : res.data.data;
    };
    const asPages = (rows: any[]) =>
      rows.map((p: any) => ({ id: String(p.id), name: String(p.name || p.id) }));

    try {
      const direct = await get('me/accounts', { fields: 'id,name' });
      if (direct?.length) return asPages(direct).slice(0, 8);

      const businesses = await get('me/businesses', { fields: 'id' });
      if (!businesses?.length) return null;

      const found: Array<{ id: string; name: string }> = [];
      for (const b of businesses.slice(0, 3)) {
        for (const edge of ['owned_pages', 'client_pages']) {
          const rows = await get(`${b.id}/${edge}`, { fields: 'id,name' });
          if (rows?.length) found.push(...asPages(rows));
        }
      }
      // De-dupe: a Page can appear under both owned_pages and client_pages.
      const seen = new Set<string>();
      const unique = found.filter((p) => !seen.has(p.id) && seen.add(p.id));
      return unique.length ? unique.slice(0, 8) : null;
    } catch {
      return null;
    }
  }

  /**
   * The Page's own access token, read from the page node with a user token.
   *
   * This is the reliable path. The documented route — GET /me/accounts — returns an empty
   * list when the Pages belong to a Business Portfolio instead of a classic admin role, even
   * though the user has full access and the consent dialog granted everything. Asking the
   * page directly for `access_token` works in both arrangements, so the owner never has to
   * discover which one they are in.
   */
  private async derivePageToken(userToken: string, pageId: string): Promise<string | null> {
    try {
      const res = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`, {
        params: { fields: 'access_token', access_token: userToken },
        timeout: 6000,
        validateStatus: () => true,
      });
      const t = res.data?.access_token;
      return typeof t === 'string' && t.length > 20 ? t : null;
    } catch {
      return null;
    }
  }

  /**
   * Verify the Instagram Business account is reachable with the linked Page token —
   * the same pair the real publish uses (`instagram_business_id` + the Page's
   * `facebook_page_token`). Instagram publishing is account-global (not per-channel),
   * so this reads the account from Settings ← Integrations, ignoring the channel id.
   */
  async testInstagram(userId: string) {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const igId = (creds?.instagram_business_id || '').trim();
    const token = creds?.facebook_page_token || '';
    if (!igId) {
      return { ok: false, error: 'לא הוגדר Instagram Business Account ID בהגדרות ← אינטגרציות.' };
    }
    if (!token) {
      return { ok: false, error: 'לא הוגדר Page Access Token של פייסבוק (אינסטגרם משתמש בטוקן של הדף המקושר).' };
    }
    const pageId = (creds?.facebook_page_id || '').trim();
    try {
      // Ask for the IG account's own fields. This only resolves when the token belongs to
      // the Facebook Page that the IG Business account is linked to — exactly what publish needs.
      const res = await axios.get(
        `https://graph.facebook.com/${GRAPH_VERSION}/${igId}`,
        { params: { fields: 'username,name,profile_picture_url', access_token: token }, timeout: 6000, validateStatus: () => true },
      );
      if (res.data?.error) {
        // The entered ID didn't resolve. Turn the vague "does not exist" into an exact answer:
        // scan EVERY page the token administers and their linked IG accounts, so we can say
        // precisely which page the IG account is (or isn't) connected to.
        const linkedOnConfigured = await this.discoverLinkedIg(pageId, token).catch(() => null);
        const pages = await this.scanTokenPages(token).catch(() => []);

        // (a) The entered IG id IS linked — but to a DIFFERENT page than the token/id configured.
        //     Tell the user which page's token to use.
        const hostPage = pages.find((p) => p.ig?.id === igId);
        if (hostPage) {
          return {
            ok: false,
            error: `המזהה של האינסטגרם (${igId}) נכון, אבל הוא מקושר לדף הפייסבוק "${hostPage.name}" (${hostPage.id}) — לא לדף שהטוקן שלו הוזן. הזן בקטע פייסבוק את ה-Page ID והטוקן של הדף "${hostPage.name}", ואז נסה שוב.`,
            suggested_page_id: hostPage.id,
          };
        }

        // (b) The configured page IS linked to some IG account, just not the id entered →
        //     the entered id is wrong; offer the right one.
        if (linkedOnConfigured && linkedOnConfigured.id !== igId) {
          return {
            ok: false,
            error: `ה-ID שהוזן (${igId}) אינו מקושר לדף. חשבון האינסטגרם המקושר לדף הזה הוא @${linkedOnConfigured.username || ''} עם המזהה ${linkedOnConfigured.id}. מילאתי אותו עבורך — לחץ שמור ובדוק שוב.`,
            suggested_id: linkedOnConfigured.id,
            suggested_username: linkedOnConfigured.username || null,
          };
        }

        // (c) The token reaches pages, but NONE is linked to any IG account.
        const withIg = pages.filter((p) => p.ig?.id);
        const msg = res.data.error.message || 'unknown error';
        if (pages.length && !withIg.length) {
          return { ok: false, error: `הטוקן מגיע ל-${pages.length} דפי פייסבוק, אך אף אחד מהם אינו מקושר לחשבון Instagram עסקי. קשר את @החשבון לדף ב-Meta Business Suite ← הגדרות הדף ← חשבונות מקושרים ← Instagram, ואז נסה שוב.` };
        }
        // (d) Fallback — couldn't enumerate pages (page-scoped token) or nothing linked.
        return {
          ok: false,
          error: pageId
            ? `לא נמצא חשבון Instagram מקושר לדף (${pageId}) דרך הטוקן הזה. ודא ש-@החשבון מקושר לדף ב-Meta Business Suite, ושהטוקן הוא Page Access Token של אותו דף עם ההרשאות instagram_basic + instagram_content_publish. (Graph: ${msg})`
            : `${msg} — הגדר Page ID בקטע פייסבוק כדי שאוכל לזהות אוטומטית לאיזה דף האינסטגרם מקושר.`,
        };
      }
      if (!res.data?.username) {
        return { ok: false, error: 'ה-ID נמצא אך אינו חשבון Instagram Business תקין (אין username). ודא שהחשבון מסוג Business/Creator ומקושר לדף.' };
      }
      return { ok: true, username: res.data.username, name: res.data?.name || null };
    } catch (err: any) {
      return { ok: false, error: err?.response?.data?.error?.message || err?.message || 'הבדיקה נכשלה.' };
    }
  }

  /** Discover the IG Business account linked to a Facebook Page (via its token), or null. */
  private async discoverLinkedIg(pageId: string, token: string): Promise<{ id: string; username?: string } | null> {
    if (!pageId || !token) return null;
    const res = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`,
      { params: { fields: 'instagram_business_account{id,username}', access_token: token }, timeout: 6000, validateStatus: () => true },
    );
    const iba = res.data?.instagram_business_account;
    return iba?.id ? { id: String(iba.id), username: iba.username } : null;
  }

  /**
   * List every Facebook Page the token administers, each with its linked IG account (if any).
   * Works with a user token (returns all pages) and often with a page token (returns that page).
   * Returns [] when the token can't enumerate — the caller then falls back to page-scoped hints.
   */
  private async scanTokenPages(token: string): Promise<Array<{ id: string; name: string; ig?: { id: string; username?: string } }>> {
    if (!token) return [];
    const res = await axios.get(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`,
      { params: { fields: 'name,instagram_business_account{id,username}', limit: 100, access_token: token }, timeout: 8000, validateStatus: () => true },
    );
    const rows: any[] = res.data?.data || [];
    return rows.map((p) => ({
      id: String(p.id),
      name: p.name || String(p.id),
      ig: p.instagram_business_account?.id
        ? { id: String(p.instagram_business_account.id), username: p.instagram_business_account.username }
        : undefined,
    }));
  }

  /**
   * Verify the Pinterest access token + target board are usable for publishing — the same
   * pair the real Pin publish uses (`pinterest_access_token` + `pinterest_board_id`).
   * Account-global (Pinterest isn't per-channel), so it reads Settings ← Integrations.
   */
  async testPinterest(userId: string) {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const token = creds?.pinterest_access_token || '';
    const boardId = (creds?.pinterest_board_id || '').trim();
    if (!token) {
      return { ok: false, error: 'לא הוגדר Pinterest Access Token בהגדרות ← אינטגרציות (נדרשות הרשאות boards:read, pins:write).' };
    }
    if (!boardId) {
      return { ok: false, error: 'לא הוגדר מזהה לוח (Board ID) לפרסום בפינטרסט.' };
    }
    // Reading a board proves READ access and nothing else. This test used to stop there and
    // report "ready to publish", which is how a grant missing pins:write passed as healthy
    // and the first pin was rejected hours later. Check the grant before touching the API:
    // no request can tell us what this already knows.
    const granted = parseGrantedScopes(creds?.pinterest_scopes);
    if (!canPublish(granted)) {
      return { ok: false, error: describeMissingScopes(missingScopes(granted), granted) };
    }
    try {
      // With write permission established, reading the specific board confirms the rest:
      // the token is live AND it can reach the exact board we will pin to.
      const res = await axios.get(
        `https://api.pinterest.com/v5/boards/${boardId}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 8000, validateStatus: () => true },
      );
      if (res.status === 401) {
        return { ok: false, error: 'הטוקן לא תקין או פג תוקף. צור Access Token חדש ב-Pinterest Developer עם ההרשאות boards:read, pins:write.' };
      }
      if (res.status === 404) {
        return { ok: false, error: `לא נמצא לוח עם המזהה ${boardId}. ודא שזה ה-Board ID הנכון ושהוא שייך לחשבון של הטוקן.` };
      }
      if (res.status !== 200 || res.data?.code) {
        return { ok: false, error: res.data?.message || `הבדיקה נכשלה (HTTP ${res.status}).` };
      }
      return { ok: true, board_name: res.data?.name || boardId };
    } catch (err: any) {
      return { ok: false, error: err?.response?.data?.message || err?.message || 'הבדיקה נכשלה.' };
    }
  }

  /**
   * Verify the WhatsApp publishing setup. For Green API this checks the instance is
   * AUTHORIZED (QR-linked) — the precondition for sending to a group. For the official
   * Cloud API it confirms the Phone Number ID + token resolve.
   */
  async testWhatsApp(userId: string) {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    const provider = creds?.whatsapp_provider || 'green';

    if (provider === 'green') {
      const instance = (creds?.green_api_instance_id || '').trim();
      const token = creds?.green_api_token || '';
      if (!instance || !token) {
        return { ok: false, error: 'לא הוגדרו Instance ID / Token של Green API בהגדרות ← אינטגרציות.' };
      }
      const base = (creds?.green_api_url || 'https://api.green-api.com').replace(/\/$/, '');
      try {
        const res = await axios.get(`${base}/waInstance${instance}/getStateInstance/${token}`, { timeout: 8000, validateStatus: () => true });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, error: 'ה-Instance ID או ה-Token של Green API אינם תקינים.' };
        }
        const state = res.data?.stateInstance;
        if (state === 'authorized') return { ok: true, state };
        return { ok: false, error: `ה-instance במצב "${state || `HTTP ${res.status}`}" — סרוק את קוד ה-QR בקונסולת Green API כדי לחבר את מספר הוואטסאפ.` };
      } catch (err: any) {
        return { ok: false, error: err?.response?.data?.message || err?.message || 'הבדיקה נכשלה.' };
      }
    }

    // Official WhatsApp Cloud API.
    const phoneId = (creds?.whatsapp_phone_number_id || '').trim();
    const token = creds?.whatsapp_access_token || '';
    if (!phoneId || !token) {
      return { ok: false, error: 'לא הוגדרו Phone Number ID / Access Token של WhatsApp Cloud API.' };
    }
    try {
      const res = await axios.get(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}`,
        { params: { fields: 'display_phone_number,verified_name', access_token: token }, timeout: 6000, validateStatus: () => true },
      );
      if (res.data?.error) return { ok: false, error: res.data.error.message };
      return { ok: true, state: res.data?.display_phone_number || 'official' };
    } catch (err: any) {
      return { ok: false, error: err?.response?.data?.error?.message || err?.message || 'הבדיקה נכשלה.' };
    }
  }

  /**
   * Ask the owner's own Green API instance whether it can see WhatsApp channels.
   *
   * Green API's docs cover groups and direct chats and say nothing about channels, so
   * neither the docs nor I can answer this for a given account — only the instance can.
   * getChats is the cheapest probe: a channel shows up there with an `@newsletter` id.
   */
  async whatsappChannelSupport(userId: string): Promise<ChannelSupport & { ok: boolean }> {
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    if ((creds?.whatsapp_provider || 'green') !== 'green') {
      return {
        ok: false, verdict: 'unsupported', total_chats: 0, channels: [],
        message: 'ה-API הרשמי של מטא לא תומך בקבוצות ולא בערוצים — רק בהודעות אישיות למי שנתן הסכמה.',
      };
    }
    const instance = (creds?.green_api_instance_id || '').trim();
    const token = creds?.green_api_token || '';
    if (!instance || !token) {
      return {
        ok: false, verdict: 'unknown', total_chats: 0, channels: [],
        message: 'לא הוגדרו Instance ID / Token של Green API בהגדרות ← אינטגרציות.',
      };
    }
    const base = (creds?.green_api_url || 'https://api.green-api.com').replace(/\/$/, '');
    try {
      const res = await axios.get(`${base}/waInstance${instance}/getChats/${token}`,
        { timeout: 15_000, validateStatus: () => true });
      const verdict = classifyChannelChats(res.status, res.data);
      return { ok: verdict.verdict !== 'unsupported', ...verdict };
    } catch (err: any) {
      return {
        ok: false, verdict: 'unknown', total_chats: 0, channels: [],
        message: err?.message || 'הבדיקה נכשלה — לא הצלחתי להגיע ל-Green API.',
      };
    }
  }

  /**
   * The decisive probe: can this instance actually PUBLISH to a channel?
   *
   * Seeing a channel in getChats only proves the instance knows it exists. Publishing needs
   * two separate capabilities, and they can differ — so both are tried and reported apart:
   * a text message, and an image with a caption (what a real post is). A post that can only
   * go out as text would be a different, much weaker feature, and the owner should learn
   * that here rather than from a month of bare-text posts.
   */
  async testWhatsAppChannelSend(userId: string, chatId: string) {
    const target = String(chatId || '').trim();
    if (!target.endsWith('@newsletter')) {
      return { ok: false, text: null, image: null, error: 'מזהה ערוץ חייב להסתיים ב-@newsletter.' };
    }
    const creds = await this.credentials.getRaw(userId).catch(() => null);
    if ((creds?.whatsapp_provider || 'green') !== 'green') {
      return { ok: false, text: null, image: null, error: 'בדיקת ערוץ רלוונטית רק לספק Green API.' };
    }
    const instance = (creds?.green_api_instance_id || '').trim();
    const token = creds?.green_api_token || '';
    if (!instance || !token) {
      return { ok: false, text: null, image: null, error: 'לא הוגדרו Instance ID / Token של Green API.' };
    }

    const base = (creds?.green_api_url || 'https://api.green-api.com').replace(/\/$/, '');
    const call = async (method: string, payload: Record<string, unknown>): Promise<GreenSendResult> => {
      try {
        const res = await axios.post(`${base}/waInstance${instance}/${method}/${token}`, payload,
          { timeout: 20_000, validateStatus: () => true });
        return describeGreenSendResult(res.status, res.data);
      } catch (err: any) {
        return { ok: false, detail: err?.message || 'הקריאה נכשלה.' };
      }
    };

    const text = await call('sendMessage', {
      chatId: target, message: '✅ Nexlify — בדיקת פרסום לערוץ (טקסט)',
    });
    // A public asset of ours: Green API fetches the URL server-side, so it must be reachable
    // from the internet — not a signed or localhost address.
    const logo = `${(process.env.FRONTEND_URL || 'https://nexlify.win-solutions.co.il').replace(/\/$/, '')}/logo-full.png`;
    const image = await call('sendFileByUrl', {
      chatId: target, urlFile: logo, fileName: 'nexlify.png',
      caption: '✅ Nexlify — בדיקת פרסום לערוץ (תמונה + כיתוב)',
    });

    return { ok: text.ok || image.ok, text, image, error: null as string | null };
  }

  /** When this group's Facebook PAGE last received a post — the FB throttle clock. */
  async getFacebookLastSent(userId: string, channelId: string): Promise<Date | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.facebook_last_sent_at ?? null;
  }

  /** Stamp the group's Facebook page as just-posted (advances the FB throttle clock). */
  async markFacebookSent(userId: string, channelId: string): Promise<void> {
    await this.repo.update({ user_id: userId, channel_id: channelId }, { facebook_last_sent_at: new Date() });
  }

  /** Fetches member count from Telegram's getChatMemberCount API */
  private async fetchMemberCount(token: string, chatId: string): Promise<number | null> {
    try {
      const res = await axios.get(
        `https://api.telegram.org/bot${token}/getChatMemberCount`,
        { params: { chat_id: chatId }, timeout: 8000 },
      );
      if (res.data?.ok && typeof res.data.result === 'number') {
        return res.data.result;
      }
    } catch {
      // Silently ignore — member count is best-effort
    }
    return null;
  }

  /** Refreshes member counts for all channels that have a token + channel_id */
  private async refreshMemberCounts(channels: Channel[]): Promise<void> {
    const eligible = channels.filter((c) => c.bot_token_enc && c.channel_id);
    await Promise.all(
      eligible.map(async (c) => {
        const token = decrypt(c.bot_token_enc);
        const chatId = normalizeTelegramChatId(c.channel_id);
        const count = await this.fetchMemberCount(token, chatId);
        if (count !== null && count !== c.members_count) {
          await this.repo.update(c.id, { members_count: count });
          c.members_count = count; // update in-memory so toPublic() returns the fresh value
        }
      }),
    );
  }

  /**
   * Resolve a saved channel by its Telegram channel_id → the bot token + normalized
   * chat id to actually send with. Each channel can carry its OWN bot token, so a post
   * routed here MUST use that bot (the default bot is usually not a member → "chat not
   * found"). Returns null if the user has no matching channel (caller falls back to the
   * default credentials). `token` is null when the channel has no own token (use default).
   */
  /**
   * If a raw chat id (e.g. the user's default channel) is ALSO a saved group, return that
   * group's channel_id — else null. Lets the queue route a "no group" post into the saved
   * group's bucket when they're the same chat, so one chat never has two parallel queues.
   * Matches on the normalized chat id so a bare id and a -100-prefixed id are equal.
   */
  async groupIdForChat(userId: string, chatId: string): Promise<string | null> {
    const target = normalizeTelegramChatId((chatId || '').trim());
    if (!target) return null;
    const active = await this.repo.find({ where: { user_id: userId, is_active: true } });
    const match = active.find((c) => normalizeTelegramChatId(c.channel_id) === target);
    return match ? match.channel_id : null;
  }

  async resolveSendTarget(userId: string, channelId: string): Promise<{ token: string | null; chatId: string } | null> {
    // Exact match first (the common case — the id came from a saved channel row).
    let c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    // Fall back to a NORMALIZED match so a saved channel still resolves when the caller
    // passed the id in a different form (e.g. "@name" vs "-100…", stray whitespace). This
    // keeps the ownership gate in sendToTelegramChannel from wrongly rejecting a legit
    // saved target on a formatting difference.
    if (!c) {
      const target = normalizeTelegramChatId((channelId || '').trim());
      if (target) {
        const owned = await this.repo.find({ where: { user_id: userId } });
        c = owned.find((ch) => normalizeTelegramChatId(ch.channel_id) === target) || null;
      }
    }
    if (!c) return null;
    return {
      token: c.bot_token_enc ? decrypt(c.bot_token_enc) : null,
      chatId: normalizeTelegramChatId(c.channel_id),
    };
  }

  /** The per-channel footer template id (each group has its own join link). Null → use the global default. */
  async getFooterTemplateId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.footer_template_id || null;
  }

  /** The per-channel body template id (each group can have its own copy style). Null → global default. */
  async getBodyTemplateId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.body_template_id || null;
  }

  /** The per-channel Facebook Page id (each group has its own page). Null → global default. */
  async getFacebookPageId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.facebook_page_id || null;
  }

  /** The per-channel Facebook Page token (decrypted). Null → use the account's global token. */
  async getFacebookPageToken(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.facebook_page_token_enc ? decrypt(c.facebook_page_token_enc) : null;
  }

  /** The per-channel Instagram Business id. Null → use the account's global account. */
  async getInstagramBusinessId(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.instagram_business_id || null;
  }

  /** Every group of a user, for the per-group queue cron. */
  async listForSchedule(userId: string): Promise<Channel[]> {
    return this.repo.find({ where: { user_id: userId }, order: { created_at: 'ASC' } });
  }

  /**
   * A group's send-window hours (null = the group inherits the account's global window).
   * Lets a campaign that targets a specific group publish in THAT group's hours instead of
   * a global default. Returns null when no such group exists.
   */
  async getScheduleWindow(
    userId: string,
    channelId: string,
  ): Promise<{ startHour: number | null; endHour: number | null } | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    if (!c) return null;
    return { startHour: c.schedule_start_hour ?? null, endHour: c.schedule_end_hour ?? null };
  }

  /** The group's send interval in minutes (its own setting), or null to inherit the default. */
  async getIntervalMinutes(userId: string, channelId: string): Promise<number | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.schedule_interval_minutes ?? null;
  }

  /**
   * Stamp the per-group send clock for each of `channelIds`. A post that fanned out to
   * several groups advances ALL of their clocks, so no group gets an extra free slot.
   */
  async markSent(userId: string, channelIds: string[], at: Date): Promise<void> {
    const ids = Array.from(new Set((channelIds || []).filter(Boolean)));
    if (!ids.length) return;
    await this.repo
      .createQueryBuilder()
      .update(Channel)
      .set({ schedule_last_sent_at: at })
      .where('user_id = :userId AND channel_id IN (:...ids)', { userId, ids })
      .execute();
  }

  /**
   * "Start the meter" on enqueue so a freshly-queued post can't fire on the very next
   * scheduler tick. When a group's send clock is stale — never sent, or older than its
   * interval — the queue gate treats a new post as immediately due, which the user reads
   * as "it published instead of going into the queue". Stamping the clock to `now` makes
   * the first queued post wait one full interval; a group mid-drip (recent clock) is left
   * untouched so its cadence isn't pushed back. Per-channel interval falls back to the
   * user's global interval when the channel inherits it.
   */
  async primeScheduleIfStale(userId: string, channelIds: string[], now: Date, fallbackIntervalMin: number): Promise<void> {
    const ids = Array.from(new Set((channelIds || []).filter(Boolean)));
    if (!ids.length) return;
    const chans = await this.repo.find({ where: { user_id: userId, channel_id: In(ids) } });
    const stale = chans.filter((c) => {
      const interval = c.schedule_interval_minutes ?? fallbackIntervalMin;
      const last = c.schedule_last_sent_at ? new Date(c.schedule_last_sent_at).getTime() : 0;
      return !last || (now.getTime() - last) / 60_000 >= interval;
    }).map((c) => c.channel_id);
    if (stale.length) await this.markSent(userId, stale, now);
  }

  /** The saved channel's display name (for multi-group error labels). Null if unknown. */
  async getName(userId: string, channelId: string): Promise<string | null> {
    const c = await this.repo.findOne({ where: { user_id: userId, channel_id: channelId } });
    return c?.name || null;
  }

  /**
   * Broadcast a plain-text announcement to every saved Telegram group. Each group is sent
   * with its OWN bot token (falling back to `fallbackToken` — the user's default bot — when
   * a channel has none). Best-effort per group; returns delivery counts.
   */
  async broadcastText(userId: string, text: string, fallbackToken?: string | null): Promise<{ sent: number; failed: number; total: number }> {
    const channels = await this.repo.find({ where: { user_id: userId } });
    let sent = 0, failed = 0;
    for (const c of channels) {
      const token = (c.bot_token_enc ? decrypt(c.bot_token_enc) : null) || fallbackToken || null;
      const chatId = c.channel_id ? normalizeTelegramChatId(c.channel_id) : null;
      if (!token || !chatId) { failed++; continue; }
      try {
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text, disable_web_page_preview: false },
          { timeout: 10000 },
        );
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed, total: channels.length };
  }

  private async findOwned(userId: string, id: string): Promise<Channel> {
    const channel = await this.repo.findOne({ where: { id, user_id: userId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  private toPublic(c: Channel) {
    return {
      id: c.id,
      name: c.name,
      platform: c.platform,
      channel_id: c.channel_id || '',
      description: c.description || '',
      is_active: c.is_active,
      has_token: !!c.bot_token_enc,
      bot_token_masked: c.bot_token_enc ? mask(decrypt(c.bot_token_enc)) : null,
      body_template_id: c.body_template_id || null,
      footer_template_id: c.footer_template_id || null,
      facebook_page_id: c.facebook_page_id || '',
      instagram_business_id: c.instagram_business_id || '',
      // FB token status only — never return the token itself; masked for display.
      has_fb_token: !!c.facebook_page_token_enc,
      fb_token_masked: c.facebook_page_token_enc ? mask(decrypt(c.facebook_page_token_enc)) : null,
      // The countdown on the card. null = unknown (never resolved, or a non-expiring token)
      // and the UI must say "unknown" rather than imply a problem.
      fb_token_expires_at: c.facebook_token_expires_at ?? null,
      fb_token_days_left: daysUntil(c.facebook_token_expires_at),
      smart_timing: c.smart_timing === true,
      // Per-group queue settings — null means "inherit the global schedule".
      schedule_enabled: c.schedule_enabled ?? null,
      schedule_interval_minutes: c.schedule_interval_minutes ?? null,
      schedule_start_hour: c.schedule_start_hour ?? null,
      schedule_end_hour: c.schedule_end_hour ?? null,
      schedule_last_sent_at: c.schedule_last_sent_at ?? null,
      members_count: c.members_count || 0,
      created_at: c.created_at,
      updated_at: c.updated_at,
    };
  }
}
