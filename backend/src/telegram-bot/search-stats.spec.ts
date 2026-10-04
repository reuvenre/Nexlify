import { normaliseSearch, searchesReport } from './search-stats';

describe('search stats', () => {
  it('normalises terms so the same search groups together', () => {
    expect(normaliseSearch('  Airpods   PRO ')).toBe('airpods pro');
  });

  it('lists the top searches and flags demand that found nothing', () => {
    const text = searchesReport([
      { keyword: 'אוזניות', searches: 12, empty: 0 },
      { keyword: 'שעון חכם', searches: 5, empty: 1 },
      { keyword: 'כיסא גיימינג', searches: 3, empty: 3 },
    ], 7, 20);
    expect(text).toContain('1. אוזניות — 12');
    expect(text).toContain('2. שעון חכם — 5 · 1 בלי תוצאות');
    expect(text).toContain('3. כיסא גיימינג — 3 · לא נמצא כלום');
    expect(text).toContain('ביקוש בלי מענה: כיסא גיימינג');
  });

  it('says so when there is nothing yet', () => {
    expect(searchesReport([], 7, 0)).toContain('עוד אין חיפושים');
  });
});
