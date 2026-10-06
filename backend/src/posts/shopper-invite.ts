/**
 * The line at the foot of a Telegram post that sends readers to the search bot.
 *
 * The owner's Telegram audiences are CHANNELS: only he can write in them, so the
 * members' /find can never be typed there. The search lives in the bot's private chat,
 * and this line is how a channel reader finds it. `?start=inv_<angle>` opens the chat with
 * /start, which the bot answers with its search instructions — and counts which line the
 * reader came from (telegram-bot/bot-start.ts).
 *
 * Hebrew posts only — the bot answers in Hebrew. And never at the cost of the post: a
 * line that would push a photo caption past Telegram's limit would force the post into the
 * "photo, then a separate text message" fallback. So a tight caption gets a SHORTER
 * wording of the line, and only when even the shortest does not fit is it left off.
 */

const HEBREW = /[֐-׿]/;

export const SHOPPER_INVITE_TEXT = '🔎 מחפשים מוצר אחר? בקשו מ-Nexlify Deals Bot והוא ימצא לכם תוך שניות';

/**
 * The wordings under test. One line repeated under every post stops being read after a
 * week, and a single line cannot tell which promise brings readers in — so posts rotate
 * evenly between these, each with its own start code, and /searches counts the entries.
 * Each angle's forms run longest first; the bare bot name is the last resort for all.
 */
export interface InviteAngle { id: string; forms: string[] }

export const SHOPPER_INVITE_ANGLES: InviteAngle[] = [
  {
    id: 'alert',
    forms: ['🔔 מחכים שהמחיר ירד? Nexlify Deals Bot יעדכן אתכם ברגע שזה קורה', '🔔 מחכים שהמחיר ירד? הבוט יעדכן אתכם'],
  },
  {
    id: 'find',
    forms: [SHOPPER_INVITE_TEXT, '🔎 מחפשים מוצר אחר? בקשו מ-Nexlify Deals Bot'],
  },
  {
    id: 'words',
    forms: ['💬 כתבו ל-Nexlify Deals Bot מה אתם מחפשים, במילים שלכם, והוא ימצא', '💬 כתבו לבוט מה אתם מחפשים'],
  },
];

const LAST_RESORT = '🔎 Nexlify Deals Bot';

/** A Telegram bot username: 5-32 chars, letters/digits/underscore. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/** Which angle a post carries: even across posts, and the same one every time a post is re-sent. */
export function inviteAngleFor(seed: string): InviteAngle {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SHOPPER_INVITE_ANGLES[h % SHOPPER_INVITE_ANGLES.length];
}

export function withShopperInvite(
  caption: string, botUsername: string | null | undefined, limit: number, seed?: string,
): string {
  if (!caption || !botUsername || !USERNAME.test(botUsername)) return caption;
  if (!HEBREW.test(caption)) return caption;
  if (caption.includes(`t.me/${botUsername}`)) return caption; // already there (a re-send)
  const angle = inviteAngleFor(seed || caption);
  const withLine = (text: string) =>
    `${caption.trimEnd()}\n\n<a href="https://t.me/${botUsername}?start=inv_${angle.id}">${text}</a>`;
  // A caption that already overflows goes out as a plain text message (4096) anyway, so it
  // gets the full line. One that FITS must not be pushed over by our own line.
  if (caption.length > limit) return withLine(angle.forms[0]);
  for (const text of [...angle.forms, LAST_RESORT]) {
    const next = withLine(text);
    if (next.length <= limit) return next;
  }
  return caption;
}
