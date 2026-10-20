import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Not, Repository } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { Earning } from '../earnings/earning.entity';
import { Post } from '../posts/post.entity';
import { ProductLike, PublishedProducts } from '../posts/product-similarity';
import { ProductsService, ScoutSource } from './products.service';
import { PersistentValueStore } from '../common/persistent-value.store';
import {
  CatalogItem, HOT_CATEGORY_PAGES, HOT_PAGES, KEYWORD_PAGES, MAX_FAILS_IN_A_ROW, MAX_SCAN_PROMOS, PROMO_PAGES,
  PickFunnel, SEEN_TTL_MS, ScoutCandidate, ScoutOrigin, ScoutPick, SourceGroup, SourceStat,
  carryOver, dedupe, maxScanCalls, minCommissionPct, picksPerReport, rankCatalog, scanKeywords, selectPicks, stampSeen, worthNextPage,
} from './commission-scout';
import {
  CATEGORY_PAID_TTL_MS, CategoryPaid, KeywordStats, Learning, SCOUT_SORTS, SoldStats,
  learnCategoryPaid, mergeCategoryPaid, relevanceProfile, rotationSlice,
} from './scout-learning';
import {
  NICHE_CATEGORY_HOT_PAGES, NICHE_CATEGORY_SEARCH_PAGES, NICHE_COOLDOWN_MS, NICHE_KEYWORD_HOT_PAGES,
  NICHE_KEYWORD_SEARCH_PAGES, NICHE_MAX_CALLS, NICHE_TTL_MS, PRESET_NICHES, categoryLabel, parseNicheId,
} from './scout-niches';

/** AliExpress bans bursts over ~1 call a second; the scan stays under it. */
const CALL_GAP_MS = 1100;
/** What the account published this recently is not recommended again. */
const POSTED_WINDOW_MS = 30 * 86_400_000;
/** The screen's "scan now" waits this long between scans, so it cannot eat the API quota. */
export const SCAN_COOLDOWN_MS = 10 * 60_000;
/** How long the last scan is kept for the screen. */
const CATALOG_TTL_MS = 7 * 86_400_000;
/** The orders and posts the learning reads (scout-learning.ts). */
const SOLD_WINDOW_MS = 90 * 86_400_000;
const KEYWORD_WINDOW_MS = 60 * 86_400_000;
/** Bounded reads: the learning needs a picture, not every row. */
const MAX_LEARNING_ROWS = 5000;

/** A remembered recommendation: when, and what it looked like (so another store's listing of it is recognised). */
type SeenEntry = number | { at: number; title?: string; image?: string };

function seenAt(v: SeenEntry): number {
  return typeof v === 'number' ? v : Number(v?.at || 0);
}

/** The high-commission screen's data: the last scan, as it was. */
export interface ScoutCatalog {
  scanned_at: string;
  scanned: number;
  min_rate: number;
  errors: string[];
  items: CatalogItem[];
  /** API calls the scan spent, and whether it stopped at its budget with more left to read. */
  calls?: number;
  budget_hit?: boolean;
  /** Products this scan found for the first time (the list keeps earlier scans' finds for a week). */
  new_count?: number;
  /** What each kind of source gave (the screen's «מה הסריקה מצאה»). */
  sources?: SourceStat[];
  /** Where products fell out of the daily report (daily scan only). */
  funnel?: PickFunnel;
}

function sourceGroup(src: ScoutSource): SourceGroup {
  if (src.kind === 'promo') return 'promo';
  if (src.keyword) return 'keywords';
  if (src.category_id) return 'categories';
  return 'hot';
}

/** One entry in the niche list. */
export interface NicheOption { id: string; label: string }

/** A niche search's result, as it was: the same shape as the daily catalog, plus the niche. */
export interface NicheCatalog extends ScoutCatalog {
  niche_id: string;
  label: string;
}

/** A source a scan reads, with how many pages and how its products are labelled. */
interface ScanStep { source: ScoutSource; pages: number; foundBy: string; origin: ScoutOrigin }

