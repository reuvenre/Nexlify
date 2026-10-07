import { OrchestratorAgent } from './orchestrator.agent';
import { PublishedProducts } from '../posts/product-similarity';

/**
 * The gap this closes: a campaign with `use_agents` on routes through the orchestrator, and
 * the orchestrator handed `campaign.keywords` straight to the ProductAgent. So the 🗓️
 * seasonal toggle and every registered bonus pool did NOTHING on an agents campaign — the
 * owner set them, watched ordinary products keep coming through the holidays, and no screen
 * could explain it. Both runners now read the same plan.
 */
describe('OrchestratorAgent — seasonal and bonus keywords reach the agents path', () => {
  const USER = 'u1';
  const campaign: any = {
    id: 'c1', name: 'טקטי בקליק', keywords: ['tactical flashlight'],
    posts_per_run: 1, language: 'he', use_agents: true,
  };

  const PLAN = {
    kwList: ['tactical flashlight', 'שרשראות תאורה לסוכה', 'storage box'],
    kwEffective: ['tactical flashlight', 'שרשראות תאורה לסוכה', 'storage box'],
    rotationList: ['שרשראות תאורה לסוכה', 'tactical flashlight'],
    baseCursor: 0,
    perPost: 2,                                   // the seasonal window's extra post
    slotKeywords: ['שרשראות תאורה לסוכה', 'tactical flashlight'],
    distinctKeywords: ['שרשראות תאורה לסוכה', 'tactical flashlight'],
    occasionHint: 'זו תקופת חגי תשרי — חבר את הכתיבה לאווירת החג.',
    saleSeasonHint: null,
    seasonalKeywordSet: new Set(['שרשראות תאורה לסוכה']),
    bonusKeywordSet: new Set(['storage box']),
  };

  /** The orchestrator with every collaborator stubbed. `products` is what the ProductAgent
   *  reports back, which decides whether the content step runs at all. */
  function build(plan: any = PLAN, products: any[] = [{ product_id: 'p1', title: 'פנס טקטי' }], published: any[] = []) {
    const findBestProducts = jest.fn(async (..._a: any[]) => ({ products, tokens: 0 }));
    const generateOptimizedContent = jest.fn(async (..._a: any[]) => ({ text: 'טקסט', language: 'he', tokens: 0 }));
    const createAgentPost = jest.fn(async (..._a: any[]) => undefined);
    const campaignKeywordPlan = jest.fn(async (..._a: any[]) => plan);
    const agent = new OrchestratorAgent(
      { findBestProducts } as any,
      { generateOptimizedContent } as any,
      { evaluateAndOptimize: async () => ({ status: 'healthy', tokens: 0 }) } as any,
      {
        campaignKeywordPlan, soldPriceBandFor: async () => null, createAgentPost,
        recentlyPublished: async () => new PublishedProducts(published),
      } as any,
      { getRate: async () => 3.7 } as any,
      { getRaw: async () => ({ currency_pair: 'USD_ILS' }) } as any,
      { create: (r: any) => ({ ...r, id: 'run1' }), save: async (r: any) => r } as any,
    );
    return { agent, findBestProducts, generateOptimizedContent, createAgentPost, campaignKeywordPlan };
  }

  it('asks for the plan instead of reading the campaign row directly', async () => {
    const { agent, campaignKeywordPlan } = build();
    await agent.run(campaign, USER);
    expect(campaignKeywordPlan).toHaveBeenCalledWith(campaign, USER, expect.anything());
  });

  it('searches the keywords the PLAN chose, not the raw campaign list', async () => {
    const { agent, findBestProducts } = build();
    await agent.run(campaign, USER);
    const keywords = (findBestProducts.mock.calls[0] as any[])[1];
    // The seasonal term is IN, and it is first — the ProductAgent searches only the first
    // few keywords it is handed, so ordering is the difference between searching a holiday
    // term and never searching it at all.
    expect(keywords).toEqual(['שרשראות תאורה לסוכה', 'tactical flashlight']);
    expect(keywords).not.toEqual(campaign.keywords);
  });

  it("takes the seasonal window's extra post from the plan", async () => {
    // posts_per_run is 1 and the open window buys a second. Reading campaign.posts_per_run
    // here would have quietly dropped that boost everywhere agents run.
    const { agent, findBestProducts } = build();
    await agent.run(campaign, USER);
    expect((findBestProducts.mock.calls[0] as any[])[3]).toBe(2);
  });

  const seasonArg = (mock: jest.Mock) => (mock.mock.calls[0] as any[])[8];

  it('gives the copywriter the occasion context for a product a SEASONAL keyword found', async () => {
    const { agent, generateOptimizedContent } = build(PLAN, [
      { product_id: 'p1', title: 'מגש הגשה', keyword: 'שרשראות תאורה לסוכה' },
    ]);
    await agent.run(campaign, USER);
    expect(seasonArg(generateOptimizedContent)).toBe(PLAN.occasionHint);
  });

  it('withholds it from a product the campaign\'s OWN keyword found', async () => {
    // The reported symptom: the holiday angle landing on every product in the feed, so a
    // tactical belt and army fatigues were written up as holiday-table items. The occasion
    // line follows the keyword that found the product, not the calendar.
    const { agent, generateOptimizedContent } = build(PLAN, [
      { product_id: 'p1', title: 'חגורה טקטית', keyword: 'tactical flashlight' },
    ]);
    await agent.run(campaign, USER);
    expect(seasonArg(generateOptimizedContent)).toBeNull();
  });

  it('withholds it from a product the agent did not attribute', async () => {
    // The keyword is the model's word, so it can be missing. Unknown must fall to the
    // QUIETER side: a missing label is not a licence to frame a product as a holiday buy.
    const { agent, generateOptimizedContent } = build(PLAN, [{ product_id: 'p1', title: 'פנס טקטי' }]);
    await agent.run(campaign, USER);
    expect(seasonArg(generateOptimizedContent)).toBeNull();
  });

  it('gives the SALE-season line to every product, attributed or not', async () => {
    // 11.11 and Black Friday say nothing about what the product is — they are a fact about
    // the week's prices, and that is true of a tactical belt too.
    const sale = 'הקשר: עונת בלאק פריידיי — מסגר את הדיל בהתאם.';
    const { agent, generateOptimizedContent } = build(
      { ...PLAN, occasionHint: null, saleSeasonHint: sale },
      [{ product_id: 'p1', title: 'חגורה טקטית', keyword: 'tactical flashlight' }],
    );
    await agent.run(campaign, USER);
    expect(seasonArg(generateOptimizedContent)).toBe(sale);
  });

  it('passes no season line outside every window', async () => {
    // Silence is the correct output when no window is open — a stale holiday line in
    // November reads worse than none at all.
    const { agent, generateOptimizedContent } = build({ ...PLAN, occasionHint: null, saleSeasonHint: null });
    await agent.run(campaign, USER);
    expect(seasonArg(generateOptimizedContent)).toBeNull();
  });

  it('still reports a clean run when the plan yields no products', async () => {
    const { agent, generateOptimizedContent } = build(PLAN, []);
    const res = await agent.run(campaign, USER);
    expect(res.posts_created).toBe(0);
    expect(res.errors).toEqual([]);
    expect(generateOptimizedContent).not.toHaveBeenCalled();
  });

  describe('never the same product twice', () => {
    const belt = { product_id: '1005001', title: 'Tactical Belt Quick Release Buckle Nylon Molle Outdoor' };
    const sameBeltOtherStore = { product_id: '1005002', title: 'Hot Sale Tactical Belt Quick Release Buckle Nylon Molle Outdoor' };
    const sling = { product_id: '1005003', title: 'Rifle Sling Two Point Adjustable Quick Detach Strap' };

    it('hands the agent a filter that hides what the account already published', async () => {
      const { agent, findBestProducts } = build(PLAN, [sling], [belt]);
      await agent.run(campaign, USER);
      const hide = (findBestProducts.mock.calls[0] as any[])[5];
      expect(hide(sameBeltOtherStore)).toBe(true);
      // (the sling was picked by this run, so it is in the set by now — check another item)
      expect(hide({ product_id: '1005009', title: 'Night Vision Monocular Infrared Digital Camera' })).toBe(false);
    });

    it('drops a pick that repeats a published product, or another pick of this run', async () => {
      const { agent, createAgentPost } = build(PLAN, [belt, sling, { ...sling, product_id: '1005004' }], [sameBeltOtherStore]);
      await agent.run(campaign, USER);
      const posted = createAgentPost.mock.calls.map((c: any[]) => c[2].product_id);
      expect(posted).toEqual(['1005003']);
    });

    it('records the keyword that found the product on the post', async () => {
      const { agent, createAgentPost } = build(PLAN, [{ ...sling, keyword: 'tactical flashlight' }]);
      await agent.run(campaign, USER);
      expect((createAgentPost.mock.calls[0] as any[])[2].keyword).toBe('tactical flashlight');
    });
  });
});
