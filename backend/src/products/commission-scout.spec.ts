import {
  MAX_PER_CATEGORY, ScoutCandidate, earnPerSaleUsd, minCommissionPct, parseRate, pickLines,
  picksPerReport, reportHeader, scanKeywords, scoreCandidate, selectPicks,
} from './commission-scout';

const base = (over: Partial<ScoutCandidate> = {}): ScoutCandidate => ({
  product_id: '1', title: 'Tactical flashlight', sale_price: 40, original_price: 60, discount_percent: 33,
  orders_count: 500, rating: 4.7, currency: 'ILS', sale_price_usd: 10, commission_rate: 12,
  category: 'Lights', found_by: 'flashlight', origin: 'niche', ...over,
});

describe('commission scout', () => {
  it('reads the rate in every shape the API sends', () => {
    expect(parseRate('12.5%')).toBe(12.5);
    expect(parseRate('7.0')).toBe(7);
    expect(parseRate(15)).toBe(15);
    expect(parseRate('')).toBe(0);
    expect(parseRate(undefined)).toBe(0);
    expect(parseRate('abc')).toBe(0);
    expect(parseRate('150')).toBe(0);
  });

  it('pays per sale in USD', () => {
    expect(earnPerSaleUsd({ sale_price_usd: 10, commission_rate: 12 })).toBe(1.2);
  });

  it('ranks a product that sells over one that only pays a higher rate', () => {
    const seller = base({ product_id: 'a', commission_rate: 12, orders_count: 20_000 });
    const idle = base({ product_id: 'b', commission_rate: 15, orders_count: 12 });
    expect(scoreCandidate(seller)).toBeGreaterThan(scoreCandidate(idle));
  });

  it("puts the owner's own niche ahead of the same money from a promotion list", () => {
    expect(scoreCandidate(base({ origin: 'niche' }))).toBeGreaterThan(scoreCandidate(base({ origin: 'promo' })));
  });

  it('keeps only products at or above the bar, selling, rated, and not seen', () => {
    const { picks, qualified } = selectPicks([
      base({ product_id: 'ok' }),
      base({ product_id: 'low', commission_rate: 11.9 }),
      base({ product_id: 'unsold', orders_count: 3 }),
      base({ product_id: 'badly-rated', rating: 3.9 }),
      base({ product_id: 'unrated', rating: 0 }),
      base({ product_id: 'seen' }),
      base({ product_id: 'no-price', sale_price_usd: 0 }),
    ], { minRate: 12, exclude: new Set(['seen']), max: 10 });
    expect(picks.map((p) => p.product_id).sort()).toEqual(['ok', 'unrated']);
    expect(qualified).toBe(2);
  });

  it('lets one category fill at most MAX_PER_CATEGORY places', () => {
    const many = Array.from({ length: 6 }, (_, i) => base({ product_id: `l${i}`, category: 'Lights' }));
    const other = base({ product_id: 'k1', category: 'Knives', orders_count: 50 });
    const { picks } = selectPicks([...many, other], { minRate: 12, exclude: new Set(), max: 10 });
    expect(picks.filter((p) => p.category === 'Lights')).toHaveLength(MAX_PER_CATEGORY);
    expect(picks.map((p) => p.product_id)).toContain('k1');
  });

  it('keeps the niche origin of a product found twice', () => {
    const { picks } = selectPicks([
      base({ origin: 'promo', found_by: 'Hot Deals' }),
      base({ origin: 'niche', found_by: 'flashlight' }),
    ], { minRate: 12, exclude: new Set(), max: 10 });
    expect(picks).toHaveLength(1);
    expect(picks[0].origin).toBe('niche');
  });

  it('stops at the requested number of picks, best first', () => {
    const list = Array.from({ length: 30 }, (_, i) => base({ product_id: `p${i}`, category: `c${i}`, orders_count: 100 + i * 100 }));
    const { picks } = selectPicks(list, { minRate: 12, exclude: new Set(), max: 5 });
    expect(picks).toHaveLength(5);
    expect(picks[0].product_id).toBe('p29');
  });

  it('reads each campaign keyword once, capped', () => {
    expect(scanKeywords([['knife', ' Knife '], ['torch', 'knife'], ['']], 12)).toEqual(['knife', 'torch']);
    expect(scanKeywords([Array.from({ length: 20 }, (_, i) => `k${i}`)], 12)).toHaveLength(12);
  });

  it('takes the bar and the count from the environment, within bounds', () => {
    expect(minCommissionPct({})).toBe(12);
    expect(minCommissionPct({ COMMISSION_SCOUT_MIN: '15' })).toBe(15);
    expect(minCommissionPct({ COMMISSION_SCOUT_MIN: 'x' })).toBe(12);
    expect(picksPerReport({})).toBe(10);
    expect(picksPerReport({ COMMISSION_SCOUT_PICKS: '50' })).toBe(20);
  });

  it('says what a pick pays and where it was found', () => {
    const [pick] = selectPicks([base({ commission_rate: 14.5 })], { minRate: 12, exclude: new Set(), max: 1 }).picks;
    const lines = pickLines(pick);
    expect(lines[0]).toBe('💵 עמלה 14.5% · כ-$1.45 לכל מכירה');
    expect(lines[1]).toContain('«flashlight»');
  });

  it('explains an empty day instead of sending nothing', () => {
    const text = reportHeader({ picks: 0, qualified: 0, scanned: 900, minRate: 12, errors: ['Hot: ApiCallLimit'] });
    expect(text).toContain('נסרקו 900 מוצרים');
    expect(text).toContain('לא נמצא היום');
    expect(text).toContain('1 חיפושים נכשלו');
  });
});
