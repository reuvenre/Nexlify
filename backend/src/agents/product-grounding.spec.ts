import { groundRankedProducts, productScore, recordSearch, SearchLedger } from './product-grounding';

const item = (id: string | number, extra: Record<string, any> = {}) => ({
  product_id: String(id),
  title: `Server title ${id}`,
  sale_price: 10,
  original_price: 20,
  discount_percent: 50,
  orders_count: 5000,
  rating: 4.5,
  image_url: `https://img/${id}.jpg`,
  category: 'Tools',
  currency: 'USD',
  ...extra,
});

describe('product grounding', () => {
  const ledger = (): SearchLedger => {
    const l: SearchLedger = new Map();
    recordSearch(l, 'tactical belt', [item(1), item(2)]);
    recordSearch(l, 'halloween decorations', [item(3), item(1)]);
    return l;
  };

  it('takes every published field from the search result, not from the model', () => {
    const { products } = groundRankedProducts(
      [{ product_id: '2', title: 'FREE iPhone', sale_price: 0.01, original_price: 999, image_url: 'https://evil', keyword: 'christmas gifts' }],
      ledger(), 3,
    );
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      product_id: '2', title: 'Server title 2', sale_price: 10, original_price: 20, image_url: 'https://img/2.jpg',
    });
  });

  it('attributes the keyword the server actually searched, and the first search that found an id wins', () => {
    const { products } = groundRankedProducts([{ product_id: '3', keyword: 'tactical belt' }, { product_id: '1' }], ledger(), 3);
    expect(products.map((p) => p.keyword)).toEqual(['halloween decorations', 'tactical belt']);
  });

  it('drops ids the search never returned instead of repairing them', () => {
    const { products, rejected } = groundRankedProducts([{ product_id: '999' }, { product_id: '1' }], ledger(), 3);
    expect(products.map((p) => p.product_id)).toEqual(['1']);
    expect(rejected).toEqual(['999']);
  });

  it('keeps the model order, dedupes, accepts numeric ids and caps at count', () => {
    const { products } = groundRankedProducts([{ product_id: 3 }, { product_id: '3' }, '2', { product_id: 1 }], ledger(), 2);
    expect(products.map((p) => p.product_id)).toEqual(['3', '2']);
  });

  it('returns nothing for a non-array answer', () => {
    expect(groundRankedProducts({ product_id: '1' }, ledger(), 3).products).toEqual([]);
  });

  it('ignores search payloads without ids', () => {
    const l: SearchLedger = new Map();
    recordSearch(l, 'kw', [null, {}, { product_id: '' }, item(7)]);
    recordSearch(l, 'kw', { not: 'an array' });
    expect([...l.keys()]).toEqual(['7']);
  });

  it('scores by the stated formula, with the sold-band bonus only inside the band', () => {
    const p = { discount_percent: 50, orders_count: 20000, rating: 5, sale_price: 12 };
    expect(productScore(p)).toBe(80);
    expect(productScore(p, { low: 10, high: 15 })).toBe(95);
    expect(productScore(p, { low: 20, high: 30 })).toBe(80);
  });
});
