import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Channel } from '../channels/channel.entity';
import { ShopperSearch } from './shopper-search.entity';
import { normaliseSearch, searchesReport } from './search-stats';
import { User } from '../users/user.entity';
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
import { ManagerAgentService, isAuthError } from '../manager/manager-agent.service';
import { managerQuestion } from '../manager/manager-intent';
import { proposalText } from '../manager/manager-proposal';
import {
  SHOPPER_HELP, SHOPPER_WELCOME, MORE_BUTTON, isMoreRequest, ShopperQuery, ShopperLimiter, escapeHtml, takeUnseen, parseShopperQuery, rankShopperResults, shopperCaption,
} from './shopper';

/** Inline keyboard row(s) as Telegram wants them. A button carries EITHER a callback or a
 *  url — the morning report's "open the dashboard" button is the latter. */
type Keyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>;

const RESULTS_PER_PAGE = 5;

const HELP = [
  '🛍️ מילת חיפוש ← מוצרים עם כפתור "פרסם לקבוצה"',
  '🧠 שאלה ← המנהל עונה, למשל: למה פינטרסט ירד השבוע?',
  '/status · /searches · /groups',
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
  }>();
  /** Which bot answers this update. Set while handling the search bot's updates, so every
   *  reply in that flow goes out from the bot the reader wrote to (see search-bot.ts). */
  private readonly replyVia = new AsyncLocalStorage<{ token: string }>();
  private searchBotName: { username: string | null; at: number } | null = null;

  constructor(
    @InjectRepository(Channel) private readonly channels: Repository<Channel>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ShopperSearch) private readonly searches: Repository<ShopperSearch>,
    private readonly products: ProductsService,
    private readonly posts: PostsService,
    private readonly credentials: CredentialsService,
    // The morning report's buttons: show the evidence, and take a change back.
    private readonly optimizer: OptimizerService,
    private readonly manager: ManagerAgentService,
    private readonly links: LinksService,
  ) {}

  // ── Entry point ────────────────────────────────────────────────────────────

  /** Handle one Telegram update the webhook routed here (everything that isn't /status). */
  async handleUpdate(update: any): Promise<void> {
    if (update?.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    const msg = update?.message;
    const text = String(msg?.text || '').trim();
    const chatId = String(msg?.chat?.id ?? '');
    if (!text || !chatId) return;
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
        await this.send(chatId, `🔎 החיפוש עבר לבוט החדש שלנו — לחצו כאן: https://t.me/${username}?start=post`);
        return;
      }
    }
    await this.handleShopper(msg, text);
  }

  /** An update delivered to the search bot's own webhook: every sender is a reader. */
  async handleSearchBotUpdate(update: any): Promise<void> {
    const token = searchBotToken();
    const msg = update?.message;
    const text = String(msg?.text || '').trim();
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
    if (/^\/searches(@\S+)?$/i.test(text)) {
      await this.reportSearches(chatId);
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
    await this.sendLong(chatId, answer.text);
    for (const p of answer.proposals) {
      await this.send(chatId, `💡 הצעה: ${proposalText(p)}\n${p.reason}`, [[
        { text: '✅ אשר', callback_data: encodeCallback('pa', p.id) },
        { text: '❌ דחה', callback_data: encodeCallback('pr', p.id) },
      ]]);
    }
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

    let query = text;
    if (text.startsWith('/')) {
      const [rawCmd, ...rest] = text.split(/\s+/);
      const cmd = rawCmd.split('@')[0].toLowerCase();
      if (cmd === '/find' || cmd === '/search') {
        query = rest.join(' ').trim();
      } else {
        // /start, /help and anything else: explain, but only in private — a group sees
        // other bots' commands all day, and answering them would be noise.
        if (isPrivate) await this.send(chatId, SHOPPER_WELCOME);
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

    let ranked: BotProduct[];
    const seen = new Set<string>();
    try {
      ranked = takeUnseen(await this.shopperPage(userId, parsed, 1), seen);
    } catch (err: any) {
      this.logger.warn(`shopper search "${parsed.keyword}" failed: ${err?.message}`);
      await this.send(chatId, '❌ החיפוש לא זמין כרגע, נסה שוב מאוחר יותר.', undefined, replyTo);
      return;
    }

    const picks = ranked.slice(0, 3);
    // What readers ask for — anonymous, and never the owner's own test searches.
    if (!memberKey.startsWith('owner:')) {
      void this.searches.insert({
        user_id: userId, keyword: normaliseSearch(parsed.keyword),
        max_price: parsed.maxPrice ?? null, results: picks.length,
      }).catch((err) => this.logger.warn(`search log failed: ${err?.message}`));
    }
    if (!picks.length) {
      await this.send(chatId, `לא מצאתי מוצרים מתאימים ל«${parsed.keyword}»${parsed.maxPrice ? ' בתקציב הזה' : ''}. נסה ניסוח אחר.`,
        undefined, replyTo);
      return;
    }
    if (isPrivate) {
      this.shopperSessions.set(chatId, { q: parsed, ranked, shown: picks.length, page: 1, done: false, at: Date.now(), seen });
      if (this.shopperSessions.size > 2000) this.shopperSessions.delete(this.shopperSessions.keys().next().value as string);
    }

    const budgetLabel = parsed.maxPrice || parsed.minPrice
      // No parentheses: a bracket at the end of right-to-left text is drawn mirrored.
      ? ` ${[parsed.minPrice ? `מ-${parsed.minPrice}` : '', parsed.maxPrice ? `עד ${parsed.maxPrice}` : ''].filter(Boolean).join(' ')} ש"ח`
      : '';
    const header = `🔎 ${picks.length} המומלצים ל«${escapeHtml(parsed.keyword)}»${budgetLabel}:`;
    await this.showShopperResults(chatId, userId, header, picks, 1, isGroup, replyTo);
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
      await this.send(chatId, `זה כל מה שמצאתי ל«${session.q.keyword}» 🙂 נסו ניסוח אחר או מוצר אחר.`);
      return;
    }
    const from = session.shown + 1;
    session.shown += picks.length;
    const header = `🔄 עוד ${picks.length} ל«${escapeHtml(session.q.keyword)}»:`;
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
  ): Promise<void> {
    const linkFor = async (p: BotProduct) => {
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
      const sent = await this.call('sendPhoto', {
        chat_id: chatId, photo: picks[i].image_url!, caption, parse_mode: 'HTML',
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
      } else if (current !== url || !(info?.allowed_updates || []).includes('message')) {
        const ok = await this.call('setWebhook', { url, secret_token: searchWebhookSecret(), allowed_updates: ['message'] });
        if (ok) this.logger.log('Search bot webhook registered');
      }
      const find = { command: 'find', description: 'חיפוש מוצר באלי אקספרס' };
      await this.call('setMyCommands', { commands: [find], scope: { type: 'default' } });
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
    await this.sendLong(chatId, searchesReport(rows, days, total));
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