export interface ScoutReport {
  picks: ScoutPick[];
  qualified: number;
  scanned: number;
  minRate: number;
  errors: string[];
  funnel?: PickFunnel;
  sources?: SourceStat[];
}

/**
 * Runs the commission scan (products/commission-scout.ts) for one account, within a budget of
 * API calls (`maxScanCalls`, 300 ≈ 5–6 minutes):
 *  1. AliExpress's promotion lists for affiliates, sorted by commission, paged until a page
 *     falls under the bar;
 *  2. the hot-products feed overall, where the boosted 50–90 % rates sit;
 *  3. every active campaign's keywords, in the regular and the hot search;
 *  4. the hot-products feed per category, rotating the starting category by day, so a budget
 *     that runs out still covers different categories on different days.
 * Every read asks for the API's maximum page (50). Products the account posted or was recommended in the last 30
 * days are left out of the Telegram report; the recommended ones are remembered in
 * persistent_values (`commission_scout_seen:<user>`), so a deploy cannot make them come back.
 *
 * Every scan also keeps the whole ranked list for the high-commission screen
 * (`commission_scout_catalog:<user>`, 7 d): a scan takes minutes of API calls, far too
 * long for a page load, so the screen reads the last one and can start a new one.
 */
@Injectable()
export class CommissionScoutService {
  private readonly logger = new Logger(CommissionScoutService.name);

  constructor(
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly products: ProductsService,
    private readonly memory: PersistentValueStore,
    @InjectRepository(Earning) private readonly earnings?: Repository<Earning>,
  ) {}

  async scan(userId: string): Promise<ScoutReport> {
    const minRate = minCommissionPct();
    const reader = this.makeReader(userId, minRate, maxScanCalls());
    const { readPages, candidates, errors } = reader;
    const out = reader.out;

    // Every source reads a different (sort, page) slice on every scan: the API returns a
    // small fixed slice per query, so a fixed slice meant the same products scan after scan.
    // The step is per scan, kept across deploys (it used to be per day, so ten «סרוק עכשיו»
    // in one day read exactly the same pages).
    const step = await this.nextStep(`commission_scout_cursor:${userId}`);

    // 1. AliExpress's own promotion lists, highest commission first: a different set of them,
    //    from a different depth, each scan.
    const allPromos = await this.products.featuredPromoNames(userId);
    const promoStart = allPromos.length ? (step * MAX_SCAN_PROMOS) % allPromos.length : 0;
    const promos = [...allPromos.slice(promoStart), ...allPromos.slice(0, promoStart)].slice(0, MAX_SCAN_PROMOS);
    for (const name of promos) await readPages({ kind: 'promo', name }, PROMO_PAGES, name, 'promo', 1 + (step % 2) * PROMO_PAGES);

    // 2. The hot-products feed, overall: best sellers or the dearest, pages 1–5 or 6–10.
    const overall = rotationSlice(step, 0, HOT_PAGES);
    await readPages({ kind: 'hot', sort: overall.sort }, HOT_PAGES, 'כל הקטגוריות', 'hot',
      1 + (Math.floor(step / SCOUT_SORTS.length) % 2) * HOT_PAGES);

    // 3. The owner's niche: every active campaign's keywords, regular and hot search.
    const active = await this.campaigns.find({ where: { user_id: userId, status: 'active' as any } })
      .catch(() => [] as Campaign[]);
    const keywords = scanKeywords(active.map((c) => c.keywords || []));
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      const { sort, startPage } = rotationSlice(step, i, KEYWORD_PAGES);
      await readPages({ kind: 'search', keyword: kw, sort }, KEYWORD_PAGES, kw, 'niche', startPage);
      await readPages({ kind: 'hot', keyword: kw, sort }, KEYWORD_PAGES, kw, 'niche', startPage);
    }

