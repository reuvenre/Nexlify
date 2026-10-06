import { ManagerAgentService, isAuthError } from './manager-agent.service';
import { proposalKey, StoredProposal } from './manager-proposal';

const CAMPAIGN_ID = '11111111-2222-3333-4444-555555555555';

function build(campaignOver: Record<string, any> = {}) {
  const campaign = {
    id: CAMPAIGN_ID, user_id: 'u1', name: 'Pinterest', status: 'active', posts_per_run: 3,
    seasonal_keywords: false, learn_from_orders: false, keywords: ['lamp', 'rug'], retired_keywords: [],
    ...campaignOver,
  };
  const store = new Map<string, any>();
  const memory: any = {
    load: jest.fn(async (k: string) => store.get(k) ?? null),
    save: jest.fn(async (k: string, v: any) => { store.set(k, v); }),
  };
  const queries: Array<[string, any[]]> = [];
  const campaigns: any = {
    findOne: jest.fn(async ({ where }: any) => (where.id === campaign.id && where.user_id === campaign.user_id ? campaign : null)),
    query: jest.fn(async (sql: string, params: any[]) => { queries.push([sql, params]); return []; }),
  };
  const svc = new ManagerAgentService(campaigns, {} as any, memory);
  const propose = (over: Partial<StoredProposal> = {}) => {
    const p: StoredProposal = {
      id: 'p1', userId: 'u1', createdAt: Date.now(), campaignId: CAMPAIGN_ID, campaignName: 'Pinterest',
      kind: 'posts_per_run', value: 4, current: 3, reason: '3.4 קליקים לפוסט', ...over,
    };
    store.set(proposalKey(p.id), p);
    return p;
  };
  return { svc, store, queries, propose, campaign };
}

describe('ManagerAgentService.approve', () => {
  it('applies the change, logs an undoable action, and refuses a second tap', async () => {
    const { svc, queries, propose } = build();
    propose();
    const first = await svc.approve('u1', 'p1');
    expect(first.ok).toBe(true);
    expect(queries[0][0]).toContain('UPDATE campaigns SET posts_per_run');
    expect(queries[0][1]).toEqual([4, CAMPAIGN_ID, 'u1']);
    expect(queries[1][0]).toContain('INSERT INTO manager_actions');
    expect(queries[1][1].slice(1, 6)).toEqual(['posts_per_run', CAMPAIGN_ID, 'Pinterest', '3', '4']);

    const second = await svc.approve('u1', 'p1');
    expect(second).toEqual({ ok: false, message: 'ההצעה כבר בוצעה' });
    expect(queries).toHaveLength(2);
  });

  it('re-validates against the live campaign and does nothing when it moved on', async () => {
    const { svc, queries, propose } = build({ posts_per_run: 4 });
    propose();
    const res = await svc.approve('u1', 'p1');
    expect(res.ok).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('never applies another user\'s proposal', async () => {
    const { svc, queries, propose } = build();
    propose({ userId: 'someone-else' });
    expect((await svc.approve('u1', 'p1')).ok).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('moves a removed keyword to the retired list and logs the keyword change', async () => {
    const { svc, queries, propose } = build();
    propose({ kind: 'remove_keyword', value: 'rug', current: 2 });
    expect((await svc.approve('u1', 'p1')).ok).toBe(true);
    expect(queries[0][1]).toEqual([['lamp'], ['rug'], CAMPAIGN_ID, 'u1']);
    expect(queries[1][1][1]).toBe('keywords');
  });

  it('a rejected proposal cannot be approved afterwards', async () => {
    const { svc, queries, propose } = build();
    propose();
    await svc.reject('u1', 'p1');
    expect((await svc.approve('u1', 'p1')).ok).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('ManagerAgentService.ask — a refused Anthropic key', () => {
  const answer = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'תשובה' }], usage: { input_tokens: 1, output_tokens: 1 } };
  const authError = Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 });

  function build(fallback: any) {
    const own = { apiKey: 'user-key', messages: { create: jest.fn(async () => { throw authError; }) } };
    const agentClient: any = {
      for: jest.fn(async () => ({ client: own, model: 'm' })),
      fallback: jest.fn(() => fallback),
      record: jest.fn(),
    };
    const svc = new ManagerAgentService({} as any, agentClient, {} as any);
    return { svc, own };
  }

  it('retries once with the platform key and answers', async () => {
    const platform = { apiKey: 'platform-key', messages: { create: jest.fn(async () => answer) } };
    const { svc } = build(platform);
    const res = await svc.ask('u1', 'כמה קליקים?');
    expect(res.text).toBe('תשובה');
    expect(platform.messages.create).toHaveBeenCalledTimes(1);
  });

  it('surfaces the auth error when there is no other key to try', async () => {
    const { svc } = build(null);
    await expect(svc.ask('u1', 'כמה קליקים?')).rejects.toMatchObject({ status: 401 });
    expect(isAuthError(authError)).toBe(true);
    expect(isAuthError(new Error('timeout'))).toBe(false);
  });
});

describe('ManagerAgentService.weeklyReview — the manager, unasked', () => {
  it('asks the fixed weekly question in a conversation of its own', async () => {
    const create = jest.fn(async (_req: any) => ({
      stop_reason: 'end_turn', content: [{ type: 'text', text: 'השבוע: אין מה לשנות.' }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const agentClient: any = { for: jest.fn(async () => ({ client: { apiKey: 'k', messages: { create } }, model: 'm' })), fallback: () => null, record: jest.fn() };
    const svc = new ManagerAgentService({} as any, agentClient, {} as any);

    const res = await svc.weeklyReview('u1');
    expect(res.text).toBe('השבוע: אין מה לשנות.');
    const sent = create.mock.calls[0][0].messages;
    expect(sent).toHaveLength(1); // no history from the owner's own questions
    expect(sent[0].content).toContain('סקירה שבועית יזומה');
    expect(sent[0].content).toContain('english_search');

    // The owner's next question does not carry the review as its context.
    await svc.ask('u1', 'כמה קליקים?', 'chat-1');
    expect(create.mock.calls[1][0].messages).toHaveLength(1);
  });
});
