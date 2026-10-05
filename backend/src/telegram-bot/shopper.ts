import { productScore } from '../agents/product-grounding';
import { BotProduct, formatMoney, truncate } from './product-card';
import { applyWordPolicy } from '../posts/word-policy';

/**
 * The members' product search — pure parts.
 *
 * A member writes "/find אוזניות בלוטות' עד 100 ש"ח" in a group (or anything at all in a
 * private chat with the bot) and gets three products with the owner's affiliate link.
 *
 * Nothing here involves a language model choosing products. The search API returns real
 * listings, the ranking is a fixed formula, and every number in the reply comes straight
 * from the listing — the "server-issued facts only" rule, applied by construction.
 */

export interface ShopperQuery {
  keyword: string;
  /** In the owner's display currency (ILS), as ProductsService.search expects. */
  minPrice?: number;
  maxPrice?: number;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';
const CURRENCY = /(?:ש["״']?ח|שקלים|שקל|₪|nis|ils|shekels?)/giu;
const FILLER = /^(?:(?:אני|אנחנו)\s+)?(?:מחפש(?:ת|ים|ות)?|רוצה|צריכ(?:ה|ים)?|צריך|תמצא(?:י)?\s+לי|תחפש(?:י)?(?:\s+לי)?|חפש(?:י)?(?:\s+לי)?|יש\s+(?:לכם|לך)|looking\s+for|find(?:\s+me)?|i\s+(?:want|need))\s+/iu;
const KEYWORD_MAX = 60;

const toNum = (s: string) => Number(s.replace(',', '.'));

/** Read a member's message into a search, or null when there is nothing to search for. */
export function parseShopperQuery(raw: string): ShopperQuery | null {
  let text = String(raw || '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim();
  if (!text) return null;
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  const between = text.match(new RegExp(`(?:בין|between)\\s*${NUM}\\s*(?:ל-?|עד|ו-?|to|and|-)\\s*${NUM}`, 'iu'));
  if (between) {
    minPrice = toNum(between[1]);
    maxPrice = toNum(between[2]);
    text = text.replace(between[0], ' ');
  } else {
    const max = text.match(new RegExp(`(?:עד|מתחת\\s*ל-?|פחות\\s*מ-?|under|below|up\\s*to|max|<)\\s*₪?\\s*${NUM}`, 'iu'));
    if (max) { maxPrice = toNum(max[1]); text = text.replace(max[0], ' '); }
    const min = text.match(new RegExp(`(?:מעל|יותר\\s*מ-?|החל\\s*מ-?|over|above|from|min|>)\\s*₪?\\s*${NUM}`, 'iu'));
    if (min) { minPrice = toNum(min[1]); text = text.replace(min[0], ' '); }
  }
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) [minPrice, maxPrice] = [maxPrice, minPrice];

  let keyword = text.replace(CURRENCY, ' ').replace(/[?!.,:;"״]+/g, ' ').replace(/\s+/g, ' ').trim();
  keyword = keyword.replace(FILLER, '').trim();
  if (keyword.length < 2) return null;
  if (keyword.length > KEYWORD_MAX) keyword = keyword.slice(0, KEYWORD_MAX).trim();

  const q: ShopperQuery = { keyword };
  if (minPrice != null && minPrice > 0) q.minPrice = minPrice;
  if (maxPrice != null && maxPrice > 0) q.maxPrice = maxPrice;
  return q;
}

/**
 * The three to show. A listing without a photo or a price is not shown to a stranger; a
 * poorly rated one (under 4.3 when rated at all) is not recommended. The rest by score.
 */
export function rankShopperResults(items: BotProduct[], count = 3, seen: Set<string> = new Set()): BotProduct[] {
  const ranked = (items || [])
    .filter((p) => p && p.image_url && Number(p.sale_price) > 0 && p.product_id)
    .filter((p) => !(Number(p.rating) > 0 && Number(p.rating) < 4.3))
    .map((p) => ({ p, s: productScore(p) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
  // Ranked first, deduplicated second: of two copies of one product, the better offer stays.
  return takeUnseen(ranked, seen).slice(0, count);
}

/**
 * Every way the same product comes back from AliExpress: its id, and — because several
 * sellers list one product under different ids — its photo and its title. A reader who
 * taps «עוד מוצרים» must never be shown something he has already seen.
 */
export function sameProductKeys(p: BotProduct): string[] {
  const keys = [`id:${String(p.product_id).trim()}`];
  const img = String(p.image_url || '').split('?')[0].toLowerCase()
    // AliExpress serves one photo under size variants: …/abc.jpg_220x220.jpg
    .replace(/(\.(?:jpe?g|png|webp|avif))_[^/]*$/, '$1');
  if (img) keys.push(`img:${img}`);
  const title = String(p.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 60);
  if (title.length >= 12) keys.push(`t:${title}`);
  return keys;
}

/** The items not already in `seen` (by any key), adding theirs to it. Order kept. */
export function takeUnseen(items: BotProduct[], seen: Set<string>): BotProduct[] {
  const out: BotProduct[] = [];
  for (const p of items) {
    const keys = sameProductKeys(p);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(p);
  }
  return out;
}

/** Text for a Telegram HTML message: only &, < and > are special there. */
export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The same buy button the channel posts carry — the link hides behind the text. */
export const SHOPPER_BUY_TEXT = '🛒 לרכישה — לחצו כאן 🛒';

/**
 * One result as a Telegram HTML caption (send with parse_mode HTML). Laid out like a
 * channel post: the URL is never shown, only the buy button that carries it.
 */
export function shopperCaption(p: BotProduct, index: number, link: string): string {
  // A translated title can now say "ציד" — the owner's vocabulary holds in the bot too.
  const lines = [`${index}. ${escapeHtml(truncate(applyWordPolicy(p.title), 110))}`];
  const sale = formatMoney(p.sale_price, p.currency);
  // A channel post can lack a stored price — no "₪0" then.
  if (Number(p.sale_price) > 0) lines.push(p.discount_percent > 0 && p.original_price > p.sale_price
    // No "-50%": a leading minus inside right-to-left text is drawn at the wrong end ("50%-").
    ? `💰 ${sale} במקום ${formatMoney(p.original_price, p.currency)} · ${p.discount_percent}% הנחה`
    : `💰 ${sale}`);
  const stats: string[] = [];
  if (p.rating > 0) stats.push(`⭐ ${p.rating}`);
  if (p.orders_count > 0) stats.push(`📦 ${p.orders_count.toLocaleString('en-US')} נמכרו`);
  if (stats.length) lines.push(stats.join('  ·  '));
  lines.push(`<a href="${escapeHtml(link).replace(/"/g, '&quot;')}">${SHOPPER_BUY_TEXT}</a>`);
  return lines.join('\n');
}

// ── The channel's own posts ──────────────────────────────────────────────────
//
// Some products AliExpress hides behind another name (a FLYLINK "hidden product": the page
// shows something else). Searching the API for what the reader calls it finds nothing
// useful — but the channel post we published says it in Hebrew. So the reader's words are
// matched against our own published copy too.

const SEARCH_STOPWORDS = new Set(['של', 'עם', 'את', 'או', 'גם', 'על', 'for', 'the', 'and', 'with', 'of']);

/**
 * The reader's words as ILIKE patterns, all of which a post must contain. A long Hebrew
 * plural loses its suffix so «ידיות» also finds «ידית» (substring match: the stem
 * still matches the plural). LIKE wildcards are escaped.
 */
export function channelSearchTerms(keyword: string): string[] {
  const words = String(keyword || '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s'׳-]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['׳-]+|['׳-]+$/g, ''))
    .filter((w) => w.length >= 2 && !SEARCH_STOPWORDS.has(w));
  const terms = words.map((w) => (/^[֐-׿]{5,}$/.test(w) ? w.replace(/(?:ים|ות)$/, '') : w));
  return [...new Set(terms)].slice(0, 5).map((t) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

/** A published post's headline: its first line that has words, tags and markdown stripped. */
export function postHeadline(text: string, fallback = ''): string {
  const line = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[*_~`]+/g, '').replace(/\s+/g, ' ').trim())
    .find((l) => /[\p{L}\p{N}]/u.test(l));
  return truncate(line || fallback, 110);
}

/** A row of the posts table, as the channel search reads it. */
export interface ChannelPostRow {
  id: string;
  product_id: string;
  product_title: string;
  product_image: string;
  generated_text: string;
  price_ils: number;
}

/**
 * Channel posts as results: one per product, newest first, at most `count`. The price is
 * the one the post was published with; there is no rating or order count to show.
 */
export function channelHits(rows: ChannelPostRow[], count = 2): Array<{ post: ChannelPostRow; product: BotProduct }> {
  const out: Array<{ post: ChannelPostRow; product: BotProduct }> = [];
  const ids = new Set<string>();
  for (const r of rows || []) {
    if (!r?.product_image || ids.has(r.product_id)) continue;
    ids.add(r.product_id);
    const price = Math.round((Number(r.price_ils) || 0) * 100) / 100;
    out.push({
      post: r,
      product: {
        product_id: r.product_id, title: postHeadline(r.generated_text, r.product_title),
        sale_price: price, original_price: price, discount_percent: 0, orders_count: 0, rating: 0,
        currency: 'ILS', image_url: r.product_image,
      },
    });
    if (out.length >= count) break;
  }
  return out;
}

/** The first message a reader gets (the link in a post opens the chat with /start). */
export const SHOPPER_WELCOME = [
  '👋 ברוכים הבאים ל-Nexlify Deals Bot!',
  'המקום למציאת הדילים הכי שווים באלי אקספרס 🛍️',
  '',
  'כתבו מה אתם מחפשים ואמצא לכם 3 מוצרים מומלצים.',
  'למשל: אוזניות בלוטות\' עד 100 ש"ח',
  '',
  'לא מצאתם? כתבו «עוד מוצרים» ואביא עוד אפשרויות 🔄',
].join('\n');

/** A message that could not be read as a search — short, it is not the first contact. */
export const SHOPPER_HELP = [
  '🔎 כתבו מה אתם מחפשים ואמצא 3 מוצרים מומלצים באלי אקספרס.',
  'למשל: אוזניות בלוטות\' עד 100 ש"ח',
].join('\n');

/** The label of the reply-keyboard button; tapping it sends exactly this text. */
export const MORE_BUTTON = '🔄 עוד מוצרים';

/**
 * "Give me more" in the reader's words: «עוד», «עוד מוצרים», «תן לי עוד מוצרים», «יש עוד?»,
 * the keyboard button. A request for more of the SAME search — anything with a product in
 * it ("עוד אוזניות") is a new search and stays one.
 */
export function isMoreRequest(text: string): boolean {
  const t = String(text || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F?!.,״"']/gu, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return false;
  return /^(?:(?:תן|תני|תנו|הבא|תביא|תביאי|תביאו|הביאו|תראה|תראי|תראו|יש)\s+)?(?:(?:לי|לנו)\s+)?עוד(?:\s+(?:מוצרים|מוצר|תוצאות|אפשרויות|דילים|כמה|משהו))?(?:\s+בבקשה)?$/u.test(t)
    || /^(?:more|next|show more)$/.test(t);
}

/**
 * Per-member and overall budgets for the public search. Every search costs an API call
 * (and a translation for Hebrew), and the bot is reachable by anyone who finds it — so it
 * is metered, in memory. A deploy resetting the counters only ever lets a few extra
 * searches through, which is the right side to fail on.
 */
export class ShopperLimiter {
  private readonly perUser = new Map<string, number[]>();
  private day = '';
  private dayCount = 0;

  constructor(
    private readonly userLimit = 6,
    private readonly userWindowMs = 10 * 60 * 1000,
    private readonly dailyLimit = 400,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consume one search for this member, or say why not. */
  take(userKey: string): 'ok' | 'user' | 'daily' {
    const t = this.now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.dayCount = 0; }
    if (this.dayCount >= this.dailyLimit) return 'daily';

    const recent = (this.perUser.get(userKey) || []).filter((x) => t - x < this.userWindowMs);
    if (recent.length >= this.userLimit) {
      this.perUser.set(userKey, recent);
      return 'user';
    }
    recent.push(t);
    this.perUser.set(userKey, recent);
    this.dayCount++;
    if (this.perUser.size > 5000) this.perUser.delete(this.perUser.keys().next().value as string);
    return 'ok';
  }
}
