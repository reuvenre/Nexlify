/**
 * The commission scout: which products pay a commission of 12 % or more, and which of those
 * are worth recommending to the owner.
 *
 * The rate is not on the AliExpress site at all; only the affiliate API carries it, so the
 * scan reads the API (ProductsService.scoutProducts). It cannot list every product, so it
 * reads AliExpress's own promotion lists for affiliates (where boosted-commission products
 * sit, sorted by commission) and the owner's campaign keywords, in both the regular and the
 * hot-products search.
 *
 * A high rate alone is not the recommendation. 15 % on a product three people bought earns
 * less than 12 % on one that sells by the thousand, so picks are ranked by what a sale pays
 * (price × rate), how much it sells, and how it is rated. Products found through the owner's
 * own keywords rank ahead of the same money from a general promotion list.
 *
 * The owner's own results refine all of it (products/scout-learning.ts): what his orders
 * really paid replaces the declared rate, keywords that sold lift their products, products
 * outside his channels' categories rank lower, and a listing of something already posted
 * under another store's id counts as posted.
 *
 * Kept free of Nest so the ranking can be unit tested.
 */

import { ProductLike, PublishedProducts, imageKey } from '../posts/product-similarity';
import { Learning, OFF_NICHE_FACTOR, PaidBasis, learnedFor } from './scout-learning';

/** The bar the owner set: 12 % and up. COMMISSION_SCOUT_MIN overrides it. */
export const MIN_COMMISSION_PCT = 12;
/** Picks per report. COMMISSION_SCOUT_PICKS overrides it (1–20). */
export const DEFAULT_PICKS = 10;
/** A product nobody buys is not a recommendation, whatever it pays. */
export const MIN_ORDERS = 10;
/** Below this, buyers complain more than they buy (0 = unrated, allowed at a discount). */
export const MIN_RATING = 4.3;
/**
 * When the strict floors leave the report short, relevant products are taken at these
 * instead. An empty report was the other complaint: a newer listing with a few sales and a
 * 4.0 rating is a fair pick when it is for his audience and pays.
 */
export const RELAXED_MIN_ORDERS = 3;
export const RELAXED_MIN_RATING = 4.0;
/** Products outside his niche fill at most this many of a short report, and say so. */
export const OFF_NICHE_MAX_PICKS = 3;
/** No more than this many picks from one category, so one category cannot fill the list. */
export const MAX_PER_CATEGORY = 3;
/** A product recommended once is not recommended again for this long. */
export const SEEN_TTL_MS = 30 * 86_400_000;
/** Campaign keywords per scan (each read in the regular and the hot search, KEYWORD_PAGES each). */
export const MAX_SCAN_KEYWORDS = 20;
export const KEYWORD_PAGES = 2;
/** Promotion lists per scan. Sorted by commission, so paging stops once a page falls under the bar. */
export const MAX_SCAN_PROMOS = 20;
export const PROMO_PAGES = 5;
/** The hot-products feed (where AliExpress puts its boosted 50–90 % rates): overall, then per category. */
export const HOT_PAGES = 5;
export const HOT_CATEGORY_PAGES = 3;
/** API calls one scan may spend (1.1 s apart: 300 ≈ 5–6 minutes). COMMISSION_SCOUT_MAX_CALLS overrides it. */
export const DEFAULT_MAX_CALLS = 300;
/** This many failed calls in a row is the quota or the keys, not bad luck: the scan stops. */
export const MAX_FAILS_IN_A_ROW = 5;
/** Picks from the owner's own keywords weigh this much more than the same money elsewhere. */
export const NICHE_BOOST = 1.3;

/** niche = a campaign keyword, promo = a promotion list, hot = the hot-products feed (a category's or overall). */
export type ScoutOrigin = 'niche' | 'promo' | 'hot';

export interface ScoutCandidate {
  product_id: string;
  title: string;
  sale_price: number;
  original_price: number;
  discount_percent: number;
  orders_count: number;
  rating: number;
  currency: string;
  sale_price_usd: number;
  commission_rate: number;
  category?: string;
  image_url?: string;
  product_url?: string;
  affiliate_url?: string;
  /** What found it: a campaign keyword or a promotion list's name. */
  found_by: string;
  origin: ScoutOrigin;
  /** Set by the learning step (scout-learning.ts); absent, the declared rate stands. */
  effective_rate?: number;
  paid_basis?: PaidBasis;
  relevant?: boolean;
  boost?: number;
}

