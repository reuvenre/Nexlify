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
      scoutProducts: jest.fn(async () => ({ data: [item] })),
    };
    const campaigns = { find: jest.fn(async () => [{ keywords: ['knife'] }]) };
    const posts = { find: jest.fn(async () => [{ product_id: '9' }]) };
    const svc = new CommissionScoutService(campaigns as any, posts as any, products as any, memory as any);
    (global as any).setTimeout = ((fn: any) => { fn(); return 0 as any; }) as any;
    return { svc, memory, stored, products };
  }
  const realTimeout = global.setTimeout;
  afterEach(() => { global.setTimeout = realTimeout; });

  it('keeps the whole ranked list for the screen, with what was posted marked', async () => {
    const { svc, stored } = build();
    const report = await svc.scan('u1');
    expect(report.scanned).toBe(3); // one promo page, then the keyword in both searches
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
});
