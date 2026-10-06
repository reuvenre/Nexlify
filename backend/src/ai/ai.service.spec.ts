import { AiService } from './ai.service';

// Minimal creds with both a chosen (gemini) and a secondary (anthropic) key.
const creds: any = {
  ai_provider: 'gemini',
  gemini_api_key: 'g-key',
  anthropic_api_key: 'a-key',
  user_id: 'u1',
};

function makeService(): AiService {
  const usage: any = { record: jest.fn() };
  return new AiService(usage);
}

describe('AiService provider failover', () => {
  it('resolveProvider prefers the chosen keyed provider', () => {
    const svc = makeService();
    expect(svc.resolveProvider(creds)).toBe('gemini');
    expect(svc.resolveProvider({ ai_provider: 'gemini', anthropic_api_key: 'a' } as any)).toBe('anthropic');
    expect(svc.resolveProvider(null)).toBeNull();
  });

  it('fails over to the secondary provider when the chosen one throws', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockRejectedValue(new Error('gemini 429'));
    jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue({ text: 'שלום עולם', provider: 'anthropic', tokens: 10, promptTokens: 5, outputTokens: 5 });
    const res = await svc.generate(creds, { system: 's', prompt: 'p' });
    expect(res?.provider).toBe('anthropic');
    expect(res?.text).toBe('שלום עולם');
  });

  it('fails over when the chosen provider returns EMPTY text', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockResolvedValue({ text: '   ', provider: 'gemini', tokens: 0 });
    jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue({ text: 'copy', provider: 'anthropic', tokens: 8, promptTokens: 4, outputTokens: 4 });
    const res = await svc.generate(creds, { system: 's', prompt: 'p' });
    expect(res?.provider).toBe('anthropic');
  });

  it('returns null only when ALL keyed providers fail', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockRejectedValue(new Error('down'));
    jest.spyOn(svc as any, 'callAnthropic').mockRejectedValue(new Error('down'));
    expect(await svc.generate(creds, { system: 's', prompt: 'p' })).toBeNull();
  });
});

describe('AiService truncation failover (issue #62)', () => {
  const truncated = { text: 'half a pin', provider: 'gemini', tokens: 9, promptTokens: 3, outputTokens: 6, truncated: true };
  const full = { text: 'a whole finished pin', provider: 'anthropic', tokens: 12, promptTokens: 5, outputTokens: 7 };

  it('a truncated draft fails over to the next keyed provider when opted in', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockResolvedValue(truncated);
    jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue(full);
    const res = await svc.generate(creds, { system: 's', prompt: 'p', truncationFailover: true });
    expect(res?.provider).toBe('anthropic');
    expect(res?.truncated).toBeFalsy();
  });

  it('without the opt-in a truncated draft is returned as-is — judge calls hit their tiny cap by design', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockResolvedValue(truncated);
    const anthropic = jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue(full);
    const res = await svc.generate(creds, { system: 's', prompt: 'p' });
    expect(res?.provider).toBe('gemini');
    expect(res?.truncated).toBe(true);
    expect(anthropic).not.toHaveBeenCalled();
  });

  it('when EVERY provider truncates, the first truncated draft comes back still flagged', async () => {
    // The caller's own truncation handling (budget doubling) must get something to act on.
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockResolvedValue(truncated);
    jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue({ ...full, truncated: true });
    const res = await svc.generate(creds, { system: 's', prompt: 'p', truncationFailover: true });
    // The LAST provider's truncated result is returned directly (no failover left);
    // significant: it is non-null and still carries the truncated flag.
    expect(res?.truncated).toBe(true);
    expect(res?.text?.length).toBeGreaterThan(0);
  });

  it('a truncated draft that failed over is still metered — its tokens were consumed', async () => {
    const usage: any = { record: jest.fn() };
    const svc = new AiService(usage);
    jest.spyOn(svc as any, 'callGemini').mockResolvedValue(truncated);
    jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue(full);
    await svc.generate(creds, { system: 's', prompt: 'p', truncationFailover: true });
    expect(usage.record).toHaveBeenCalledWith('u1', 'gemini', 3, 6, 9);
    expect(usage.record).toHaveBeenCalledWith('u1', 'anthropic', 5, 7, 12);
  });
});

describe('AiService says why a provider produced nothing', () => {
  it('collects one line per failed provider', async () => {
    const svc = makeService();
    jest.spyOn(svc as any, 'callGemini').mockRejectedValue(
      Object.assign(new Error('400'), { response: { status: 400, data: { error: { message: 'API key not valid. Please pass a valid API key.' } } } }),
    );
    jest.spyOn(svc as any, 'callAnthropic').mockResolvedValue({ text: '', provider: 'anthropic', tokens: 3, stopReason: 'refusal' });
    const failures: string[] = [];
    expect(await svc.generate(creds, { system: 's', prompt: 'p', failures })).toBeNull();
    expect(failures).toEqual(['gemini: המפתח נדחה', 'anthropic: המודל סירב לכתוב על המוצר']);
  });
});

describe('AiService: a refused account Anthropic key retries on the platform key', () => {
  const axios = require('axios');
  const anthropicOnly: any = { ai_provider: 'anthropic', anthropic_api_key: 'account-key', user_id: 'u1' };
  const ok = { data: { content: [{ type: 'text', text: 'קופי' }], usage: { input_tokens: 5, output_tokens: 3 }, stop_reason: 'end_turn' } };
  const refused = Object.assign(new Error('401'), { response: { status: 401, data: { error: { message: 'invalid x-api-key' } } } });
  let post: jest.SpyInstance;
  const env = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { post = jest.spyOn(axios, 'post'); });
  afterEach(() => { post.mockRestore(); process.env.ANTHROPIC_API_KEY = env; });

  it('uses the platform key once the account key is refused', async () => {
    process.env.ANTHROPIC_API_KEY = 'platform-key';
    post.mockRejectedValueOnce(refused).mockResolvedValueOnce(ok);
    const res = await makeService().generate(anthropicOnly, { system: 's', prompt: 'p' });
    expect(res?.text).toBe('קופי');
    expect(post.mock.calls.map((c) => c[2].headers['x-api-key'])).toEqual(['account-key', 'platform-key']);
  });

  it('does not retry the same key, and names the refusal', async () => {
    process.env.ANTHROPIC_API_KEY = 'account-key';
    post.mockRejectedValue(refused);
    const failures: string[] = [];
    expect(await makeService().generate(anthropicOnly, { system: 's', prompt: 'p', failures })).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(failures).toEqual(['anthropic: המפתח נדחה']);
  });

  it('does not spend the platform key on an empty credit balance', async () => {
    process.env.ANTHROPIC_API_KEY = 'platform-key';
    post.mockRejectedValue(Object.assign(new Error('400'), {
      response: { status: 400, data: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } },
    }));
    const failures: string[] = [];
    await makeService().generate(anthropicOnly, { system: 's', prompt: 'p', failures });
    expect(post).toHaveBeenCalledTimes(1);
    expect(failures).toEqual(['anthropic: נגמר הקרדיט בחשבון']);
  });
});
