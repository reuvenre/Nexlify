import {
  blackFridayDay, israelDaysUntil, israelTime, saleCopyHint, saleIntervalMinutes, salePeakNow,
  salePhase, salePostsPerRun, saleWindows,
} from './sale-calendar';

describe('sale calendar', () => {
  it('finds Black Friday', () => {
    expect(blackFridayDay(2026)).toBe(27);
    expect(blackFridayDay(2025)).toBe(28);
    expect(blackFridayDay(2024)).toBe(29);
  });

  it('starts 11.11 at Pacific midnight, 10:00 in Israel', () => {
    const w = saleWindows(2026).find((x) => x.key === '1111')!;
    expect(w.liveFrom.toISOString()).toBe('2026-11-11T08:00:00.000Z');
    expect(israelTime(w.liveFrom)).toEqual({ date: '11.11', time: '10:00' });
    expect(w.liveTo.toISOString()).toBe('2026-11-12T08:00:00.000Z');
  });

  it('names the phase', () => {
    expect(salePhase(new Date('2026-10-20T12:00:00Z'))).toBeNull();
    expect(salePhase(new Date('2026-11-05T12:00:00Z'))).toMatchObject({ window: { key: '1111' }, phase: 'warmup' });
    // 09:59 Israel on 11.11 is still the warm-up; 10:00 is the sale.
    expect(salePhase(new Date('2026-11-11T07:59:00Z'))?.phase).toBe('warmup');
    expect(salePhase(new Date('2026-11-11T08:00:00Z'))?.phase).toBe('live');
    expect(salePhase(new Date('2026-11-20T12:00:00Z'))).toMatchObject({ window: { key: 'black_friday' }, phase: 'warmup' });
    expect(salePhase(new Date('2026-11-28T12:00:00Z'))).toMatchObject({ window: { key: 'black_friday' }, phase: 'live' });
    expect(salePhase(new Date('2026-11-30T20:00:00Z'))).toMatchObject({ window: { key: 'cyber_monday' }, phase: 'live' });
    expect(salePhase(new Date('2026-12-02T12:00:00Z'))).toBeNull();
  });

  it('writes a different line before and during the sale', () => {
    const before = saleCopyHint('he', new Date('2026-11-05T12:00:00Z'))!;
    expect(before).toContain('בעגלה');
    expect(before).toContain('10:00');
    const during = saleCopyHint('he', new Date('2026-11-11T12:00:00Z'))!;
    expect(during).toContain('מבצע 11.11');
    expect(during).toContain('אל תמציא');
    expect(saleCopyHint('he', new Date('2026-11-28T12:00:00Z'))).toContain('30.11');
    expect(saleCopyHint('en', new Date('2026-11-30T20:00:00Z'))).toContain('Cyber Monday');
    expect(saleCopyHint('he', new Date('2026-10-01T12:00:00Z'))).toBeNull();
  });

  it('stresses the 11.11 sale and never calls it a last chance, all day', () => {
    for (const t of ['2026-11-11T09:00:00Z', '2026-11-11T18:00:00Z', '2026-11-12T05:00:00Z']) {
      for (const lang of ['he', 'en']) {
        const hint = saleCopyHint(lang, new Date(t))!;
        expect(hint).toContain('11.11');
        // The prompt forbids "last chance"; it must never ask for it.
        expect(hint).not.toMatch(/כתוב כהזדמנות אחרונה|השעות האחרונות|Write it as a last chance|last hours/);
      }
      expect(saleCopyHint('he', new Date(t))).toContain('אל תכתוב שזו הזדמנות אחרונה');
      expect(saleCopyHint('he', new Date(t))).not.toContain('מחר');
    }
  });

  it('turns to last-call copy in the final 14 hours of Cyber Monday only', () => {
    // 19:59 Israel on 30.11: still the day's framing.
    expect(saleCopyHint('he', new Date('2026-11-30T17:59:00Z'))).toContain('היום סייבר מאנדיי');
    const last = saleCopyHint('he', new Date('2026-11-30T20:00:00Z'))!;
    expect(last).toContain('השעות האחרונות של סייבר מאנדיי');
    expect(last).toContain('עד 1.12 ב-10:00');
    expect(last).toContain('אל תמציא');
    // Black Friday's end runs into Cyber Monday: no last call there.
    expect(saleCopyHint('he', new Date('2026-11-29T20:00:00Z'))).toContain('סוף השבוע של בלאק פריידיי');
  });

  it('doubles a run while a sale is live, capped', () => {
    expect(salePostsPerRun(1, false)).toBe(1);
    expect(salePostsPerRun(1, true)).toBe(2);
    expect(salePostsPerRun(2, true)).toBe(4);
    expect(salePostsPerRun(5, true)).toBe(6);
    expect(salePostsPerRun(8, true)).toBe(8);
  });

  it('halves the group interval while a sale is live, never under the floor', () => {
    expect(saleIntervalMinutes(60, false)).toBe(60);
    expect(saleIntervalMinutes(60, true)).toBe(30);
    expect(saleIntervalMinutes(30, true)).toBe(20);
    expect(saleIntervalMinutes(15, true)).toBe(15);
  });

  it('can be switched off', () => {
    const live = new Date('2026-11-11T12:00:00Z');
    expect(salePeakNow(live)).toBe(true);
    process.env.SALE_PEAK_BOOST_DISABLED = '1';
    expect(salePeakNow(live)).toBe(false);
    delete process.env.SALE_PEAK_BOOST_DISABLED;
  });

  it('counts Israel days to a start', () => {
    const w = saleWindows(2026).find((x) => x.key === '1111')!;
    expect(israelDaysUntil(w.liveFrom, new Date('2026-11-04T09:00:00Z'))).toBe(7);
    expect(israelDaysUntil(w.liveFrom, new Date('2026-11-09T07:00:00Z'))).toBe(2);
  });
});
