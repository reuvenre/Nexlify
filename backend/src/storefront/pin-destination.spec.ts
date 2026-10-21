import { isHebrewAudience, isPinVisit, pinBuyUrl, pinMayUseStore } from './pin-destination';
import { StorefrontService } from './storefront.service';

describe('where a pin may land', () => {
  it('reads Hebrew, and a missing language as the Hebrew default', () => {
    for (const l of ['he', 'HE', 'he-IL', 'iw', 'עברית', '', null, undefined]) expect(isHebrewAudience(l)).toBe(true);
    for (const l of ['en', 'en-US', 'ar', 'ru']) expect(isHebrewAudience(l)).toBe(false);
  });

  it('needs the store on, its link switch on, and a Hebrew post', () => {
    expect(pinMayUseStore({ enabled: true, link_in_posts: true }, 'he')).toBe(true);
    expect(pinMayUseStore({ enabled: true, link_in_posts: false }, 'he')).toBe(false);
    expect(pinMayUseStore({ enabled: false, link_in_posts: true }, 'he')).toBe(false);
    expect(pinMayUseStore({ enabled: true, link_in_posts: true }, 'en')).toBe(false);
    expect(pinMayUseStore(null, 'he')).toBe(false);
  });

  it('marks our own redirect as a pin\'s, and leaves anything else alone', () => {
    expect(pinBuyUrl('https://nexlify.win-solutions.co.il/r/abc123')).toBe('https://nexlify.win-solutions.co.il/r/abc123?s=pin');
    expect(pinBuyUrl('https://s.click.aliexpress.com/e/_x')).toBe('https://s.click.aliexpress.com/e/_x');
  });

  it('recognises a Pinterest visit by our tag, Pinterest\'s own tag, the referrer or the crawler', () => {
    expect(isPinVisit({ src: 'pin' })).toBe(true);
    expect(isPinVisit({ utm_source: 'Pinterest' })).toBe(true);
    expect(isPinVisit({ referer: 'https://www.pinterest.com/pin/123/' })).toBe(true);
    expect(isPinVisit({ referer: 'https://pin.it/abc' })).toBe(true);
    expect(isPinVisit({ userAgent: 'Pinterestbot/1.0 (+http://www.pinterest.com/bot.html)' })).toBe(true);
    expect(isPinVisit({ referer: 'https://t.me/channel', userAgent: 'Mozilla/5.0' })).toBe(false);
  });
});

describe('StorefrontService.publicProduct — pins already published', () => {
  function build(store: any, language: string | null) {
    const repo = {
      findOne: jest.fn(async () => store),
      query: jest.fn(async (sql: string) => {
        if (/c\.language/.test(sql)) return [{ language }];
        if (/short_code/.test(sql)) return [{ url: 'https://s.click.aliexpress.com/e/_x', code: 'abc123' }];
        return [];
      }),
    } as any;
    const links = { shortUrl: (c: string) => `https://nexlify.win-solutions.co.il/r/${c}` } as any;
    const svc = new StorefrontService(repo, {} as any, links);
    (svc as any).postProducts = jest.fn(async () => [{ id: 'p:1', title: 'Watch case', price: 6.46, currency: 'USD' }]);
    return svc;
  }
  const store = (link_in_posts: boolean) => ({ slug: 'hidden-premium-brands', enabled: true, link_in_posts, user_id: 'u1' });

  it('sends an English campaign\'s pin on to the product, through the tracked link', async () => {
    const res = await build(store(true), 'en').publicProduct('hidden-premium-brands', 'p:1');
    expect(res.pin_redirect).toBe('https://nexlify.win-solutions.co.il/r/abc123?s=pin');
  });

  it('sends every pin on when the owner switched the link off', async () => {
    const res = await build(store(false), 'he').publicProduct('hidden-premium-brands', 'p:1');
    expect(res.pin_redirect).toBeDefined();
  });

  it('keeps a Hebrew pin on the store while the switch is on', async () => {
    const res = await build(store(true), 'he').publicProduct('hidden-premium-brands', 'p:1');
    expect(res.pin_redirect).toBeUndefined();
    expect(res.buy_url).toBe('https://nexlify.win-solutions.co.il/r/abc123');
  });
});
