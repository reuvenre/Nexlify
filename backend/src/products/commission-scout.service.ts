import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Not, Repository } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { Post } from '../posts/post.entity';
import { ProductsService, ScoutSource } from './products.service';
import { PersistentValueStore } from '../common/persistent-value.store';
import {
  CatalogItem, HOT_CATEGORY_PAGES, HOT_PAGES, KEYWORD_PAGES, MAX_FAILS_IN_A_ROW, MAX_SCAN_PROMOS, PROMO_PAGES,
  SEEN_TTL_MS, ScoutCandidate, ScoutOrigin, ScoutPick,
  maxScanCalls, minCommissionPct, picksPerReport, rankCatalog, scanKeywords, selectPicks, worthNextPage,
} from './commission-scout';
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
  ) {}

  async scan(userId: string): Promise<ScoutReport> {
    const minRate = minCommissionPct();
    const reader = this.makeReader(userId, minRate, maxScanCalls());
    const { readPages, candidates, errors } = reader;
    const out = reader.out;

    // 1. AliExpress's own promotion lists, highest commission first.
    const promos = (await this.products.featuredPromoNames(userId)).slice(0, MAX_SCAN_PROMOS);
    for (const name of promos) await readPages({ kind: 'promo', name }, PROMO_PAGES, name, 'promo');

    // 2. The hot-products feed, overall.
    await readPages({ kind: 'hot' }, HOT_PAGES, 'כל הקטגוריות', 'hot');

    // 3. The owner's niche: every active campaign's keywords, regular and hot search.
    const active = await this.campaigns.find({ where: { user_id: userId, status: 'active' as any } })
      .catch(() => [] as Campaign[]);
    for (const kw of scanKeywords(active.map((c) => c.keywords || []))) {
      await readPages({ kind: 'search', keyword: kw }, KEYWORD_PAGES, kw, 'niche');
      await readPages({ kind: 'hot', keyword: kw }, KEYWORD_PAGES, kw, 'niche');
    }

    // 4. The hot-products feed per category, from a different category each day.
    const cats = await this.products.getCategories(userId).catch(() => [] as Array<{ id: string; name: string }>);
    const day = Math.floor(Date.now() / 86_400_000);
    for (let i = 0; i < cats.length && !out(); i++) {
      const c = cats[(day + i) % cats.length];
      await readPages({ kind: 'hot', category_id: c.id }, HOT_CATEGORY_PAGES, c.name, 'hot');
    }
    const { calls, scanned, budgetHit } = reader.stats();

    const posted = await this.postedRecently(userId, candidates.map((c) => c.product_id));
    const exclude = new Set([...posted, ...(await this.recommendedRecently(userId))]);
    const { picks, qualified } = selectPicks(candidates, { minRate, exclude, max: picksPerReport() });
    this.logger.log(`commission scout ${userId}: ${calls} calls, ${scanned} scanned, ${qualified} ≥ ${minRate}%, ${picks.length} picked`);

    // A scan that read nothing at all keeps the previous list on the screen, and says why.
    await this.memory.save(`commission_scout_error:${userId}`, scanned > 0 ? null
      : (errors[0] || 'לא נמצא מה לסרוק: אין קמפיין פעיל עם מילות מפתח, ואלי אקספרס לא החזירה רשימות מבצעים'), CATALOG_TTL_MS);
    if (scanned > 0) {
      const catalog: ScoutCatalog = {
        scanned_at: new Date().toISOString(),
        scanned, min_rate: minRate, errors: errors.slice(0, 5),
        items: rankCatalog(candidates, { minRate, posted }),
        calls, budget_hit: budgetHit,
      };
      await this.memory.save(`commission_scout_catalog:${userId}`, catalog, CATALOG_TTL_MS);
    }
    return { picks, qualified, scanned, minRate, errors };
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
    const out = () => calls >= budget || failsInARow >= MAX_FAILS_IN_A_ROW;
    const read = async (source: ScoutSource, page: number, foundBy: string, origin: ScoutOrigin) => {
      if (out()) return { data: [] as any[], sorted: false };
      calls++;
      const res = await this.products.scoutProducts(userId, source, page);
      if (res.error) { errors.push(`${foundBy}: ${res.error}`); failsInARow++; } else failsInARow = 0;
      scanned += res.data.length;
      for (const p of res.data) candidates.push({ ...p, found_by: foundBy, origin });
      await new Promise((r) => setTimeout(r, CALL_GAP_MS));
      return res;
    };
    const readPages = async (source: ScoutSource, pages: number, foundBy: string, origin: ScoutOrigin) => {
      for (let page = 1; page <= pages && !out(); page++) {
        const res = await read(source, page, foundBy, origin);
        if (!worthNextPage(res.data, minRate)) break;
      }
    };
    return { readPages, out, candidates, errors, stats: () => ({ calls, scanned, budgetHit: calls >= budget }) };
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
    for (const st of steps) {
      if (reader.out()) break;
      await reader.readPages(st.source, st.pages, st.foundBy, st.origin);
    }
    const { calls, scanned, budgetHit } = reader.stats();
    const posted = await this.postedRecently(userId, reader.candidates.map((c) => c.product_id));
    const result: NicheCatalog = {
      niche_id: id, label,
      scanned_at: new Date().toISOString(),
      scanned, min_rate: minRate, errors: reader.errors.slice(0, 5),
      items: rankCatalog(reader.candidates, { minRate, posted }),
      calls, budget_hit: budgetHit,
    };
    await this.memory.save(this.nicheKey(userId, id), result, NICHE_TTL_MS);
    this.logger.log(`niche scan ${userId} ${id}: ${calls} calls, ${scanned} scanned, ${result.items.length} ≥ ${minRate}%`);
  }

  /** Remember the picks the owner was actually shown, so they are not recommended again. */
  async markShown(userId: string, picks: ScoutPick[]): Promise<void> {
    if (!picks.length) return;
    const key = `commission_scout_seen:${userId}`;
    const now = Date.now();
    // Merge, never assign: an empty read must not wipe what is already remembered.
    const seen = { ...((await this.memory.load<Record<string, number>>(key)) || {}) };
    for (const id of Object.keys(seen)) if (now - seen[id] > SEEN_TTL_MS) delete seen[id];
    for (const p of picks) seen[p.product_id] = now;
    await this.memory.save(key, seen, SEEN_TTL_MS);
  }

  /** Recommended in the Telegram report in the last 30 days. */
  private async recommendedRecently(userId: string): Promise<string[]> {
    const now = Date.now();
    const seen = (await this.memory.load<Record<string, number>>(`commission_scout_seen:${userId}`)) || {};
    return Object.entries(seen).filter(([, at]) => now - at <= SEEN_TTL_MS).map(([id]) => id);
  }

  /** Posted by the account in the last 30 days (a failed post does not count). */
  private async postedRecently(userId: string, ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    const now = Date.now();
    const unique = [...new Set(ids)].filter(Boolean);
    for (let i = 0; i < unique.length; i += 500) {
      const rows = await this.posts.find({
        select: ['product_id'],
        where: {
          user_id: userId,
          product_id: In(unique.slice(i, i + 500)),
          status: Not('failed' as any),
          created_at: MoreThan(new Date(now - POSTED_WINDOW_MS)),
        },
      }).catch(() => [] as Post[]);
      for (const r of rows) if (r.product_id) out.add(String(r.product_id));
    }
    return out;
  }
}
