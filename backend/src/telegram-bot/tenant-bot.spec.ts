import {
  linkDeepLink, looksLikeBotToken, newLinkCode, parseLinkStart, tenantWebhookPath, tenantWebhookSecret, tenantWebhookUrl,
} from './tenant-bot';
import { ShopperLimiter } from './shopper';

describe('an account\'s own bot', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('each account has its own webhook path and its own secret', () => {
    process.env.JWT_SECRET = 'jwt';
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(tenantWebhookPath(a)).toBe(`/telegram/tenant/${a}`);
    expect(tenantWebhookSecret(a)).not.toBe(tenantWebhookSecret(b));
    expect(tenantWebhookSecret(a)).toMatch(/^[a-f0-9]{48}$/);
    // Stable across restarts: Telegram keeps echoing the secret it was given.
    expect(tenantWebhookSecret(a)).toBe(tenantWebhookSecret(a));
  });

  it('needs a public backend for the webhook', () => {
    process.env.BACKEND_URL = 'http://localhost:3001';
    expect(tenantWebhookUrl('u1')).toBeNull();
    process.env.BACKEND_URL = 'https://api.example.com/';
    expect(tenantWebhookUrl('u1')).toBe('https://api.example.com/telegram/tenant/u1');
  });

  it('checks the shape of a BotFather token before calling Telegram', () => {
    expect(looksLikeBotToken('8123456789:AAH1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v')).toBe(true);
    expect(looksLikeBotToken(' 8123456789:AAH1bC2dE3fG4hI5jK6lM7nO8pQ9rS0tU1v ')).toBe(true);
    expect(looksLikeBotToken('https://t.me/mybot')).toBe(false);
    expect(looksLikeBotToken('8123456789')).toBe(false);
    expect(looksLikeBotToken('')).toBe(false);
  });

  it('links the owner chat with a one-time code from the deep link', () => {
    const code = newLinkCode();
    expect(code).toMatch(/^[a-f0-9]{12}$/);
    expect(newLinkCode()).not.toBe(code);
    expect(linkDeepLink('my_deals_bot', code)).toBe(`https://t.me/my_deals_bot?start=link_${code}`);
    expect(parseLinkStart(`/start link_${code}`)).toBe(code);
    expect(parseLinkStart(`/start@my_deals_bot link_${code.toUpperCase()}`)).toBe(code);
    expect(parseLinkStart('/start inv_find')).toBeNull();
    expect(parseLinkStart('link_abc')).toBeNull();
  });
});

describe('ShopperLimiter per account', () => {
  it('one account\'s busy day does not spend another account\'s budget', () => {
    const lim = new ShopperLimiter(100, 60_000, 3, () => 1_700_000_000_000);
    expect(lim.take('r1', 'acct-a')).toBe('ok');
    expect(lim.take('r2', 'acct-a')).toBe('ok');
    expect(lim.take('r3', 'acct-a')).toBe('ok');
    expect(lim.take('r4', 'acct-a')).toBe('daily');
    expect(lim.take('r4', 'acct-b')).toBe('ok');
    expect(lim.take('r4')).toBe('ok'); // the platform's own bots
  });

  it('a reader\'s pace is counted per bot', () => {
    const lim = new ShopperLimiter(1, 60_000, 100, () => 1_700_000_000_000);
    expect(lim.take('r1', 'acct-a')).toBe('ok');
    expect(lim.take('r1', 'acct-a')).toBe('user');
    expect(lim.take('r1', 'acct-b')).toBe('ok');
  });
});
