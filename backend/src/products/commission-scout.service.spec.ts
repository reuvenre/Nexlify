import { CommissionScoutService, SCAN_COOLDOWN_MS } from './commission-scout.service';

/** The screen's data and its "scan now": the last scan is kept, and a scan cannot be spammed. */
describe('CommissionScoutService', () => {
  function build(stored: Record<string, any> = {}) {
    const memory = {
      load: jest.fn(async (k: string) => stored[k] ?? null),
      save: jest.fn(async (k: string, v: any) => { stored[k] = v; }),
    };
    const item = {
      product_id: '9', title: 'Knife', sale_price: 37, original_price: 60, discount_percent: 38, orders_count: 800,
      rating: 4.8, currency: 'ILS', sale_price_usd: 10, commission_rate: 15, category: 'Tools',
    };
    const products = {
      featuredPromoNames: jest.fn(async () => ['Hot Product']),
      scoutProducts: jest.fn(async (..._a: any[]) => ({ data: [item] }) as any),
      getCategories: jest.fn(async () => [{ id: '44', name: 'Tools' }]),
    };
    const campaigns = { find: jest.fn(async () => [{ keywords: ['knife'] }]) };
    const posts = { find: jest.fn(async () => [{ product_id: '9' }]) };
    const earnings = { find: jest.fn(async (..._a: any[]) => [] as any[]) };
    const svc = new CommissionScoutService(campaigns as any, posts as any, products as any, memory as any, earnings as any);
    (global as any).setTimeout = ((fn: any) => { fn(); return 0 as any; }) as any;
    return { svc, memory, stored, products, item, posts, earnings };
  }
  const realTimeout = global.setTimeout;
  afterEach(() => { global.setTimeout = realTimeout; });

  it('keeps the whole ranked list for the screen, with what was posted marked', async () => {
    const { svc, stored } = build();
    const report = await svc.scan('u1');
    // one promo page, the hot feed, the keyword in both searches, one category of the hot feed
    expect(report.scanned).toBe(5);
    expect(report.picks).toHaveLength(0); // posted in the last 30 days: not recommended again
    const saved = stored['commission_scout_catalog:u1'];
    expect(saved.items).toHaveLength(1);
    expect(saved.items[0].posted_recently).toBe(true);
    expect(saved.min_rate).toBe(12);
  });

  it('keeps the previous list when a scan read nothing', async () => {
    const { svc, stored, products } = build({ 'commission_scout_catalog:u1': { items: ['old'] } });
    products.featuredPromoNames.mockResolvedValue([]);
    products.scoutProducts.mockResolvedValue({ data: [], error: 'App Call Limited' } as any);
    products.getCategories.mockResolvedValue([]);
    await svc.scan('u1');
    expect(stored['commission_scout_catalog:u1']).toEqual({ items: ['old'] });
    expect((await svc.catalog('u1')).last_error).toContain('App Call Limited');
  });

  it('refuses a second scan inside the cooldown', async () => {
    const recent = { scanned_at: new Date(Date.now() - SCAN_COOLDOWN_MS / 2).toISOString(), items: [] };
    const { svc } = build({ 'commission_scout_catalog:u1': recent });
    const res = await svc.startScan('u1');
    expect(res.started).toBe(false);
    expect((await svc.catalog('u1')).next_scan_at).not.toBeNull();
  });

  it('starts a scan after the cooldown, and refuses one while it runs', async () => {
    const old = { scanned_at: new Date(Date.now() - SCAN_COOLDOWN_MS * 2).toISOString(), items: [] };
    const { svc, products } = build({ 'commission_scout_catalog:u1': old });
    let release!: () => void;
    products.featuredPromoNames.mockReturnValue(new Promise((r) => { release = () => r([]); }) as any);
    expect((await svc.startScan('u1')).started).toBe(true);
    expect((await svc.catalog('u1')).running).toBe(true);
    expect((await svc.startScan('u1')).started).toBe(false);
    release();
  });

  it("reads each keyword at the day's rotated slice, and page 1 when that slice is past the end", async () => {
    const { svc, products } = build();
    // day % 6 === 2 → keyword 0 reads the best sellers from page 3 today
    const now = jest.spyOn(Date, 'now').mockReturnValue((6 * 3000 + 2) * 86_400_000 + 3600_000);
    products.featuredPromoNames.mockResolvedValue([]);
    products.getCategories.mockResolvedValue([]);
    products.scoutProducts.mockImplementation(async (_u: string, _src: any, page: number) => ({ data: page === 1 ? [] : [] }));
    await svc.scan('u1');
    now.mockRestore();
    const search = products.scoutProducts.mock.calls.filter((c: any[]) => c[1].kind === 'search');
    expect(search.map((c: any[]) => c[2])).toEqual([3, 1]);
    expect(search[0][1].sort).toBe('LAST_VOLUME_DESC');
  });

  it("ranks by what his own orders of a product paid, not by the declared rate", async () => {
    const { svc, stored, posts, earnings } = build();
    posts.find.mockResolvedValue([]);
    earnings.find.mockResolvedValue([
      { product_id: '9', order_amount_usd: 50, commission_usd: 2, incentive_commission_usd: 0.5, keyword: 'knife' },
      { product_id: '9', order_amount_usd: 50, commission_usd: 2, incentive_commission_usd: null, keyword: 'knife' },
    ]);
    await svc.scan('u1');
    const item = stored['commission_scout_catalog:u1'].items[0];
    expect(item).toMatchObject({ commission_rate: 15, effective_rate: 4.5, paid_basis: 'product' });
    expect(stored['commission_scout_paid:u1'].tools.orders).toBe(2);
  });

  it('pages on while a full page still pays, and stops at the first page under the bar', async () => {
    const { svc, products, item } = build();
    const full = (rate: number) => ({ data: Array.from({ length: 50 }, (_, i) => ({ ...item, product_id: `${rate}-${i}`, commission_rate: rate })) });
    products.featuredPromoNames.mockResolvedValue(['Hot Product']);
    products.getCategories.mockResolvedValue([]);
    products.scoutProducts.mockImplementation(async (_u: string, src: any, page: number) =>
      src.kind === 'promo' ? (page < 3 ? full(70) : full(5)) : ({ data: [] }));
    await svc.scan('u1');
    const promoPages = products.scoutProducts.mock.calls.filter((c: any[]) => c[1].kind === 'promo').map((c: any[]) => c[2]);
    expect(promoPages).toEqual([1, 2, 3]); // page 3 fell under the bar: no page 4
  });

  it('stops after five failures in a row (the quota, not bad luck)', async () => {
    const { svc, products } = build();
    products.featuredPromoNames.mockResolvedValue(Array.from({ length: 20 }, (_, i) => `P${i}`));
    products.scoutProducts.mockResolvedValue({ data: [], error: 'App Call Limited' } as any);
    await svc.scan('u1');
    expect(products.scoutProducts).toHaveBeenCalledTimes(5);
  });

  it('never spends more than its call budget', async () => {
    process.env.COMMISSION_SCOUT_MAX_CALLS = '12';
    try {
      const { svc, products, item } = build();
      products.featuredPromoNames.mockResolvedValue(Array.from({ length: 20 }, (_, i) => `P${i}`));
      products.scoutProducts.mockResolvedValue({ data: Array.from({ length: 50 }, (_, i) => ({ ...item, product_id: String(i), commission_rate: 80 })) });
      await svc.scan('u1');
      expect(products.scoutProducts).toHaveBeenCalledTimes(12);
    } finally {
      delete process.env.COMMISSION_SCOUT_MAX_CALLS;
    }
  });
});
