import { ProductsService } from './products.service';

/** The readers' bot asks AliExpress for Hebrew titles; a refusal must not cost the search. */
describe('ProductsService.search — title_language', () => {
  const item = { product_id: '1', product_title: 'אוזניות', sale_price: '10', original_price: '20', sale_price_currency: 'USD', product_main_image_url: 'https://i/1.jpg' };

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
      return { data: { aliexpress_affiliate_product_query_response: { resp_result: responses.shift() } } };
    });
    return { svc, calls };
  }

  it('sends target_language when asked', async () => {
    const { svc, calls } = build([{ resp_code: 200, result: { products: { product: [item] } } }]);
    const res = await svc.search('u1', { keyword: 'earbuds', title_language: 'HE', strict: true });
    expect(calls[0].target_language).toBe('HE');
    expect(res.data).toHaveLength(1);
  });

  it('retries once in English when the API refuses the language', async () => {
    const { svc, calls } = build([
      { resp_code: 400, resp_msg: 'invalid target_language' },
      { resp_code: 200, result: { products: { product: [item] } } },
    ]);
    const res = await svc.search('u1', { keyword: 'earbuds', title_language: 'HE', strict: true });
    expect(calls).toHaveLength(2);
    expect(calls[1].target_language).toBeUndefined();
    expect(res.data).toHaveLength(1);
  });

  it('leaves every other caller in English', async () => {
    const { svc, calls } = build([{ resp_code: 200, result: { products: { product: [item] } } }]);
    await svc.search('u1', { keyword: 'earbuds', strict: true });
    expect(calls[0].target_language).toBeUndefined();
  });
});
