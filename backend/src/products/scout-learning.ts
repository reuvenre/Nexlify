/**
 * What makes the commission scout's picks fresh, relevant and honest about the money.
 *
 * The owner's complaints were three: the same recommendations again and again, products that
 * have nothing to do with his channels, and too few products. Each has its own cause here:
 *
 *  - **The same products.** The affiliate API returns a small, fixed slice per query, so a
 *    keyword read at the same (sort, page) every day returns the same items forever, and the
 *    30-day "already recommended" memory then empties the report. `rotationSlice` walks each
 *    keyword and category through different (sort, page) slices day by day.
 *  - **The same product under another id.** AliExpress lists one item once per store. The
 *    scout's "already posted" check was by id, so another store's listing of last week's
 *    product came back as new. The scan now asks `PublishedProducts` (photo / title).
 *  - **Not relevant.** AliExpress's promotion lists and the overall hot feed are for every
 *    audience. `relevanceProfile` reads, from the same scan, which categories the owner's own
 *    keywords land in, plus the words of his clicked posts; a product outside both ranks lower
 *    and fills the Telegram report only when nothing relevant is left, marked as such.
 *  - **The rate is what the API declares, not what is paid** (category caps, new vs returning
 *    buyer). His own orders say what he was really paid: per product when it sold, per
 *    category otherwise (`learnCategoryPaid`, remembered across scans). The ranking uses that.
 *  - **What sold for him.** A keyword whose posts brought orders lifts its products; one with
 *    clicks and no orders lowers them (`keywordBoost`).
 *
 * Kept free of Nest so all of it can be unit tested.
 */

import { titleTokens } from '../posts/product-similarity';

// ── Rotation ──────────────────────────────────────────────────────────────────

/** Sorts the scan rotates through. Best sellers, then the dearest (more dollars per sale). */
export const SCOUT_SORTS = ['LAST_VOLUME_DESC', 'SALE_PRICE_DESC'] as const;
export type ScoutSort = typeof SCOUT_SORTS[number];
/** Page windows per sort: with 2 pages a read, windows start at pages 1, 3, 5. */
export const ROTATION_WINDOWS = 3;
/** Days before a keyword reads the same slice again: 2 sorts × 3 windows. */
export const ROTATION_CYCLE_DAYS = SCOUT_SORTS.length * ROTATION_WINDOWS;

/**
 * The (sort, first page) a source reads today. `index` staggers the sources, so on any one
 * day some keywords read their best sellers' first page while others read deeper.
 */
export function rotationSlice(day: number, index: number, pages: number): { sort: ScoutSort; startPage: number } {
  const k = (((day + index) % ROTATION_CYCLE_DAYS) + ROTATION_CYCLE_DAYS) % ROTATION_CYCLE_DAYS;
  return {
    sort: SCOUT_SORTS[k % SCOUT_SORTS.length],
    startPage: 1 + Math.floor(k / SCOUT_SORTS.length) * Math.max(1, pages),
  };
}

// ── What he was really paid ───────────────────────────────────────────────────

/** What the orders of one product actually paid (cancelled orders aside). */
export interface SoldStats { orders: number; amount_usd: number; paid_usd: number }

/** One category's evidence: what its sold products declared, and what they paid. */
export interface CategoryPaid { declared_usd: number; paid_usd: number; orders: number; at: number }

/** Below this many orders, a product's or a category's paid rate is noise. */
export const MIN_ORDERS_FOR_PAID_RATE = 3;
/** A product's own paid rate needs fewer orders: it is exact, not an average of others. */
export const MIN_ORDERS_FOR_PRODUCT_RATE = 2;
/** A category's evidence is kept this long across scans. */
export const CATEGORY_PAID_TTL_MS = 90 * 86_400_000;

export interface RatedLike {
  product_id: string;
  commission_rate: number;
  category?: string;
}

function catKey(category?: string): string {
  return String(category || '—').trim().toLowerCase();
}

/**
 * The scan's evidence per category: products in this scan that he has sold, what their
 * declared rate would have paid on those orders, and what was paid.
 */
export function learnCategoryPaid(candidates: RatedLike[], sold: Map<string, SoldStats>, now = Date.now()): Record<string, CategoryPaid> {
  const out: Record<string, CategoryPaid> = {};
  const counted = new Set<string>();
  for (const c of candidates) {
    const s = sold.get(String(c.product_id));
    if (!s || !s.orders || s.amount_usd <= 0 || !(c.commission_rate > 0) || counted.has(c.product_id)) continue;
    counted.add(c.product_id);
    const k = catKey(c.category);
    const row = out[k] || (out[k] = { declared_usd: 0, paid_usd: 0, orders: 0, at: now });
    row.declared_usd += s.amount_usd * c.commission_rate / 100;
    row.paid_usd += s.paid_usd;
    row.orders += s.orders;
  }
  return out;
}

/**
 * Merge, never assign: a category this scan has evidence for is replaced (the orders are a
 * rolling window, so adding would count the same orders twice); every other category keeps
 * what earlier scans learned, until it ages out.
 */
export function mergeCategoryPaid(prev: Record<string, CategoryPaid> | null, next: Record<string, CategoryPaid>, now = Date.now()): Record<string, CategoryPaid> {
  const out: Record<string, CategoryPaid> = {};
  for (const [k, v] of Object.entries(prev || {})) if (v && now - Number(v.at || 0) <= CATEGORY_PAID_TTL_MS) out[k] = v;
  for (const [k, v] of Object.entries(next)) if (v.orders >= MIN_ORDERS_FOR_PAID_RATE || !out[k]) out[k] = v;
  return out;
}

