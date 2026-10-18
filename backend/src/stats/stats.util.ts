/**
 * Pure helpers behind the dashboard overview. They live apart from the service so the
 * bucketing and delta rules — the parts that quietly go wrong — are testable without a DB.
 */

/**
 * "Now" on `tz`'s wall clock, formatted 'YYYY-MM-DD HH:mm:ss' — a NAIVE local timestamp,
 * directly comparable in SQL against `col AT TIME ZONE '<tz>'`. sv-SE is the locale whose
 * output IS that shape; Postgres parses it as a timestamp-without-tz literal as-is.
 */
export function localNowString(tz: string, now = new Date()): string {
  return now.toLocaleString('sv-SE', { timeZone: tz, hour12: false });
}

/**
 * The owner's commission day: 10:00 to 10:00 the next morning, Israel time, named by the
 * date it starts on. That is the portal's day for most of the year, but the portal is on
 * US Pacific time, and in the weeks the two countries change DST on different dates its
 * day starts at 09:00 or 11:00 here. The owner reads the day by the Israel clock, so the
 * boundary is pinned to 10:00 in Jerusalem, never derived from Pacific.
 */
export const COMMISSION_DAY_TZ = 'Asia/Jerusalem';
export const COMMISSION_DAY_START_HOUR = 10;

/** Today's commission day key, 'YYYY-MM-DD' (before 10:00 Israel it is still yesterday). */
export function commissionDayNow(now = new Date()): string {
  const [date, time] = localNowString(COMMISSION_DAY_TZ, now).split(' ');
  const hour = Number(time.slice(0, 2));
  if (hour >= COMMISSION_DAY_START_HOUR) return date;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** `count` consecutive 'YYYY-MM' keys ending with the month containing `localNow`. */
export function monthKeys(localNow: string, count: number): string[] {
  const [y, m] = localNow.slice(0, 7).split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  }
  return keys;
}

/** `count` consecutive 'YYYY-MM-DD' keys ending with the day containing `localNow`. */
export function dayKeys(localNow: string, count: number): string[] {
  const [y, m, d] = localNow.slice(0, 10).split('-').map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * The calendar-month comparison windows around `localNow`, as naive local timestamps.
 *
 * The delta compares the current month against the SAME ELAPSED STRETCH of the previous
 * one, not the whole of it: on the 3rd, three days measured against a full month would
 * print a catastrophic drop every single month. When the previous month is shorter than
 * the elapsed stretch (March 30th vs February), the window clamps to the whole previous
 * month rather than spilling into the current one.
 */
export function monthWindows(localNow: string): {
  key: string; prev_key: string;
  prev_from: string; prev_to: string;
} {
  // Naive local → fake-UTC Date, so calendar arithmetic works without a tz library.
  const now = new Date(localNow.replace(' ', 'T') + 'Z');
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const curFrom = Date.UTC(y, m, 1);
  const prevFrom = Date.UTC(y, m - 1, 1);
  const prevTo = Math.min(prevFrom + (now.getTime() - curFrom), curFrom);
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return {
    key: new Date(curFrom).toISOString().slice(0, 7),
    prev_key: new Date(prevFrom).toISOString().slice(0, 7),
    prev_from: fmt(prevFrom),
    prev_to: fmt(prevTo),
  };
}

/**
 * Expand sparse SQL output into one value per key, zero-filling gaps.
 *
 * Grouped queries only return buckets that have rows, so a quiet month is simply absent.
 * Charting that directly draws a 12-month trend from 5 bars and silently misplaces them —
 * the gaps have to become explicit zeros before the series means anything.
 */
export function densify(rows: Array<{ bucket: string; value: number }>, keys: string[]): number[] {
  const found = new Map(rows.map((r) => [String(r.bucket).slice(0, 10), Number(r.value) || 0]));
  return keys.map((k) => found.get(k) ?? 0);
}

/**
 * Percentage change against the previous period, or null when there's no baseline.
 *
 * Returning null rather than 0 or 100 matters: a first-month account has nothing to compare
 * against, and "+100%" on the dashboard would be an invented claim. The UI omits the badge
 * when this is null.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Sum with float noise trimmed — commission_ils is a float column. */
export function sum(values: number[]): number {
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}
