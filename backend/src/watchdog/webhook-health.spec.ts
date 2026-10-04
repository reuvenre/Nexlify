import { SEARCH_BOT_UPDATES, hostOf, webhookVerdict } from './webhook-health';

const OURS = 'https://nexus-backend.onrender.com/telegram/webhook';
const NOW = Date.UTC(2026, 9, 4, 16);

describe('webhookVerdict', () => {
  it('is quiet when the webhook is ours and healthy', () => {
    expect(webhookVerdict({ url: OURS, pending_update_count: 0, allowed_updates: ['message', 'callback_query'] }, OURS, NOW)).toBeNull();
    expect(webhookVerdict(null, OURS, NOW)).toBeNull();
  });

  it('reports an unset webhook', () => {
    expect(webhookVerdict({ url: '' }, OURS, NOW)?.kind).toBe('unset');
  });

  it('reports a foreign webhook by host only, with an owner action', () => {
    const v = webhookVerdict({ url: 'https://hook.eu1.make.com/secretpath123' }, OURS, NOW)!;
    expect(v.kind).toBe('foreign');
    expect(v.detail).toContain('hook.eu1.make.com');
    expect(v.detail).not.toContain('secretpath123');
    expect(v.action).toBeDefined();
  });

  it('reports a recent delivery error, and ignores an old one', () => {
    const recent = { url: OURS, last_error_date: (NOW - 10 * 60_000) / 1000, last_error_message: 'Wrong response from the webhook: 502 Bad Gateway' };
    expect(webhookVerdict(recent, OURS, NOW)?.kind).toBe('failing');
    const old = { ...recent, last_error_date: (NOW - 5 * 3600_000) / 1000 };
    expect(webhookVerdict(old, OURS, NOW)).toBeNull();
  });

  it('reports a delivery backlog and missing update types', () => {
    expect(webhookVerdict({ url: OURS, pending_update_count: 40 }, OURS, NOW)?.kind).toBe('backlog');
    expect(webhookVerdict({ url: OURS, allowed_updates: ['message'] }, OURS, NOW)?.kind).toBe('updates');
  });

  it('holds the search bot only to what it receives — messages, no button taps (#100)', () => {
    expect(webhookVerdict({ url: OURS, allowed_updates: ['message'] }, OURS, NOW, SEARCH_BOT_UPDATES)).toBeNull();
    expect(webhookVerdict({ url: OURS, allowed_updates: ['callback_query'] }, OURS, NOW, SEARCH_BOT_UPDATES)?.kind).toBe('updates');
  });
});

describe('hostOf', () => {
  it('never returns the path', () => {
    expect(hostOf('https://a.b.com/x/y?z=1')).toBe('a.b.com');
    expect(hostOf('nonsense')).toBe('(כתובת לא תקינה)');
  });
});
