/**
 * Can the members of this Telegram chat use /find?
 *
 * Three things decide it, and none of them is visible from the dashboard:
 * - A CHANNEL is broadcast-only: members cannot write in it at all, so /find there is
 *   impossible. Its members reach the search through the bot's private chat instead.
 * - In a group, a bot that is an ADMIN receives every message. A plain member bot in
 *   privacy mode receives only commands addressed to it, so a bare "/find" may be dropped.
 * - A bot that is not in the chat at all hears nothing.
 */

export type Readiness = 'ready' | 'channel' | 'not_admin' | 'not_member' | 'unknown';

export function groupReadiness(chatType: string | null | undefined, botStatus: string | null | undefined): Readiness {
  if (!chatType) return 'unknown';
  if (chatType === 'channel') return 'channel';
  if (chatType !== 'group' && chatType !== 'supergroup') return 'unknown';
  if (botStatus === 'administrator' || botStatus === 'creator') return 'ready';
  if (botStatus === 'member' || botStatus === 'restricted') return 'not_admin';
  if (botStatus === 'left' || botStatus === 'kicked') return 'not_member';
  return 'unknown';
}

/** One owner-facing line per chat. */
export function readinessLine(name: string, r: Readiness, botUsername?: string | null): string {
  const dm = botUsername ? `t.me/${botUsername}` : 'הצ\'אט הפרטי עם הבוט';
  switch (r) {
    case 'ready': return `✅ ${name}: קבוצה, הבוט מנהל — /find עובד`;
    case 'channel': return `📢 ${name}: ערוץ — אי אפשר לכתוב בו. החברים יחפשו דרך ${dm}`;
    case 'not_admin': return `⚠️ ${name}: הבוט חבר אבל לא מנהל — יש להפוך אותו למנהל כדי ש-/find יגיע אליו`;
    case 'not_member': return `❌ ${name}: הבוט לא נמצא בקבוצה`;
    case 'unknown': return `❔ ${name}: לא הצלחתי לבדוק (ייתכן שהבוט לא בקבוצה או שהמזהה שגוי)`;
  }
}
