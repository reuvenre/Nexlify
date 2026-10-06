import { SHOPPER_INVITE_ANGLES } from '../posts/shopper-invite';

/**
 * Where a reader came into the search bot from — the `start` parameter of the link they
 * tapped (`t.me/<bot>?start=inv_alert`). Counted anonymously in `bot_starts`, so the owner
 * can see which invite line, the pinned post or the announcement actually brings people in.
 */

/** Every source we hand out, and how /searches names it. */
export const START_SOURCES: Record<string, string> = {
  inv_alert: '🔔 שורה: מחכים שהמחיר ירד',
  inv_find: '🔎 שורה: מחפשים מוצר אחר',
  inv_words: '💬 שורה: במילים שלכם',
  pin: '📌 הפוסט הנעוץ',
  news: '📣 פוסט ההכרזה',
  site: '🌐 קישור האתר',
  moved: '↪️ הועבר מהבוט הישן',
  post: '🕰️ קישור מפוסט ישן',
};

// Every invite angle must have a name in the report.
for (const a of SHOPPER_INVITE_ANGLES) {
  if (!START_SOURCES[`inv_${a.id}`]) throw new Error(`bot-start: no label for invite angle ${a.id}`);
}

/**
 * The source of a /start message: a known code, «direct» for a bare /start (the bot found
 * by name), «other» for anything else — never the raw parameter, which a stranger can set.
 * Null when the message is not /start.
 */
export function parseStartSource(text: string): string | null {
  const m = String(text || '').trim().match(/^\/start(?:@\S+)?(?:\s+(\S+))?\s*$/i);
  if (!m) return null;
  const param = (m[1] || '').toLowerCase();
  if (!param) return 'direct';
  return START_SOURCES[param] ? param : 'other';
}

/** The /searches line: entries per source over the window, most first. */
export function startsReport(rows: { source: string; n: number }[], days: number): string {
  const list = rows.filter((r) => Number(r.n) > 0).sort((a, b) => Number(b.n) - Number(a.n));
  if (!list.length) return `🚪 כניסות לבוט ב-${days} ימים: עדיין אין`;
  const total = list.reduce((s, r) => s + Number(r.n), 0);
  const name = (s: string) => START_SOURCES[s] || (s === 'direct' ? '🔗 ישירות (בלי קישור)' : '❔ אחר');
  return [`🚪 כניסות לבוט ב-${days} ימים: ${total}`, ...list.map((r) => `   ${name(r.source)} — ${r.n}`)].join('\n');
}