    // 4. Per category: only the categories his own keywords' results landed in, read in both
    //    the hot feed and the regular search. Reading every AliExpress category spent most of
    //    the budget on tractors and wigs the screen then had to hide. With no niche to go by
    //    (no keyword results), every category, from a different one each scan.
    const allCats = await this.products.getCategories(userId).catch(() => [] as Array<{ id: string; name: string }>);
    const mine = relevanceProfile(candidates, []).categories;
    const cats = mine.size ? allCats.filter((c) => mine.has(String(c.name || '').trim().toLowerCase())) : allCats;
    for (let i = 0; i < cats.length && !out(); i++) {
      const c = cats[(step + i) % cats.length];
      const { sort, startPage } = rotationSlice(step, i, HOT_CATEGORY_PAGES);
      await readPages({ kind: 'hot', category_id: c.id, sort }, HOT_CATEGORY_PAGES, c.name, 'hot', startPage);
      if (mine.size) await readPages({ kind: 'search', category_id: c.id, sort }, HOT_CATEGORY_PAGES, c.name, 'hot', startPage);
    }
    const { calls, scanned, budgetHit } = reader.stats();

    const learning = await this.learning(userId, candidates);
    const postedSet = await this.publishedRecently(userId);
    const seen = await this.recommendedRecently(userId);
    const published = new PublishedProducts([...postedSet.items, ...seen]);
    const { picks, qualified, funnel } = selectPicks(candidates, {
      minRate, exclude: new Set(seen.map((s) => String(s.product_id))), max: picksPerReport(), published, learning,
    });
    this.logger.log(`commission scout ${userId}: ${calls} calls, ${scanned} scanned, ${qualified} ≥ ${minRate}%, ${picks.length} picked · ${JSON.stringify(funnel)}`);

