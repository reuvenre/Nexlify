import { ManagerAgentService } from './manager-agent.service';
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
