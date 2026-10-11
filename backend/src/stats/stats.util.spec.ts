import { deltaPct, densify, localNowString, monthKeys, monthWindows, sum, dayKeys } from './stats.util';

describe('stats.util', () => {
  describe('localNowString', () => {
    it("renders the tz's wall clock in Postgres timestamp shape", () => {
      // 2026-08-19T21:30Z = 2026-08-20 05:30 in Shanghai (+08, no DST).
      expect(localNowString('Asia/Shanghai', new Date('2026-08-19T21:30:00Z')))
        .toBe('2026-08-20 05:30:00');
    });

    it('crosses the month boundary the calendar way, not the UTC way', () => {
      // 2026-08-31 23:00 IL is already September on the portal clock (+08 vs +03).
      expect(localNowString('Asia/Shanghai', new Date('2026-08-31T20:00:00Z')).slice(0, 7))
        .toBe('2026-09');
      expect(localNowString('Asia/Jerusalem', new Date('2026-08-31T20:00:00Z')).slice(0, 7))
        .toBe('2026-08');
    });
  });

  describe('dayKeys', () => {
    it('returns consecutive days ending with today, across a month and a year boundary', () => {
      expect(dayKeys('2026-10-11 09:30:00', 3)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
      expect(dayKeys('2026-03-01 00:10:00', 2)).toEqual(['2026-02-28', '2026-03-01']);
      expect(dayKeys('2027-01-01 08:00:00', 2)).toEqual(['2026-12-31', '2027-01-01']);
    });

    it('densify fills quiet days with zeros, in order', () => {
      const keys = dayKeys('2026-10-11 09:30:00', 3);
      expect(densify([{ bucket: '2026-10-11', value: 4 }, { bucket: '2026-10-09', value: 1 }], keys)).toEqual([1, 0, 4]);
    });
  });

  describe('monthKeys', () => {
    it('returns consecutive months ending with the current one', () => {
      expect(monthKeys('2026-08-19 22:00:00', 4))
        .toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    });

    it('crosses a year boundary without drifting', () => {
      expect(monthKeys('2026-02-01 00:00:00', 3))
        .toEqual(['2025-12', '2026-01', '2026-02']);
    });
  });

  describe('monthWindows', () => {
    it('compares against the SAME elapsed stretch of the previous month', () => {
      const w = monthWindows('2026-08-19 21:45:30');
      expect(w.key).toBe('2026-08');
      expect(w.prev_key).toBe('2026-07');
      expect(w.prev_from).toBe('2026-07-01 00:00:00');
      // 18d 21:45:30 into August ↔ 18d 21:45:30 into July.
      expect(w.prev_to).toBe('2026-07-19 21:45:30');
    });

    it('clamps to the whole previous month when it is the shorter one', () => {
      // March 30th is deeper into March than February is long — without the clamp the
      // baseline window would spill into March and count current-month rows as baseline.
      const w = monthWindows('2026-03-30 12:00:00');
      expect(w.prev_from).toBe('2026-02-01 00:00:00');
      expect(w.prev_to).toBe('2026-03-01 00:00:00');
    });

    it('crosses a year boundary in January', () => {
      const w = monthWindows('2026-01-10 08:00:00');
      expect(w.prev_key).toBe('2025-12');
      expect(w.prev_from).toBe('2025-12-01 00:00:00');
      expect(w.prev_to).toBe('2025-12-10 08:00:00');
    });
  });

  describe('densify', () => {
    it('zero-fills months the query returned no rows for', () => {
      const keys = ['2026-06', '2026-07', '2026-08'];
      const rows = [{ bucket: '2026-08', value: 5 }, { bucket: '2026-06', value: 2 }];
      // Order comes from keys, not from the query — a quiet middle month must not collapse.
      expect(densify(rows, keys)).toEqual([2, 0, 5]);
    });

    it('coerces string counts, which is what COUNT(*) returns', () => {
      const rows = [{ bucket: '2026-07', value: '42' as any }];
      expect(densify(rows, ['2026-07'])).toEqual([42]);
    });
  });

  describe('deltaPct', () => {
    it('reports growth against the previous period', () => {
      expect(deltaPct(125, 100)).toBe(25);
    });

    it('reports a decline as negative', () => {
      expect(deltaPct(80, 100)).toBe(-20);
    });

    it('returns null with no baseline instead of inventing +100%', () => {
      // A first-month account has nothing to compare against; the UI hides the badge.
      expect(deltaPct(500, 0)).toBeNull();
    });
  });

  describe('sum', () => {
    it('trims float noise from the commission column', () => {
      expect(sum([0.1, 0.2])).toBe(0.3);
    });

    it('is zero for an empty series', () => {
      expect(sum([])).toBe(0);
    });
  });
});
