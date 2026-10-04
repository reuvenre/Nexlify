import { createHash } from 'crypto';

/**
 * The readers' search bot — optionally a bot of its own.
 *
 * Out of the box the readers' search runs on the owner's bot, the one that also sends
 * him the watchdog alerts and the morning report. Readers never see any of that (every
 * owner feature is gated on his chat id), but they do see that bot's name and username.
 * Setting SEARCH_BOT_TOKEN to a second bot from BotFather moves the readers to it: its
 * own webhook, its own name, and the invite line in every post points there. The owner's
 * bot keeps everything else, and a reader who still arrives at it (an old post's link)
 * is sent on to the new one.
 */

export const SEARCH_WEBHOOK_PATH = '/telegram/search-webhook';

export function searchBotToken(): string | null {
  return (process.env.SEARCH_BOT_TOKEN || '').trim() || null;
}

/** The secret Telegram echoes on every delivery to the search bot's webhook. Hex fits
 *  Telegram's allowed alphabet; derived so no extra variable is needed. */
export function searchWebhookSecret(): string {
  const base = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim() || process.env.JWT_SECRET || 'nexlify';
  return createHash('sha256').update(`tg-search-webhook:${base}`).digest('hex').slice(0, 40);
}

/** The public URL the search bot's webhook must point to, or null without a public backend. */
export function searchWebhookUrl(): string | null {
  const base = (process.env.BACKEND_URL || '').replace(/\/$/, '');
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return null;
  return `${base}${SEARCH_WEBHOOK_PATH}`;
}

/** Shown on the bot's empty chat before "Start", and on its profile. */
export const SEARCH_BOT_DESCRIPTION =
  '👋 ברוכים הבאים ל-Nexlify Deals Bot — המקום למציאת הדילים הכי שווים באלי אקספרס 🛍️\n'
  + 'כתבו מה אתם מחפשים ואמצא לכם 3 מוצרים מומלצים, עם מחיר בשקלים, הנחה ודירוג.\n'
  + 'למשל: אוזניות בלוטות\' עד 100 ש"ח';
export const SEARCH_BOT_SHORT_DESCRIPTION = 'מוצאים לכם את הדילים הכי שווים באלי אקספרס 🔎';