export interface ScoutPick extends ScoutCandidate {
  /** What one sale pays, in USD (commissions are paid in USD), at the effective rate. */
  earn_per_sale_usd: number;
  score: number;
  /** Filled a short report from outside his niche: the card says so. */
  off_niche?: boolean;
}

/** "12.5%" / "12.5" / 12.5 → 12.5; anything unreadable → 0. */
export function parseRate(value: unknown): number {
  const n = parseFloat(String(value ?? '').replace('%', '').trim());
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 0;
}

export function minCommissionPct(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseFloat(String(env.COMMISSION_SCOUT_MIN || ''));
  return Number.isFinite(n) && n > 0 && n < 100 ? n : MIN_COMMISSION_PCT;
}

export function maxScanCalls(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(String(env.COMMISSION_SCOUT_MAX_CALLS || ''), 10);
  return Number.isFinite(n) && n >= 10 ? Math.min(2000, n) : DEFAULT_MAX_CALLS;
}

/** A full page with something at or above the bar is worth reading the next page of. */
export function worthNextPage(page: Array<{ commission_rate: number }>, minRate: number, pageSize = 50): boolean {
  return page.length >= pageSize && page.some((p) => p.commission_rate >= minRate);
}

export function picksPerReport(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(String(env.COMMISSION_SCOUT_PICKS || ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(20, n) : DEFAULT_PICKS;
}

/** The rate a sale is counted at: what his orders say it pays, else what the API declares. */
function rateOf(c: Pick<ScoutCandidate, 'commission_rate' | 'effective_rate'>): number {
  return c.effective_rate ?? c.commission_rate ?? 0;
}

/** What one sale pays, in USD. */
export function earnPerSaleUsd(c: Pick<ScoutCandidate, 'sale_price_usd' | 'commission_rate' | 'effective_rate'>): number {
  return +((c.sale_price_usd || 0) * rateOf(c) / 100).toFixed(2);
}

/**
 * Money per sale × how much it sells × how it is rated (× the niche boost), × what his own
 * results with its keyword say, × OFF_NICHE_FACTOR for a product outside his audience.
 */
export function scoreCandidate(c: ScoutCandidate): number {
  const demand = Math.log10((c.orders_count || 0) + 10);
  const quality = c.rating > 0 ? Math.min(1, c.rating / 5) ** 2 : 0.7;
  const boost = c.origin === 'niche' ? NICHE_BOOST : 1;
  const learned = (c.boost ?? 1) * (c.relevant === false ? OFF_NICHE_FACTOR : 1);
  return earnPerSaleUsd(c) * demand * quality * boost * learned;
}

/** The learning step, when there is one: effective rate, relevance and keyword boost on every candidate. */
function learn(candidates: ScoutCandidate[], learning?: Learning): ScoutCandidate[] {
  return learning ? candidates.map((c) => ({ ...c, ...learnedFor(c, learning) })) : candidates;
}

/** One product per id: a product found twice keeps its niche origin (the owner's own keyword is the better reason) and the best rate quoted. */
export function dedupe(candidates: ScoutCandidate[]): ScoutCandidate[] {
  const byId = new Map<string, ScoutCandidate>();
  for (const c of candidates) {
    if (!c?.product_id) continue;
    const prev = byId.get(c.product_id);
    if (!prev) { byId.set(c.product_id, c); continue; }
    // The niche label wins; the rate is the best any source quoted (the hot feed quotes the boosted one).
    const keep = prev.origin !== 'niche' && c.origin === 'niche' ? c : prev;
    byId.set(c.product_id, { ...keep, commission_rate: Math.max(prev.commission_rate, c.commission_rate) });
  }
  return [...byId.values()];
}

/** Selling and rated well enough (strict, or the relaxed floors for a short report). */
function meetsFloors(c: ScoutCandidate, relaxed = false): boolean {
  return (c.orders_count || 0) >= (relaxed ? RELAXED_MIN_ORDERS : MIN_ORDERS)
    && (c.rating === 0 || c.rating >= (relaxed ? RELAXED_MIN_RATING : MIN_RATING));
}

function ranked(candidates: ScoutCandidate[]): ScoutPick[] {
  return candidates
    .map((c) => ({ ...c, earn_per_sale_usd: earnPerSaleUsd(c), score: scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score);
}

/** Why products did not make the report: the line that turns "only 3 picks" into a reason. */
export interface PickFunnel {
  /** Distinct products the scan found. */
  unique: number;
  /** At or above the bar by the declared rate. */
  at_bar: number;
  /** At the bar by the declared rate, under it by what his orders say it pays. */
  pays_less: number;
  /** Posted, or recommended before, in the last 30 days (by id, photo or title). */
  already: number;
  /** Outside his niche (his keywords' categories and his clicked posts' words). */
  off_niche: number;
  /** Too few sales or too low a rating, even at the relaxed floors. */
  floors: number;
}

/**
 * The Telegram report, filled in tiers so it is neither repetitive nor empty:
 *  1. relevant products at the strict floors;
 *  2. relevant products at the relaxed floors (RELAXED_MIN_ORDERS / RELAXED_MIN_RATING);
 *  3. at most OFF_NICHE_MAX_PICKS products outside his niche at the strict floors, marked.
 * The bar is the effective rate: a declared 15 % in a category his orders show pays a
 * third of that does not count as 15 %. Nothing posted or recommended in 30 days comes
 * back, under its own id or another store's (`published`), and no two picks are the same
 * product. At most MAX_PER_CATEGORY per category.
 */
export function selectPicks(candidates: ScoutCandidate[], opts: {
  minRate: number;
  exclude: Set<string>;
  max: number;
  /** Posted and recommended products, matched by id, photo or title. */
  published?: { has(p: ProductLike): boolean };
  learning?: Learning;
}): { picks: ScoutPick[]; qualified: number; funnel: PickFunnel } {
  const unique = learn(dedupe(candidates), opts.learning);
  const funnel: PickFunnel = { unique: unique.length, at_bar: 0, pays_less: 0, already: 0, off_niche: 0, floors: 0 };
  const pool: ScoutCandidate[] = [];
  for (const c of unique) {
    if (c.commission_rate < opts.minRate || !((c.sale_price_usd || 0) > 0)) continue;
    funnel.at_bar++;
    if (rateOf(c) < opts.minRate) { funnel.pays_less++; continue; }
    if (opts.exclude.has(c.product_id) || opts.published?.has(c)) { funnel.already++; continue; }
    pool.push(c);
  }
  const best = ranked(pool);
  const tiers: Array<{ items: ScoutPick[]; cap: number; offNiche?: boolean }> = [
    { items: best.filter((p) => p.relevant !== false && meetsFloors(p)), cap: opts.max },
    { items: best.filter((p) => p.relevant !== false && !meetsFloors(p) && meetsFloors(p, true)), cap: opts.max },
    { items: best.filter((p) => p.relevant === false && meetsFloors(p)), cap: OFF_NICHE_MAX_PICKS, offNiche: true },
  ];
  funnel.off_niche = best.filter((p) => p.relevant === false).length;
  funnel.floors = best.filter((p) => p.relevant !== false && !meetsFloors(p, true)).length;

  const perCategory = new Map<string, number>();
  const taken = new PublishedProducts();
  const picks: ScoutPick[] = [];
  for (const tier of tiers) {
    let fromTier = 0;
    for (const p of tier.items) {
      if (picks.length >= opts.max || fromTier >= tier.cap) break;
      const cat = (p.category || '—').toLowerCase();
      const n = perCategory.get(cat) || 0;
      if (n >= MAX_PER_CATEGORY || taken.has(p)) continue;
      perCategory.set(cat, n + 1);
      taken.add(p);
      picks.push(tier.offNiche ? { ...p, off_niche: true } : p);
      fromTier++;
    }
  }
  return { picks, qualified: pool.length, funnel };
}

/** The most products the high-commission screen keeps from one scan. */
export const CATALOG_MAX = 2000;

export interface CatalogItem extends ScoutPick {
  /** The account posted it in the last 30 days (by id, photo or title) — shown, marked, never hidden. */
  posted_recently: boolean;
}

/**
 * The high-commission screen: every product at or above the bar, best first, up to CATALOG_MAX.
 * Unlike the Telegram report it has no sales or rating floor: the 50–90 % products are often
 * new listings with few sales, and the owner asked to see them all. The ranking still puts a
 * product that sells ahead, and the card shows its sales. Nothing is left out for having been
 * posted; it is marked instead, so the owner can see what he already covers.
 */
export function rankCatalog(candidates: ScoutCandidate[], opts: {
  minRate: number;
  posted: Set<string>;
  /** Posted products matched by id, photo or title (another store's listing of a posted item). */
  published?: { has(p: ProductLike): boolean };
  learning?: Learning;
}): CatalogItem[] {
  const listed = learn(dedupe(candidates), opts.learning)
    .filter((c) => c.commission_rate >= opts.minRate && (c.sale_price_usd || 0) > 0);
  // One card per photo: several stores' listings of one item would otherwise fill a shelf
  // with the same product. The best-ranked listing is the one kept.
  const photos = new Set<string>();
  const out: CatalogItem[] = [];
  for (const p of ranked(listed)) {
    if (out.length >= CATALOG_MAX) break;
    const photo = imageKey(p.image_url);
    if (photo && photos.has(photo)) continue;
    if (photo) photos.add(photo);
    out.push({ ...p, posted_recently: opts.posted.has(p.product_id) || !!opts.published?.has(p) });
  }
  return out;
}

/** The keywords a scan reads: every active campaign's rotation, de-duplicated, capped. */
export function scanKeywords(lists: string[][], max = MAX_SCAN_KEYWORDS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const kw = String(raw || '').replace(/\s+/g, ' ').trim();
      const key = kw.toLowerCase();
      if (!kw || seen.has(key)) continue;
      seen.add(key);
      out.push(kw);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** The lines a pick adds under the ordinary product card. */
function pct(r: number): string {
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function pickLines(p: ScoutPick): string[] {
  const paid = p.paid_basis && p.effective_rate !== undefined
    ? ` (בפועל כ-${pct(p.effective_rate)}% ${p.paid_basis === 'product' ? 'לפי ההזמנות שלך במוצר הזה' : 'לפי ההזמנות שלך בקטגוריה'})`
    : '';
  const lines = [
    `💵 עמלה ${pct(p.commission_rate)}%${paid} · כ-$${p.earn_per_sale_usd.toFixed(2)} לכל מכירה`,
    p.origin === 'niche' ? `🎯 נמצא במילת המפתח «${p.found_by}»`
      : p.origin === 'hot' ? `🔥 מהמוצרים החמים «${p.found_by}»`
        : `🏷️ מרשימת המבצעים «${p.found_by}»`,
  ];
  if (p.off_niche) lines.push('🌐 מחוץ לנישה של הערוצים שלך: נכנס כי לא היו מספיק מוצרים מהנישה');
  return lines;
}

/** The report's opening message. */
export function reportHeader(r: { picks: number; qualified: number; scanned: number; minRate: number; errors: string[]; funnel?: PickFunnel }): string {
  const lines = [`💎 סוכן העמלות: מוצרים עם עמלה של ${r.minRate}% ומעלה`, ''];
  lines.push(`נסרקו ${r.scanned.toLocaleString('en-US')} מוצרים, ${r.qualified} עברו את הסף.`);
  if (r.funnel) lines.push(funnelLine(r.funnel, r.minRate));
  if (r.picks) {
    lines.push(`הנה ${r.picks} הכי משתלמים: מדורגים לפי כמה מכירה משלמת, כמה המוצר נמכר והדירוג שלו.`);
    lines.push('העמלה היא מה שאלי אקספרס מצהירה ב-API. בפועל היא יכולה להיות נמוכה יותר (תקרות לפי קטגוריה, לקוח חדש מול חוזר).');
  } else {
    lines.push('לא נמצא היום מוצר חדש שעובר את הסף, נמכר ומדורג טוב. מוצרים שכבר פורסמו או הומלצו ב-30 הימים האחרונים לא חוזרים.');
  }
  if (r.errors.length) lines.push('', `⚠️ ${r.errors.length} חיפושים נכשלו (למשל: ${r.errors[0]}).`);
  return lines.join('\n');
}

/** "Of 1,240 distinct products: 310 at the bar, 41 already posted, …" — only the parts that are not zero. */
export function funnelLine(f: PickFunnel, minRate: number): string {
  const parts = [`${f.at_bar.toLocaleString('en-US')} מעל ${minRate}%`];
  if (f.pays_less) parts.push(`${f.pays_less} משלמים לך בפועל פחות (לפי ההזמנות שלך)`);
  if (f.already) parts.push(`${f.already} כבר פורסמו או הומלצו ב-30 יום`);
  if (f.off_niche) parts.push(`${f.off_niche} מחוץ לנישה שלך`);
  if (f.floors) parts.push(`${f.floors} עם מעט מדי מכירות או דירוג נמוך`);
  return `📊 מתוך ${f.unique.toLocaleString('en-US')} מוצרים שונים: ${parts.join(' · ')}.`;
}
