import { appendSeasonalRun, seasonalLedgerLine, sumSeasonalRuns } from './seasonal-ledger';

const DAY = 24 * 3600e3;
const run = (t: number, over: Partial<{ s: number; q: number; k: number; d: number; w: number }> = {}) =>
  ({ t, s: 0, q: 0, k: 0, d: 0, w: 0, ...over });

describe('the seasonal ledger', () => {
  it('appends a run and drops runs older than the window', () => {
    const now = 10 * DAY;
    const out = appendSeasonalRun([run(now - 4 * DAY), run(now - DAY)], run(now));
    expect(out.map((e) => e.t)).toEqual([now - DAY, now]);
  });

  it('survives a missing or corrupt stored value', () => {
    expect(appendSeasonalRun(null, run(5))).toHaveLength(1);
    expect(appendSeasonalRun('x' as any, run(5))).toHaveLength(1);
  });

  it('sums only the window', () => {
    const now = 10 * DAY;
    const t = sumSeasonalRuns([run(now - 5 * DAY, { s: 9 }), run(now - DAY, { s: 2, q: 1, k: 1 }), run(now, { s: 1, d: 1 })], now);
    expect(t).toEqual({ runs: 2, slots: 3, queued: 1, skipped: 1, dry: 1, swapped: 0 });
  });

  it('says when the rotation never reached a seasonal slot', () => {
    expect(seasonalLedgerLine({ runs: 40, slots: 0, queued: 0, skipped: 0, dry: 0, swapped: 0 }))
      .toBe('40 הרצות, אף מקום עונתי לא הגיע לתורו בסבב');
  });

  it('splits the slots by what happened to them', () => {
    expect(seasonalLedgerLine({ runs: 40, slots: 9, queued: 0, skipped: 7, dry: 0, swapped: 2 }))
      .toBe('40 הרצות · 9 מקומות עונתיים · 0 פורסמו · 7 דולגו (הקבוצה תפוסה) · 2 הוחלפו ע"י שומר הרלוונטיות');
  });

  it('is silent with no evidence', () => {
    expect(seasonalLedgerLine({ runs: 0, slots: 0, queued: 0, skipped: 0, dry: 0, swapped: 0 })).toBeNull();
  });
});
