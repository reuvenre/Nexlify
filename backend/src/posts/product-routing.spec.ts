import { PostsService } from './posts.service';
import { RouteCampaign, campaignByKeyword, campaignForGroup } from './product-routing';

const camp = (over: Partial<RouteCampaign>): RouteCampaign => ({
  id: 'c1', name: 'טקטי', status: 'active', keywords: ['tactical flashlight'], targets: ['-100tac'], ...over,
});

describe('product routing — the decisions', () => {
  it('finds the one campaign holding the keyword, whatever its case and spacing', () => {
    const list = [camp({}), camp({ id: 'c2', name: 'בית', keywords: ['kitchen'], targets: ['-100home'] })];
    expect(campaignByKeyword(list, '  Tactical   Flashlight ')?.id).toBe('c1');
    expect(campaignByKeyword(list, 'garden')).toBeNull();
    expect(campaignByKeyword(list, '')).toBeNull();
  });

  it('accepts a keyword two campaigns share only when they feed the same groups', () => {
    const same = [camp({}), camp({ id: 'c2', status: 'paused' })];
    expect(campaignByKeyword(same, 'tactical flashlight')?.id).toBe('c1');
    const split = [camp({}), camp({ id: 'c2', targets: ['-100other'] })];
    expect(campaignByKeyword(split, 'tactical flashlight')).toBeNull();
  });

  it('takes the active campaign feeding a group over a paused one', () => {
    const list = [camp({ id: 'p', status: 'paused' }), camp({ id: 'a' })];
    expect(campaignForGroup(list, '-100tac')?.id).toBe('a');
    expect(campaignForGroup(list, '-100none')).toBeNull();
  });
});

/** routeProduct on a bare service: only the collaborators it reads are stubbed. */
describe('PostsService.routeProduct', () => {
  const campaigns = [
    { id: 'c1', name: 'טקטי', status: 'active', source: 'aliexpress', keywords: ['tactical flashlight'], target_channels: '["-100tac"]', post_template: 'תבנית טקטית {title}', language: 'he' },
    { id: 'c2', name: 'בית', status: 'active', source: 'aliexpress', keywords: ['kitchen'], target_channels: '["-100home"]', post_template: '', language: 'he' },
    { id: 'f', name: 'פליילינק', status: 'active', source: 'flylink', keywords: ['x'], target_channels: '["-100tac"]' },
  ];
  function build(opts: { posted?: any[]; ai?: string | null; templates?: Record<string, string> } = {}) {
    const svc: any = Object.create(PostsService.prototype);
    svc.credentials = { getRaw: jest.fn(async () => ({ default_body_template_id: 'acct' })) };
    svc.campaignRepo = { find: jest.fn(async () => campaigns) };
    svc.postedRepo = { find: jest.fn(async () => opts.posted || []) };
    svc.channels = {
      activeTelegramGroups: jest.fn(async () => [
        { channel_id: '-100tac', name: 'טקטי בקליק', core_focus: 'ציוד טקטי' },
        { channel_id: '-100home', name: 'בית חכם', core_focus: null },
        { channel_id: '-100free', name: 'קבוצה בלי קמפיין', core_focus: null },
      ]),
      getBodyTemplateId: jest.fn(async (_u: string, ch: string) => (ch === '-100free' ? 'grp' : null)),
    };
    svc.ai = {
      hasAnyKey: () => opts.ai !== undefined,
      generate: jest.fn(async () => (opts.ai === null ? { text: 'not json' } : { text: opts.ai })),
    };
    const t = { acct: 'תבנית החשבון', grp: 'תבנית הקבוצה', ...(opts.templates || {}) } as Record<string, string>;
    svc.templateContent = jest.fn(async (_u: string, id?: string) => (id ? t[id] || '' : ''));
    return svc as PostsService;
  }

  it('routes by the keyword that found the product, with the campaign template', async () => {
    const r = await build().routeProduct('u', { product_id: '1', title: 'LED torch', keyword: 'tactical flashlight' });
    expect(r).toMatchObject({ confident: true, method: 'keyword', channels: ['-100tac'], group_names: ['טקטי בקליק'] });
    expect(r.template).toBe('תבנית טקטית {title}');
    expect(r.template_source).toBe('campaign');
  });

  it('routes by a campaign that already posted it, falling back to the account template', async () => {
    const r = await build({ posted: [{ campaign_id: 'c2' }] }).routeProduct('u', { product_id: '1', title: 'Pan' });
    expect(r).toMatchObject({ confident: true, method: 'history', channels: ['-100home'], template: 'תבנית החשבון', template_source: 'account' });
  });

  it('asks the judge, and takes its campaign', async () => {
    const r = await build({ ai: '{"campaign": 1, "keyword": "pan", "reason": "כלי מטבח"}' }).routeProduct('u', { product_id: '1', title: 'Pan' });
    expect(r).toMatchObject({ confident: true, method: 'ai', campaign: { id: 'c2', name: 'בית' } });
  });

  it('asks the owner when the judge says none fits, listing every group with its campaign', async () => {
    const r = await build({ ai: '{"campaign": -1, "keyword": "toy", "reason": ""}' }).routeProduct('u', { product_id: '1', title: 'Toy' });
    expect(r.confident).toBe(false);
    expect(r.options).toEqual([
      { channel_id: '-100tac', name: 'טקטי בקליק', campaign_name: 'טקטי' },
      { channel_id: '-100home', name: 'בית חכם', campaign_name: 'בית' },
      { channel_id: '-100free', name: 'קבוצה בלי קמפיין', campaign_name: null },
    ]);
  });

  it('asks the owner when the judge answers nonsense or there is no AI key', async () => {
    expect((await build({ ai: null }).routeProduct('u', { product_id: '1', title: 'x' })).confident).toBe(false);
    expect((await build().routeProduct('u', { product_id: '1', title: 'x' })).confident).toBe(false);
  });

  it('for a group the owner chose, uses the template of the campaign feeding it', async () => {
    const r = await build().routeProduct('u', { product_id: '1', channel_id: '-100tac' });
    expect(r).toMatchObject({ confident: true, method: 'chosen', channels: ['-100tac'], template: 'תבנית טקטית {title}' });
  });

  it('for a chosen group no campaign feeds, uses the group template', async () => {
    const r = await build().routeProduct('u', { product_id: '1', channel_id: '-100free' });
    expect(r).toMatchObject({ method: 'group', template: 'תבנית הקבוצה', template_source: 'group', campaign: null });
  });
});
