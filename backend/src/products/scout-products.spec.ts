import { ProductsService } from './products.service';

/** The commission scout's API reads: the rate comes through, and a refusal is never mock data. */
describe('ProductsService.scoutProducts', () => {
  const item = {
    product_id: '7', product_title: 'Knife', sale_price: '10', original_price: '20', sale_price_currency: 'USD',
    commission_rate: '9.0%', hot_product_commission_rate: '14.0%', lastest_volume: '300', evaluate_rate: '96%',
  };

  function build(responses: any[]) {
    const svc = new ProductsService(
      { getRaw: jest.fn(async () => ({ aliexpress_app_key: 'k', aliexpress_app_secret: 's', currency_pair: 'USD_ILS' })) } as any,
      { getRate: jest.fn(async () => 3.7) } as any,
      { computeIls: (base: number) => base } as any,
      { hasAnyKey: () => false } as any,
      { get: jest.fn(async () => undefined), set: jest.fn(async () => undefined) } as any,
    );
    const calls: any[] = [];
    (svc as any).aliGet = jest.fn(async (signed: any) => {
      calls.push(signed);
      return { data: responses.shift() };
    });
    return { svc, calls };
  }

  it('takes the higher of the regular and the hot rate', async () => {
    const { svc, calls } = build([{ aliexpress_affiliate_hotproduct_query_response: { resp_result: { resp_code: 200, result: { products: { product: [item] } } } } }]);
    const res = await svc.scoutProducts('u1', { kind: 'hot', keyword: 'knife' });
    expect(calls[0].method).toBe('aliexpress.affiliate.hotproduct.query');
    expect(calls[0].fields).toContain('commission_rate');
    expect(res.data[0].commission_rate).toBe(14);
    expect(res.data[0].sale_price_usd).toBe(10);
  });

  it('reads a promotion list by commission, and in its own order when that sort is refused', async () => {
    const ok = { aliexpress_affiliate_featuredpromo_products_get_response: { resp_result: { resp_code: 200, result: { products: { product: [item] } } } } };
    const refused = { aliexpress_affiliate_featuredpromo_products_get_response: { resp_result: { resp_code: 405, resp_msg: 'bad sort' } } };
    const { svc, calls } = build([refused, ok]);
    const res = await svc.scoutProducts('u1', { kind: 'promo', name: 'Hot Product' });
    expect(calls[0].sort).toBe('commissionDesc');
    expect(calls[0].promotion_name).toBe('Hot Product');
    expect(calls[1].sort).toBeUndefined();
    expect(res.data).toHaveLength(1);
  });

  it('returns the refusal, never products', async () => {
    const { svc } = build([{ error_response: { code: 'ApiCallLimit', msg: 'App Call Limited' } }]);
    const res = await svc.scoutProducts('u1', { kind: 'search', keyword: 'knife' });
    expect(res.data).toEqual([]);
    expect(res.error).toBe('App Call Limited');
  });
});
