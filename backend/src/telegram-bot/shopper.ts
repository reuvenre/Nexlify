import { productScore } from '../agents/product-grounding';
import { BotProduct, formatMoney, truncate } from './product-card';

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
export function rankShopperResults(items: BotProduct[], count = 3): BotProduct[] {
  const seen = new Set<string>();
  return (items || [])
    .filter((p) => p && p.image_url && Number(p.sale_price) > 0 && p.product_id)
    .filter((p) => !(Number(p.rating) > 0 && Number(p.rating) < 4.3))
    .filter((p) => (seen.has(p.product_id) ? false : (seen.add(p.product_id), true)))
    .map((p) => ({ p, s: productScore(p) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, count)
    .map((x) => x.p);
}

/** One result as a photo caption — plain text, link last so Telegram makes it tappable. */
export function shopperCaption(p: BotProduct, index: number, link: string): string {
  const lines = [`${index}. ${truncate(p.title, 110)}`];
  const sale = formatMoney(p.sale_price, p.currency);
  lines.push(p.discount_percent > 0 && p.original_price > p.sale_price
    ? `💰 ${sale} (במקום ${formatMoney(p.original_price, p.currency)}, -${p.discount_percent}%)`
    : `💰 ${sale}`);
  const stats: string[] = [];
  if (p.rating > 0) stats.push(`⭐ ${p.rating}`);
  if (p.orders_count > 0) stats.push(`📦 ${p.orders_count.toLocaleString('en-US')} נמכרו`);
  if (stats.length) lines.push(stats.join('  ·  '));
  lines.push(`🔗 ${link}`);
  return lines.join('\n');
}

export const SHOPPER_FOOTER = 'ℹ️ קישורי שותפים: רכישה דרכם תומכת בקבוצה, בלי שום עלות נוספת עבורך.';

export const SHOPPER_HELP = [
  '🔎 חיפוש מוצרים באלי אקספרס',
  '',
  'כתוב מה אתה מחפש, ואפשר להוסיף תקציב:',
  '• אוזניות בלוטות\' עד 100 ש"ח',
  '• תיק גב לטיולים בין 80 ל-200',
  '',
  'בקבוצה: /find ואחריו מה שמחפשים.',
].join('\n');

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
