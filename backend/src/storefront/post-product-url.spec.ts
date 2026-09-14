import { StorefrontService } from './storefront.service';

/**
 * Where a Pinterest pin points decides whether Pinterest indexes it at all.
 *
 * Measured before this existed: 50 pins, 23 impressions in 30 days, and not one findable in
 * Pinterest search by its own exact title. Every pin pointed at s.click.aliexpress.com — a
 * domain we neither own nor can claim, with no page behind it to read.
 *
 * The storefront product page replaces it. The danger in that swap is a pin aimed at a page
 * that will never render: the store's catalog query admits a post only on four conditions,
 * and a 404 destination is worse than the redirect it replaced. So the resolver checks the
 * same four, and answers null rather than guessing.
 */
describe('StorefrontService.postProductUrl', () => {
  const USER = 'u1';
  const OK = {
    id: 'post-uuid',
    product_id: '1005001',
    product_title: 'פנס טקטי',
    price_ils: 89,
    affiliate_url: 'https://s.click.aliexpress.com/e/_abc',
  };

  /** The service with only what this method touches. */
  function build(store: any = { slug: 'hidden-premium-brands', enabled: true }) {
    const repo = { findOne: jest.fn(async () => store) } as any;
    return { svc: new StorefrontService(repo, {} as any, {} as any), repo };
  }

  const FRONTEND = process.env.FRONTEND_URL;
  beforeEach(() => { process.env.FRONTEND_URL = 'https://nexlify.win-solutions.co.il'; });
  afterAll(() => { process.env.FRONTEND_URL = FRONTEND; });

  it('builds the product page on the claimed host', async () => {
    const { svc } = build();
    await expect(svc.postProductUrl(USER, OK)).resolves.toBe(
      'https://nexlify.win-solutions.co.il/s/hidden-premium-brands/p/p%3Apost-uuid',
    );
  });

  it('encodes the id exactly the way the store\'s own grid links it', async () => {
    // The grid uses encodeURIComponent("p:<uuid>"). A pin linking the raw colon would be a
    // second spelling of the same page — and only one of them is the one Pinterest sees
    // elsewhere on the site.
    const { svc } = build();
    const url = await svc.postProductUrl(USER, OK);
    expect(url).toContain('p%3A');
    expect(url).not.toContain('/p/p:');
  });

  it('falls back (null) when the account has no live store', async () => {
    const { svc } = build(null);
    await expect(svc.postProductUrl(USER, OK)).resolves.toBeNull();
  });

  it('asks the repository only for an ENABLED store', async () => {
    // A disabled store's pages 404. Reading it and linking anyway would aim every pin at a
    // dead page — the exact failure this method exists to prevent.
    const { svc, repo } = build();
    await svc.postProductUrl(USER, OK);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { user_id: USER, enabled: true } });
  });

  describe('refuses a post the catalog page would never render', () => {
    const cases: Array<[string, any]> = [
      ['no product id', { ...OK, product_id: null }],
      ['empty title', { ...OK, product_title: '   ' }],
      ['no price', { ...OK, price_ils: 0 }],
      ['no affiliate url', { ...OK, affiliate_url: '' }],
      ['no post id', { ...OK, id: null }],
    ];
    for (const [name, post] of cases) {
      it(name, async () => {
        const { svc } = build();
        await expect(svc.postProductUrl(USER, post)).resolves.toBeNull();
      });
    }
  });

  it('refuses a relative base — a crawler cannot follow it', async () => {
    // FRONTEND_URL unset yields "/s/slug". Handing Pinterest that is worse than sending it
    // nowhere: it reads as a broken destination rather than an absent one.
    process.env.FRONTEND_URL = '';
    const { svc } = build();
    await expect(svc.postProductUrl(USER, OK)).resolves.toBeNull();
  });
});
