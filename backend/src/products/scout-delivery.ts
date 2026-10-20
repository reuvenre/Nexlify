/**
 * The morning commission report must not vanish quietly.
 *
 * It used to fire once, at 08:20. A scan is minutes of API calls in the same process as every
 * other cron, so a deploy or a host restart in those minutes, the scan still running from a
 * «/commission», or one thrown error meant no report that day, and nothing said so. Now the
 * cron tries every 20 minutes through the morning window until one goes out, remembers why
 * each attempt failed (`commission_scout_fail:<day>`), and the watchdog raises a missed day
 * once the window has closed (`missedReportVerdict`).
 *
 * Kept free of Nest so the window and the verdict can be unit tested.
 */

/** The first attempt, Israel time. */
export const FIRST_ATTEMPT = { hour: 8, minute: 20 };
/** The last attempt, Israel time (the cron fires every 20 minutes from 08:00 to 11:40). */
export const LAST_ATTEMPT = { hour: 11, minute: 40 };
/** From this hour, a day with no report is a missed day. */
export const MISSED_AFTER_HOUR = 12;

/** What the last failed attempt of the day ran into. */
export interface ScoutFailure {
  at: string;
  reason: string;
  attempts: number;
}

/** Is an attempt due at this Israel wall time? */
export function attemptDue(hour: number, minute: number): boolean {
  const t = hour * 60 + minute;
  return t >= FIRST_ATTEMPT.hour * 60 + FIRST_ATTEMPT.minute && t <= LAST_ATTEMPT.hour * 60 + LAST_ATTEMPT.minute;
}

/** Israel wall clock: the day key and the hour/minute the window is judged by. */
export function jerusalemNow(now = new Date()): { day: string; hour: number; minute: number } {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const [h, m] = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour12: false }).split(':').map(Number);
  return { day, hour: h % 24, minute: m };
}

export interface MissedVerdict {
  title: string;
  detail: string;
  action?: string;
}

/**
 * Null while the report is still due or went out; otherwise what the owner and the issue
 * should say. A refused key is his to fix, so that one carries an action.
 */
export function missedReportVerdict(s: { hour: number; delivered: boolean; failure: ScoutFailure | null }): MissedVerdict | null {
  if (s.delivered || s.hour < MISSED_AFTER_HOUR) return null;
  const why = s.failure
    ? `${s.failure.attempts} ניסיונות נכשלו. האחרון (${s.failure.at}): ${s.failure.reason}`
    : 'אף ניסיון לא רץ: כנראה השרת היה כבוי או ישן בכל החלון 08:20–11:40.';
  // A refused key is his to fix; a quota limit or a crash clears by itself or is ours.
  const keys = /app_?key|signature|\bsign\b|מפתחות/i.test(s.failure?.reason || '');
  return {
    title: 'סוכן העמלות לא שלח את הדוח של הבוקר',
    detail: why,
    ...(keys ? { action: 'בדוק את מפתחות AliExpress בהגדרות ← שווקים. אפשר להריץ את הדוח עכשיו עם /commission בבוט.' } : {}),
  };
}
