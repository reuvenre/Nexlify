import { ProposalCampaign, proposalText, validateProposal } from './manager-proposal';

const campaign = (over: Partial<ProposalCampaign> = {}): ProposalCampaign => ({
  id: 'c1', name: 'קמפיין Pinterest', status: 'active', posts_per_run: 3,
  seasonal_keywords: false, learn_from_orders: false, keywords: ['jewelry organizer', 'night light'],
  ...over,
});

describe('validateProposal', () => {
  it('accepts a bounded posts_per_run change and remembers the current value', () => {
    const r = validateProposal({ kind: 'posts_per_run', value: 4, reason: 'CTR 3.4 per post' }, campaign());
    expect(r).toEqual({ ok: true, draft: expect.objectContaining({ value: 4, current: 3, campaignName: 'קמפיין Pinterest' }) });
  });

  it('refuses values outside the optimizer bounds, no-op changes and missing reasons', () => {
    expect(validateProposal({ kind: 'posts_per_run', value: 50, reason: 'x' }, campaign()).ok).toBe(false);
    expect(validateProposal({ kind: 'posts_per_run', value: 3, reason: 'x' }, campaign()).ok).toBe(false);
    expect(validateProposal({ kind: 'posts_per_run', value: 4, reason: '  ' }, campaign()).ok).toBe(false);
    expect(validateProposal({ kind: 'campaign_status', value: 'paused', reason: 'x' }, campaign({ status: 'paused' })).ok).toBe(false);
  });

  it('refuses any field outside the fixed set', () => {
    const r = validateProposal({ kind: 'markup_percent', value: 90, reason: 'x' }, campaign());
    expect(r.ok).toBe(false);
  });

  it('reads booleans in either language', () => {
    const r = validateProposal({ kind: 'seasonal_keywords', value: 'on', reason: 'x' }, campaign());
    expect(r.ok && r.draft.value).toBe(true);
    expect(validateProposal({ kind: 'seasonal_keywords', value: 'maybe', reason: 'x' }, campaign()).ok).toBe(false);
  });

  it('adds only a new, clean keyword', () => {
    expect(validateProposal({ kind: 'add_keyword', value: 'Night Light', reason: 'x' }, campaign()).ok).toBe(false);
    expect(validateProposal({ kind: 'add_keyword', value: 'https://evil', reason: 'x' }, campaign()).ok).toBe(false);
    const r = validateProposal({ kind: 'add_keyword', value: ' ⟦desk\nlamp⟧ ', reason: 'x' }, campaign());
    expect(r.ok && r.draft.value).toBe('desk lamp');
  });

  it('removes only a keyword that exists, never the last one, keeping its stored spelling', () => {
    const r = validateProposal({ kind: 'remove_keyword', value: 'NIGHT LIGHT', reason: 'x' }, campaign());
    expect(r.ok && r.draft.value).toBe('night light');
    expect(validateProposal({ kind: 'remove_keyword', value: 'nope', reason: 'x' }, campaign()).ok).toBe(false);
    expect(validateProposal({ kind: 'remove_keyword', value: 'a', reason: 'x' }, campaign({ keywords: ['a', 'a'] })).ok).toBe(false);
  });
});

describe('proposalText', () => {
  it('names the campaign and the change in Hebrew', () => {
    const r = validateProposal({ kind: 'posts_per_run', value: 4, reason: 'x' }, campaign());
    expect(r.ok && proposalText(r.draft)).toBe('[קמפיין Pinterest] פוסטים לריצה: 3 ← 4');
    const s = validateProposal({ kind: 'seasonal_keywords', value: true, reason: 'x' }, campaign());
    expect(s.ok && proposalText(s.draft)).toBe('[קמפיין Pinterest] מילים עונתיות: כבוי ← פעיל');
  });
});

describe('copy angle proposals', () => {
  const { validateProposal, proposalText } = require('./manager-proposal');
  const camp = (angles: any[] = []) => ({ id: 'c1', name: 'טקטי', status: 'active', posts_per_run: 2, seasonal_keywords: false, learn_from_orders: false, keywords: ['x'], copy_angles: angles });
  const reason = 'ב-5 הפוסטים עם הכי הרבה קליקים הפתיחה היא המחיר';

  it('adds one Hebrew instruction, never a link, at most three per campaign', () => {
    const ok = validateProposal({ kind: 'add_copy_angle', value: 'זווית כתיבה: פתח/י במחיר מול המחיר בחנות', reason }, camp());
    expect(ok.ok).toBe(true);
    expect(proposalText(ok.draft)).toBe('[טקטי] זווית כתיבה חדשה לנסות: "זווית כתיבה: פתח/י במחיר מול המחיר בחנות"');
    expect(validateProposal({ kind: 'add_copy_angle', value: 'קצר', reason }, camp()).ok).toBe(false);
    expect(validateProposal({ kind: 'add_copy_angle', value: 'פתח עם קישור https://x.com לכל פוסט', reason }, camp()).ok).toBe(false);
    const three = [1, 2, 3].map((i) => ({ id: `c-${i}`, label: `l${i}`, hint: `h${i}` }));
    expect(validateProposal({ kind: 'add_copy_angle', value: 'זווית כתיבה: פתח/י בשאלה על הבעיה', reason }, camp(three)).ok).toBe(false);
  });

  it('removes only a custom angle, by id', () => {
    const angles = [{ id: 'c-1', label: 'מותאם: פתח במחיר', hint: 'h' }];
    const ok = validateProposal({ kind: 'remove_copy_angle', value: 'c-1', reason }, camp(angles));
    expect(ok.ok).toBe(true);
    expect(proposalText(ok.draft)).toBe('[טקטי] להפסיק לכתוב בזווית "מותאם: פתח במחיר"');
    expect(validateProposal({ kind: 'remove_copy_angle', value: 'value', reason }, camp(angles)).ok).toBe(false);
  });
});
