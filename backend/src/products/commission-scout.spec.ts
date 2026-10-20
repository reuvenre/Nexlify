import {
  CATALOG_MAX, MAX_PER_CATEGORY, ScoutCandidate, earnPerSaleUsd, minCommissionPct, parseRate, pickLines,
  picksPerReport, rankCatalog, reportHeader, scanKeywords, scoreCandidate, selectPicks, worthNextPage,
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
      base({ product_id: 'unsold', orders_count: 1 }),
      base({ product_id: 'badly-rated', rating: 3.9 }),
      base({ product_id: 'unrated', rating: 0 }),
      base({ product_id: 'seen' }),
      base({ product_id: 'no-price', sale_price_usd: 0 }),
    ], { minRate: 12, exclude: new Set(['seen']), max: 10 });
    expect(picks.map((p) => p.product_id).sort()).toEqual(['ok', 'unrated']);
    // at the bar and not seen: ok, unsold, badly-rated, unrated
    expect(qualified).toBe(4);
  });

  it('fills a short report at the relaxed floors, after every strict pick', () => {
    const { picks, funnel } = selectPicks([
      base({ product_id: 'strict', orders_count: 40 }),
      // pays more, but sells little and is rated lower: only in the second tier
      base({ product_id: 'newer', orders_count: 4, rating: 4.1, commission_rate: 40 }),
      base({ product_id: 'too-new', orders_count: 1, commission_rate: 60 }),
    ], { minRate: 12, exclude: new Set(), max: 10 });
    expect(picks.map((p) => p.product_id)).toEqual(['strict', 'newer']);
    expect(funnel.floors).toBe(1);
  });

  it('never picks the same product twice under two stores\' ids', () => {
    const photo = 'https://ae01.alicdn.com/kf/S7a1b2c3d4e5f6.jpg_220x220.jpg';
    const { picks } = selectPicks([
      base({ product_id: 'store-a', image_url: photo, orders_count: 900 }),
      base({ product_id: 'store-b', image_url: photo.replace('_220x220.jpg', ''), orders_count: 800 }),
      base({ product_id: 'other', category: 'Knives' }),
    ], { minRate: 12, exclude: new Set(), max: 10 });
    expect(picks.map((p) => p.product_id)).toEqual(['store-a', 'other']);
  });

  it('counts another store\'s listing of a posted product as posted', () => {
    const posted = { has: (p: any) => p.title === 'Rechargeable LED tactical flashlight 2000 lumens zoom' };
    const { picks, funnel } = selectPicks([
      base({ product_id: 'new-id', title: 'Rechargeable LED tactical flashlight 2000 lumens zoom' }),
      base({ product_id: 'fresh', title: 'Folding knife' }),
    ], { minRate: 12, exclude: new Set(), max: 10, published: posted });
    expect(picks.map((p) => p.product_id)).toEqual(['fresh']);
    expect(funnel.already).toBe(1);
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

  it('shows the 50–90 % products on the screen even with few sales or no rating', () => {
    const items = rankCatalog([
      base({ product_id: 'new-90', commission_rate: 90, orders_count: 0, rating: 0 }),
      base({ product_id: 'bad-rated-70', commission_rate: 70, orders_count: 2, rating: 3.8 }),
      base({ product_id: 'seller-12', commission_rate: 12, orders_count: 20_000 }),
    ], { minRate: 12, posted: new Set() });
    // All three are shown; the ranking still puts a badly rated, barely sold one under a bestseller.
    expect(items.map((i) => i.product_id).sort()).toEqual(['bad-rated-70', 'new-90', 'seller-12']);
    expect(items[0].product_id).toBe('new-90');
  });

  it('takes the best rate any source quoted for the same product', () => {
    const items = rankCatalog([
      base({ product_id: 'x', commission_rate: 9, origin: 'niche' }),
      base({ product_id: 'x', commission_rate: 85, origin: 'hot', found_by: 'Tools' }),
    ], { minRate: 12, posted: new Set() });
    expect(items).toHaveLength(1);
    expect(items[0].commission_rate).toBe(85);
    expect(items[0].origin).toBe('niche');
  });

  it('pages on only from a full page with something at or above the bar', () => {
    const page = (n: number, rate: number) => Array.from({ length: n }, () => ({ commission_rate: rate }));
    expect(worthNextPage(page(50, 80), 12)).toBe(true);
    expect(worthNextPage(page(50, 8), 12)).toBe(false);
    expect(worthNextPage(page(30, 80), 12)).toBe(false);
  });

  it('keeps every qualifying product for the screen, posted ones marked rather than hidden', () => {
    const items = rankCatalog([
      base({ product_id: 'a', orders_count: 9000 }),
      base({ product_id: 'b' }),
      base({ product_id: 'low', commission_rate: 8 }),
      ...Array.from({ length: 5 }, (_, i) => base({ product_id: `same-cat-${i}` })),
    ], { minRate: 12, posted: new Set(['b']) });
    expect(items.map((i) => i.product_id)).not.toContain('low');
    expect(items).toHaveLength(7); // no per-category cap on the screen
    expect(items[0].product_id).toBe('a');
    expect(items.find((i) => i.product_id === 'b')?.posted_recently).toBe(true);
    expect(items.find((i) => i.product_id === 'a')?.posted_recently).toBe(false);
  });

  it('caps the screen list', () => {
    const many = Array.from({ length: CATALOG_MAX + 40 }, (_, i) => base({ product_id: `p${i}` }));
    expect(rankCatalog(many, { minRate: 12, posted: new Set() })).toHaveLength(CATALOG_MAX);
  });
});
