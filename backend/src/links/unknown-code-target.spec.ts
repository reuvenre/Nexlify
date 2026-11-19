import { unknownCodeTarget } from './links.controller';

describe('unknownCodeTarget', () => {
  it('prefers the configured fallback page', () => {
    expect(unknownCodeTarget({ SHORT_LINK_FALLBACK_URL: 'https://t.me/mychannel', FRONTEND_URL: 'https://site.co.il' } as any))
      .toBe('https://t.me/mychannel');
  });
  it('falls back to the site home page, first of several domains', () => {
    expect(unknownCodeTarget({ FRONTEND_URL: 'https://site.co.il/,https://x.vercel.app' } as any)).toBe('https://site.co.il/');
  });
  it('never returns a relative or empty target', () => {
    expect(unknownCodeTarget({ SHORT_LINK_FALLBACK_URL: 'javascript:alert(1)' } as any)).toBe('https://www.aliexpress.com/');
  });
});
