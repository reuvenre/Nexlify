import { ManagerAgentService } from './manager-agent.service';
import {
  ProposalCampaign, StoredProposal, bundleKey, parseKeywordList, proposalKey, proposalText, validateProposal,
} from './manager-proposal';
import { actionLabel, undoPlan } from '../optimizer/action-undo';

/**
 * The owner asked to change a campaign's keywords and its group's focus "in one go". Two new
 * proposal kinds carry that (set_keywords: the whole rotation; set_group_focus: the target
 * group's core focus), and "אשר הכל" approves every proposal of one answer with a single tap.
 */

const CID = '11111111-2222-3333-4444-555555555555';
const TACTICAL_GROUP = { channelId: '-100777', name: 'טקטי בקליק', focus: null as string | null };
const campaign = (over: Partial<ProposalCampaign> = {}): ProposalCampaign => ({
  id: CID, name: 'טקטי - אלי', status: 'active', posts_per_run: 1, seasonal_keywords: false,
  learn_from_orders: false, keywords: ['טקטי', 'השרדות', 'ציוד צבאי'], groups: [TACTICAL_GROUP], ...over,
});
const NEW_KEYWORDS = ['נרתיק לאקדח', 'אפוד טקטי', 'מסילת פיקטיני', 'פנס נשק'];
const FOCUS = 'ציוד טקטי ואיירסופט: נרתיקים, אפודים, מסילות פיקטיני, פנסי נשק';

describe('set_keywords', () => {
  it('reads a list sent as an array or as one comma/line separated string', () => {
    expect(parseKeywordList(['a b', ' a b ', 'cd'])).toEqual(['a b', 'cd']);
    expect(parseKeywordList('נרתיק לאקדח, אפוד טקטי\nפנס נשק;  ')).toEqual(['נרתיק לאקדח', 'אפוד טקטי', 'פנס נשק']);
  });

  it('replaces the whole rotation in one proposal and says what goes and what comes', () => {
    const v = validateProposal({ kind: 'set_keywords', value: NEW_KEYWORDS, reason: 'בקשת הבעלים' }, campaign());
    if ('error' in v) throw new Error(v.error);
    expect(v.draft.value).toEqual(NEW_KEYWORDS);
    expect(v.draft.current).toEqual(['טקטי', 'השרדות', 'ציוד צבאי']);
    const text = proposalText(v.draft);
    expect(text).toContain('(3 ← 4)');
    expect(text).toContain('יוצאות: טקטי, השרדות, ציוד צבאי');
    expect(text).toContain('נכנסות: נרתיק לאקדח');
  });

  it('refuses an empty list, a link, too many words, or no change', () => {
    const ask = (value: unknown, c = campaign()) => validateProposal({ kind: 'set_keywords', value, reason: 'x' }, c);
    expect(ask([]).ok).toBe(false);
    expect(ask(['https://x.com']).ok).toBe(false);
    expect(ask(Array.from({ length: 31 }, (_v, i) => `kw ${i}`)).ok).toBe(false);
    expect(ask(['טקטי', 'השרדות', 'ציוד צבאי']).ok).toBe(false);
  });
});

describe('set_group_focus', () => {
  it('sets the focus of the campaign\'s target group and remembers the old one', () => {
    const v = validateProposal({ kind: 'set_group_focus', value: FOCUS, reason: 'בקשת הבעלים' },
      campaign({ groups: [{ ...TACTICAL_GROUP, focus: 'ציוד טקטי' }] }));
    if ('error' in v) throw new Error(v.error);
    expect(v.draft.value).toBe(FOCUS);
    expect(JSON.parse(String(v.draft.current))).toEqual([{ ...TACTICAL_GROUP, focus: 'ציוד טקטי' }]);
    expect(proposalText(v.draft)).toBe(`[טקטי - אלי] מיקוד ליבה לקבוצה טקטי בקליק: "${FOCUS}"\n(במקום: "ציוד טקטי")`);
  });

  it('refuses a campaign with no saved group, a too-short focus, a link, or no change', () => {
    const ask = (value: unknown, c = campaign()) => validateProposal({ kind: 'set_group_focus', value, reason: 'x' }, c);
    expect(ask(FOCUS, campaign({ groups: [] })).ok).toBe(false);
    // Never onto a sister group: a campaign feeding two groups cannot carry one group's focus.
    const two = ask(FOCUS, campaign({ groups: [TACTICAL_GROUP, { channelId: '-100888', name: 'מאמא', focus: null }] }));
    expect(two.ok).toBe(false);
    expect('error' in two && two.error).toContain('מאמא');
    expect(ask('טקטי').ok).toBe(false);
    expect(ask('ציוד טקטי מכאן https://evil.example').ok).toBe(false);
    expect(ask(FOCUS, campaign({ groups: [{ ...TACTICAL_GROUP, focus: FOCUS }] })).ok).toBe(false);
  });
});

