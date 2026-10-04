import { searchBotToken, searchWebhookSecret, searchWebhookUrl } from './search-bot';

describe('search bot settings', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('is off without a token', () => {
    delete process.env.SEARCH_BOT_TOKEN;
    expect(searchBotToken()).toBeNull();
    process.env.SEARCH_BOT_TOKEN = '  123:abc ';
    expect(searchBotToken()).toBe('123:abc');
  });

  it('derives a stable secret in Telegram\'s allowed alphabet, distinct from the owner bot\'s', () => {
    process.env.JWT_SECRET = 'j';
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const a = searchWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(searchWebhookSecret()).toBe(a);
    process.env.TELEGRAM_WEBHOOK_SECRET = 'other';
    expect(searchWebhookSecret()).not.toBe(a);
  });

  it('has no webhook URL without a public backend', () => {
    process.env.BACKEND_URL = 'http://localhost:3001';
    expect(searchWebhookUrl()).toBeNull();
    process.env.BACKEND_URL = 'https://api.example.com/';
    expect(searchWebhookUrl()).toBe('https://api.example.com/telegram/search-webhook');
  });
});
