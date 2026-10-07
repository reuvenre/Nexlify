import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AsyncLocalStorage } from 'async_hooks';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Channel } from '../channels/channel.entity';
import { ShopperSearch } from './shopper-search.entity';
import { normaliseSearch, searchesReport } from './search-stats';
import { User } from '../users/user.entity';
import { Post } from '../posts/post.entity';
import { ChannelMessage } from './channel-message.entity';
import { PriceAlert } from './price-alert.entity';
import { BotStart } from './bot-start.entity';
import { ParcelTrack } from './parcel-track.entity';
import {
  DEFAULT_DAILY_REGISTRATIONS, MAX_PARCELS_PER_READER, PARCEL_HELP, PARCEL_TTL_DAYS, ParcelState, followButton, isFinal,
  isNewStage, isTrackHelp, parcelCard, parseParcelCallback, parseTrackingNumber, readTrackInfo,
} from './parcel-tracking';
import { parcelInfo, parcelQuota, registerParcel, seventeenTrackKey } from './seventeen-track';
import { parseStartSource, startsReport } from './bot-start';
import {
  ALERT_MAX_MISSES, ALERT_TTL_DAYS, MAX_ALERTS_PER_READER, isPriceDrop, isStopAlerts, parseAlertCallback, priceDropCaption,
  watchButton, watchable, watchingText,
} from './price-alerts';
import {
  ChannelRef, buyLink, channelPostRef, channelPostUrl, forwardedChannelRef, isOwnChannel, messageLinks, messageText, parsePostLink,
} from './channel-capture';
import { ProductsService } from '../products/products.service';
import { PostsService } from '../posts/posts.service';
import { CredentialsService } from '../credentials/credentials.service';
import { OptimizerService } from '../optimizer/optimizer.service';
import { CB_DETAIL, CB_UNDO, CB_UNDO_LIST, undoKeyboard } from '../optimizer/digest-keyboard';
import {
  BotProduct, encodeCallback, matchByPrefix, parseCallback, productCaption, truncate,
} from './product-card';
import { splitMessage } from './split-message';
import { groupReadiness, readinessLine } from './group-readiness';
import {
  SEARCH_BOT_DESCRIPTION, SEARCH_BOT_NAME, SEARCH_BOT_SHORT_DESCRIPTION, searchBotToken, searchWebhookSecret, searchWebhookUrl,
} from './search-bot';
import { SEARCH_BOT_UPDATES, WebhookVerdict, webhookVerdict } from '../watchdog/webhook-health';
import { LinksService } from '../links/links.service';
import { ManagerAgentService, ManagerAnswer, isAuthError } from '../manager/manager-agent.service';
import { AgentClient } from '../agents/agent-client.service';
import { PersistentValueStore } from '../common/persistent-value.store';
import {
  REWRITE_EMPTY_TTL_MS, REWRITE_MODEL, REWRITE_SYSTEM, REWRITE_TTL_MS, parseRewrites, titleMatchesSearch, rewriteKey, rewritePrompt,
} from './query-rewrite';
import { managerQuestion } from '../manager/manager-intent';
import { proposalText } from '../manager/manager-proposal';
import {
  SHOPPER_HELP, SHOPPER_WELCOME, MORE_BUTTON, ChannelPostRow, HEBREW_FINALS, channelHits, postHeadline, channelMatchFloor, channelSearchTerms, sameProductKeys, isMoreRequest, ShopperQuery, ShopperLimiter, escapeHtml, takeUnseen, parseShopperQuery, rankShopperResults, shopperCaption,
} from './shopper';

/** Inline keyboard row(s) as Telegram wants them. A button carries EITHER a callback or a
 *  url — the morning report's "open the dashboard" button is the latter. */
type Keyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>;

const RESULTS_PER_PAGE = 5;

const HELP = [
  '🛍️ מילת חיפוש ← מוצרים עם כפתור "פרסם לקבוצה"',
  '🧠 שאלה ← המנהל עונה, למשל: למה פינטרסט ירד השבוע?',
  '/status · /searches · /groups · /resetsearches · /weekly',
].join('\n');

