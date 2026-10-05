/**
 * Pure presentation + callback-encoding helpers for the Telegram product bot.
 *
 * Kept free of Nest/axios so the card text and the button payloads can be unit
 * tested — the payloads in particular have a hard 64-BYTE limit that Telegram
 * enforces by rejecting the whole message, which is easy to blow accidentally
 * once a uuid and a product id share one string.
 */

/** Currencies the affiliate feed actually returns; anything else prints its code. */
const SYMBOLS: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };

/** Telegram's hard limit on callback_data. */
export const CALLBACK_MAX_BYTES = 64;

/** The subset of a mapped AliExpress product the bot needs. Prices are already in
 *  the owner's target currency (ProductsService applies the converter). */
export interface BotProduct {
  product_id: string;
  title: string;
  sale_price: number;
  original_price: number;
  discount_percent: number;
  orders_count: number;
  rating: number;
  currency: string;
  image_url?: string;
  affiliate_url?: string;
  /** Extra lines a result must carry (a channel post's hidden-product instructions). */
  notes?: string[];
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = SYMBOLS[(currency || '').toUpperCase()];
  const value = (Number(amount) || 0).toFixed(2).replace(/\.00$/, '');
  return symbol ? `${symbol}${value}` : `${value} ${currency}`;
}

/** Trim to `max` characters on a word boundary when possible. */
export function truncate(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * One product as a photo caption. Plain text on purpose — the bot sends without
 * parse_mode (same as the watchdog alerts), so any markup would show literally.
 * Stays well under Telegram's 1024-character caption limit.
 */
export function productCaption(p: BotProduct, index: number): string {
  const lines = [`${index}. ${truncate(p.title, 150)}`, ''];

  const sale = formatMoney(p.sale_price, p.currency);
  const hasDiscount = p.discount_percent > 0 && p.original_price > p.sale_price;
  lines.push(hasDiscount
    ? `💰 ${sale} (במקום ${formatMoney(p.original_price, p.currency)}, הנחה ${p.discount_percent}%)`
    : `💰 ${sale}`);

  const stats: string[] = [];
  if (p.rating > 0) stats.push(`⭐ ${p.rating}`);
  if (p.orders_count > 0) stats.push(`📦 ${p.orders_count.toLocaleString('en-US')} מכירות`);
  if (stats.length) lines.push(stats.join('  ·  '));

  return lines.join('\n');
}

/**
 * Build a callback payload. Parts are joined with ':' and the LAST part is trimmed
 * when the result would exceed Telegram's limit — callers that pass a uuid last
 * must therefore resolve it by prefix (see `matchByPrefix`).
 */
export function encodeCallback(action: string, ...parts: string[]): string {
  const all = [action, ...parts];
  let data = all.join(':');
  if (Buffer.byteLength(data) <= CALLBACK_MAX_BYTES) return data;

  const head = all.slice(0, -1).join(':');
  const room = CALLBACK_MAX_BYTES - Buffer.byteLength(`${head}:`);
  const tail = all[all.length - 1].slice(0, Math.max(0, room));
  data = `${head}:${tail}`;
  return data;
}

export function parseCallback(data: string): { action: string; args: string[] } {
  const parts = String(data || '').split(':');
  return { action: parts[0] || '', args: parts.slice(1) };
}

/** Resolve an id that `encodeCallback` may have truncated. Returns null when the
 *  prefix is empty or matches more than one candidate (never guess a target). */
export function matchByPrefix<T extends { id: string }>(items: T[], prefix: string): T | null {
  if (!prefix) return null;
  const hits = items.filter((i) => i.id.startsWith(prefix));
  return hits.length === 1 ? hits[0] : null;
}