    // A scan that read nothing at all keeps the previous list on the screen, and says why.
    await this.memory.save(`commission_scout_error:${userId}`, scanned > 0 ? null
      : (errors[0] || 'לא נמצא מה לסרוק: אין קמפיין פעיל עם מילות מפתח, ואלי אקספרס לא החזירה רשימות מבצעים'), CATALOG_TTL_MS);
    if (scanned > 0) {
      // The list grows: what earlier scans found this week stays, and this scan's finds are «חדש».
      const previous = await this.memory.load<ScoutCatalog>(`commission_scout_catalog:${userId}`);
      const nowIso = new Date().toISOString();
      const ranked = rankCatalog(carryOver(candidates, previous?.items), { minRate, posted: postedSet.ids, published: postedSet.set, learning });
      const items = stampSeen(ranked, new Set(candidates.map((c) => String(c.product_id))), previous, nowIso);
      const catalog: ScoutCatalog = {
        scanned_at: nowIso,
        scanned, min_rate: minRate, errors: errors.slice(0, 5),
        items, new_count: items.filter((i) => i.is_new).length,
        calls, budget_hit: budgetHit,
        sources: reader.sources(), funnel,
      };
      await this.memory.save(`commission_scout_catalog:${userId}`, catalog, CATALOG_TTL_MS);
    }
    return { picks, qualified, scanned, minRate, errors, funnel, sources: reader.sources() };
  }

  private readonly running = new Set<string>();

  /** The screen: the last scan, and whether one is running now. */
  async catalog(userId: string): Promise<{ catalog: ScoutCatalog | null; running: boolean; next_scan_at: string | null; last_error: string | null }> {
    const catalog = await this.memory.load<ScoutCatalog>(`commission_scout_catalog:${userId}`);
    const lastError = await this.memory.load<string>(`commission_scout_error:${userId}`);
    const last = catalog ? Date.parse(catalog.scanned_at) : 0;
    const next = last && Date.now() - last < SCAN_COOLDOWN_MS ? new Date(last + SCAN_COOLDOWN_MS).toISOString() : null;
    return { catalog, running: this.running.has(userId), next_scan_at: next, last_error: lastError || null };
  }

  /**
   * "Scan now" from the screen. Runs in the background (about a minute); the screen polls
   * catalog(). Refused while one runs or within SCAN_COOLDOWN_MS of the last.
   */
  async startScan(userId: string): Promise<{ started: boolean; reason?: string }> {
    if (this.running.has(userId)) return { started: false, reason: 'סריקה כבר רצה' };
    const { next_scan_at } = await this.catalog(userId);
    if (next_scan_at) return { started: false, reason: 'הסריקה האחרונה הייתה לפני פחות מ-10 דקות' };
    this.running.add(userId);
    void this.scan(userId)
      .catch((err) => this.logger.warn(`commission scan ${userId} failed: ${err?.message}`))
      .finally(() => this.running.delete(userId));
    return { started: true };
  }

  /**
   * Reads scout sources within a budget of API calls, spaced 1.1 s apart, paging on while a full
   * page still has something at or above the bar, and stopping after MAX_FAILS_IN_A_ROW failures.
   */
  private makeReader(userId: string, minRate: number, budget: number) {
    const candidates: ScoutCandidate[] = [];
    const errors: string[] = [];
    let scanned = 0;
    let calls = 0;
    let failsInARow = 0;
    const bySource = new Map<SourceGroup, SourceStat>();
    const out = () => calls >= budget || failsInARow >= MAX_FAILS_IN_A_ROW;
    const read = async (source: ScoutSource, page: number, foundBy: string, origin: ScoutOrigin) => {
      if (out()) return { data: [] as any[], sorted: false };
      calls++;
      const res = await this.products.scoutProducts(userId, source, page);
      const group = sourceGroup(source);
      const st = bySource.get(group) || { group, calls: 0, read: 0, at_bar: 0, errors: 0 };
      st.calls++;
      st.read += res.data.length;
      st.at_bar += res.data.filter((p: any) => (p.commission_rate || 0) >= minRate).length;
      if (res.error) { st.errors++; st.error = st.error || `${foundBy}: ${res.error}`.slice(0, 160); }
      bySource.set(group, st);
      if (res.error) { errors.push(`${foundBy}: ${res.error}`); failsInARow++; } else failsInARow = 0;
      scanned += res.data.length;
      for (const p of res.data) candidates.push({ ...p, found_by: foundBy, origin });
      await new Promise((r) => setTimeout(r, CALL_GAP_MS));
      return res;
    };
    const readPages = async (source: ScoutSource, pages: number, foundBy: string, origin: ScoutOrigin, startPage = 1) => {
      for (let page = startPage; page < startPage + pages && !out(); page++) {
        const res = await read(source, page, foundBy, origin);
        // A rotated slice past the end of a short result set comes back empty: read page 1 instead.
        if (page === startPage && startPage > 1 && !res.data.length && !res.error) {
          await read(source, 1, foundBy, origin);
          break;
        }
        if (!worthNextPage(res.data, minRate)) break;
      }
    };
    const order: SourceGroup[] = ['promo', 'hot', 'keywords', 'categories'];
    return {
      readPages, out, candidates, errors,
      stats: () => ({ calls, scanned, budgetHit: calls >= budget }),
      sources: () => order.map((g) => bySource.get(g)).filter((x): x is SourceStat => !!x),
    };
  }

  // ── Search by niche ──────────────────────────────────────────────────────

  /** The list the owner picks a niche from: his campaign keywords, the ready niches, AliExpress's categories. */
  async niches(userId: string): Promise<{ mine: NicheOption[]; presets: NicheOption[]; categories: NicheOption[] }> {
    const active = await this.campaigns.find({ where: { user_id: userId, status: 'active' as any } })
      .catch(() => [] as Campaign[]);
    const cats = await this.products.getCategories(userId).catch(() => [] as Array<{ id: string; name: string }>);
    return {
      mine: scanKeywords(active.map((c) => c.keywords || []), 60).map((k) => ({ id: `kw:${k}`, label: k })),
      presets: PRESET_NICHES.map((n) => ({ id: `preset:${n.key}`, label: n.label })),
      categories: cats.map((c) => ({ id: `cat:${c.id}`, label: categoryLabel(c.name) }))
        .sort((a, b) => a.label.localeCompare(b.label, 'he')),
    };
  }

  /** What a niche id on the list reads. Null for an id that is not on the owner's list. */
  private async nicheSteps(userId: string, id: string): Promise<{ label: string; steps: ScanStep[] } | null> {
    const n = parseNicheId(id);
    if (!n) return null;
    if (n.kind === 'preset') {
      const preset = PRESET_NICHES.find((p) => p.key === n.value);
      if (!preset) return null;
      return {
        label: preset.label,
        steps: preset.keywords.flatMap((kw) => [
          { source: { kind: 'hot', keyword: kw } as ScoutSource, pages: NICHE_KEYWORD_HOT_PAGES, foundBy: `${preset.label} · ${kw}`, origin: 'hot' as ScoutOrigin },
          { source: { kind: 'search', keyword: kw } as ScoutSource, pages: NICHE_KEYWORD_SEARCH_PAGES, foundBy: `${preset.label} · ${kw}`, origin: 'hot' as ScoutOrigin },
        ]),
      };
    }
    const list = await this.niches(userId);
    if (n.kind === 'kw') {
      const mine = list.mine.find((o) => o.id === id);
      if (!mine) return null;
      // A campaign keyword keeps origin `niche`, so quick post routes the product to that campaign.
      return {
        label: mine.label,
        steps: [
          { source: { kind: 'hot', keyword: mine.label }, pages: NICHE_KEYWORD_HOT_PAGES, foundBy: mine.label, origin: 'niche' },
          { source: { kind: 'search', keyword: mine.label }, pages: NICHE_KEYWORD_SEARCH_PAGES, foundBy: mine.label, origin: 'niche' },
        ],
      };
    }
    const cat = list.categories.find((o) => o.id === id);
    if (!cat) return null;
    return {
      label: cat.label,
      steps: [
        { source: { kind: 'hot', category_id: n.value }, pages: NICHE_CATEGORY_HOT_PAGES, foundBy: cat.label, origin: 'hot' },
        { source: { kind: 'search', category_id: n.value }, pages: NICHE_CATEGORY_SEARCH_PAGES, foundBy: cat.label, origin: 'hot' },
      ],
    };
  }

  private nicheKey(userId: string, id: string): string {
    return `commission_scout_niche:${userId}:${id.slice(0, 90)}`;
  }

  /** A niche's last result, and whether a search of it runs now. */
  async nicheResult(userId: string, id: string): Promise<{ result: NicheCatalog | null; running: boolean; next_scan_at: string | null }> {
    const result = await this.memory.load<NicheCatalog>(this.nicheKey(userId, id));
    const last = result ? Date.parse(result.scanned_at) : 0;
    const next = last && Date.now() - last < NICHE_COOLDOWN_MS ? new Date(last + NICHE_COOLDOWN_MS).toISOString() : null;
    return { result, running: this.running.has(`${userId}:${id}`), next_scan_at: next };
  }

  /** Search one niche in the background (about a minute); the screen polls nicheResult. */
  async startNicheScan(userId: string, id: string): Promise<{ started: boolean; reason?: string }> {
    const plan = await this.nicheSteps(userId, id);
    if (!plan) return { started: false, reason: 'הנישה לא נמצאה ברשימה' };
    const runKey = `${userId}:${id}`;
    if (this.running.has(runKey)) return { started: false, reason: 'החיפוש בנישה הזאת כבר רץ' };
    const { next_scan_at } = await this.nicheResult(userId, id);
    if (next_scan_at) return { started: false, reason: 'הנישה נסרקה לפני פחות מ-5 דקות' };
    this.running.add(runKey);
    void this.scanNiche(userId, id, plan.label, plan.steps)
      .catch((err) => this.logger.warn(`niche scan ${id} failed: ${err?.message}`))
      .finally(() => this.running.delete(runKey));
    return { started: true };
  }

  private async scanNiche(userId: string, id: string, label: string, steps: ScanStep[]): Promise<void> {
    const minRate = minCommissionPct();
    const reader = this.makeReader(userId, minRate, NICHE_MAX_CALLS);
    // A niche searched again reads another (sort, depth) slice, so it adds rather than repeats.
    const step = await this.nextStep(`commission_scout_niche_cursor:${userId}:${id.slice(0, 90)}`);
    for (let i = 0; i < steps.length; i++) {
      if (reader.out()) break;
      const st = steps[i];
      const { sort, startPage } = rotationSlice(step, i, st.pages);
      const source = st.source.kind === 'promo' ? st.source : { ...st.source, sort };
      await reader.readPages(source, st.pages, st.foundBy, st.origin, startPage);
    }
    const { calls, scanned, budgetHit } = reader.stats();
    const learning = await this.learning(userId, reader.candidates);
    const posted = await this.publishedRecently(userId);
    const previous = await this.memory.load<NicheCatalog>(this.nicheKey(userId, id));
    const nowIso = new Date().toISOString();
    const ranked = rankCatalog(carryOver(reader.candidates, previous?.items), { minRate, posted: posted.ids, published: posted.set, learning });
    const items = stampSeen(ranked, new Set(reader.candidates.map((c) => String(c.product_id))), previous, nowIso);
    const result: NicheCatalog = {
      niche_id: id, label,
      scanned_at: nowIso,
      scanned, min_rate: minRate, errors: reader.errors.slice(0, 5),
      items, new_count: items.filter((i) => i.is_new).length,
      calls, budget_hit: budgetHit, sources: reader.sources(),
    };
    await this.memory.save(this.nicheKey(userId, id), result, NICHE_TTL_MS);
    this.logger.log(`niche scan ${userId} ${id}: ${calls} calls, ${scanned} scanned, ${result.items.length} ≥ ${minRate}%`);
  }

  /** Remember the picks the owner was actually shown, so they are not recommended again (nor another store's listing of them). */
  async markShown(userId: string, picks: ScoutPick[]): Promise<void> {
    if (!picks.length) return;
    const key = `commission_scout_seen:${userId}`;
    const now = Date.now();
    // Merge, never assign: an empty read must not wipe what is already remembered.
    const seen: Record<string, SeenEntry> = { ...((await this.memory.load<Record<string, SeenEntry>>(key)) || {}) };
    for (const id of Object.keys(seen)) if (now - seenAt(seen[id]) > SEEN_TTL_MS) delete seen[id];
    for (const p of picks) seen[p.product_id] = { at: now, title: p.title?.slice(0, 200), image: p.image_url };
    await this.memory.save(key, seen, SEEN_TTL_MS);
  }

  /** Recommended in the Telegram report in the last 30 days (older entries carry only the time). */
  private async recommendedRecently(userId: string): Promise<ProductLike[]> {
    const now = Date.now();
    const seen = (await this.memory.load<Record<string, SeenEntry>>(`commission_scout_seen:${userId}`)) || {};
    return Object.entries(seen)
      .filter(([, v]) => now - seenAt(v) <= SEEN_TTL_MS)
      .map(([id, v]) => ({ product_id: id, title: typeof v === 'object' ? v.title : undefined, image_url: typeof v === 'object' ? v.image : undefined }));
  }

  /**
   * What the account published in the last 30 days, or has waiting to go out (a failed post
   * does not count), as ids and as a set that also recognises another store's listing of
   * the same item by its photo or title (posts/product-similarity.ts).
   */
  private async publishedRecently(userId: string): Promise<{ ids: Set<string>; set: PublishedProducts; items: ProductLike[] }> {
    const rows = await this.posts.find({
      select: ['product_id', 'product_title', 'product_image'],
      where: { user_id: userId, status: Not('failed' as any), created_at: MoreThan(new Date(Date.now() - POSTED_WINDOW_MS)) },
      order: { created_at: 'DESC' },
      take: 2000,
    }).catch(() => [] as Post[]);
    const items: ProductLike[] = rows.filter((r) => r?.product_id)
      .map((r) => ({ product_id: String(r.product_id), title: r.product_title, image_url: r.product_image }));
    return { ids: new Set(items.map((i) => String(i.product_id))), set: new PublishedProducts(items), items };
  }

  /**
   * What the owner's own results teach the ranking (scout-learning.ts): what his orders of
   * each product really paid, the paid-to-declared ratio per category (remembered across
   * scans in `commission_scout_paid:<user>`, merged), how each keyword's posts did, and
   * which categories and words are his audience's. Every read is bounded, and a failed one
   * only leaves that part neutral.
   */
  private async learning(userId: string, candidates: ScoutCandidate[]): Promise<Learning> {
    const now = Date.now();
    const sold = new Map<string, SoldStats>();
    const orders = await this.safeFind(() => this.earnings!.find({
      select: ['product_id', 'order_amount_usd', 'commission_usd', 'incentive_commission_usd', 'keyword'],
      where: { user_id: userId, status: Not('cancelled' as any), order_date: MoreThan(new Date(now - SOLD_WINDOW_MS)) },
      take: MAX_LEARNING_ROWS,
    }));
    for (const o of orders) {
      const id = String(o.product_id || '');
      if (!id || id === 'unknown') continue;
      const s = sold.get(id) || { orders: 0, amount_usd: 0, paid_usd: 0 };
      s.orders++;
      s.amount_usd += Number(o.order_amount_usd) || 0;
      // The incentive bonus is money the same sale paid him, on top of the commission.
      s.paid_usd += (Number(o.commission_usd) || 0) + (Number(o.incentive_commission_usd) || 0);
      sold.set(id, s);
    }

    const paidKey = `commission_scout_paid:${userId}`;
    const categories = mergeCategoryPaid(
      await this.memory.load<Record<string, CategoryPaid>>(paidKey),
      learnCategoryPaid(dedupe(candidates), sold, now),
      now,
    );
    if (Object.keys(categories).length) await this.memory.save(paidKey, categories, CATEGORY_PAID_TTL_MS);

    const keywords = new Map<string, KeywordStats>();
    const stat = (k: string | null | undefined) => {
      const key = String(k || '').trim().toLowerCase();
      if (!key) return null;
      if (!keywords.has(key)) keywords.set(key, { posts: 0, clicks: 0, orders: 0 });
      return keywords.get(key)!;
    };
    const posts = await this.safeFind(() => this.posts.find({
      select: ['keyword', 'clicks_count', 'product_title'],
      where: { user_id: userId, status: 'sent' as any, created_at: MoreThan(new Date(now - KEYWORD_WINDOW_MS)) },
      take: MAX_LEARNING_ROWS,
    }));
    for (const p of posts) {
      const s = stat(p.keyword);
      if (s) { s.posts++; s.clicks += Number(p.clicks_count) || 0; }
    }
    for (const o of orders) {
      const s = stat(o.keyword);
      if (s) s.orders++;
    }
    const clickedTitles = posts.filter((p) => (Number(p.clicks_count) || 0) > 0 && p.product_title).map((p) => p.product_title);

    return { sold, categories, keywords, profile: relevanceProfile(candidates, clickedTitles) };
  }

  /** This scan's rotation step, and the next one saved (a year: it only has to keep moving). */
  private async nextStep(key: string): Promise<number> {
    const step = Math.max(0, Math.floor(Number(await this.memory.load<number>(key)) || 0));
    await this.memory.save(key, step + 1, 365 * 86_400_000);
    return step;
  }

  /** A bounded read that never fails the scan: an error (or no repository) is an empty answer. */
  private async safeFind<T>(fn: () => Promise<T[]>): Promise<T[]> {
    try {
      return (await fn()) || [];
    } catch {
      return [];
    }
  }
}
