/**
 * The clock AliExpress counts affiliate orders by: US PACIFIC time (America/Los_Angeles).
 *
 * The order API's times ('yyyy-MM-dd HH:mm:ss', no zone) and the portal's day are both on
 * that clock — the portal's "yesterday" runs 10:00–10:00 Israel time. They were read as
 * GMT+8 for a while. Rows still lined up with the portal (both sides read the same wall
 * clock), but every stored moment was 15 hours early against real time. So anything
 * measured from NOW was wrong: the sync window, "today", and "the last 24 hours". In the
 * morning the 24 h tile showed 1 order while the portal showed 21.
 *
 * Pacific observes DST (UTC−7 in summer, UTC−8 in winter), so the offset is never a
 * constant: every conversion goes through the zone name.
 */
export const PORTAL_TZ = 'America/Los_Angeles';

const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;

/** The zone's wall-clock parts of an instant. */
function wallParts(d: Date, tz: string): number[] {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
}

/** Offset of `tz` from UTC at instant `d`, in ms (Pacific summer → −7 h). */
function zoneOffsetMs(d: Date, tz: string): number {
  const [y, mo, da, h, mi, s] = wallParts(d, tz);
  return Date.UTC(y, mo - 1, da, h, mi, s) - (d.getTime() - d.getMilliseconds());
}

/** A Pacific wall-clock time ('yyyy-MM-dd HH:mm:ss[.sss]') as a real instant, or null. */
export function portalWallToDate(s: string | null | undefined): Date | null {
  const m = WALL.exec(String(s || '').trim());
  if (!m) return null;
  const [, y, mo, da, h, mi, se, ms] = m;
  const asUtc = Date.UTC(+y, +mo - 1, +da, +h, +mi, +se, +(ms || '0').padEnd(3, '0'));
  // Two passes settle the offset across a DST change.
  let t = asUtc - zoneOffsetMs(new Date(asUtc), PORTAL_TZ);
  t = asUtc - zoneOffsetMs(new Date(t), PORTAL_TZ);
  return Number.isNaN(t) ? null : new Date(t);
}

/** An instant as Pacific wall-clock time, 'yyyy-MM-dd HH:mm:ss' — the order API's format. */
export function dateToPortalWall(d: Date): string {
  const [y, mo, da, h, mi, s] = wallParts(d, PORTAL_TZ);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(da)} ${p(h)}:${p(mi)}:${p(s)}`;
}

/** Today's date on the portal clock, 'yyyy-mm-dd'. */
export function portalToday(now: Date = new Date()): string {
  return dateToPortalWall(now).slice(0, 10);
}

/** Start of `yyyy-mm-dd` in portal time, or null when no bound was given. */
export function portalRangeStart(from?: string | null): Date | null {
  const day = String(from || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return portalWallToDate(`${day} 00:00:00.000`);
}

/** End of `yyyy-mm-dd` in portal time — inclusive of the whole day the owner picked. */
export function portalRangeEnd(to?: string | null): Date | null {
  const day = String(to || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return portalWallToDate(`${day} 23:59:59.999`);
}
