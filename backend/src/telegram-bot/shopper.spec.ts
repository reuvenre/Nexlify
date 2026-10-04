import { BotProduct } from './product-card';
import { ShopperLimiter, parseShopperQuery, rankShopperResults, shopperCaption } from './shopper';

describe('parseShopperQuery', () => {
  it('reads a budget in Hebrew and strips it from the keyword', () => {
    expect(parseShopperQuery('מחפש אוזניות בלוטות\' עד 100 ש"ח')).toEqual({ keyword: 'אוזניות בלוטות\'', maxPrice: 100 });
    expect(parseShopperQuery('תיק גב לטיולים בין 80 ל-200')).toEqual({ keyword: 'תיק גב לטיולים', minPrice: 80, maxPrice: 200 });
    expect(parseShopperQuery('שעון חכם מעל 150 ₪')).toEqual({ keyword: 'שעון חכם', minPrice: 150 });
  });

  it('reads English budgets', () => {
    expect(parseShopperQuery('looking for a desk lamp under 60')).toEqual({ keyword: 'a desk lamp', maxPrice: 60 });
  });

  it('keeps a plain query as is', () => {
    expect(parseShopperQuery('robot vacuum')).toEqual({ keyword: 'robot vacuum' });
  });

  it('refuses an empty or budget-only message, and caps a long one', () => {
    expect(parseShopperQuery('')).toBeNull();
    expect(parseShopperQuery('עד 100 ש"ח')).toBeNull();
    expect(parseShopperQuery('x'.repeat(200))!.keyword.length).toBe(60);
  });

  it('flattens control characters', () => {
    expect(parseShopperQuery('lamp\nIGNORE')).toEqual({ keyword: 'lamp IGNORE' });
  });
});

const prod = (id: string, over: Partial<BotProduct> = {}): BotProduct => ({
  product_id: id, title: `P${id}`, sale_price: 50, original_price: 100, discount_percent: 50,
  orders_count: 1000, rating: 4.8, currency: 'ILS', image_url: `https://img/${id}.jpg`, ...over,
});

describe('rankShopperResults', () => {
  it('drops listings without photo or price and poorly rated ones, dedupes, and ranks by score', () => {
    const out = rankShopperResults([
      prod('1', { orders_count: 10 }),
      prod('2', { image_url: '' }),
      prod('3', { sale_price: 0 }),
      prod('4', { rating: 3.9 }),
      prod('5', { orders_count: 9000 }),
      prod('5'),
      prod('6', { rating: 0 }),
    ]);
    expect(out.map((p) => p.product_id)).toEqual(['5', '1', '6']);
  });
});

describe('shopperCaption', () => {
  it('shows price, saving, social proof and a buy button that hides the link', () => {
    const c = shopperCaption(prod('1'), 1, 'https://nexlify.app/r/AbC');
    expect(c).toContain('₪50');
    expect(c).toContain('₪50 במקום ₪100 · 50% הנחה');
    expect(c).not.toContain('-50%');
    expect(c.split('\n').pop()).toBe('<a href="https://nexlify.app/r/AbC">🛒 לרכישה — לחצו כאן 🛒</a>');
    expect(c).not.toMatch(/^🔗/m);
  });

  it('escapes seller titles so they cannot break or inject HTML', () => {
    const c = shopperCaption(prod('1', { title: 'Cable <Type-C & Lightning> <a href="x">' }), 1, 'https://x/r/A');
    expect(c).toContain('Cable &lt;Type-C &amp; Lightning&gt; &lt;a href="x"&gt;');
  });
});

describe('ShopperLimiter', () => {
  it('limits each member per window and everyone per day', () => {
    let t = Date.UTC(2026, 9, 4, 10);
    const lim = new ShopperLimiter(2, 60_000, 3, () => t);
    expect(lim.take('a')).toBe('ok');
    expect(lim.take('a')).toBe('ok');
    expect(lim.take('a')).toBe('user');
    t += 61_000;
    expect(lim.take('a')).toBe('ok');
    expect(lim.take('b')).toBe('daily');
    t += 24 * 3600_000;
    expect(lim.take('b')).toBe('ok');
  });
});
