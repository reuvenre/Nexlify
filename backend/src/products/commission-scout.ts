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
 * Kept free of Nest so the ranking can be unit tested.
 */

/** The bar the owner set: 12 % and up. COMMISSION_SCOUT_MIN overrides it. */
export const MIN_COMMISSION_PCT = 12;
/** Picks per report. COMMISSION_SCOUT_PICKS overrides it (1–20). */
export const DEFAULT_PICKS = 10;
/** A product nobody buys is not a recommendation, whatever it pays. */
export const MIN_ORDERS = 10;
/** Below this, buyers complain more than they buy (0 = unrated, allowed at a discount). */
export const MIN_RATING = 4.3;
/** No more than this many picks from one category, so one category cannot fill the list. */
export const MAX_PER_CATEGORY = 3;
/** A product recommended once is not recommended again for this long. */
export const SEEN_TTL_MS = 30 * 86_400_000;
/** Keyword searches per scan (each keyword is read twice: regular and hot). */
export const MAX_SCAN_KEYWORDS = 12;
/** Promotion lists per scan, two pages each. */
export const MAX_SCAN_PROMOS = 8;
/** Picks from the owner's own keywords weigh this much more than the same money elsewhere. */
export const NICHE_BOOST = 1.3;

export type ScoutOrigin = 'niche' | 'promo';

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
}

export interface ScoutPick extends ScoutCandidate {
  /** What one sale pays, in USD (commissions are paid in USD). */
  earn_per_sale_usd: number;
  score: number;
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

export function picksPerReport(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(String(env.COMMISSION_SCOUT_PICKS || ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(20, n) : DEFAULT_PICKS;
}

/** What one sale pays, in USD. */
export function earnPerSaleUsd(c: Pick<ScoutCandidate, 'sale_price_usd' | 'commission_rate'>): number {
  return +((c.sale_price_usd || 0) * (c.commission_rate || 0) / 100).toFixed(2);
}

/** Money per sale × how much it sells × how it is rated (× the niche boost). */
export function scoreCandidate(c: ScoutCandidate): number {
  const demand = Math.log10((c.orders_count || 0) + 10);
  const quality = c.rating > 0 ? Math.min(1, c.rating / 5) ** 2 : 0.7;
  const boost = c.origin === 'niche' ? NICHE_BOOST : 1;
  return earnPerSaleUsd(c) * demand * quality * boost;
}

/** One product per id; a product found twice keeps its niche origin (the owner's own keyword is the better reason). */
function dedupe(candidates: ScoutCandidate[]): ScoutCandidate[] {
  const byId = new Map<string, ScoutCandidate>();
  for (const c of candidates) {
    if (!c?.product_id) continue;
    const prev = byId.get(c.product_id);
    if (!prev || (prev.origin === 'promo' && c.origin === 'niche')) byId.set(c.product_id, c);
  }
  return [...byId.values()];
}

/** At or above the bar, selling, rated well enough, with a price. */
function qualifies(c: ScoutCandidate, minRate: number): boolean {
  return c.commission_rate >= minRate
    && (c.orders_count || 0) >= MIN_ORDERS
    && (c.rating === 0 || c.rating >= MIN_RATING)
    && (c.sale_price_usd || 0) > 0;
}

function ranked(candidates: ScoutCandidate[]): ScoutPick[] {
  return candidates
    .map((c) => ({ ...c, earn_per_sale_usd: earnPerSaleUsd(c), score: scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The Telegram report: every qualifying candidate not posted or recommended recently,
 * ranked by score, at most MAX_PER_CATEGORY per category.
 */
export function selectPicks(candidates: ScoutCandidate[], opts: {
  minRate: number;
  exclude: Set<string>;
  max: number;
}): { picks: ScoutPick[]; qualified: number } {
  const qualified = dedupe(candidates).filter((c) => qualifies(c, opts.minRate) && !opts.exclude.has(c.product_id));
  const perCategory = new Map<string, number>();
  const picks: ScoutPick[] = [];
  for (const p of ranked(qualified)) {
    if (picks.length >= opts.max) break;
    const cat = (p.category || '—').toLowerCase();
    const n = perCategory.get(cat) || 0;
    if (n >= MAX_PER_CATEGORY) continue;
    perCategory.set(cat, n + 1);
    picks.push(p);
  }
  return { picks, qualified: qualified.length };
}

/** The most products the high-commission screen keeps from one scan. */
export const CATALOG_MAX = 300;

export interface CatalogItem extends ScoutPick {
  /** The account posted it in the last 30 days — shown, marked, never hidden. */
  posted_recently: boolean;
}

/**
 * The high-commission screen: every qualifying product, best first, up to CATALOG_MAX. Unlike
 * the Telegram report nothing is left out for having been posted; it is marked instead, so
 * the owner can see what he already covers.
 */
export function rankCatalog(candidates: ScoutCandidate[], opts: { minRate: number; posted: Set<string> }): CatalogItem[] {
  return ranked(dedupe(candidates).filter((c) => qualifies(c, opts.minRate)))
    .slice(0, CATALOG_MAX)
    .map((p) => ({ ...p, posted_recently: opts.posted.has(p.product_id) }));
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
export function pickLines(p: ScoutPick): string[] {
  const rate = Number.isInteger(p.commission_rate) ? String(p.commission_rate) : p.commission_rate.toFixed(1);
  return [
    `💵 עמלה ${rate}% · כ-$${p.earn_per_sale_usd.toFixed(2)} לכל מכירה`,
    p.origin === 'niche' ? `🎯 נמצא במילת המפתח «${p.found_by}»` : `🏷️ מרשימת המבצעים «${p.found_by}»`,
  ];
}

/** The report's opening message. */
export function reportHeader(r: { picks: number; qualified: number; scanned: number; minRate: number; errors: string[] }): string {
  const lines = [`💎 סוכן העמלות: מוצרים עם עמלה של ${r.minRate}% ומעלה`, ''];
  lines.push(`נסרקו ${r.scanned.toLocaleString('en-US')} מוצרים, ${r.qualified} עברו את הסף.`);
  if (r.picks) {
    lines.push(`הנה ${r.picks} הכי משתלמים: מדורגים לפי כמה מכירה משלמת, כמה המוצר נמכר והדירוג שלו.`);
    lines.push('העמלה היא מה שאלי אקספרס מצהירה ב-API. בפועל היא יכולה להיות נמוכה יותר (תקרות לפי קטגוריה, לקוח חדש מול חוזר).');
  } else {
    lines.push('לא נמצא היום מוצר חדש שעובר את הסף, נמכר ומדורג טוב. מוצרים שכבר פורסמו או הומלצו ב-30 הימים האחרונים לא חוזרים.');
  }
  if (r.errors.length) lines.push('', `⚠️ ${r.errors.length} חיפושים נכשלו (למשל: ${r.errors[0]}).`);
  return lines.join('\n');
}