/** paid ÷ declared for a category, or null when there is too little evidence. */
export function categoryPaidRatio(c: CategoryPaid | undefined): number | null {
  if (!c || c.orders < MIN_ORDERS_FOR_PAID_RATE || c.declared_usd <= 0) return null;
  return Math.min(1.2, Math.max(0.05, c.paid_usd / c.declared_usd));
}

export type PaidBasis = 'product' | 'category';

/** The rate to rank by: his own orders of this product, else his category's ratio, else the declared rate. */
export function effectiveRate(
  c: RatedLike,
  sold: Map<string, SoldStats>,
  categories: Record<string, CategoryPaid>,
): { rate: number; basis?: PaidBasis } {
  const s = sold.get(String(c.product_id));
  if (s && s.orders >= MIN_ORDERS_FOR_PRODUCT_RATE && s.amount_usd > 0) {
    return { rate: +Math.min(95, (s.paid_usd / s.amount_usd) * 100).toFixed(1), basis: 'product' };
  }
  const ratio = categoryPaidRatio(categories[catKey(c.category)]);
  if (ratio !== null && ratio < 0.98) return { rate: +(c.commission_rate * ratio).toFixed(1), basis: 'category' };
  return { rate: c.commission_rate };
}

// ── What sold for him ─────────────────────────────────────────────────────────

/** A keyword's record over the window: posts, their clicks, and the orders attributed to it. */
export interface KeywordStats { posts: number; clicks: number; orders: number }

/** Too few posts to judge a keyword by. */
const MIN_POSTS_TO_JUDGE = 5;

/**
 * ×1.1 per attributed order up to ×1.5; ×0.8 for a keyword whose posts draw clicks and no
 * orders; ×0.85 for one whose posts draw nothing at all. Neutral below MIN_POSTS_TO_JUDGE.
 */
export function keywordBoost(s: KeywordStats | undefined): number {
  if (!s) return 1;
  if (s.orders > 0) return Math.min(1.5, 1 + 0.1 * s.orders);
  if (s.posts < MIN_POSTS_TO_JUDGE) return 1;
  if (s.posts >= 10 && s.clicks >= 20) return 0.8;
  if (s.clicks === 0) return 0.85;
  return 1;
}

// ── Relevant to his channels ──────────────────────────────────────────────────

export interface RelevanceProfile {
  /** Categories his own keywords' results fall in (at least MIN_NICHE_HITS of them). */
  categories: Set<string>;
  /** Words that recur in the titles of his clicked posts. */
  words: Set<string>;
  /** Nothing to judge by (no keywords, no clicked posts): everything counts as relevant. */
  empty: boolean;
}

/** A category counts as his once this many of his keywords' results land in it. */
export const MIN_NICHE_HITS = 2;
/** A word counts as his once it recurs in this many of his clicked posts' titles. */
const MIN_WORD_POSTS = 2;
/** A product sharing this many of his words is relevant without the category. */
const MIN_SHARED_WORDS = 2;
/** What an off-niche product's score is multiplied by. */
export const OFF_NICHE_FACTOR = 0.6;

export function relevanceProfile(
  candidates: Array<{ category?: string; origin: string }>,
  clickedTitles: string[],
): RelevanceProfile {
  const hits = new Map<string, number>();
  for (const c of candidates) {
    if (c.origin !== 'niche') continue;
    const k = catKey(c.category);
    hits.set(k, (hits.get(k) || 0) + 1);
  }
  const categories = new Set([...hits].filter(([k, n]) => k !== '—' && n >= MIN_NICHE_HITS).map(([k]) => k));
  const perWord = new Map<string, number>();
  for (const t of clickedTitles) for (const w of titleTokens(t)) if (w.length >= 3 && !/^\d+$/.test(w)) perWord.set(w, (perWord.get(w) || 0) + 1);
  const words = new Set([...perWord].filter(([, n]) => n >= MIN_WORD_POSTS).map(([w]) => w));
  return { categories, words, empty: !categories.size && !words.size };
}

/** Is this product for his audience? His own keyword's result always is. */
export function isRelevant(c: { title: string; category?: string; origin: string }, p: RelevanceProfile): boolean {
  if (p.empty || c.origin === 'niche') return true;
  if (p.categories.has(catKey(c.category))) return true;
  let shared = 0;
  for (const w of titleTokens(c.title)) if (p.words.has(w) && ++shared >= MIN_SHARED_WORDS) return true;
  return false;
}

// ── Put together ──────────────────────────────────────────────────────────────

export interface Learning {
  sold: Map<string, SoldStats>;
  categories: Record<string, CategoryPaid>;
  keywords: Map<string, KeywordStats>;
  profile: RelevanceProfile;
}

export interface Learned {
  /** The rate the ranking uses (≤ the declared one when his orders say so). */
  effective_rate: number;
  /** Where the effective rate came from, when it is not the declared one. */
  paid_basis?: PaidBasis;
  /** For his audience (his keywords' categories or words). */
  relevant: boolean;
  /** What his own results with the keyword that found it do to the score. */
  boost: number;
}

export function learnedFor(
  c: RatedLike & { title: string; origin: string; found_by: string },
  l: Learning,
): Learned {
  const { rate, basis } = effectiveRate(c, l.sold, l.categories);
  const relevant = isRelevant(c, l.profile);
  const boost = c.origin === 'niche' ? keywordBoost(l.keywords.get(c.found_by.trim().toLowerCase())) : 1;
  return { effective_rate: rate, paid_basis: basis, relevant, boost };
}

export function emptyLearning(): Learning {
  return { sold: new Map(), categories: {}, keywords: new Map(), profile: { categories: new Set(), words: new Set(), empty: true } };
}
