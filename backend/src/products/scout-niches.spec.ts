import { CommissionScoutService } from './commission-scout.service';
import { NICHE_MAX_CALLS, PRESET_NICHES, categoryLabel, parseNicheId } from './scout-niches';

describe('scout niches — parsing', () => {
  it('reads the three kinds of niche id', () => {
    expect(parseNicheId('kw:פנס טקטי')).toEqual({ kind: 'kw', value: 'פנס טקטי' });
    expect(parseNicheId('preset:tactical')).toEqual({ kind: 'preset', value: 'tactical' });
    expect(parseNicheId('cat:44')).toEqual({ kind: 'cat', value: '44' });
    expect(parseNicheId('free text')).toBeNull();
    expect(parseNicheId('kw:')).toBeNull();
    expect(parseNicheId(undefined)).toBeNull();
  });

  it('names AliExpress categories in Hebrew, and leaves an unknown one as it is', () => {
    expect(categoryLabel('Home & Garden')).toBe('בית וגן');
    expect(categoryLabel('Some New Category')).toBe('Some New Category');
  });

  it('gives every ready niche English keywords and a unique key', () => {
    const keys = PRESET_NICHES.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const n of PRESET_NICHES) {
      expect(n.keywords.length).toBeGreaterThan(0);
      for (const k of n.keywords) expect(k).toMatch(/^[a-z0-9 ]+$/);
    }
  });
});

describe('CommissionScoutService — search by niche', () => {
  function build() {
    const stored: Record<string, any> = {};
    const memory = { load: jest.fn(async (k: string) => stored[k] ?? null), save: jest.fn(async (k: string, v: any) => { stored[k] = v; }) };
    const item = { product_id: '9', title: 'Torch', sale_price: 37, original_price: 60, discount_percent: 38, orders_count: 800, rating: 4.8, currency: 'ILS', sale_price_usd: 10, commission_rate: 70, category: 'Lights' };
    const products = {
      featuredPromoNames: jest.fn(async () => []),
      scoutProducts: jest.fn(async (..._a: any[]) => ({ data: [item] }) as any),
      scoutPriceCapUsd: jest.fn(async () => 94.59),
      getCategories: jest.fn(async () => [{ id: '44', name: 'Consumer Electronics' }]),
    };
    const campaigns = { find: jest.fn(async () => [{ keywords: ['tactical flashlight'] }]) };
    const posts = { find: jest.fn(async () => []) };
    const svc = new CommissionScoutService(campaigns as any, posts as any, products as any, memory as any);
    (global as any).setTimeout = ((fn: any) => { fn(); return 0 as any; }) as any;
    return { svc, stored, products, item };
  }
  const realTimeout = global.setTimeout;
  afterEach(() => { global.setTimeout = realTimeout; });
  const flush = () => new Promise((r) => realTimeout(r, 0));

  it('lists his keywords, the ready niches and the categories in Hebrew', async () => {
    const { svc } = build();
    const list = await svc.niches('u1');
    expect(list.mine).toEqual([{ id: 'kw:tactical flashlight', label: 'tactical flashlight' }]);
    expect(list.presets.length).toBe(PRESET_NICHES.length);
    expect(list.categories).toEqual([{ id: 'cat:44', label: 'מוצרי חשמל ואלקטרוניקה' }]);
  });

  it('refuses an id that is not on the list', async () => {
    const { svc } = build();
    expect((await svc.startNicheScan('u1', 'kw:something else')).started).toBe(false);
    expect((await svc.startNicheScan('u1', 'preset:nope')).started).toBe(false);
    expect((await svc.startNicheScan('u1', 'cat:999')).started).toBe(false);
  });

  it('searches a campaign keyword as the niche origin, so quick post can route it', async () => {
    const { svc, stored } = build();
    expect((await svc.startNicheScan('u1', 'kw:tactical flashlight')).started).toBe(true);
    await flush();
    const r = stored['commission_scout_niche:u1:kw:tactical flashlight'];
    expect(r.label).toBe('tactical flashlight');
    expect(r.items[0]).toMatchObject({ origin: 'niche', found_by: 'tactical flashlight', commission_rate: 70 });
  });

  it('searches a category in the hot feed and the regular search, by category id', async () => {
    const { svc, products } = build();
    await svc.startNicheScan('u1', 'cat:44');
    await flush();
    const sources = products.scoutProducts.mock.calls.map((c: any[]) => c[1]);
    expect(sources).toMatchObject([{ kind: 'hot', category_id: '44' }, { kind: 'search', category_id: '44' }]);
  });

  it('keeps a niche search within its own call budget', async () => {
    const { svc, products, item } = build();
    products.scoutProducts.mockResolvedValue({ data: Array.from({ length: 50 }, (_, i) => ({ ...item, product_id: String(i) })) });
    await svc.startNicheScan('u1', 'preset:tactical');
    await flush();
    expect(products.scoutProducts.mock.calls.length).toBeLessThanOrEqual(NICHE_MAX_CALLS);
    expect(products.scoutProducts.mock.calls.length).toBeGreaterThan(10);
  });

  it('will not search the same niche twice inside the cooldown', async () => {
    const { svc } = build();
    await svc.startNicheScan('u1', 'cat:44');
    await flush();
    expect((await svc.startNicheScan('u1', 'cat:44')).started).toBe(false);
    expect((await svc.nicheResult('u1', 'cat:44')).next_scan_at).not.toBeNull();
  });
});
