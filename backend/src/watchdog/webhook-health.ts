/**
 * Is Telegram actually delivering the bot's messages to us?
 *
 * Everything the owner and the members type to the bot — /status, questions for the
 * manager, product searches, the morning report's buttons — arrives through one webhook.
 * When it is not ours, or Telegram cannot reach it, the bot simply goes silent: no error
 * on our side, because no request ever arrives. Telegram is the only one who knows, and it
 * says so in getWebhookInfo. This reads that answer.
 */

export interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
}

export interface WebhookVerdict {
  /** Stable per problem kind, so the throttle holds one alert per cause. */
  kind: 'unset' | 'foreign' | 'failing' | 'backlog' | 'updates';
  title: string;
  detail: string;
  /** Set when only the owner can fix it. */
  action?: string;
}

/** Errors older than this are history, not a current fault. */
export const WEBHOOK_ERROR_RECENT_MS = 60 * 60 * 1000;
export const WEBHOOK_BACKLOG = 25;

/** Host only: a foreign webhook URL may carry a secret path (Make, Zapier hooks). */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return '(כתובת לא תקינה)'; }
}

/** What the owner's bot needs: messages, and the taps on its inline buttons. */
export const OWNER_BOT_UPDATES = ['message', 'callback_query'];
/** The readers' search bot sends no buttons — messages are all it receives. */
export const SEARCH_BOT_UPDATES = ['message'];

export function webhookVerdict(
  info: WebhookInfo | null, expectedUrl: string, nowMs: number, required: string[] = OWNER_BOT_UPDATES,
): WebhookVerdict | null {
  if (!info) return null; // Telegram unreachable or no token — nothing to judge
  const url = String(info.url || '');
  if (!url) {
    return {
      kind: 'unset',
      title: 'הבוט בטלגרם לא מחובר לשרת — הודעות אליו לא מגיעות',
      detail: 'getWebhookInfo מחזיר url ריק: Telegram לא שולח לנו שום עדכון. הרישום בעלייה (setupTelegramWebhook) נכשל או לא רץ.',
    };
  }
  if (url !== expectedUrl) {
    return {
      kind: 'foreign',
      title: 'הבוט בטלגרם מחובר למערכת אחרת — הודעות אליו לא מגיעות לכאן',
      detail: `ה-webhook של הבוט מצביע ל-${hostOf(url)} ולא ל-${hostOf(expectedUrl)}. setupTelegramWebhook לא דורס webhook של אינטגרציה אחרת.`,
      action: `הבוט מחובר כרגע ל-${hostOf(url)} (למשל Make). אם זה כבר לא בשימוש — כתוב לי ואחבר אותו לשרת; `
        + 'אם כן בשימוש — צריך בוט נפרד לשירות הזה.',
    };
  }
  const errAt = Number(info.last_error_date || 0) * 1000;
  if (errAt && nowMs - errAt < WEBHOOK_ERROR_RECENT_MS && info.last_error_message) {
    return {
      kind: 'failing',
      title: 'Telegram לא מצליח למסור הודעות לשרת',
      detail: `שגיאה אחרונה (${new Date(errAt).toISOString()}): ${String(info.last_error_message).slice(0, 200)}`
        + ` · ממתינות: ${info.pending_update_count ?? 0}`,
    };
  }
  if ((info.pending_update_count || 0) >= WEBHOOK_BACKLOG) {
    return {
      kind: 'backlog',
      title: `${info.pending_update_count} הודעות לבוט ממתינות למסירה`,
      detail: 'Telegram מחזיק תור הודעות שלא נמסרו — השרת עונה לאט או נכשל לסירוגין.',
    };
  }
  const allowed = info.allowed_updates || [];
  if (allowed.length && !required.every((u) => allowed.includes(u))) {
    return {
      kind: 'updates',
      title: 'הבוט מקבל רק חלק מסוגי העדכונים',
      detail: `allowed_updates = ${allowed.join(', ')} — חסר ${required.filter((u) => !allowed.includes(u)).join(' / ')}.`,
    };
  }
  return null;
}