describe('undoing a focus change', () => {
  const row = {
    id: 'a1', kind: 'group_focus', target_id: CID, target_label: 'טקטי בקליק',
    before: JSON.stringify([{ channelId: '-100777', name: 'טקטי בקליק', focus: null }]),
    after: JSON.stringify({ focus: FOCUS }), reason: 'x', until_at: null, undone_at: null,
  };

  it('puts back each group\'s previous focus, none included', () => {
    expect(undoPlan(row)).toEqual({ kind: 'group_focus', groups: [{ channelId: '-100777', focus: null }] });
    expect(actionLabel(row)).toBe(`[טקטי בקליק] קבעתי מיקוד ליבה: "${FOCUS}"`);
    expect(undoPlan({ ...row, undone_at: new Date() })).toBeNull();
  });
});

describe('ManagerAgentService — approving keywords and focus together', () => {
  function build() {
    const live: any = {
      id: CID, user_id: 'u1', name: 'טקטי - אלי', status: 'active', posts_per_run: 1,
      seasonal_keywords: false, learn_from_orders: false, keywords: ['טקטי', 'השרדות', 'ציוד צבאי'],
      retired_keywords: ['ישן'], target_channels: JSON.stringify(['-100777']),
    };
    const store = new Map<string, any>();
    const memory: any = {
      load: async (k: string) => store.get(k) ?? null,
      save: async (k: string, v: any) => { store.set(k, v); },
    };
    const writes: Array<[string, any[]]> = [];
    const campaigns: any = {
      findOne: async ({ where }: any) => (where.id === CID && where.user_id === 'u1' ? live : null),
      query: async (sql: string, params: any[]) => {
        if (sql.includes('SELECT channel_id, name, core_focus')) {
          return [{ channel_id: '-100777', name: 'טקטי בקליק', core_focus: null }];
        }
        writes.push([sql, params]);
        return [];
      },
    };
    const svc = new ManagerAgentService(campaigns, {} as any, memory);
    const put = (p: Partial<StoredProposal>) => {
      const full = { userId: 'u1', createdAt: Date.now(), campaignId: CID, campaignName: live.name, reason: 'בקשת הבעלים', ...p } as StoredProposal;
      store.set(proposalKey(full.id), full);
    };
    put({ id: 'k', kind: 'set_keywords', value: NEW_KEYWORDS, current: live.keywords });
    put({ id: 'f', kind: 'set_group_focus', value: FOCUS, current: JSON.stringify([TACTICAL_GROUP]) });
    store.set(bundleKey('b1'), { userId: 'u1', ids: ['k', 'f'] });
    return { svc, writes, store };
  }

  it('one tap applies both, retires the words that left, and logs two undoable actions', async () => {
    const { svc, writes } = build();
    const res = await svc.approveAll('u1', 'b1');
    expect(res.ok).toBe(true);
    expect(res.message).toContain('להחליף את מילות המפתח');
    expect(res.message).toContain('מיקוד ליבה לקבוצה טקטי בקליק');
    expect(res.message.match(/אפשר לבטל/g)).toHaveLength(1);

    const [kwSql, kwParams] = writes[0];
    expect(kwSql).toContain('UPDATE campaigns SET keywords');
    expect(kwParams.slice(0, 2)).toEqual([NEW_KEYWORDS, ['ישן', 'טקטי', 'השרדות', 'ציוד צבאי']]);
    expect(writes[1][1][1]).toBe('keywords');

    const [focusSql, focusParams] = writes[2];
    expect(focusSql).toContain('UPDATE channels SET core_focus');
    expect(focusParams).toEqual([FOCUS, 'u1', ['-100777']]);
    expect(writes[3][1].slice(1, 4)).toEqual(['group_focus', CID, 'טקטי בקליק']);
  });

  it('a second tap does nothing, and another user\'s bundle is refused', async () => {
    const { svc, writes } = build();
    await svc.approveAll('u1', 'b1');
    const n = writes.length;
    const again = await svc.approveAll('u1', 'b1');
    expect(again.ok).toBe(false);
    expect(writes).toHaveLength(n);
    expect((await svc.approveAll('u2', 'b1')).ok).toBe(false);
  });

  it('reject-all closes both, so neither can be approved after', async () => {
    const { svc, writes } = build();
    await svc.rejectAll('u1', 'b1');
    expect((await svc.approve('u1', 'k')).ok).toBe(false);
    expect((await svc.approve('u1', 'f')).ok).toBe(false);
    expect(writes).toHaveLength(0);
  });
});