/**
 * Two-way Telegram bot for finding and publishing products from the phone.
 *
 * The owner DMs a keyword, gets the top results as photo cards, taps a product,
 * picks one of their groups and the post goes out through the SAME quickPost path
 * the dashboard uses (AI copy, affiliate short link, per-group template).
 *
 * Access is the owner chat only — identical to the watchdog's /status gate — so the
 * bot needs no auth of its own and can never publish on behalf of another tenant.
 *
 * Search results are cached in memory because a product CANNOT be re-resolved from
 * its id alone (the affiliate API only searches keywords, so a re-fetch would post a
 * wrong or empty product). A cache miss is reported, never guessed around.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);

  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private static readonly CACHE_MAX = 400;

  /** product_id → the card we showed, so a publish tap keeps the real price/title/image. */
  private readonly shown = new Map<string, { product: BotProduct; at: number }>();
  /** chat → last keyword, powering "עוד תוצאות" without re-typing it. */
  private readonly lastQuery = new Map<string, { keyword: string; page: number; at: number }>();
  /** Budgets for the members' search — anyone can reach it, so it is metered. */
  private readonly shopperLimits = new ShopperLimiter();
  /** A reader's last search, so «עוד מוצרים» continues it. Re-derivable (they can search
   *  again), so memory is the right store; half an hour is a conversation. */
  private readonly shopperSessions = new Map<string, {
    q: ShopperQuery; ranked: BotProduct[]; shown: number; page: number; done: boolean; at: number;
    /** Every key of every product in `ranked` (shopper.ts sameProductKeys) — no repeats. */
    seen: Set<string>;
    /** The reader's own words, when `q` is a model's rewrite of them — what the reader is shown. */
    label?: string;
  }>();
  /** Which bot answers this update. Set while handling the search bot's updates, so every
   *  reply in that flow goes out from the bot the reader wrote to (see search-bot.ts). */
  private readonly replyVia = new AsyncLocalStorage<{ token: string }>();
  private searchBotName: { username: string | null; at: number } | null = null;

  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ShopperSearch) private readonly searches: Repository<ShopperSearch>,
    @InjectRepository(Post) private readonly postsRepo: Repository<Post>,
    @InjectRepository(ChannelMessage) private readonly channelMessages: Repository<ChannelMessage>,
    @InjectRepository(PriceAlert) private readonly alerts: Repository<PriceAlert>,
    @InjectRepository(BotStart) private readonly starts: Repository<BotStart>,
    @InjectRepository(ParcelTrack) private readonly parcels: Repository<ParcelTrack>,
    private readonly products: ProductsService,
    private readonly posts: PostsService,
    private readonly credentials: CredentialsService,
    // The morning report's buttons: show the evidence, and take a change back.
    private readonly optimizer: OptimizerService,
    private readonly manager: ManagerAgentService,
    private readonly links: LinksService,
    // The readers' search: a small model rewrites a search AliExpress cannot read (query-rewrite.ts).
    private readonly agentClient: AgentClient,
    private readonly memory: PersistentValueStore,
  ) {}

  // ── Entry point ────────────────────────────────────────────────────────────

  /** Handle one Telegram update the webhook routed here (everything that isn't /status). */
  async handleUpdate(update: any): Promise<void> {
    if (update?.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    // A post in one of the owner's channels (the bot is its admin): keep it searchable.
    const channelPost = update?.channel_post || update?.edited_channel_post;
    if (channelPost) {
      await this.captureChannelPost(channelPost);
      return;
    }
    const msg = update?.message;
    const text = String(msg?.text || '').trim();
    const chatId = String(msg?.chat?.id ?? '');
    // The owner forwarding a channel post (photo posts carry a caption, not text) saves it.
    if (chatId && this.isOwner(chatId) && forwardedChannelRef(msg)) {
      await this.saveForwardedPost(chatId, msg);
      return;
    }
    if (!text || !chatId) return;
    // The owner sending a link to one of his channel posts (a channel that blocks forwarding).
    if (this.isOwner(chatId) && parsePostLink(text)) {
      await this.savePostByLink(chatId, msg);
      return;
    }
    if (this.isOwner(chatId)) {
      await this.handleMessage(chatId, text);
      return;
    }
    // Everyone else — group members and strangers in a private chat — gets the product
    // search and nothing more: no buttons, no publishing, no data. When the search has a
    // bot of its own, a reader who reached the owner's bot (an older post's link) is sent
    // on to it instead.
    if (searchBotToken() && msg?.chat?.type === 'private') {
      const username = await this.searchBotUsername();
      if (username) {
        await this.send(chatId, `🔎 החיפוש עבר לבוט החדש שלנו — לחצו כאן: https://t.me/${username}?start=moved`);
        return;
      }
    }
    await this.handleShopper(msg, text);
  }

  /** An update delivered to the search bot's own webhook: every sender is a reader. */
  async handleSearchBotUpdate(update: any): Promise<void> {
    const token = searchBotToken();
    // The 🔔 under a result — the only buttons this bot sends.
    if (token && update?.callback_query) {
      await this.replyVia.run({ token }, () => this.onReaderTap(update.callback_query));
      return;
    }
    const msg = update?.message;
    const text = String(msg?.text || '').trim();
    // The owner may forward channel posts here too — save them, never search their text.
    if (token && msg?.chat?.id && this.isOwner(String(msg.chat.id)) && forwardedChannelRef(msg)) {
      await this.replyVia.run({ token }, () => this.saveForwardedPost(String(msg.chat.id), msg));
      return;
    }
    // The owner's search-log commands work here too — this is where he looks at the readers' side.
    if (token && msg?.chat?.id && this.isOwner(String(msg.chat.id)) && /^\/(?:searches|resetsearches)(?:@\S+)?(?:\s|$)/i.test(text)) {
      const chatId = String(msg.chat.id);
      const reset = text.match(/^\/resetsearches(?:@\S+)?(?:\s+(.+))?$/i);
      await this.replyVia.run({ token }, () => (reset ? this.resetSearches(chatId, (reset[1] || '').trim()) : this.reportSearches(chatId)));
      return;
    }
    if (token && msg?.chat?.id && this.isOwner(String(msg.chat.id)) && parsePostLink(text)) {
      await this.replyVia.run({ token }, () => this.savePostByLink(String(msg.chat.id), msg));
      return;
    }
    if (!token || !text || !msg?.chat?.id) return;
    // The owner testing the readers' bot gets the readers' search — except a question for
    // the manager, which lives in his own bot (it needs buttons this bot does not receive).
    // Without this pointer his question came back as a list of products.
    const chatId = String(msg.chat.id);
    if (msg.chat.type === 'private' && this.isOwner(chatId) && managerQuestion(text)) {
      const me = await this.get('getMe', {});
      const ownBot = me?.username ? `@${me.username}` : 'הבוט של הדוחות';
      await this.replyVia.run({ token }, () => this.send(chatId,
        `🧠 שאלות למנהל עונים ב-${ownBot} (הבוט שבו אתה מקבל את הדוחות).\n`
        + 'כאן זה הבוט של הקוראים — כל הודעה היא חיפוש מוצר, בדיוק כמו שהם רואים.'));
      return;
    }
    await this.replyVia.run({ token }, () => this.handleShopper(msg, text));
  }

  /**
   * The @username readers should be sent to: the search bot's when one is configured,
   * otherwise null. Cached for an hour — getMe does not change.
   */
  async searchBotUsername(): Promise<string | null> {
    const token = searchBotToken();
    if (!token) return null;
    if (this.searchBotName && Date.now() - this.searchBotName.at < 3600_000) return this.searchBotName.username;
    const me = await this.replyVia.run({ token }, () => this.get('getMe', {}));
    this.searchBotName = { username: me?.username || null, at: Date.now() };
    return this.searchBotName.username;
  }

  /** Only the configured owner chat is answered; anything else is silently ignored. */
  private isOwner(chatId: string): boolean {
    const owner = String(process.env.WATCHDOG_TELEGRAM_CHAT_ID || '');
    return !!owner && chatId === owner;
  }

  private async handleMessage(chatId: string, text: string): Promise<void> {
    const question = managerQuestion(text);
    if (question) {
      await this.askManager(chatId, question);
      return;
    }
    const reset = text.match(/^\/resetsearches(?:@\S+)?(?:\s+(.+))?$/i);
    if (reset) {
      await this.resetSearches(chatId, (reset[1] || '').trim());
      return;
    }
    if (/^\/searches(@\S+)?$/i.test(text)) {
      await this.reportSearches(chatId);
      return;
    }
    // The manager's weekly review, now — the same one Sunday morning brings unasked.
    if (/^\/weekly(@\S+)?$/i.test(text)) {
      await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
      await this.sendWeeklyReview(chatId);
      return;
    }
    if (/^\/groups(@\S+)?$/i.test(text)) {
      await this.reportGroups(chatId);
      return;
    }
    // The owner tapping the link at the foot of his own post (/start post) sees what his
    // readers see — not his own command list.
    if (/^\/start(@\S+)?(\s|$)/i.test(text)) {
      await this.send(chatId, `👀 כך זה נראה לקוראים שלוחצים על הקישור בפוסט:\n\n${SHOPPER_WELCOME}`
        + '\n\n(חיפוש רגיל כאן הוא החיפוש שלך, עם כפתורי פרסום. כדי לקבל בדיוק מה שקורא מקבל: /find ואחריו החיפוש)');
      return;
    }
    // /find in the owner's chat is the READER's search — three picks with links, no publish
    // buttons — so he can see exactly what his readers get. /search and plain text stay his.
    if (/^\/find(@\S+)?(\s|$)/i.test(text)) {
      await this.handleShopper({ chat: { id: chatId, type: 'private' }, from: { id: `owner:${chatId}` } }, text);
      return;
    }
    const keyword = this.keywordFrom(text);
    if (!keyword) {
      await this.send(chatId, HELP);
      return;
    }
    await this.runSearch(chatId, keyword, 1);
  }

  /**
   * The search term in a message. A bare message IS the term; `/search foo` (also
   * `/search@MyBot foo`) carries it as an argument. Any other slash command has no
   * term — the caller answers with the help text instead of searching for "/foo".
   */
  private keywordFrom(text: string): string | null {
    if (!text.startsWith('/')) return text;
    const [rawCmd, ...rest] = text.split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();
    if (cmd !== '/search' && cmd !== '/find') return null;
    return rest.join(' ').trim() || null;
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  private async runSearch(chatId: string, keyword: string, page: number): Promise<void> {
    const userId = await this.ownerUserId();
    if (!userId) {
      await this.send(chatId, '❌ לא נמצא משתמש אדמין במערכת.');
      return;
    }

    let items: BotProduct[];
    try {
      // A budget in the owner's search works the same as in the readers' ("…עד 200 ש"ח").
      const q = parseShopperQuery(keyword) || { keyword };
      const res = await this.products.search(userId, {
        keyword: q.keyword, min_price: q.minPrice, max_price: q.maxPrice, page, limit: RESULTS_PER_PAGE,
      });
      items = (res?.data || []) as BotProduct[];
    } catch (err: any) {
      this.logger.warn(`bot search "${keyword}" failed: ${err?.message}`);
      await this.send(chatId, `❌ החיפוש נכשל: ${err?.message || err}`);
      return;
    }

    if (!items.length) {
      await this.send(chatId, page > 1
        ? `אין עוד תוצאות עבור «${keyword}».`
        : `לא נמצאו מוצרים עבור «${keyword}». נסה ניסוח אחר.`);
      return;
    }

    this.lastQuery.set(chatId, { keyword, page, at: Date.now() });
    await this.send(chatId, `🔎 «${keyword}» — ${items.length} תוצאות (עמוד ${page}):`);

    let index = (page - 1) * RESULTS_PER_PAGE;
    for (const p of items) {
      index++;
      this.remember(p);
      const caption = productCaption(p, index);
      const keyboard: Keyboard = [[
        { text: '📤 פרסם לקבוצה', callback_data: encodeCallback('c', p.product_id) },
      ]];
      // A photo that Telegram refuses to fetch must not swallow the whole result.
      const sent = p.image_url
        ? await this.sendPhoto(chatId, p.image_url, caption, keyboard)
        : false;
      if (!sent) await this.send(chatId, caption, keyboard);
    }

    await this.send(chatId, 'רוצה עוד אפשרויות?', [[
      { text: '🔄 עוד תוצאות', callback_data: encodeCallback('m', String(page + 1)) },
    ]]);
  }

  // ── Button taps ────────────────────────────────────────────────────────────

  private async handleCallback(cq: any): Promise<void> {
    const chatId = String(cq?.message?.chat?.id ?? '');
    const messageId = cq?.message?.message_id;
    const cbId = String(cq?.id || '');
    // A reader's 🔔 under a search result (when the readers use this bot) — any reader may tap it.
    if (parseAlertCallback(String(cq?.data || '')) || parseParcelCallback(String(cq?.data || ''))) {
      await this.onReaderTap(cq);
      return;
    }
    if (!chatId || !this.isOwner(chatId)) {
      await this.answer(cbId);
      return;
    }

    const { action, args } = parseCallback(String(cq?.data || ''));
    switch (action) {
      case 'm': return this.onMoreResults(chatId, cbId, Number(args[0]));
      case 'c': return this.onPickChannel(chatId, cbId, args[0]);
      case 'g': return this.onPublish(chatId, cbId, messageId, args[0], args[1]);
      case CB_DETAIL: return this.onDigestDetail(chatId, cbId, args[0]);
      case CB_UNDO_LIST: return this.onUndoList(chatId, cbId);
      case CB_UNDO: return this.onUndo(chatId, cbId, messageId, args[0]);
      case 'pa': return this.onProposal(chatId, cbId, messageId, args[0], true);
      case 'pr': return this.onProposal(chatId, cbId, messageId, args[0], false);
      case 'rs': return this.onResetSearches(chatId, cbId, messageId, args[0]);
      case 'x':
        await this.answer(cbId, 'בוטל');
        await this.editText(chatId, messageId, 'בוטל.');
        return;
      default:
        await this.answer(cbId);
    }
  }

  // ── The manager ────────────────────────────────────────────────────────────

  /** A question for the manager agent: answer, then each proposal with its own buttons. */
  private async askManager(chatId: string, question: string): Promise<void> {
    const userId = await this.ownerUserId();
    if (!userId) {
      await this.send(chatId, '❌ לא נמצא משתמש אדמין במערכת.');
      return;
    }
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
    let answer;
    try {
      answer = await this.manager.ask(userId, question, chatId);
    } catch (err: any) {
      this.logger.warn(`manager ask failed: ${err?.message}`);
      await this.send(chatId, isAuthError(err)
        // Said in the owner's terms, with where to fix it — not the raw API JSON.
        ? '🔑 מפתח ה-Anthropic נדחה (לא תקין או פג תוקף), ולכן המנהל לא יכול לענות.\n'
          + 'צור מפתח חדש ב-console.anthropic.com ← API Keys, והדבק אותו בלוח הבקרה: הגדרות ← Anthropic API Key '
          + '(או עדכן את ANTHROPIC_API_KEY ב-Render).'
        : `❌ המנהל לא הצליח לענות: ${err?.message || err}`);
      return;
    }
    await this.deliverManagerAnswer(chatId, answer);
  }

  /** The manager's answer, then each proposal with its own ✅/❌. */
  private async deliverManagerAnswer(chatId: string, answer: ManagerAnswer, header = ''): Promise<void> {
    await this.sendLong(chatId, `${header}${answer.text}`);
    for (const p of answer.proposals) {
      await this.send(chatId, `💡 הצעה: ${proposalText(p)}\n${p.reason}`, [[
        { text: '✅ אשר', callback_data: encodeCallback('pa', p.id) },
        { text: '❌ דחה', callback_data: encodeCallback('pr', p.id) },
      ]]);
    }
  }

  // ── The manager, unasked ────────────────────────────────────────────────

  private weeklyRunning = false;

  /**
   * Sunday morning, the manager reads the week and brings what it would change — at most
   * three proposals, each waiting for the owner's tap. Tried every 20 minutes from 09:00 to
   * 13:40 until one gets through; the week's delivery is remembered in persistent_values, so
   * a deploy mid-morning neither loses it nor sends it twice. Off with MANAGER_WEEKLY_DISABLED=1.
   */
  @Cron('0 */20 9-13 * * 0', { timeZone: 'Asia/Jerusalem' })
  async weeklyManagerReview(): Promise<void> {
    const chatId = String(process.env.WATCHDOG_TELEGRAM_CHAT_ID || '');
    if (!chatId || process.env.MANAGER_WEEKLY_DISABLED === '1' || this.weeklyRunning) return;
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const key = `manager_weekly:${day}`;
    if (await this.memory.load(key)) return;
    this.weeklyRunning = true;
    try {
      if (await this.sendWeeklyReview(chatId)) await this.memory.save(key, true, 8 * 24 * 3600_000);
    } finally {
      this.weeklyRunning = false;
    }
  }

  /** Run the review and send it. False when it should be tried again later. */
  private async sendWeeklyReview(chatId: string): Promise<boolean> {
    const userId = await this.ownerUserId();
    if (!userId) return false;
    let answer: ManagerAnswer;
    try {
      answer = await this.manager.weeklyReview(userId);
    } catch (err: any) {
      this.logger.warn(`weekly review failed: ${err?.message}`);
      if (!isAuthError(err)) return false; // a blip — the next slot tries again
      // Retrying a refused key changes nothing: say so once, in the owner's terms.
      await this.send(chatId, '🔑 הסקירה השבועית של המנהל לא נשלחה: מפתח ה-Anthropic נדחה. '
        + 'עדכן אותו בהגדרות ← Anthropic API Key (או ANTHROPIC_API_KEY ב-Render), ואז שלח /weekly.');
      return true;
    }
    await this.deliverManagerAnswer(chatId, answer, '🧭 הסקירה השבועית של המנהל\n\n');
    return true;
  }

  /** "אשר" / "דחה" on a proposal. Editing the message drops the buttons — one tap only. */
  private async onProposal(
    chatId: string, cbId: string, messageId: number | undefined, proposalId: string | undefined, approve: boolean,
  ): Promise<void> {
    const userId = await this.ownerUserId();
    if (!proposalId || !userId) {
      await this.answer(cbId, 'לא נמצא');
      return;
    }
    await this.answer(cbId, approve ? 'מבצע…' : 'נדחה');
    if (approve) {
      const res = await this.manager.approve(userId, proposalId);
      await this.editText(chatId, messageId, res.ok ? res.message : `❌ ${res.message}`);
    } else {
      await this.editText(chatId, messageId, await this.manager.reject(userId, proposalId));
    }
  }

  // ── The members' product search ────────────────────────────────────────────

  /**
   * A non-owner message. In a private chat any text is a search; in a group only an explicit
   * /find (or /search) is, and only in the owner's own groups — the bot added to a stranger's
   * group must not become a free search engine on the owner's API quota.
   */
  private async handleShopper(msg: any, text: string): Promise<void> {
    if (process.env.SHOPPER_BOT_DISABLED === '1') return;
    const chat = msg?.chat || {};
    const chatId = String(chat.id ?? '');
    const isPrivate = chat.type === 'private';
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    if (!isPrivate && !isGroup) return;

    // «בטל התראות» / /stop — every price alert of this reader goes.
    if (isPrivate && isStopAlerts(text)) {
      const res: any = await this.alerts.query(
        `UPDATE price_alerts SET active = false WHERE chat_id = $1 AND active RETURNING id`, [chatId],
      ).catch(() => [[]]);
      const n = Array.isArray(res?.[0]) ? res[0].length : Array.isArray(res) ? res.length : 0;
      await this.send(chatId, n > 1 ? `🔕 ביטלתי ${n} התראות מחיר.` : n ? '🔕 ביטלתי את התראת המחיר.' : 'אין לך התראות מחיר פעילות.');
      return;
    }

    // «איפה החבילה שלי?» — a tracking number, /track, or /parcels (parcel-tracking.ts).
    if (isPrivate && (parseTrackingNumber(text) || isTrackHelp(text))) {
      await this.handleParcelMessage(chatId, text);
      return;
    }

    let query = text;
    if (text.startsWith('/')) {
      const [rawCmd, ...rest] = text.split(/\s+/);
      const cmd = rawCmd.split('@')[0].toLowerCase();
      if (cmd === '/find' || cmd === '/search') {
        query = rest.join(' ').trim();
      } else {
        // /start, /help and anything else: explain, but only in private — a group sees
        // other bots' commands all day, and answering them would be noise.
        if (isPrivate) {
          await this.send(chatId, SHOPPER_WELCOME);
          await this.recordStart(text, String(msg?.from?.id ?? chatId));
        }
        return;
      }
    } else if (isGroup) {
      return;
    }

    const userId = await this.ownerUserId();
    if (!userId) return;
    if (isGroup && !(await this.isOwnersGroup(userId, chat))) return;

    const replyTo = isGroup ? msg.message_id : undefined;
    const memberKey = String(msg?.from?.id ?? chatId);

    // «עוד מוצרים» — the next three of the same search, private chats only.
    if (isPrivate && isMoreRequest(query)) {
      await this.moreShopperResults(chatId, userId, memberKey);
      return;
    }

    const parsed = parseShopperQuery(query);
    if (!parsed) {
      await this.send(chatId, SHOPPER_HELP, undefined, replyTo);
      return;
    }

    const budget = this.shopperLimits.take(memberKey);
    if (budget !== 'ok') {
      if (budget === 'user') await this.send(chatId, '⏳ הרבה חיפושים ברצף — נסה שוב בעוד כמה דקות.', undefined, replyTo);
      return;
    }

    // The channel first: a product AliExpress hides under another name is found by the
    // words our own post used. Its products then count as seen, so the API never repeats them.
    const seen = new Set<string>();
    const channel = await this.channelPostHits(userId, parsed).catch((err) => {
      this.logger.warn(`channel search "${parsed.keyword}" failed: ${err?.message}`);
      return { hits: [] as Array<{ post: ChannelPostRow; product: BotProduct }>, matched: -1, terms: [] as string[],
        error: String(err?.message || err).slice(0, 200) };
    });
    const fromChannel = channel.hits;
    // The owner testing the readers' search sees what the channel search did — readers don't.
    // The English search a model wrote when the reader's own words found nothing (query-rewrite.ts).
    let rewrite: string | null = null;
    // What the rewrite step did, for the owner's 🔧 line — including why it did nothing.
    let rewriteNote = '';
    // What reached the reader from the channel (filled in below, read by ownerDiag).
    let shownChannel = 0;
    let shownFull = 0;
    const ownerDiag = async () => {
      if (!isPrivate || !(this.isOwner(chatId) || memberKey.startsWith('owner:'))) return;
      const terms = channelSearchTerms(parsed.keyword);
      let line = channel.matched < 0
        ? `החיפוש בערוץ נכשל: ${(channel as { error?: string }).error}`
        : `בפוסטים של הערוץ: ${channel.matched} תואמים ל-${terms.join(' + ')}, הוצגו ${shownChannel}`
          + (shownChannel ? ` (${shownFull} עם כל המילים).` : '.');
      if (fromChannel.length === 0) {
        line += `\n${await this.channelSearchFunnel(userId, terms).catch((e) => `בדיקה נכשלה: ${e?.message}`)}`;
      }
      if (rewriteNote) line += `\n🪄 ${rewriteNote}`;
      // Which build answered — Render sets RENDER_GIT_COMMIT; tells "not deployed yet" apart from "deployed and missed".
      const build = String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7);
      await this.send(chatId, `🔧 (רק אתה רואה${build ? ` · גרסה ${build}` : ''}) ${line}`);
    };
    fromChannel.forEach((h) => sameProductKeys(h.product).forEach((k) => seen.add(k)));

    let ranked: BotProduct[] = [];
    try {
      ranked = takeUnseen(await this.shopperPage(userId, parsed, 1), seen);
    } catch (err: any) {
      this.logger.warn(`shopper search "${parsed.keyword}" failed: ${err?.message}`);
      if (!fromChannel.length) {
        await this.send(chatId, '❌ החיפוש לא זמין כרגע, נסה שוב מאוחר יותר.', undefined, replyTo);
        return;
      }
    }

    // The reader's words found nothing on AliExpress, or nothing related: let a model turn them
    // into the English a seller writes, and search again. Its results go first; the originals
    // stay behind them. The model only rewrites the search — it never sees or picks a product.
    // A channel post that holds every word of the search is a full match; one that matched on
    // its long word only («פיקטיני» in a post about a flashlight FOR picatinny) is partial, and
    // gives way to AliExpress results that do match the search.
    const searchLetters = channel.terms.reduce((n, t) => n + t.length, 0);
    const fullCh = fromChannel.filter((h) => Number((h.post as any).score) >= searchLetters);
    const partCh = fromChannel.filter((h) => !fullCh.includes(h));
    // AliExpress results that cover the search go first (titleMatchesSearch), the rest after.
    const matches = (p: BotProduct) => titleMatchesSearch(parsed.keyword, p.title);
    let relatedN = ranked.filter(matches).length;
    ranked = [...ranked.filter(matches), ...ranked.filter((p) => !matches(p))];

    if (fullCh.length >= 3) {
      rewriteNote = 'ניסוח חכם: לא נדרש — הערוץ מילא את התוצאות';
    } else if (process.env.SHOPPER_REWRITE_DISABLED === '1') {
      rewriteNote = 'ניסוח חכם: כבוי (SHOPPER_REWRITE_DISABLED)';
    } else if (relatedN > 0) {
      rewriteNote = `ניסוח חכם: לא נדרש — ${relatedN} מתוצאות AliExpress מתאימות לחיפוש`;
    } else {
      try {
        const found = await this.rewrittenResults(userId, parsed, seen);
        if (found.query) {
          // The rewrite's results answer the search by construction — they count as matching.
          ranked = [...found.items, ...ranked];
          relatedN = found.items.length;
          rewrite = found.query;
          rewriteNote = `AliExpress לא הבין את החיפוש — חיפשתי במקומו: ${rewrite}`;
        } else {
          rewriteNote = found.queries.length
            ? `ניסוח חכם: Haiku הציע ${found.queries.join(' · ')} — אבל לא נמצאו מוצרים חדשים`
            : 'ניסוח חכם: Haiku לא הציע ניסוח לחיפוש הזה';
        }
      } catch (err: any) {
        this.logger.warn(`shopper rewrite "${parsed.keyword}" failed: ${err?.message}`);
        rewriteNote = `ניסוח חכם נכשל: ${String(err?.message || err).slice(0, 160)}`;
      }
    }

    // Up to three, in this order: channel posts with every word, AliExpress results that match
    // the search, channel posts that matched in part. AliExpress results that do NOT match
    // (a phone clamp for «מתפס פיקטיני») only when there is nothing else at all — two right
    // answers beat three with a wrong one. The API's share is always a prefix of `ranked`,
    // so «עוד מוצרים» picks up after it.
    const slots = 3 - fullCh.length;
    const apiFirst = ranked.slice(0, Math.min(relatedN, slots));
    const partPicks = partCh.slice(0, slots - apiFirst.length);
    const apiRest = fullCh.length + apiFirst.length + partPicks.length ? [] : ranked.slice(0, slots);
    const picks = [...apiFirst, ...apiRest];
    const channelPicks = [...fullCh, ...partPicks];
    const shownInOrder = [...fullCh.map((h) => h.product), ...apiFirst, ...partPicks.map((h) => h.product), ...apiRest];
    const total = shownInOrder.length;
    shownChannel = channelPicks.length;
    shownFull = fullCh.length;
    // What readers ask for — anonymous, and never the owner's own test searches: his /find
    // in his own bot ('owner:…'), and him writing to the readers' bot (his Telegram id).
    if (!memberKey.startsWith('owner:') && !this.isOwner(memberKey)) {
      void this.searches.insert({
        user_id: userId, keyword: normaliseSearch(parsed.keyword),
        max_price: parsed.maxPrice ?? null, results: total, rewrite,
      }).catch((err) => this.logger.warn(`search log failed: ${err?.message}`));
    }
    if (!total) {
      await this.send(chatId, `לא מצאתי מוצרים מתאימים ל«${parsed.keyword}»${parsed.maxPrice ? ' בתקציב הזה' : ''}. נסה ניסוח אחר.`,
        undefined, replyTo);
      await ownerDiag();
      return;
    }
    if (isPrivate) {
      // «עוד מוצרים» pages on with the search that worked — the rewrite, when there was one.
      const q = rewrite ? { ...parsed, keyword: rewrite } : parsed;
      this.shopperSessions.set(chatId, { q, ranked, shown: picks.length, page: 1, done: false, at: Date.now(), seen, label: parsed.keyword });
      if (this.shopperSessions.size > 2000) this.shopperSessions.delete(this.shopperSessions.keys().next().value as string);
    }

    const budgetLabel = parsed.maxPrice || parsed.minPrice
      // No parentheses: a bracket at the end of right-to-left text is drawn mirrored.
      ? ` ${[parsed.minPrice ? `מ-${parsed.minPrice}` : '', parsed.maxPrice ? `עד ${parsed.maxPrice}` : ''].filter(Boolean).join(' ')} ש"ח`
      : '';
    const header = `🔎 ${total} המומלצים ל«${escapeHtml(parsed.keyword)}»${budgetLabel}:`;
    await this.showShopperResults(chatId, userId, header, shownInOrder, 1, isGroup, replyTo,
      new Map(channelPicks.map((h) => [h.product.product_id, h.post.id])));
    await ownerDiag();
  }

  /** How much of the search a post covers, in letters of the stems it contains ($2 = stems). */
  private static channelScore(haystack: string): string {
    return `(SELECT coalesce(sum(length(t)), 0) FROM unnest($2::text[]) t
      WHERE translate(${haystack}, '${HEBREW_FINALS[0]}', '${HEBREW_FINALS[1]}') ILIKE '%' || t || '%')`;
  }
  private static readonly CHANNEL_SCORE = TelegramBotService.channelScore(
    `coalesce(generated_text, '') || ' ' || coalesce(product_title, '')`);
  private static readonly CHANNEL_MESSAGE_SCORE = TelegramBotService.channelScore(`coalesce(text, '')`);

  /**
   * Posts the channel already published that cover most of the search (CHANNEL_MATCH_SHARE
   * of its letters), best covered first, then newest — at most two shown, within the
   * reader's budget. A post without a stored price passes any budget. Only sent posts with
   * a photo and somewhere to send the reader (channelPostLink), never an expired promotion.
   */
  private async channelPostHits(userId: string, q: ShopperQuery): Promise<{
    hits: Array<{ post: ChannelPostRow; product: BotProduct }>; matched: number; terms: string[];
  }> {
    const terms = channelSearchTerms(q.keyword);
    if (!terms.length) return { hits: [], matched: 0, terms };
    const rows: ChannelPostRow[] = await this.postsRepo.query(
      `SELECT * FROM (
         SELECT id, product_id, product_title, product_image, gallery_json, generated_text, price_ils,
                affiliate_url, coalesce(sent_at, created_at) AS at, ${TelegramBotService.CHANNEL_SCORE} AS score
           FROM posts
          WHERE user_id = $1 AND status = 'sent'
            AND coalesce(sent_at, created_at) > now() - interval '180 days'
            AND coalesce(promo_expired, false) = false
            AND ($3::float IS NULL OR coalesce(price_ils, 0) <= 0 OR price_ils >= $3)
            AND ($4::float IS NULL OR coalesce(price_ils, 0) <= 0 OR price_ils <= $4)
       ) m
       WHERE score >= $5
       ORDER BY score DESC, at DESC
       LIMIT 30`,
      [userId, terms, q.minPrice ?? null, q.maxPrice ?? null, channelMatchFloor(terms)],
    );
    // What the channel itself shows: posts edited in Telegram, deleted from the posts screen,
    // or written there by hand. No stored price — they pass any budget, like a custom post.
    const shown: Array<{ id: string; chat_id: string; chat_username: string | null; message_id: number;
      text: string; buy_url: string; at: Date; score: string }> = await this.channelMessages.query(
      `SELECT * FROM (
         SELECT id, chat_id, chat_username, message_id, text, buy_url, posted_at AS at,
                ${TelegramBotService.CHANNEL_MESSAGE_SCORE} AS score
           FROM channel_messages
          WHERE user_id = $1 AND coalesce(buy_url, '') <> ''
       ) m
       WHERE score >= $3
       ORDER BY score DESC, at DESC
       LIMIT 30`,
      [userId, terms, channelMatchFloor(terms)],
    ).catch((err) => { this.logger.warn(`channel_messages search failed: ${err?.message}`); return []; });
    const fromChannel: Array<ChannelPostRow & { score: number; at: Date; rank: number }> = shown.map((m) => ({
      id: m.id, product_id: `tg:${m.chat_id}:${m.message_id}`, product_title: '', product_image: '',
      generated_text: m.text, price_ils: 0, affiliate_url: m.buy_url,
      post_url: channelPostUrl(m.chat_username, m.chat_id, m.message_id), score: Number(m.score), at: m.at, rank: 1,
    }));
    // Best covered first; on a tie the system's own post (it has the photo), then the newest.
    const merged = [...(rows as any[]).map((r) => ({ ...r, score: Number(r.score), rank: 0 })), ...fromChannel]
      .sort((a, b) => b.score - a.score || a.rank - b.rank || new Date(b.at).getTime() - new Date(a.at).getTime());
    return { hits: channelHits(merged, 2, terms), matched: rows.length + shown.length, terms };
  }

  /**
   * For the owner only, when the channel search came back empty: where the matching posts
   * fell out — so a miss can be read off one test instead of guessed at.
   */
  private async channelSearchFunnel(userId: string, terms: string[]): Promise<string> {
    if (!terms.length) return 'אין מילים לחפש';
    const [r] = await this.postsRepo.query(
      `SELECT count(*)::int AS text,
              count(*) FILTER (WHERE user_id = $1)::int AS mine,
              count(*) FILTER (WHERE user_id = $1 AND status = 'sent')::int AS sent,
              count(*) FILTER (WHERE user_id = $1 AND status = 'sent'
                AND coalesce(sent_at, created_at) > now() - interval '180 days')::int AS recent,
              string_agg(DISTINCT status, ',') AS statuses
         FROM posts WHERE ${TelegramBotService.CHANNEL_SCORE} >= $3`,
      [userId, terms, channelMatchFloor(terms)],
    );
    // Each stem on its own, across every post: tells "the words are not in our posts" apart
    // from "they are, but the match floor or a filter dropped them".
    const each: Array<{ t: string; n: number; last: Date | null }> = await this.postsRepo.query(
      `SELECT t, count(p.id)::int AS n, max(coalesce(p.sent_at, p.created_at)) AS last
         FROM unnest($1::text[]) t
         LEFT JOIN posts p ON translate(coalesce(p.generated_text, '') || ' ' || coalesce(p.product_title, ''),
                                        '${HEBREW_FINALS[0]}', '${HEBREW_FINALS[1]}') ILIKE '%' || t || '%'
        GROUP BY t`,
      [terms],
    );
    const [cm] = await this.channelMessages.query(
      `SELECT count(*)::int AS saved,
              count(*) FILTER (WHERE ${TelegramBotService.CHANNEL_MESSAGE_SCORE} >= $3)::int AS matching
         FROM channel_messages WHERE user_id = $1 AND $2::text[] IS NOT NULL`,
      [userId, terms, channelMatchFloor(terms)],
    ).catch(() => [null]);
    const perTerm = each.map((e) => `«${e.t}» ב-${e.n}${e.last ? ` (אחרון ${new Date(e.last).toISOString().slice(0, 10)})` : ''}`).join(' · ');
    return `בכל המערכת ${r?.text ?? 0} פוסטים מכילים את המילים · שלך ${r?.mine ?? 0} · נשלחו ${r?.sent ?? 0}`
      + ` · ב-180 יום ${r?.recent ?? 0}${r?.statuses ? ` · סטטוסים: ${r.statuses}` : ''}\nכל מילה לבד: ${perTerm}`
      + `\nשמורים מהערוץ עצמו: ${cm?.saved ?? 0}, תואמים ${cm?.matching ?? 0}`;
  }

  /**
   * Search again with the model's English rewrites of the reader's words, until three new
   * products are found. `query` is the first rewrite that found anything.
   */
  private async rewrittenResults(
    userId: string, q: ShopperQuery, seen: Set<string>,
  ): Promise<{ query: string | null; items: BotProduct[]; queries: string[] }> {
    const queries = await this.rewriteQueries(userId, q.keyword);
    let query: string | null = null;
    const items: BotProduct[] = [];
    for (const rq of queries) {
      const page = await this.shopperPage(userId, { ...q, keyword: rq }, 1).catch(() => [] as BotProduct[]);
      const fresh = takeUnseen(page, seen);
      if (fresh.length && !query) query = rq;
      items.push(...fresh);
      if (items.length >= 3) break;
    }
    return { query, items, queries };
  }

  /**
   * The model's rewrites of one search, remembered in persistent_values: the same words from
   * the next reader cost no model call. A failed call is not remembered — the next search
   * tries again.
   */
  private async rewriteQueries(userId: string, keyword: string): Promise<string[]> {
    const key = rewriteKey(keyword);
    const cached = await this.memory.load<string[]>(key);
    if (Array.isArray(cached)) return cached;

    let { client } = await this.agentClient.for(userId);
    const request = {
      model: REWRITE_MODEL, max_tokens: 200,
      system: REWRITE_SYSTEM,
      messages: [{ role: 'user' as const, content: rewritePrompt(keyword) }],
    };
    let response;
    try {
      response = await client.messages.create(request, { timeout: 10_000 });
    } catch (err: any) {
      const other = isAuthError(err) ? this.agentClient.fallback(client) : null;
      if (!other) throw err;
      client = other;
      response = await client.messages.create(request, { timeout: 10_000 });
    }
    this.agentClient.record(userId, response.usage);
    const text = response.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const queries = parseRewrites(text, keyword);
    await this.memory.save(key, queries, queries.length ? REWRITE_TTL_MS : REWRITE_EMPTY_TTL_MS);
    return queries;
  }

  /** One page of the API, ranked, links only. Throws on an API failure (strict search). */
  private async shopperPage(userId: string, q: ShopperQuery, page: number): Promise<BotProduct[]> {
    const res = await this.products.search(userId, {
      keyword: q.keyword,
      min_price: q.minPrice,
      max_price: q.maxPrice,
      page,
      limit: 20,
      // Never mock data in front of a stranger: a failed search says so instead.
      strict: true,
      // Readers write Hebrew; the titles they get back should be Hebrew too.
      title_language: 'HE',
    });
    const items = ((res?.data || []) as BotProduct[]).filter((p) => !!p.affiliate_url);
    return rankShopperResults(items, items.length);
  }

  /** The next three of the reader's last search, fetching the next API page when needed. */
  private async moreShopperResults(chatId: string, userId: string, memberKey: string): Promise<void> {
    const session = this.shopperSessions.get(chatId);
    if (!session || Date.now() - session.at > 30 * 60_000) {
      await this.send(chatId, 'על מה להביא עוד? כתבו מה אתם מחפשים, למשל: אוזניות בלוטות\' עד 100 ש"ח');
      return;
    }
    if (this.shopperLimits.take(memberKey) !== 'ok') {
      await this.send(chatId, '⏳ הרבה חיפושים ברצף — נסה שוב בעוד כמה דקות.');
      return;
    }
    session.at = Date.now();
    if (session.ranked.length - session.shown < 3 && !session.done) {
      try {
        // Same product under another id, photo or title counts as seen (sameProductKeys).
        const next = takeUnseen(await this.shopperPage(userId, session.q, session.page + 1), session.seen);
        session.page++;
        if (!next.length) session.done = true;
        session.ranked.push(...next);
      } catch (err: any) {
        this.logger.warn(`shopper more "${session.q.keyword}" failed: ${err?.message}`);
      }
    }
    const picks = session.ranked.slice(session.shown, session.shown + 3);
    if (!picks.length) {
      await this.send(chatId, `זה כל מה שמצאתי ל«${session.label ?? session.q.keyword}» 🙂 נסו ניסוח אחר או מוצר אחר.`);
      return;
    }
    const from = session.shown + 1;
    session.shown += picks.length;
    const header = `🔄 עוד ${picks.length} ל«${escapeHtml(session.label ?? session.q.keyword)}»:`;
    await this.showShopperResults(chatId, userId, header, picks, from, false);
  }

  /**
   * Results, laid out like the channel posts: the buy button carries the link and the URL
   * itself is never shown — hence HTML. In a private chat the header also brings the
   * «עוד מוצרים» button, a reply-keyboard key that simply sends that text.
   */
  private async showShopperResults(
    chatId: string, userId: string, header: string, picks: BotProduct[], from: number,
    isGroup: boolean, replyTo?: number,
    /** product_id → post id, for results that are the channel's own posts. */
    channelPosts: Map<string, string> = new Map(),
  ): Promise<void> {
    const linkFor = async (p: BotProduct) => {
      // A channel post keeps its own short link, so the click counts on that post.
      const postId = channelPosts.get(p.product_id);
      const post = postId ? await this.postsRepo.findOne({ where: { id: postId } }).catch(() => null) : null;
      if (post?.affiliate_url) {
        const code = await this.links.ensureCode(post).catch(() => null);
        return code ? this.links.shortUrl(code) : post.affiliate_url;
      }
      // Already one of our short links (a channel post's buy button): its clicks count on that post.
      if (p.affiliate_url!.startsWith(this.links.shortUrl(''))) return p.affiliate_url!;
      const code = await this.links.mintTarget(p.affiliate_url!, userId, 'shopper').catch(() => null);
      return code ? this.links.shortUrl(code) : p.affiliate_url!;
    };
    if (isGroup) {
      // One reply in a group — three photo cards per search would flood it.
      const blocks: string[] = [];
      for (let i = 0; i < picks.length; i++) blocks.push(shopperCaption(picks[i], from + i, await linkFor(picks[i])));
      await this.sendHtml(chatId, [header, ...blocks].join('\n\n'), replyTo);
      return;
    }
    await this.call('sendMessage', {
      chat_id: chatId, text: header, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: {
        keyboard: [[{ text: MORE_BUTTON }]], resize_keyboard: true, is_persistent: true,
        input_field_placeholder: 'מה אתם מחפשים?',
      },
    });
    for (let i = 0; i < picks.length; i++) {
      const caption = shopperCaption(picks[i], from + i, await linkFor(picks[i]));
      if (!picks[i].image_url) {
        // A post saved from the channel itself: its own preview shows the photo, above the text.
        await this.call('sendMessage', {
          chat_id: chatId, text: caption, parse_mode: 'HTML',
          link_preview_options: picks[i].post_url
            ? { url: picks[i].post_url, prefer_large_media: true, show_above_text: true }
            : { is_disabled: true },
        });
        continue;
      }
      // 🔔 under every AliExpress product: «תודיע לי כשהמחיר יורד».
      const bell = watchable(picks[i]);
      if (bell) this.rememberForAlert(picks[i]);
      const sent = await this.call('sendPhoto', {
        chat_id: chatId, photo: picks[i].image_url!, caption, parse_mode: 'HTML',
        ...(bell ? { reply_markup: { inline_keyboard: [[watchButton(picks[i].product_id)]] } } : {}),
      });
      if (!sent) await this.sendHtml(chatId, caption);
    }
  }

  /** An HTML message (the readers' results). Callers escape any text they did not write. */
  private sendHtml(chatId: string, text: string, replyTo?: number): Promise<boolean> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    });
  }

  /** Is this group one of the owner's own Telegram groups? Matched by id or @username. */
  private async isOwnersGroup(userId: string, chat: any): Promise<boolean> {
    const ids = new Set([String(chat.id)]);
    if (chat.username) ids.add(`@${String(chat.username).toLowerCase()}`);
    const groups = await this.telegramChannels(userId).catch(() => [] as Channel[]);
    return groups.some((g) => ids.has(String(g.channel_id).trim().toLowerCase()) || ids.has(String(g.channel_id).trim()));
  }

  // ── Where readers come in from (bot-start.ts) ─────────────────────────────

  /** Readers already counted per source today — a reader tapping the same link twice is one entry. */
  private readonly startsSeen = new Map<string, number>();

  /** A /start through one of our links, counted anonymously — never the owner's own taps. */
  private async recordStart(text: string, memberKey: string): Promise<void> {
    const source = parseStartSource(text);
    if (!source || memberKey.startsWith('owner:') || this.isOwner(memberKey)) return;
    const seenKey = `${memberKey}:${source}`;
    const now = Date.now();
    if (now - (this.startsSeen.get(seenKey) || 0) < 24 * 3600_000) return;
    this.startsSeen.set(seenKey, now);
    if (this.startsSeen.size > 20000) this.startsSeen.delete(this.startsSeen.keys().next().value as string);
    const userId = await this.ownerUserId();
    if (!userId) return;
    await this.starts.insert({ user_id: userId, source })
      .catch((err) => this.logger.warn(`bot start log failed: ${err?.message}`));
  }

  // ── Parcel tracking (parcel-tracking.ts, seventeen-track.ts) ─────────────

  /** A tap under a reader's result or parcel card: price alert or parcel follow. */
  private async onReaderTap(cq: any): Promise<void> {
    if (parseParcelCallback(String(cq?.data || ''))) await this.onParcelTap(cq);
    else await this.onAlertTap(cq);
  }

  /** A tracking number (the free page at once, 🔔 when the API is set up), or the reader's list. */
  private async handleParcelMessage(chatId: string, text: string): Promise<void> {
    const number = parseTrackingNumber(text);
    const mine: ParcelTrack[] = await this.parcels.find({ where: { chat_id: chatId, active: true }, order: { created_at: 'DESC' } })
      .catch(() => []);
    if (!number) {
      const list = mine.map((p) => parcelCard(p.number, { status: p.status, subStatus: p.sub_status, eventTime: null, eventText: null, eventLocation: null }));
      await this.sendHtml(chatId, list.length ? [`📦 החבילות שאני עוקב אחריהן בשבילך:`, ...list].join('\n\n') : PARCEL_HELP);
      return;
    }
    const followed = mine.find((p) => p.number === number);
    let state: ParcelState | null = null;
    if (followed && seventeenTrackKey()) {
      state = await parcelInfo([number]).then((m) => (m.has(number) ? readTrackInfo(m.get(number)) : null)).catch(() => null);
    }
    const button = seventeenTrackKey() ? [[followButton(number, !!followed)]] : undefined;
    await this.call('sendMessage', {
      chat_id: chatId, text: parcelCard(number, state), parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      ...(button ? { reply_markup: { inline_keyboard: button } } : {}),
    });
  }

  /** 🔔 / 🔕 under a parcel card. Following registers the number with 17TRACK (one unit of quota). */
  private async onParcelTap(cq: any): Promise<void> {
    const cbId = String(cq?.id || '');
    const tap = parseParcelCallback(String(cq?.data || ''));
    const chatId = String(cq?.message?.chat?.id ?? '');
    if (!tap || !chatId || cq?.message?.chat?.type !== 'private' || !seventeenTrackKey()) {
      await this.answer(cbId);
      return;
    }
    const setButton = (following: boolean) => this.call('editMessageReplyMarkup', {
      chat_id: chatId, message_id: cq?.message?.message_id, reply_markup: { inline_keyboard: [[followButton(tap.number, following)]] },
    });
    if (tap.action === 'stop') {
      await this.parcels.query(`UPDATE parcel_tracks SET active = false WHERE chat_id = $1 AND number = $2`, [chatId, tap.number]).catch(() => {});
      await this.answer(cbId, '🔕 המעקב בוטל');
      await setButton(false);
      return;
    }
    const userId = await this.ownerUserId();
    if (!userId) { await this.answer(cbId); return; }
    const [{ n }] = await this.parcels.query(
      `SELECT count(*)::int AS n FROM parcel_tracks WHERE chat_id = $1 AND active AND number <> $2`, [chatId, tap.number],
    ).catch(() => [{ n: 0 }]);
    if (n >= MAX_PARCELS_PER_READER) {
      await this.answer(cbId, `אני כבר עוקב אחרי ${MAX_PARCELS_PER_READER} חבילות שלך. כשאחת תגיע, אפשר להוסיף עוד.`);
      return;
    }
    // The quota does not refill — a daily cap keeps one busy day from spending it all.
    const cap = Number(process.env.PARCEL_DAILY_REGISTRATIONS) || DEFAULT_DAILY_REGISTRATIONS;
    const [{ today }] = await this.parcels.query(
      `SELECT count(*)::int AS today FROM parcel_tracks WHERE created_at > now() - interval '1 day'`,
    ).catch(() => [{ today: 0 }]);
    const existing = await this.parcels.findOne({ where: { chat_id: chatId, number: tap.number } }).catch(() => null);
    if (!existing && today >= cap) {
      await this.answer(cbId, 'המעקב האוטומטי מלא להיום — נסו מחר. הקישור למעקב עובד בינתיים.');
      return;
    }
    const reg = await registerParcel(tap.number);
    if (!reg.ok) {
      this.logger.warn(`parcel register ${tap.number} failed: ${reg.error}`);
      await this.answer(cbId, reg.quotaOut
        ? 'המעקב האוטומטי לא זמין כרגע. הקישור למעקב עובד — אפשר לבדוק בו בכל רגע.'
        : 'לא הצלחתי לרשום את המספר למעקב. כדאי לבדוק שהוא נכון ולנסות שוב.');
      return;
    }
    await this.parcels.query(
      `INSERT INTO parcel_tracks (user_id, chat_id, number) VALUES ($1, $2, $3)
       ON CONFLICT (chat_id, number) DO UPDATE SET active = true, checked_at = NULL`,
      [userId, chatId, tap.number],
    );
    await this.answer(cbId, '🔔 אעדכן אותך בכל שלב, עד שהחבילה מגיעה.');
    await setButton(true);
  }

  private parcelsRunning = false;

  /**
   * Every two hours in waking hours: read every followed parcel from 17TRACK (40 per call,
   * no quota) and tell the reader when it reaches a new stage. A delivered parcel is
   * announced once and dropped. Off with PARCEL_TRACKING_DISABLED=1, or without a key.
   */
  @Cron('0 10 8-22/2 * * *', { timeZone: 'Asia/Jerusalem' })
  async checkParcels(): Promise<{ checked: number; sent: number }> {
    const result = { checked: 0, sent: 0 };
    if (this.parcelsRunning || process.env.PARCEL_TRACKING_DISABLED === '1' || !seventeenTrackKey()) return result;
    this.parcelsRunning = true;
    try {
      await this.parcels.query(
        `UPDATE parcel_tracks SET active = false WHERE active AND created_at < now() - ($1 || ' days')::interval`,
        [String(PARCEL_TTL_DAYS)],
      );
      // A tracking number is the reader's data too — gone a month after following ends.
      await this.parcels.query(`DELETE FROM parcel_tracks WHERE NOT active AND created_at < now() - interval '30 days'`);
      const rows: ParcelTrack[] = await this.parcels.query(`SELECT * FROM parcel_tracks WHERE active ORDER BY checked_at ASC NULLS FIRST LIMIT 400`);
      if (!rows.length) return result;
      const token = searchBotToken() || await this.telegramToken();
      if (!token) return result;
      const infos = await parcelInfo([...new Set(rows.map((r) => r.number))]).catch((err) => {
        this.logger.warn(`parcels: 17TRACK read failed: ${err?.message}`);
        return null;
      });
      if (!infos) return result;
      const blocked = new Set<string>();
      for (const r of rows) {
        if (blocked.has(r.chat_id)) continue;
        result.checked++;
        const info = infos.get(r.number);
        if (!info) continue;
        const state = readTrackInfo(info);
        const final = isFinal(state.status, state.subStatus);
        if (isNewStage({ status: r.status, subStatus: r.sub_status }, state)) {
          const outcome = await this.replyVia.run({ token }, () => this.sendToReader('sendMessage', {
            chat_id: r.chat_id, text: parcelCard(r.number, state, { update: true }), parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(final ? {} : { reply_markup: { inline_keyboard: [[followButton(r.number, true)]] } }),
          }));
          if (outcome === 'blocked') {
            blocked.add(r.chat_id);
            await this.parcels.query(`UPDATE parcel_tracks SET active = false WHERE chat_id = $1`, [r.chat_id]);
            continue;
          }
          if (outcome === 'failed') continue; // the stage is told again next time
          result.sent++;
        }
        await this.parcels.query(
          `UPDATE parcel_tracks SET status = $2, sub_status = $3, event_time = $4, checked_at = now(),
             notified_at = CASE WHEN $5 THEN now() ELSE notified_at END, active = NOT $6 WHERE id = $1`,
          [r.id, state.status, state.subStatus, state.eventTime, isNewStage({ status: r.status, subStatus: r.sub_status }, state), final],
        );
      }
    } catch (err: any) {
      this.logger.warn(`parcel run failed: ${err?.message}`);
    } finally {
      this.parcelsRunning = false;
    }
    return result;
  }

  /** One message to a reader, telling a blocked bot apart from a passing failure. */
  private async sendToReader(method: string, body: Record<string, unknown>): Promise<'sent' | 'blocked' | 'failed'> {
    const token = this.replyVia.getStore()?.token;
    try {
      await axios.post(`https://api.telegram.org/bot${token}/${method}`, body, { timeout: 15000 });
      return 'sent';
    } catch (err: any) {
      const status = err?.response?.status;
      const desc = String(err?.response?.data?.description || err?.message || '');
      this.logger.warn(`reader message to ${body.chat_id} failed: ${desc}`);
      return status === 403 || /blocked|deactivated|chat not found/i.test(desc) ? 'blocked' : 'failed';
    }
  }

  // ── Price-drop alerts (price-alerts.ts) ───────────────────────────────────

  /** Products just shown to readers, so a 🔔 tap knows the price they saw without an API call. */
  private readonly alertProducts = new Map<string, { product: BotProduct; at: number }>();

  private rememberForAlert(p: BotProduct): void {
    this.alertProducts.set(p.product_id, { product: p, at: Date.now() });
    if (this.alertProducts.size > 5000) this.alertProducts.delete(this.alertProducts.keys().next().value as string);
  }

  /** A tap on 🔔 / 🔕 under a result. Private chats only — an alert is a private message. */
  private async onAlertTap(cq: any): Promise<void> {
    const cbId = String(cq?.id || '');
    const tap = parseAlertCallback(String(cq?.data || ''));
    const chatId = String(cq?.message?.chat?.id ?? '');
    const messageId = cq?.message?.message_id;
    if (!tap || !chatId || cq?.message?.chat?.type !== 'private') {
      await this.answer(cbId);
      return;
    }
    const userId = await this.ownerUserId();
    if (!userId) {
      await this.answer(cbId);
      return;
    }
    const setButton = (watching: boolean) => this.call('editMessageReplyMarkup', {
      chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[watchButton(tap.productId, watching)]] },
    });

    if (tap.action === 'stop') {
      await this.alerts.query(`UPDATE price_alerts SET active = false WHERE chat_id = $1 AND product_id = $2`, [chatId, tap.productId])
        .catch(() => {});
      await this.answer(cbId, '🔕 המעקב בוטל');
      await setButton(false);
      return;
    }

    const [{ n }] = await this.alerts.query(
      `SELECT count(*)::int AS n FROM price_alerts WHERE chat_id = $1 AND active AND product_id <> $2`, [chatId, tap.productId],
    ).catch(() => [{ n: 0 }]);
    if (n >= MAX_ALERTS_PER_READER) {
      await this.answer(cbId, `יש לך כבר ${MAX_ALERTS_PER_READER} מוצרים במעקב. כתוב /stop כדי לבטל את כולם.`);
      return;
    }
    const cached = this.alertProducts.get(tap.productId);
    const product = cached && Date.now() - cached.at < 6 * 3600_000
      ? cached.product
      : (await this.products.refreshPricesBatch(userId, [tap.productId]).catch(() => new Map())).get(tap.productId);
    if (!product || !(Number(product.sale_price) > 0)) {
      await this.answer(cbId, 'לא הצלחתי לקרוא את המחיר כרגע — נסה שוב בעוד רגע.');
      return;
    }
    await this.alerts.query(
      `INSERT INTO price_alerts (user_id, chat_id, product_id, title, image_url, price_ils, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (chat_id, product_id) DO UPDATE
         SET active = true, price_ils = EXCLUDED.price_ils, title = EXCLUDED.title, image_url = EXCLUDED.image_url,
             currency = EXCLUDED.currency, misses = 0, notified_at = NULL, notified_price = NULL, created_at = now()`,
      [userId, chatId, tap.productId, String(product.title || '').slice(0, 200), product.image_url || null,
        Number(product.sale_price), product.currency || 'ILS'],
    );
    await this.answer(cbId, watchingText(product.title, Number(product.sale_price), product.currency || 'ILS'));
    await setButton(true);
  }

  private alertsRunning = false;

  /**
   * Four times a day, in waking hours: re-price every watched product (20 per API call) and
   * message the readers whose price really dropped. An alert fires once; the message carries
   * the 🔔 again for a reader who wants to keep watching. Off with PRICE_ALERTS_DISABLED=1.
   */
  @Cron('0 25 9,13,17,21 * * *', { timeZone: 'Asia/Jerusalem' })
  async checkPriceAlerts(): Promise<{ checked: number; sent: number }> {
    const result = { checked: 0, sent: 0 };
    if (this.alertsRunning || process.env.PRICE_ALERTS_DISABLED === '1') return result;
    this.alertsRunning = true;
    try {
      await this.alerts.query(
        `UPDATE price_alerts SET active = false WHERE active AND created_at < now() - ($1 || ' days')::interval`,
        [String(ALERT_TTL_DAYS)],
      );
      const rows: PriceAlert[] = await this.alerts.query(
        `SELECT * FROM price_alerts WHERE active ORDER BY checked_at ASC NULLS FIRST LIMIT 500`,
      );
      const token = searchBotToken() || await this.telegramToken();
      if (!token) return result;

      const byUser = new Map<string, PriceAlert[]>();
      for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);
      for (const [userId, list] of byUser) {
        const ids = [...new Set(list.map((a) => a.product_id))];
        const prices = new Map<string, any>();
        const unreached = new Set<string>();
        const blocked = new Set<string>();
        for (let i = 0; i < ids.length; i += 20) {
          const chunk = ids.slice(i, i + 20);
          try {
            const got = await this.products.refreshPricesBatch(userId, chunk);
            // Not one product back is the API (keys, quota, an error inside a 200), not a whole
            // chunk delisted at once — no miss. A lone delisted product still ends at ALERT_TTL_DAYS.
            if (!got.size) chunk.forEach((id) => unreached.add(id));
            got.forEach((v, k) => prices.set(k, v));
          } catch (err: any) {
            // An API failure says nothing about the products — no miss is counted.
            this.logger.warn(`price alerts: price check failed: ${err?.message}`);
            chunk.forEach((id) => unreached.add(id));
          }
        }
        for (const a of list) {
          if (blocked.has(a.chat_id)) continue;
          result.checked++;
          const now = prices.get(a.product_id);
          if (!now) {
            if (unreached.has(a.product_id)) continue;
            await this.alerts.query(
              `UPDATE price_alerts SET misses = misses + 1, checked_at = now(), active = (misses + 1 < $2) WHERE id = $1`,
              [a.id, ALERT_MAX_MISSES],
            );
            continue;
          }
          if (!isPriceDrop(a.price_ils, Number(now.sale_price))) {
            await this.alerts.query(`UPDATE price_alerts SET misses = 0, checked_at = now() WHERE id = $1`, [a.id]);
            continue;
          }
          const outcome = await this.replyVia.run({ token }, () => this.sendPriceDrop(userId, a, now));
          if (outcome === 'failed') continue; // try again at the next check
          if (outcome === 'blocked') {
            // The reader blocked the bot: nothing of theirs can be delivered any more.
            blocked.add(a.chat_id);
            await this.alerts.query(`UPDATE price_alerts SET active = false WHERE chat_id = $1`, [a.chat_id]);
            continue;
          }
          await this.alerts.query(
            `UPDATE price_alerts SET active = false, notified_at = now(), notified_price = $2, checked_at = now() WHERE id = $1`,
            [a.id, Number(now.sale_price)],
          );
          result.sent++;
        }
      }
    } catch (err: any) {
      this.logger.warn(`price alerts run failed: ${err?.message}`);
    } finally {
      this.alertsRunning = false;
    }
    return result;
  }

  /** One alert, as a photo card with the buy button and the 🔔 to keep watching. */
  private async sendPriceDrop(userId: string, a: PriceAlert, now: any): Promise<'sent' | 'blocked' | 'failed'> {
    const code = await this.links.mintTarget(now.affiliate_url || '', userId, 'alert').catch(() => null);
    const link = code ? this.links.shortUrl(code) : now.affiliate_url;
    if (!link) return 'failed';
    const caption = priceDropCaption(a, now, link);
    // The 🔔 on this message must set the bar at the price shown here, not the one cached earlier.
    this.rememberForAlert(now);
    const token = this.replyVia.getStore()?.token;
    const base = `https://api.telegram.org/bot${token}`;
    const markup = { inline_keyboard: [[watchButton(a.product_id)]] };
    try {
      const photo = now.image_url || a.image_url;
      if (photo) {
        await axios.post(`${base}/sendPhoto`, { chat_id: a.chat_id, photo, caption, parse_mode: 'HTML', reply_markup: markup }, { timeout: 15000 });
      } else {
        await axios.post(`${base}/sendMessage`, { chat_id: a.chat_id, text: caption, parse_mode: 'HTML', reply_markup: markup }, { timeout: 15000 });
      }
      return 'sent';
    } catch (err: any) {
      const status = err?.response?.status;
      const desc = String(err?.response?.data?.description || err?.message || '');
      this.logger.warn(`price alert to ${a.chat_id} failed: ${desc}`);
      return status === 403 || /blocked|deactivated|chat not found/i.test(desc) ? 'blocked' : 'failed';
    }
  }

  // ── The channel as it really is ────────────────────────────────────────────

  /** A post (or an edit) in a channel the bot administers — kept when it is one of the owner's. */
  private async captureChannelPost(msg: any): Promise<void> {
    const ref = channelPostRef(msg);
    const text = messageText(msg).trim();
    // An album's other photos carry no caption; the one with the text is what is searched.
    if (!ref || !text) return;
    const userId = await this.ownerUserId();
    if (!userId) return;
    const own = await this.telegramChannels(userId).catch(() => [] as Channel[]);
    if (!isOwnChannel(ref, own.map((c) => c.channel_id))) return;
    await this.saveChannelMessage(userId, ref, text, buyLink(messageLinks(msg)))
      .catch((err) => this.logger.warn(`channel post ${ref.chatId}/${ref.messageId} not saved: ${err?.message}`));
  }

  /**
   * The owner forwarded a channel post to the bot — the way an OLD post gets in, since
   * Telegram gives a bot no channel history. Only his own channels: a post from someone
   * else's channel carries their affiliate link, and readers would buy through it.
   */
  private async saveForwardedPost(chatId: string, msg: any): Promise<void> {
    const ref = forwardedChannelRef(msg)!;
    const text = messageText(msg).trim();
    if (!text) {
      // An album arrives one photo per message and only one carries the caption — stay quiet.
      if (!msg?.media_group_id) await this.send(chatId, '⚠️ בפוסט הזה אין טקסט — אין מה לחפש בו. העבר את ההודעה שיש בה את הכיתוב.');
      return;
    }
    const userId = await this.ownerUserId();
    if (!userId) return;
    const own = await this.telegramChannels(userId).catch(() => [] as Channel[]);
    if (!isOwnChannel(ref, own.map((c) => c.channel_id))) {
      await this.send(chatId, `⚠️ הפוסט הזה מערוץ שאינו מהערוצים שלך${ref.username ? ` (@${ref.username})` : ''} — לא נשמר.`);
      return;
    }
    const buy = buyLink(messageLinks(msg));
    try {
      await this.saveChannelMessage(userId, ref, text, buy);
    } catch (err: any) {
      await this.send(chatId, `❌ לא נשמר: ${String(err?.message || err).slice(0, 150)}`);
      return;
    }
    const headline = postHeadline(text);
    await this.send(chatId, buy
      ? `📥 נשמר לחיפוש בבוט: «${headline}»`
      : `📥 נשמר, אבל אין בו קישור לרכישה — הקוראים לא יקבלו אותו כתוצאה: «${headline}»`);
  }

  /**
   * The owner sent a link to a post in one of his channels. A channel with "Restrict saving
   * content" blocks forwarding, so this is how its old posts get in: the bot (the channel's
   * admin) tries to read the post itself; when Telegram refuses that too, the owner pastes
   * the post's text under the link and that is what is saved.
   */
  private async savePostByLink(chatId: string, msg: any): Promise<void> {
    const link = parsePostLink(messageText(msg))!;
    // Reads go through the owner's bot — the channel's admin — even when he wrote to the
    // readers' bot; replies stay with whichever bot he wrote to.
    const ownerToken = await this.telegramToken();
    const asOwner = <T>(fn: () => Promise<T>) => (ownerToken ? this.replyVia.run({ token: ownerToken }, fn) : fn());

    let ref: ChannelRef = { chatId: link.chatId || '', username: link.username, messageId: link.messageId, date: 0 };
    if (link.username) {
      const chat = await asOwner(() => this.get('getChat', { chat_id: `@${link.username}` }));
      if (!chat?.id) {
        await this.send(chatId, `⚠️ לא מצאתי את הערוץ @${link.username}. בדוק את הקישור.`);
        return;
      }
      ref = { ...ref, chatId: String(chat.id), username: chat.username || link.username };
    }
    const userId = await this.ownerUserId();
    if (!userId) return;
    const own = await this.telegramChannels(userId).catch(() => [] as Channel[]);
    if (!isOwnChannel(ref, own.map((c) => c.channel_id))) {
      await this.send(chatId, '⚠️ הקישור הוא לערוץ שאינו מהערוצים שלך — לא נשמר.');
      return;
    }

    let text = link.rest;
    let links = text ? messageLinks(msg) : [];
    if (!text) {
      // Let the bot read the post: forward it into this chat, take its text, remove the copy.
      const copy = await asOwner(() => this.get('forwardMessage', {
        chat_id: chatId, from_chat_id: ref.chatId, message_id: ref.messageId, disable_notification: true,
      }));
      if (copy) {
        text = messageText(copy).trim();
        links = messageLinks(copy);
        ref.date = Number(copy.forward_origin?.date || copy.forward_date) || 0;
        void asOwner(() => this.call('deleteMessage', { chat_id: chatId, message_id: copy.message_id }));
      }
      if (!text) {
        await this.send(chatId, [
          '🔒 הערוץ חוסם העברה של פוסטים, אז גם הבוט לא יכול לקרוא את הפוסט הזה.',
          'העתק את הטקסט של הפוסט ושלח אותו כך — הקישור בשורה הראשונה והטקסט מתחתיו:',
          '',
          `${channelPostUrl(ref.username, ref.chatId, ref.messageId)}`,
          '(כאן הטקסט של הפוסט)',
        ].join('\n'));
        return;
      }
    }
    const buy = buyLink(links);
    try {
      await this.saveChannelMessage(userId, ref, text, buy);
    } catch (err: any) {
      await this.send(chatId, `❌ לא נשמר: ${String(err?.message || err).slice(0, 150)}`);
      return;
    }
    const headline = postHeadline(text);
    await this.send(chatId, buy
      ? `📥 נשמר לחיפוש בבוט: «${headline}»`
      : `📥 נשמר, אבל לא מצאתי בו קישור לרכישה — הקוראים לא יקבלו אותו כתוצאה. אם הקישור מוסתר מאחורי טקסט, הוסף אותו בסוף ההודעה. «${headline}»`);
  }

  /** One row per channel post; a later edit or a second forward refreshes it. */
  private async saveChannelMessage(userId: string, ref: ChannelRef, text: string, buy: string | null): Promise<void> {
    await this.channelMessages.query(
      `INSERT INTO channel_messages (user_id, chat_id, chat_username, message_id, text, buy_url, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))
       ON CONFLICT (chat_id, message_id) DO UPDATE
         SET text = EXCLUDED.text, buy_url = EXCLUDED.buy_url,
             chat_username = coalesce(EXCLUDED.chat_username, channel_messages.chat_username), updated_at = now()`,
      [userId, ref.chatId, ref.username, ref.messageId, text.slice(0, 8000), buy, ref.date || Date.now() / 1000],
    );
  }

  // ── Setup and diagnostics ──────────────────────────────────────────────────

  /** Register the command menus once at boot. Best-effort, like the webhook setup. */
  onModuleInit(): void {
    if (process.env.WATCHDOG_TELEGRAM_CHAT_ID) {
      this.registerCommands().catch((err) => this.logger.warn(`bot commands skipped: ${err?.message}`));
    }
    if (searchBotToken()) {
      this.setupSearchBot().catch((err) => this.logger.warn(`search bot setup skipped: ${err?.message}`));
    }
  }

  /**
   * Point the search bot at its webhook and give it its menu and description. Never takes
   * over a webhook that belongs to another integration — same rule as the owner's bot.
   */
  private async setupSearchBot(): Promise<void> {
    const token = searchBotToken();
    const url = searchWebhookUrl();
    if (!token || !url) return;
    await this.replyVia.run({ token }, async () => {
      const info = await this.get('getWebhookInfo', {});
      const current = String(info?.url || '');
      if (current && current !== url) {
        this.logger.warn(`search bot already has a webhook (${current}) — not overwriting`);
      } else if (current !== url || !['message', 'callback_query'].every((u) => (info?.allowed_updates || []).includes(u))) {
        // callback_query: the 🔔 price-alert buttons under the results (price-alerts.ts).
        const ok = await this.call('setWebhook', {
          url, secret_token: searchWebhookSecret(), allowed_updates: ['message', 'callback_query'],
        });
        if (ok) this.logger.log('Search bot webhook registered');
      }
      const find = { command: 'find', description: 'חיפוש מוצר באלי אקספרס' };
      const track = { command: 'track', description: 'מעקב משלוח לפי מספר מעקב' };
      await this.call('setMyCommands', { commands: [find, track], scope: { type: 'default' } });
      // Only when it differs: Telegram rate-limits renames.
      const named = await this.get('getMyName', {});
      if (named?.name !== SEARCH_BOT_NAME) await this.call('setMyName', { name: SEARCH_BOT_NAME });
      await this.call('setMyDescription', { description: SEARCH_BOT_DESCRIPTION });
      await this.call('setMyShortDescription', { short_description: SEARCH_BOT_SHORT_DESCRIPTION });
    });
  }

  /**
   * Telegram's view of the search bot's webhook, for the watchdog — null when there is no
   * search bot or it is healthy. An unset webhook is re-registered and looked at again.
   */
  async searchBotHealth(): Promise<WebhookVerdict | null> {
    const token = searchBotToken();
    const url = searchWebhookUrl();
    if (!token || !url) return null;
    const read = () => this.replyVia.run({ token }, () => this.get('getWebhookInfo', {}))
      .then((info) => webhookVerdict(info, url, Date.now(), SEARCH_BOT_UPDATES));
    const first = await read();
    if (first && (first.kind === 'unset' || first.kind === 'updates')) {
      await this.setupSearchBot().catch(() => {});
      return read();
    }
    return first;
  }

  /**
   * The "/" menu Telegram shows. Members see only /find; the owner's chat gets his own
   * commands. Without a registered command members have no way to discover the search.
   */
  private async registerCommands(): Promise<void> {
    const find = { command: 'find', description: 'חיפוש מוצר באלי אקספרס, למשל: /find אוזניות עד 100' };
    await this.call('setMyCommands', { commands: [find], scope: { type: 'default' } });
    await this.call('setMyCommands', { commands: [find], scope: { type: 'all_group_chats' } });
    await this.call('setMyCommands', {
      commands: [
        { command: 'ask', description: 'שאלה למנהל של Nexlify' },
        { command: 'search', description: 'חיפוש מוצר ופרסום לקבוצה' },
        { command: 'searches', description: 'מה הקוראים מחפשים בבוט' },
        { command: 'groups', description: 'בדיקת /find בכל קבוצה' },
        { command: 'status', description: 'מצב המערכת' },
      ],
      scope: { type: 'chat', chat_id: process.env.WATCHDOG_TELEGRAM_CHAT_ID },
    });
  }

  /** /searches — what readers searched for most in the last week. */
  private async reportSearches(chatId: string): Promise<void> {
    const userId = await this.ownerUserId();
    if (!userId) return;
    const days = 7;
    const rows: Array<{ keyword: string; searches: number; empty: number }> = await this.searches.query(
      `SELECT keyword, count(*)::int AS searches, count(*) FILTER (WHERE results = 0)::int AS empty
       FROM shopper_searches
       WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval
       GROUP BY keyword ORDER BY searches DESC, keyword LIMIT 30`,
      [userId, String(days)],
    ).catch(() => []);
    const total = rows.reduce((n, r) => n + r.searches, 0);
    const rescued: Array<{ keyword: string; rewrite: string; searches: number }> = await this.searches.query(
      `SELECT keyword, max(rewrite) AS rewrite, count(*)::int AS searches
       FROM shopper_searches
       WHERE user_id = $1 AND rewrite IS NOT NULL AND created_at > now() - ($2 || ' days')::interval
       GROUP BY keyword ORDER BY searches DESC, keyword LIMIT 10`,
      [userId, String(days)],
    ).catch(() => []);
    const [alerts] = await this.alerts.query(
      `SELECT count(*) FILTER (WHERE active)::int AS active,
              count(*) FILTER (WHERE notified_at > now() - ($2 || ' days')::interval)::int AS sent
       FROM price_alerts WHERE user_id = $1`,
      [userId, String(days)],
    ).catch(() => [null]);
    const [alertClicks] = await this.searches.query(
      `SELECT coalesce(sum(clicks), 0)::int AS clicks FROM link_targets WHERE user_id = $1 AND kind = 'alert'`, [userId],
    ).catch(() => [null]);
    const alertLine = alerts && (alerts.active || alerts.sent)
      ? `\n\n🔔 התראות מחיר: ${alerts.active} במעקב · ${alerts.sent} נשלחו ב-${days} ימים · ${alertClicks?.clicks ?? 0} קליקים מהתראות`
      : '';
    const startRows = await this.starts.query(
      `SELECT source, count(*)::int AS n FROM bot_starts
       WHERE user_id = $1 AND created_at > now() - ($2 || ' days')::interval GROUP BY source`,
      [userId, String(days)],
    ).catch(() => null);
    const startLine = startRows ? `\n\n${startsReport(startRows, days)}` : '';
    const [parcelRow] = await this.parcels.query(
      `SELECT count(*) FILTER (WHERE active)::int AS active,
              count(*) FILTER (WHERE created_at > now() - ($1 || ' days')::interval)::int AS added
       FROM parcel_tracks`, [String(days)],
    ).catch(() => [null]);
    const quota = seventeenTrackKey() ? await parcelQuota() : null;
    const parcelLine = parcelRow && (parcelRow.active || parcelRow.added || quota)
      ? `\n\n📦 מעקב חבילות: ${parcelRow.active} פעילות · ${parcelRow.added} נוספו ב-${days} ימים`
        + (quota ? ` · מכסת 17TRACK: נותרו ${quota.remain} מתוך ${quota.total}` : '')
      : '';
    await this.sendLong(chatId, searchesReport(rows, days, total, rescued) + alertLine + startLine + parcelLine);
  }

  /**
   * /resetsearches — clear the readers' search log, e.g. of the owner's own tests from before
   * they stopped being recorded. «/resetsearches cz» keeps the first search containing "cz";
   * «/resetsearches הכל» clears everything. Bare, it offers the same as buttons — tapping the
   * command in a message sends it bare, so typing the word was the only way, and it was missed.
   */
  private async resetSearches(chatId: string, arg: string): Promise<void> {
    const userId = await this.ownerUserId();
    if (!userId) return;
    if (!arg) {
      const [{ n }] = await this.searches.query(
        `SELECT count(*)::int AS n FROM shopper_searches WHERE user_id = $1`, [userId]);
      // Each search's first time, oldest first — the one to keep is usually the first.
      const firsts: Array<{ id: string; keyword: string }> = await this.searches.query(
        `SELECT DISTINCT ON (keyword) id, keyword, created_at FROM shopper_searches
          WHERE user_id = $1 ORDER BY keyword, created_at ASC`, [userId]);
      firsts.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      // The readers' bot receives no button taps — there, the typed form only.
      const buttons = !this.replyVia.getStore() && n > 0;
      const keyboard: Keyboard | undefined = buttons ? [
        ...firsts.slice(0, 6).map((f) => [{ text: `🧹 השאר רק «${truncate(f.keyword, 24)}»`, callback_data: `rs:${f.id}` }]),
        [{ text: '🗑️ מחק הכל', callback_data: 'rs:all' }, { text: 'ביטול', callback_data: 'x' }],
      ] : undefined;
      await this.send(chatId, [
        `🧹 ברשימת החיפושים יש ${n} חיפושים.`,
        buttons ? 'בחר מה להשאיר — כל השאר יימחק:' : 'כדי למחוק, הקלד את הפקודה עם המילה שתישאר, למשל:',
        ...(buttons ? [] : ['/resetsearches cz — מוחק הכל חוץ מהחיפוש הראשון שמכיל «cz»', '/resetsearches הכל — מוחק את כולם']),
      ].join('\n'), keyboard);
      return;
    }
    let keepId: string | null = null;
    if (arg !== 'הכל') {
      const word = normaliseSearch(arg);
      const [first] = await this.searches.query(
        `SELECT id FROM shopper_searches WHERE user_id = $1 AND strpos(keyword, $2) > 0 ORDER BY created_at ASC LIMIT 1`,
        [userId, word]);
      if (!first) {
        await this.send(chatId, `לא מצאתי חיפוש שמכיל «${word}» — לא נמחק כלום.`);
        return;
      }
      keepId = first.id;
    }
    await this.send(chatId, await this.clearSearches(userId, keepId));
  }

  /** Delete the search log except one row (or all of it); the owner-facing summary. */
  private async clearSearches(userId: string, keepId: string | null): Promise<string> {
    const deleted: any[] = await this.searches.query(
      `DELETE FROM shopper_searches WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) RETURNING id`,
      [userId, keepId]);
    const [kept] = keepId
      ? await this.searches.query(`SELECT keyword, created_at FROM shopper_searches WHERE id = $1`, [keepId])
      : [];
    const when = kept ? new Date(kept.created_at).toLocaleString('he-IL', { timeZone: process.env.SCHEDULER_TZ || 'Asia/Jerusalem' }) : '';
    return `🧹 נמחקו ${deleted.length} חיפושים.`
      + (kept ? ` נשאר: «${kept.keyword}» (${when}).` : '')
      + '\nמעכשיו החיפושים שלך בבוט הקוראים לא נרשמים — הרשימה היא רק של העוקבים.';
  }

  /** A tap on one of /resetsearches' buttons. */
  private async onResetSearches(chatId: string, cbId: string, messageId: number, arg: string): Promise<void> {
    await this.answer(cbId);
    const userId = await this.ownerUserId();
    if (!userId) return;
    const keepId = arg === 'all' ? null : arg;
    if (keepId && !/^[0-9a-f-]{36}$/i.test(keepId)) return;
    await this.editText(chatId, messageId, await this.clearSearches(userId, keepId));
  }

  /** /groups — for every active Telegram group: can its members use /find? */
  private async reportGroups(chatId: string): Promise<void> {
    const userId = await this.ownerUserId();
    const groups = userId ? await this.telegramChannels(userId) : [];
    if (!groups.length) {
      await this.send(chatId, 'אין קבוצות טלגרם פעילות.');
      return;
    }
    const me = await this.get('getMe', {});
    const botId = me?.id;
    const username: string | null = me?.username || null;
    const lines: string[] = [`🤖 הבוט: ${username ? `@${username}` : 'לא ידוע'}`, ''];
    for (const g of groups) {
      const chat = await this.get('getChat', { chat_id: g.channel_id });
      const member = botId ? await this.get('getChatMember', { chat_id: g.channel_id, user_id: botId }) : null;
      lines.push(readinessLine(g.name, groupReadiness(chat?.type, member?.status), username));
    }
    if (username) {
      lines.push('', `קישור לחיפוש בפרטי, לשתף עם החברים: t.me/${username}`);
    }
    await this.sendLong(chatId, lines.join('\n'));
  }

  // ── The morning report's buttons ───────────────────────────────────────────

  /** "📋 פירוט מלא" — the evidence behind the brief, on request instead of unasked. */
  private async onDigestDetail(chatId: string, cbId: string, runId?: string): Promise<void> {
    await this.answer(cbId, 'טוען…');
    const userId = await this.ownerUserId();
    const detail = userId ? await this.optimizer.lastRunDetail(userId, runId || null) : null;
    if (!detail) {
      await this.send(chatId, 'אין פירוט שמור לדוח הזה.');
      return;
    }
    await this.sendLong(chatId, detail);
  }

  /** "↩️ בטל שינוי" — the changes still standing, each with its own undo button. */
  private async onUndoList(chatId: string, cbId: string): Promise<void> {
    await this.answer(cbId);
    const userId = await this.ownerUserId();
    const actions = userId ? await this.optimizer.recentActions(userId, 2) : [];
    const undoable = actions.filter((a) => a.undoable && !a.undone);
    if (!undoable.length) {
      await this.send(chatId, 'אין שינויים לביטול מהיומיים האחרונים.');
      return;
    }
    await this.send(chatId, 'איזה שינוי לבטל?',
      undoKeyboard(undoable.map((a) => ({ id: a.id, text: a.label }))));
  }

  /** One change, put back. */
  private async onUndo(
    chatId: string, cbId: string, messageId: number | undefined, actionId?: string,
  ): Promise<void> {
    const userId = await this.ownerUserId();
    if (!actionId || !userId) {
      await this.answer(cbId, 'לא נמצא');
      return;
    }
    await this.answer(cbId, 'מבטל…');
    const res = await this.optimizer.undoAction(userId, actionId);
    // Editing the message drops its keyboard, so a second tap can't re-apply an old state
    // even before undone_at is read — the same guard the publish flow uses.
    await this.editText(chatId, messageId, res.ok
      ? `↩️ בוטל: ${res.label || 'השינוי הוחזר'}`
      : `❌ ${res.reason || 'הביטול נכשל'}`);
  }

  private async onMoreResults(chatId: string, cbId: string, page: number): Promise<void> {
    await this.answer(cbId, 'טוען…');
    const last = this.lastQuery.get(chatId);
    if (!last) {
      await this.send(chatId, 'החיפוש הקודם פג — שלח מילת חיפוש חדשה.');
      return;
    }
    await this.runSearch(chatId, last.keyword, page > 0 ? page : last.page + 1);
  }

  /** Product tapped → offer the owner's active Telegram groups. */
  private async onPickChannel(chatId: string, cbId: string, productId: string): Promise<void> {
    const product = this.recall(productId);
    if (!product) {
      await this.answer(cbId, 'התוצאה פגה');
      await this.send(chatId, 'התוצאות פגו — שלח חיפוש חדש כדי לפרסם.');
      return;
    }

    const userId = await this.ownerUserId();
    const groups = userId ? await this.telegramChannels(userId) : [];
    if (!groups.length) {
      await this.answer(cbId);
      await this.send(chatId, 'לא הוגדרה אף קבוצת טלגרם פעילה — הוסף קבוצה בלוח הבקרה.');
      return;
    }

    const keyboard: Keyboard = groups.map((g) => [{
      text: `📣 ${g.name}`,
      callback_data: encodeCallback('g', productId, g.id),
    }]);
    keyboard.push([{ text: '❌ ביטול', callback_data: 'x' }]);

    await this.answer(cbId);
    await this.send(chatId, `לאן לפרסם את «${truncate(product.title, 60)}»?`, keyboard);
  }

  /** Group tapped → publish now through the same path the dashboard uses. */
  private async onPublish(
    chatId: string, cbId: string, messageId: number | undefined,
    productId: string, channelKey: string,
  ): Promise<void> {
    const product = this.recall(productId);
    const userId = await this.ownerUserId();
    if (!product || !userId) {
      await this.answer(cbId, 'התוצאה פגה');
      await this.editText(chatId, messageId, 'התוצאות פגו — שלח חיפוש חדש כדי לפרסם.');
      return;
    }

    const groups = await this.telegramChannels(userId);
    const group = matchByPrefix(groups, channelKey);
    if (!group) {
      await this.answer(cbId, 'הקבוצה לא נמצאה');
      await this.editText(chatId, messageId, 'הקבוצה לא נמצאה או הושבתה — נסה שוב.');
      return;
    }

    // Editing the message drops its keyboard too, so a second tap can't double-publish.
    await this.answer(cbId, 'מפרסם…');
    await this.editText(chatId, messageId, `⏳ מפרסם ל${group.name}…`);

    try {
      const post = await this.posts.quickPost(
        userId, productId,
        undefined,               // text — let the AI write it, as the dashboard does
        undefined,               // channelOverride — superseded by `channels` below
        product.image_url,
        product.affiliate_url,
        product,
        [group.channel_id],
      );
      const title = truncate(product.title, 60);
      await this.editText(chatId, messageId, post.status === 'sent'
        ? `✅ פורסם ל${group.name}\n${title}${post.error_message ? `\n⚠️ ${post.error_message}` : ''}`
        : `❌ הפרסום ל${group.name} נכשל: ${post.error_message || 'שגיאה לא ידועה'}`);
    } catch (err: any) {
      this.logger.warn(`bot publish ${productId} → ${group.name} failed: ${err?.message}`);
      await this.editText(chatId, messageId, `❌ הפרסום נכשל: ${err?.message || err}`);
    }
  }

  // ── Owner / groups ─────────────────────────────────────────────────────────

  /** The account the bot acts as: the first admin with AliExpress credentials
   *  configured, falling back to the first admin. */
  private async ownerUserId(): Promise<string | null> {
    const admins = await this.users.find({ where: { role: 'admin' } });
    for (const admin of admins) {
      const creds = await this.credentials.getRaw(admin.id).catch(() => null);
      if (creds?.aliexpress_app_key) return admin.id;
    }
    return admins[0]?.id || null;
  }

  private async telegramChannels(userId: string): Promise<Channel[]> {
    const active = await this.channels.find({
      where: { user_id: userId, is_active: true },
      order: { created_at: 'ASC' },
    });
    return active.filter((c) => (c.platform || 'telegram') === 'telegram' && !!c.channel_id);
  }

  // ── Result cache ───────────────────────────────────────────────────────────

  private remember(product: BotProduct): void {
    this.shown.set(product.product_id, { product, at: Date.now() });
    if (this.shown.size > TelegramBotService.CACHE_MAX) {
      // Map preserves insertion order — drop the oldest entries first.
      const excess = this.shown.size - TelegramBotService.CACHE_MAX;
      for (const key of Array.from(this.shown.keys()).slice(0, excess)) this.shown.delete(key);
    }
  }

  private recall(productId: string): BotProduct | null {
    const hit = this.shown.get(productId);
    if (!hit) return null;
    if (Date.now() - hit.at > TelegramBotService.CACHE_TTL_MS) {
      this.shown.delete(productId);
      return null;
    }
    return hit.product;
  }

  // ── Telegram API ───────────────────────────────────────────────────────────

  /** Same token resolution as the watchdog: an explicit bot token, else an admin's. */
  private async telegramToken(): Promise<string | null> {
    if (process.env.WATCHDOG_TELEGRAM_BOT_TOKEN) return process.env.WATCHDOG_TELEGRAM_BOT_TOKEN;
    const admins = await this.users.find({ where: { role: 'admin' } });
    for (const admin of admins) {
      const token = await this.credentials.getTelegramToken(admin.id).catch(() => null);
      if (token) return token;
    }
    return null;
  }

  private async call(method: string, payload: Record<string, any>): Promise<boolean> {
    const token = this.replyVia.getStore()?.token || await this.telegramToken();
    if (!token) return false;
    try {
      await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 15000 });
      return true;
    } catch (err: any) {
      this.logger.warn(`telegram ${method} failed: ${err?.response?.data?.description || err?.message}`);
      return false;
    }
  }

  /** A Telegram call whose RESULT is needed (getMe, getChat…). Null on any failure. */
  private async get(method: string, payload: Record<string, any>): Promise<any | null> {
    const token = this.replyVia.getStore()?.token || await this.telegramToken();
    if (!token) return null;
    try {
      const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 15000 });
      return res.data?.result ?? null;
    } catch {
      return null;
    }
  }

  private send(chatId: string, text: string, keyboard?: Keyboard, replyTo?: number): Promise<boolean> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    });
  }

  /** A report too long for one message, sent in order as several. */
  private async sendLong(chatId: string, text: string): Promise<void> {
    for (const part of splitMessage(text)) await this.send(chatId, part);
  }

  private sendPhoto(chatId: string, photo: string, caption: string, keyboard?: Keyboard): Promise<boolean> {
    return this.call('sendPhoto', {
      chat_id: chatId,
      photo,
      caption,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /** Stops the button's loading spinner. Telegram expires these fast, so failures are ignored. */
  private answer(callbackQueryId: string, text?: string): Promise<boolean> {
    if (!callbackQueryId) return Promise.resolve(false);
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }

  private async editText(chatId: string, messageId: number | undefined, text: string): Promise<void> {
    if (!messageId) { await this.send(chatId, text); return; }
    const edited = await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text });
    if (!edited) await this.send(chatId, text);
  }
}
