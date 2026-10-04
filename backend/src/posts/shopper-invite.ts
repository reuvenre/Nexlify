/**
 * The line at the foot of a Telegram post that sends readers to the search bot.
 *
 * The owner's Telegram audiences are CHANNELS: only he can write in them, so the
 * members' /find can never be typed there. The search lives in the bot's private chat,
 * and this line is how a channel reader finds it. `?start=post` opens the chat with
 * /start, which the bot answers with its search instructions.
 *
 * Hebrew posts only — the bot answers in Hebrew. And never at the cost of the post: a
 * line that would push a photo caption past Telegram's limit is left off, because that
 * forces the post into the "photo, then a separate text message" fallback.
 */

const HEBREW = /[֐-׿]/;

export const SHOPPER_INVITE_TEXT = '🔎 מחפשים מוצר אחר? כתבו לי ←';

/** A Telegram bot username: 5-32 chars, letters/digits/underscore. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function withShopperInvite(caption: string, botUsername: string | null | undefined, limit: number): string {
  if (!caption || !botUsername || !USERNAME.test(botUsername)) return caption;
  if (!HEBREW.test(caption)) return caption;
  if (caption.includes(`t.me/${botUsername}`)) return caption; // already there (a re-send)
  const line = `<a href="https://t.me/${botUsername}?start=post">${SHOPPER_INVITE_TEXT}</a>`;
  const next = `${caption.trimEnd()}\n\n${line}`;
  // Only when it still fits: a caption that already overflows goes out as plain text
  // anyway (4096), but one that FITS must not be pushed over by our own line.
  if (caption.length <= limit && next.length > limit) return caption;
  return next;
}
