import { linkVerdict } from './link-health';

describe('linkVerdict', () => {
  const url = 'https://nexlify.win-solutions.co.il/r/abc123';
  const fe = 'https://nexlify.win-solutions.co.il';

  it('is healthy on a redirect to the product', () => {
    expect(linkVerdict({ status: 302, location: 'https://s.click.aliexpress.com/e/_x' }, url, fe)).toBeNull();
    expect(linkVerdict({ status: 307, location: 'https://flylink.co.il/p/1' }, url, fe)).toBeNull();
  });

  it('names a paused Vercel project, with the owner action', () => {
    const v = linkVerdict({ status: 402, body: '<p>This deployment is temporarily paused</p>' }, url, fe)!;
    expect(v.kind).toBe('paused');
    expect(v.action).toContain('Resume');
    expect(linkVerdict({ status: 200, body: 'DEPLOYMENT_PAUSED' }, url, fe)!.kind).toBe('paused');
  });

  it('reports a site that does not answer', () => {
    expect(linkVerdict({ status: 0, error: 'ETIMEDOUT' }, url, fe)!.kind).toBe('down');
    expect(linkVerdict({ status: 503 }, url, fe)!.kind).toBe('down');
  });

  it('reports a link that lands on the home page instead of the product', () => {
    expect(linkVerdict({ status: 302, location: `${fe}/` }, url, fe)!.kind).toBe('not_redirecting');
    expect(linkVerdict({ status: 302, location: '/' }, url, fe)!.kind).toBe('not_redirecting');
    expect(linkVerdict({ status: 404, body: 'Link not found' }, url, fe)!.kind).toBe('not_redirecting');
    expect(linkVerdict({ status: 200, body: '<html>' }, url, fe)!.kind).toBe('not_redirecting');
  });
});
