import { BotProduct, formatMoney, truncate } from './product-card';
import { SHOPPER_BUY_TEXT, escapeHtml } from './shopper';
import { applyWordPolicy } from '../posts/word-policy';

/**
 * «תודיע לי כשהמחיר יורד» — the readers' price-drop alerts, pure parts.
 *
 * A reader who taps the bell under a result has as good as decided to buy; they are waiting
 * for the price. The bot remembers the price they saw, checks it every few hours, and sends
 * them the product again — privately, with the buy button — once it is really lower.
 *
 * "Really lower" is deliberate: a price that wobbles by a shekel is not news, and an alert
 * that fires on noise teaches the reader to ignore the next one.
 */

/** A drop must be at least this share of the price they saw… */
export const ALERT_MIN_DROP_SHARE = 0.05;
/** …and at least this many shekels — 5 % of ₪20 is not worth a message. */
export const ALERT_MIN_DROP_ILS = 2;
/** Alerts one reader can hold at once — a watchlist, not a scraper. */
export const MAX_ALERTS_PER_READER = 20;
/** An alert nobody has needed in this long is dropped; interest does not last forever. */
export const ALERT_TTL_DAYS = 60;
/** Checks in a row a product may be missing from the API before its alert is dropped
 *  (delisted, or no longer ships to Israel). */
export const ALERT_MAX_MISSES = 4;

/** Callback payloads: watch / stop watching one product. Product ids are digits only. */
export const ALERT_WATCH = 'pw';
export const ALERT_STOP = 'px';

/** Only AliExpress products can be watched — channel posts and supplier items have no id
 *  the price API can read. */
export function watchable(p: Pick<BotProduct, 'product_id'> & { post_url?: string }): boolean {
  return /^\d{6,20}$/.test(String(p.product_id || '')) && !p.post_url;
}

export function watchButton(productId: string, watching = false) {
  return watching
    ? { text: '🔕 הפסק מעקב מחיר', callback_data: `${ALERT_STOP}:${productId}` }
    : { text: '🔔 תודיע לי כשהמחיר יורד', callback_data: `${ALERT_WATCH}:${productId}` };
}

/** Read a tap on one of the alert buttons. */
export function parseAlertCallback(data: string): { action: 'watch' | 'stop'; productId: string } | null {
  const m = String(data || '').match(/^(pw|px):(\d{6,20})$/);
  if (!m) return null;
  return { action: m[1] === ALERT_WATCH ? 'watch' : 'stop', productId: m[2] };
}

/** Is `now` a drop worth a message against the price the reader saw? */
export function isPriceDrop(seen: number, now: number): boolean {
  const was = Number(seen);
  const is = Number(now);
  if (!(was > 0) || !(is > 0)) return false;
  return is <= was * (1 - ALERT_MIN_DROP_SHARE) && was - is >= ALERT_MIN_DROP_ILS;
}

/**
 * The alert itself, as a Telegram HTML caption. No leading minus anywhere — in right-to-left
 * text "-20%" is drawn as "20%-".
 */
export function priceDropCaption(
  alert: { title: string; price_ils: number; currency?: string | null },
  now: Pick<BotProduct, 'sale_price' | 'currency'>,
  link: string,
): string {
  const currency = now.currency || alert.currency || 'ILS';
  const pct = Math.round((1 - Number(now.sale_price) / Number(alert.price_ils)) * 100);
  return [
    '🔻 המחיר ירד!',
    escapeHtml(truncate(applyWordPolicy(alert.title), 110)),
    `💰 ${formatMoney(now.sale_price, currency)} במקום ${formatMoney(alert.price_ils, currency)} · ירד ב-${pct}%`,
    `<a href="${escapeHtml(link).replace(/"/g, '&quot;')}">${SHOPPER_BUY_TEXT}</a>`,
  ].join('\n');
}

/** What the reader is told when the bell is set. */
export function watchingText(title: string, price: number, currency = 'ILS'): string {
  return `🔔 אעדכן אותך כשהמחיר של «${truncate(applyWordPolicy(title), 60)}» ירד מתחת ל-${formatMoney(price, currency)}.`;
}

/** "Stop all my alerts", in the reader's words or as a command. */
export function isStopAlerts(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  return /^\/stop(@\S+)?$/.test(t) || /^(?:בטל|עצור|תפסיק|הפסק)\s+(?:את\s+)?(?:כל\s+)?(?:ה)?התראות$/.test(t);
}
