import { aiFailureNote, nextSale, readinessDue, readinessReport } from './sale-readiness';
import { saleWindows } from '../common/sale-calendar';

const facts = { couponsForSale: 0, activeCampaigns: 3, aiFailing: [], postsLast24h: 12, seasonalEnabled: true };

describe('sale readiness', () => {
  it('is due a week and two days before 11.11 and Black Friday, on Israel days', () => {
    expect(readinessDue(new Date('2026-11-04T08:00:00Z'))).toMatchObject({ window: { key: '1111' }, days: 7 });
    expect(readinessDue(new Date('2026-11-09T08:00:00Z'))).toMatchObject({ window: { key: '1111' }, days: 2 });
    expect(readinessDue(new Date('2026-11-20T08:00:00Z'))).toMatchObject({ window: { key: 'black_friday' }, days: 7 });
    expect(readinessDue(new Date('2026-11-05T08:00:00Z'))).toBeNull();
    // Cyber Monday never gets a checklist of its own.
    expect(readinessDue(new Date('2026-11-23T08:00:00Z'))).toBeNull();
  });

  it('names the next sale for /sale', () => {
    expect(nextSale(new Date('2026-10-14T08:00:00Z'))).toMatchObject({ window: { key: '1111' }, days: 28 });
    expect(nextSale(new Date('2026-11-12T09:00:00Z'))).toMatchObject({ window: { key: 'black_friday' } });
    expect(nextSale(new Date('2026-11-30T20:00:00Z'))).toMatchObject({ window: { key: 'black_friday' }, days: 0 });
    expect(nextSale(new Date('2026-12-05T08:00:00Z')).window.liveFrom.getUTCFullYear()).toBe(2027);
  });

  it('flags a missing coupon set and a failing AI key', () => {
    const w = saleWindows(2026).find((x) => x.key === '1111')!;
    const text = readinessReport(w, 7, { ...facts, aiFailing: ['טקטי בקליק'] });
    expect(text).toContain('עוד 7 ימים: 11.11');
    expect(text).toContain('11.11 10:00 עד 12.11 10:00');
    expect(text).toContain('⚠️ קופונים');
    expect(text).toContain('⚠️ AI: 1 קמפיינים');
    expect(text).toContain('פי 2');
  });

  it('covers Cyber Monday in the Black Friday checklist', () => {
    const w = saleWindows(2026).find((x) => x.key === 'black_friday')!;
    const text = readinessReport(w, 2, { ...facts, couponsForSale: 4 });
    expect(text).toContain('כולל סייבר מאנדיי');
    expect(text).toContain('✅ קופונים: 4');
  });

  it('reads the AI failure wording of a run note', () => {
    expect(aiFailureNote('anthropic: נגמר הקרדיט בחשבון')).toBe(true);
    expect(aiFailureNote('anthropic: המפתח נדחה')).toBe(true);
    expect(aiFailureNote('"kw": החיפוש לא החזיר מוצרים כלל')).toBe(false);
    expect(aiFailureNote(null)).toBe(false);
  });
});
