import {
  dateToPortalWall, portalRangeEnd, portalRangeStart, portalToday, portalWallToDate,
} from './portal-time';

describe('portal clock (US Pacific)', () => {
  it('reads an API time as Pacific summer time (UTC−7)', () => {
    // 10:00 Israel (UTC+3) on 2026-10-13 is midnight Pacific — the portal's day boundary.
    expect(portalWallToDate('2026-10-13 00:00:00')!.toISOString()).toBe('2026-10-13T07:00:00.000Z');
  });

  it('reads an API time as Pacific winter time (UTC−8)', () => {
    expect(portalWallToDate('2026-12-01 06:28:31')!.toISOString()).toBe('2026-12-01T14:28:31.000Z');
  });

  it('settles the offset on both sides of the DST change', () => {
    // US clocks fall back on 2026-11-01 at 02:00.
    expect(portalWallToDate('2026-10-31 23:00:00')!.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(portalWallToDate('2026-11-01 12:00:00')!.toISOString()).toBe('2026-11-01T20:00:00.000Z');
  });

  it('formats an instant the way the order API wants it', () => {
    expect(dateToPortalWall(new Date('2026-10-13T07:00:00Z'))).toBe('2026-10-13 00:00:00');
    expect(dateToPortalWall(new Date('2026-12-01T14:28:31Z'))).toBe('2026-12-01 06:28:31');
  });

  it('round-trips', () => {
    const d = new Date('2026-08-16T19:42:05.000Z');
    expect(portalWallToDate(dateToPortalWall(d))!.getTime()).toBe(d.getTime());
  });

  it('rejects what is not a wall time', () => {
    expect(portalWallToDate('')).toBeNull();
    expect(portalWallToDate(null)).toBeNull();
    expect(portalWallToDate('yesterday')).toBeNull();
  });

  it('knows which portal day it is', () => {
    // 09:59 Israel is still yesterday on the portal; 10:00 is today.
    expect(portalToday(new Date('2026-10-13T06:59:00Z'))).toBe('2026-10-12');
    expect(portalToday(new Date('2026-10-13T07:00:00Z'))).toBe('2026-10-13');
  });
});

describe('portal date-range boundaries', () => {
  it('starts the month on Pacific midnight', () => {
    expect(portalRangeStart('2026-08-01')!.toISOString()).toBe('2026-08-01T07:00:00.000Z');
  });

  it('includes an order paid in the first hours of the portal day', () => {
    const paid = portalWallToDate('2026-08-01 06:28:31')!;
    expect(paid >= portalRangeStart('2026-08-01')!).toBe(true);
  });

  it('still excludes the day before on the portal clock', () => {
    const paid = portalWallToDate('2026-07-31 23:59:00')!;
    expect(paid >= portalRangeStart('2026-08-01')!).toBe(false);
  });

  it('ends inclusive of the whole picked day', () => {
    expect(portalRangeEnd('2026-08-31')!.toISOString()).toBe('2026-09-01T06:59:59.999Z');
  });

  it('keeps a same-day from/to range non-empty', () => {
    expect(portalRangeStart('2026-08-16')!.getTime()).toBeLessThan(portalRangeEnd('2026-08-16')!.getTime());
  });

  it('treats a missing or malformed bound as no bound', () => {
    expect(portalRangeStart(undefined)).toBeNull();
    expect(portalRangeStart('')).toBeNull();
    expect(portalRangeEnd('not-a-date')).toBeNull();
  });

  it('accepts a full ISO timestamp by reading its date part', () => {
    expect(portalRangeStart('2026-08-01T00:00:00Z')!.toISOString()).toBe('2026-08-01T07:00:00.000Z');
  });
});
