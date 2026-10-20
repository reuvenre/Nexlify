import { OFF_NICHE_MAX_PICKS, ScoutCandidate, pickLines, rankCatalog, selectPicks } from './commission-scout';
import {
  CATEGORY_PAID_TTL_MS, ROTATION_CYCLE_DAYS, SoldStats, categoryPaidRatio, effectiveRate, emptyLearning, isRelevant,
  keywordBoost, learnCategoryPaid, mergeCategoryPaid, relevanceProfile, rotationSlice,
} from './scout-learning';

const base = (over: Partial<ScoutCandidate> = {}): ScoutCandidate => ({
  product_id: '1', title: 'Tactical flashlight', sale_price: 40, original_price: 60, discount_percent: 33,
  orders_count: 500, rating: 4.7, currency: 'ILS', sale_price_usd: 10, commission_rate: 12,
  category: 'Lights', found_by: 'flashlight', origin: 'niche', ...over,
});

describe('scout learning', () => {
  describe('rotation', () => {
    it('reads a different (sort, page) slice each day, and comes back after a full cycle', () => {
      const slices = Array.from({ length: ROTATION_CYCLE_DAYS }, (_, d) => JSON.stringify(rotationSlice(d, 0, 2)));
      expect(new Set(slices).size).toBe(ROTATION_CYCLE_DAYS);
      expect(rotationSlice(ROTATION_CYCLE_DAYS, 0, 2)).toEqual(rotationSlice(0, 0, 2));
      expect(rotationSlice(0, 0, 2)).toEqual({ sort: 'LAST_VOLUME_DESC', startPage: 1 });
    });

    it('staggers keywords so they do not all move together', () => {
      expect(rotationSlice(10, 0, 2)).not.toEqual(rotationSlice(10, 1, 2));
    });

    it('steps the page window by the pages a read takes', () => {
      const starts = new Set(Array.from({ length: ROTATION_CYCLE_DAYS }, (_, d) => rotationSlice(d, 0, 3).startPage));
      expect([...starts].sort((a, b) => a - b)).toEqual([1, 4, 7]);
    });
  });

  describe('what he was really paid', () => {
    const sold = new Map<string, SoldStats>([
      ['p1', { orders: 4, amount_usd: 100, paid_usd: 3 }], // 3 % on a product that declares 15 %
      ['p2', { orders: 1, amount_usd: 20, paid_usd: 0.6 }],
    ]);

    it("uses a product's own orders once it has sold twice", () => {
      expect(effectiveRate({ product_id: 'p1', commission_rate: 15 }, sold, {})).toEqual({ rate: 3, basis: 'product' });
      expect(effectiveRate({ product_id: 'p2', commission_rate: 15 }, sold, {})).toEqual({ rate: 15 });
    });

    it("applies the category's paid ratio to a product it has not sold", () => {
      const cats = learnCategoryPaid([base({ product_id: 'p1', commission_rate: 15, category: 'Lights' })], sold);
      // declared would have paid 15 on $100, 3 was paid: a fifth
      expect(categoryPaidRatio(cats.lights)).toBeCloseTo(0.2);
      expect(effectiveRate({ product_id: 'new', commission_rate: 50, category: 'Lights' }, sold, cats)).toEqual({ rate: 10, basis: 'category' });
      expect(effectiveRate({ product_id: 'new', commission_rate: 50, category: 'Tools' }, sold, cats)).toEqual({ rate: 50 });
    });

    it('needs a few orders before a category says anything', () => {
      const cats = learnCategoryPaid([base({ product_id: 'p2', commission_rate: 15 })], sold);
      expect(categoryPaidRatio(cats.lights)).toBeNull();
    });

    it('merges across scans: new evidence replaces, an empty scan keeps, old evidence ages out', () => {
      const now = Date.now();
      const prev = {
        lights: { declared_usd: 10, paid_usd: 5, orders: 5, at: now - 1000 },
        tools: { declared_usd: 10, paid_usd: 8, orders: 5, at: now - CATEGORY_PAID_TTL_MS - 1 },
      };
      expect(mergeCategoryPaid(prev, {}, now)).toEqual({ lights: prev.lights });
      const next = { lights: { declared_usd: 20, paid_usd: 4, orders: 6, at: now } };
      expect(mergeCategoryPaid(prev, next, now).lights).toEqual(next.lights);
      // a weaker reading does not overwrite a stronger one
      const weak = { lights: { declared_usd: 1, paid_usd: 1, orders: 1, at: now } };
      expect(mergeCategoryPaid(prev, weak, now).lights).toEqual(prev.lights);
    });
  });

  describe('what sold for him', () => {
    it('lifts a keyword that brought orders and lowers one with clicks and no orders', () => {
      expect(keywordBoost({ posts: 3, clicks: 10, orders: 2 })).toBeCloseTo(1.2);
      expect(keywordBoost({ posts: 40, clicks: 400, orders: 9 })).toBe(1.5);
      expect(keywordBoost({ posts: 12, clicks: 30, orders: 0 })).toBe(0.8);
      expect(keywordBoost({ posts: 6, clicks: 0, orders: 0 })).toBe(0.85);
      expect(keywordBoost({ posts: 2, clicks: 0, orders: 0 })).toBe(1);
      expect(keywordBoost(undefined)).toBe(1);
    });
  });

  describe('relevant to his channels', () => {
    const niche = [
      base({ category: 'Lights' }), base({ category: 'Lights' }), base({ category: 'Knives' }),
    ];

    it("learns his categories from his own keywords' results", () => {
      const p = relevanceProfile(niche, []);
      expect(p.categories.has('lights')).toBe(true);
      expect(p.categories.has('knives')).toBe(false); // one hit is not a pattern
      expect(isRelevant({ title: 'Wig', category: 'Hair Extensions', origin: 'hot' }, p)).toBe(false);
      expect(isRelevant({ title: 'Headlamp', category: 'Lights', origin: 'promo' }, p)).toBe(true);
    });

    it('also accepts a product sharing the words of his clicked posts', () => {
      const p = relevanceProfile([], ['Molle pouch tactical belt', 'Tactical molle vest', 'Phone case']);
      expect(isRelevant({ title: 'Tactical molle admin pouch', category: 'Bags', origin: 'promo' }, p)).toBe(true);
      expect(isRelevant({ title: 'Silk scarf', category: 'Bags', origin: 'promo' }, p)).toBe(false);
    });

    it('judges nothing when there is nothing to judge by', () => {
      expect(isRelevant({ title: 'Anything', category: 'X', origin: 'hot' }, relevanceProfile([], []))).toBe(true);
    });
  });

  describe('in the picks', () => {
    const learning = () => {
      const l = emptyLearning();
      l.profile = relevanceProfile([base({ category: 'Lights' }), base({ category: 'Lights' })], []);
      return l;
    };

    it('puts relevant products first and fills with at most a few marked off-niche ones', () => {
      const off = Array.from({ length: 6 }, (_, i) => base({
        product_id: `off${i}`, origin: 'hot', category: `Cat${i}`, commission_rate: 80, title: `Wig ${i}`,
      }));
      const { picks, funnel } = selectPicks([base({ product_id: 'mine' }), ...off], {
        minRate: 12, exclude: new Set(), max: 10, learning: learning(),
      });
      expect(picks[0].product_id).toBe('mine'); // pays far less than the wigs, still first
      expect(picks.filter((p) => p.off_niche)).toHaveLength(OFF_NICHE_MAX_PICKS);
      expect(funnel.off_niche).toBe(6);
      expect(pickLines(picks[1]).join('\n')).toContain('מחוץ לנישה');
    });

    it('drops a product that declares the bar but, by his orders, pays under it', () => {
      const l = learning();
      l.sold.set('capped', { orders: 5, amount_usd: 100, paid_usd: 4 });
      const { picks, funnel } = selectPicks([base({ product_id: 'capped', commission_rate: 30 }), base({ product_id: 'ok' })], {
        minRate: 12, exclude: new Set(), max: 10, learning: l,
      });
      expect(picks.map((p) => p.product_id)).toEqual(['ok']);
      expect(funnel.pays_less).toBe(1);
    });

    it('counts the money at the paid rate and says where it came from', () => {
      const l = learning();
      l.sold.set('p', { orders: 3, amount_usd: 100, paid_usd: 20 });
      const { picks } = selectPicks([base({ product_id: 'p', commission_rate: 50, sale_price_usd: 10 })], {
        minRate: 12, exclude: new Set(), max: 10, learning: l,
      });
      expect(picks[0].earn_per_sale_usd).toBe(2); // $10 × 20 %, not × 50 %
      expect(pickLines(picks[0])[0]).toContain('בפועל כ-20%');
    });

    it('shows the screen every product, one card per photo, posted ones marked by photo or title', () => {
      const photo = 'https://ae01.alicdn.com/kf/Sabcdef1234567890.jpg';
      const items = rankCatalog([
        base({ product_id: 'a', image_url: photo, orders_count: 900 }),
        base({ product_id: 'b', image_url: `${photo}_350x350.jpg` }),
        base({ product_id: 'wig', origin: 'hot', category: 'Hair', title: 'Wig' }),
      ], { minRate: 12, posted: new Set(), published: { has: (p) => p.product_id === 'wig' }, learning: learning() });
      expect(items.map((i) => i.product_id)).toEqual(['a', 'wig']);
      expect(items.find((i) => i.product_id === 'wig')).toMatchObject({ posted_recently: true, relevant: false });
    });
  });
});
