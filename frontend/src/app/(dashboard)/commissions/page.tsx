'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Gem, RefreshCw, Loader2, Star, ExternalLink, Sparkles, Target, Tag, CheckCircle2,
  ChevronLeft, ChevronRight, Search, AlertTriangle, TrendingUp, DollarSign, Layers, Flame, Send,
} from 'lucide-react';
import { commissionScoutApi } from '@/lib/api-client';
import { readCommissionPosted } from '@/lib/commissions-return';
import type { ScoutCatalogResponse, ScoutFunnel, ScoutItem, ScoutNicheList, ScoutNicheResponse, ScoutSourceStat } from '@/types';

/**
 * Products that pay a high commission (the commission scout, backend products/commission-scout.ts).
 *
 * A scan reads about a minute of AliExpress API calls, so the screen shows the last one and
 * can start a new one in the background (polled every 5 s). The rate is what the affiliate API
 * declares; the screen says so. Ranking is the scout's own: what a sale pays × how much the
 * product sells × its rating, with the owner's own keywords ahead. Every card hands the
 * product to the quick-post review, the same way the products screen's «צור פוסט» does.
 */

type SortKey = 'smart' | 'rate' | 'earn' | 'sold';

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'smart', label: 'המלצה חכמה', hint: 'כמה מכירה משלמת × כמה נמכר × דירוג' },
  { key: 'earn', label: 'רווח למכירה', hint: 'כמה דולר תקבל ממכירה אחת' },
  { key: 'rate', label: 'אחוז עמלה', hint: 'האחוז הגבוה ביותר קודם' },
  { key: 'sold', label: 'הכי נמכר', hint: 'הכי הרבה מכירות לאחרונה' },
];

const RATE_STEPS = [12, 20, 30, 50, 70, 90];
/** The grid shows this many at a time («טען עוד»), so 2,000 products do not render at once. */
const GRID_PAGE = 60;
/** A shelf carries this many cards; «הצג את כל» opens the rest. */
const SHELF_SIZE = 24;
/** «עמלות ענק»: the shelf for the boosted rates. */
const HUGE_RATE = 50;

/**
 * Where the owner was when he opened a product («צור פוסט»): filters, the niche, the scroll
 * and the card itself. Quick post's «חזרה» and the phone's back button land right back there
 * instead of on a fresh screen he has to search again.
 */
const VIEW_KEY = 'commissions_view';
const VIEW_TTL_MS = 60 * 60_000;

interface SavedView {
  at: number;
  category: string;
  sort: SortKey;
  minRate: number;
  nicheOnly: boolean;
  hidePosted: boolean;
  query: string;
  nicheId: string;
  nicheActive: boolean;
  shown: number;
  scrollY: number;
  /** `<shelf>:<product_id>` of the card he opened. */
  card: string;
}

function readView(): SavedView | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
    return v && Date.now() - Number(v.at) < VIEW_TTL_MS ? v : null;
  } catch {
    return null;
  }
}

/** The filters a «טען עוד» count belongs to. */
function filterKey(v: Pick<SavedView, 'category' | 'sort' | 'minRate' | 'nicheOnly' | 'hidePosted' | 'query'>): string {
  return JSON.stringify([v.category, v.sort, v.minRate, v.nicheOnly, v.hidePosted, v.query]);
}

const SYMBOLS: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };

function money(n: number, currency: string): string {
  const s = SYMBOLS[(currency || '').toUpperCase()];
  const v = (Number(n) || 0).toFixed(2).replace(/\.00$/, '');
  return s ? `${s}${v}` : `${v} ${currency}`;
}

/** 18,342 → "18K+", 940 → "940". */
function sold(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)}K+`;
  return String(n);
}

function rateLabel(r: number): string {
  return Number.isInteger(r) ? `${r}%` : `${r.toFixed(1)}%`;
}

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 1) return 'עכשיו';
  if (min < 60) return `לפני ${min} דק׳`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'לפני שעה' : `לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
}

function sortItems(items: ScoutItem[], key: SortKey): ScoutItem[] {
  const by: Record<SortKey, (a: ScoutItem, b: ScoutItem) => number> = {
    smart: (a, b) => b.score - a.score,
    earn: (a, b) => b.earn_per_sale_usd - a.earn_per_sale_usd,
    rate: (a, b) => b.commission_rate - a.commission_rate || b.score - a.score,
    sold: (a, b) => b.orders_count - a.orders_count,
  };
  return [...items].sort(by[key]);
}

export default function CommissionsPage() {
  const router = useRouter();
  const [data, setData] = useState<ScoutCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('smart');
  const [minRate, setMinRate] = useState(12);
  const [nicheOnly, setNicheOnly] = useState(false);
  const [hidePosted, setHidePosted] = useState(false);
  const [query, setQuery] = useState('');
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search by niche: one niche from the list, searched on its own (backend scout-niches.ts).
  const [niches, setNiches] = useState<ScoutNicheList | null>(null);
  const [nicheId, setNicheId] = useState('');
  const [niche, setNiche] = useState<ScoutNicheResponse | null>(null);
  /** The niche's results replace the daily list until the owner goes back. */
  const [nicheActive, setNicheActive] = useState(false);
  const nichePoll = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    commissionScoutApi.niches().then(setNiches).catch(() => {});
    return () => { if (nichePoll.current) clearTimeout(nichePoll.current); };
  }, []);

  const loadNiche = useCallback(async (id: string, activate = true) => {
    if (nichePoll.current) clearTimeout(nichePoll.current);
    try {
      const res = await commissionScoutApi.niche(id);
      setNiche(res);
      if (res.result && activate) setNicheActive(true);
      if (res.running) nichePoll.current = setTimeout(() => loadNiche(id), 5000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'טעינת הנישה נכשלה');
    }
  }, []);

  const pickNiche = (id: string) => {
    setNicheId(id);
    setNiche(null);
    setNicheActive(false);
    if (id) void loadNiche(id);
  };

  const searchNiche = async () => {
    if (!nicheId) return;
    setNotice('');
    try {
      const res = await commissionScoutApi.nicheScan(nicheId);
      if (!res.started) setNotice(res.reason || 'לא ניתן לחפש כרגע');
      await loadNiche(nicheId);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'החיפוש לא התחיל');
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await commissionScoutApi.catalog();
      setData(res);
      setError('');
      if (poll.current) clearTimeout(poll.current);
      // While a scan runs, keep checking until its list arrives.
      if (res.running) poll.current = setTimeout(load, 5000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'טעינת הרשימה נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => { if (poll.current) clearTimeout(poll.current); };
  }, [load]);

  const scan = async () => {
    setNotice('');
    try {
      const res = await commissionScoutApi.scan();
      if (!res.started) setNotice(res.reason || 'לא ניתן לסרוק כרגע');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הסריקה לא התחילה');
    }
  };

  // ── Coming back from quick post: put the screen back the way he left it.
  const restore = useRef<SavedView | null>(null);
  const [posted, setPosted] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState('');
  useEffect(() => {
    setPosted(readCommissionPosted());
    const v = readView();
    if (!v) return;
    restore.current = v;
    setCategory(String(v.category || ''));
    setSort(SORTS.some((s) => s.key === v.sort) ? v.sort : 'smart');
    setMinRate(RATE_STEPS.includes(v.minRate) ? v.minRate : 12);
    setNicheOnly(!!v.nicheOnly);
    setHidePosted(!!v.hidePosted);
    setQuery(String(v.query || ''));
    setShown({ key: filterKey(v), n: Math.max(GRID_PAGE, Number(v.shown) || GRID_PAGE) });
    if (v.nicheId) {
      setNicheId(v.nicheId);
      void loadNiche(v.nicheId, !!v.nicheActive);
    }
  }, [loadNiche]);

  const catalog = data?.catalog || null;
  const nicheItems = niche?.result?.items;
  const all = useMemo(() => {
    const items = nicheActive && nicheItems ? nicheItems : catalog?.items || [];
    return posted.size ? items.map((it) => (posted.has(it.product_id) ? { ...it, posted_recently: true } : it)) : items;
  }, [catalog, nicheActive, nicheItems, posted]);

  /** Categories by how many products they hold, for the chips and the shelves. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of all) {
      const c = it.category || 'אחר';
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortItems(all.filter((it) =>
      it.commission_rate >= minRate
      && (!category || (it.category || 'אחר') === category)
      // His niche: found by his own keyword, or in the categories and words his channels live on.
      && (!nicheOnly || it.origin === 'niche' || it.relevant === true)
      && (!hidePosted || !it.posted_recently)
      && (!q || it.title.toLowerCase().includes(q) || (it.found_by || '').toLowerCase().includes(q)),
    ), sort);
  }, [all, minRate, category, nicheOnly, hidePosted, query, sort]);

  const stats = useMemo(() => {
    if (!all.length) return null;
    const top = all.reduce((m, it) => Math.max(m, it.commission_rate), 0);
    const bestEarn = all.reduce((m, it) => Math.max(m, it.earn_per_sale_usd), 0);
    const huge = all.filter((it) => it.commission_rate >= HUGE_RATE).length;
    return { count: all.length, top, bestEarn, huge };
  }, [all]);

  /** The agent's shelf: products for his audience first; the rest only when there are none. */
  const agentPicks = useMemo(() => {
    const mine = filtered.filter((it) => it.relevant !== false);
    return (mine.length ? mine : filtered).slice(0, SHELF_SIZE);
  }, [filtered]);

  /** The boosted rates, highest first: the shelf the owner asked for. */
  const huge = useMemo(() => sortItems(filtered.filter((it) => it.commission_rate >= HUGE_RATE), 'rate'), [filtered]);

  // «טען עוד» counts for one set of filters; any other set starts from the first page again.
  const currentKey = filterKey({ category, sort, minRate, nicheOnly, hidePosted, query });
  const [shown, setShown] = useState({ key: '', n: GRID_PAGE });
  const shownN = shown.key === currentKey ? shown.n : GRID_PAGE;

  // The shelves view (like a storefront) is the default; any filter switches to one grid.
  const browsing = !category && !query.trim() && !nicheOnly && !hidePosted && minRate === 12 && sort === 'smart';

  // Once the list he left is on screen again: his scroll, then the card he opened, lit briefly.
  useEffect(() => {
    const v = restore.current;
    if (!v || loading) return;
    if (v.nicheId && !niche) return; // the niche's list is still loading
    restore.current = null;
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...v, scrollY: 0, card: '' })); } catch { /* storage blocked */ }
    requestAnimationFrame(() => {
      window.scrollTo(0, Number(v.scrollY) || 0);
      const el = v.card ? document.querySelector<HTMLElement>(`[data-card="${CSS.escape(v.card)}"]`) : null;
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', inline: 'center' });
      setHighlight(v.card);
      setTimeout(() => setHighlight(''), 2200);
    });
  }, [loading, niche]);

  const createPost = (it: ScoutItem, card: string) => {
    const view: SavedView = {
      at: Date.now(), category, sort, minRate, nicheOnly, hidePosted, query,
      nicheId, nicheActive, shown: shownN, scrollY: Math.round(window.scrollY), card,
    };
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* storage blocked */ }
    sessionStorage.setItem('quick_post_catalog_product', JSON.stringify({
      product_id: it.product_id, title: it.title,
      original_price: it.original_price, sale_price: it.sale_price, discount_percent: it.discount_percent,
      image_url: it.image_url, product_url: it.product_url, affiliate_url: it.affiliate_url,
      category: it.category, orders_count: it.orders_count, rating: it.rating, currency: it.currency,
      // The campaign keyword that found it: quick post places the product in that campaign's group.
      route_keyword: it.origin === 'niche' ? it.found_by : undefined,
    }));
    router.push('/quick-post?from_catalog=1&back=commissions');
  };

  const running = !!data?.running;
  const cooling = !!data?.next_scan_at && !running;

  return (
    <div className="space-y-6" dir="rtl">
      <Hero
        stats={stats}
        catalog={catalog}
        running={running}
        cooling={cooling}
        nextScanAt={data?.next_scan_at || null}
        onScan={scan}
      />

      {data?.last_error && !running && (
        <div className="card px-4 py-3 text-sm text-amber-300 flex items-center gap-2" role="status">
          <AlertTriangle size={16} aria-hidden="true" /> הסריקה האחרונה לא קראה מוצרים: {data.last_error}
        </div>
      )}
      {notice && (
        <div className="card px-4 py-3 text-sm text-amber-300 flex items-center gap-2" role="status">
          <AlertTriangle size={16} aria-hidden="true" /> {notice}
        </div>
      )}
      {error && (
        <div className="card px-4 py-3 text-sm text-red-400 flex items-center gap-2" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /> {error}
        </div>
      )}

      <NichePicker
        list={niches}
        value={nicheId}
        onPick={pickNiche}
        onSearch={searchNiche}
        state={niche}
        active={nicheActive}
        onBack={() => setNicheActive(false)}
        onShow={() => setNicheActive(true)}
      />

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-white/50" aria-label="טוען" /></div>
      ) : !catalog && !nicheActive ? (
        <EmptyState running={running} onScan={scan} />
      ) : (
        <>
          <ScanBreakdown
            sources={(nicheActive ? niche?.result?.sources : catalog?.sources) || []}
            funnel={nicheActive ? undefined : catalog?.funnel}
            minRate={(nicheActive ? niche?.result?.min_rate : catalog?.min_rate) ?? 12}
            calls={(nicheActive ? niche?.result?.calls : catalog?.calls) ?? 0}
          />

          <Toolbar
            categories={categories}
            category={category} setCategory={setCategory}
            sort={sort} setSort={setSort}
            minRate={minRate} setMinRate={setMinRate}
            nicheOnly={nicheOnly} setNicheOnly={setNicheOnly}
            hidePosted={hidePosted} setHidePosted={setHidePosted}
            query={query} setQuery={setQuery}
            total={all.length}
          />

          {browsing ? (
            <div className="space-y-8">
              <Shelf
                id="huge"
                highlight={highlight}
                title={`עמלות ענק: ${HUGE_RATE}% ומעלה`}
                subtitle={`${huge.length} מוצרים, העמלה הגבוהה ביותר קודם`}
                icon={Flame}
                items={huge.slice(0, SHELF_SIZE)}
                onAll={huge.length > SHELF_SIZE ? () => { setMinRate(HUGE_RATE); setSort('rate'); } : undefined}
                allCount={huge.length}
                onPost={createPost}
              />
              <Shelf
                id="top"
                highlight={highlight}
                title="ההמלצות של הסוכן"
                subtitle="המוצרים שהכי שווה לפרסם עכשיו: הרבה כסף לכל מכירה, מוצר שנמכר ודירוג גבוה"
                icon={Sparkles}
                items={agentPicks}
                ranked
                onPost={createPost}
              />
              {categories.slice(0, 12).map(([cat, n]) => (
                <Shelf
                  key={cat}
                  id={`cat-${cat}`}
                  highlight={highlight}
                  title={cat}
                  subtitle={`${n} מוצרים בקטגוריה`}
                  icon={Layers}
                  items={filtered.filter((it) => (it.category || 'אחר') === cat).slice(0, SHELF_SIZE)}
                  onAll={n > SHELF_SIZE ? () => setCategory(cat) : undefined}
                  allCount={n}
                  onPost={createPost}
                />
              ))}
            </div>
          ) : (
            <section aria-label="תוצאות">
              <p className="text-sm text-white/60 mb-3" role="status">{filtered.length} מוצרים</p>
              {filtered.length ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                    {filtered.slice(0, shownN).map((it) => {
                      const card = `grid:${it.product_id}`;
                      return (
                        <div key={it.product_id} data-card={card} className={cardHighlight(highlight === card)}>
                          <ProductCard item={it} onPost={(x) => createPost(x, card)} />
                        </div>
                      );
                    })}
                  </div>
                  {shownN < filtered.length && (
                    <div className="flex justify-center pt-5">
                      <button type="button" onClick={() => setShown({ key: currentKey, n: shownN + GRID_PAGE })} className="btn btn-ghost">
                        טען עוד ({(filtered.length - shownN).toLocaleString('en-US')} נוספים)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="card p-10 text-center text-sm text-white/60">אין מוצרים שמתאימים לסינון הזה.</div>
              )}
            </section>
          )}

          <p className="text-xs text-white/50 leading-relaxed">
            אחוז העמלה הוא מה שאלי אקספרס מצהירה ב-API לשותפים. בפועל העמלה יכולה להיות נמוכה יותר (תקרות לפי קטגוריה, לקוח חדש מול חוזר), ולכן כשההזמנות שלך מראות כמה שולם בפועל, הדירוג והרווח למכירה מחושבים לפיהן.
            הסוכן סורק את רשימות המבצעים של אלי אקספרס, את פיד המוצרים החמים (שם נמצאות עמלות של 50–90%) בכל הקטגוריות ואת מילות המפתח של הקמפיינים הפעילים שלך, 50 מוצרים בכל קריאה. כל בוקר וגם כשתלחץ «סרוק עכשיו».
            {!nicheActive && catalog?.budget_hit && ' הסריקה האחרונה עצרה במכסת הקריאות שלה, והבאה תתחיל מקטגוריות אחרות.'}
          </p>
        </>
      )}
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────

/** White on the gradient in both themes: the light theme remaps `text-white`, so it is set inline. */
const ON_HERO = { color: '#fff' } as const;
const HERO_TILE = { background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.18)' } as const;

function Hero({ stats, catalog, running, cooling, nextScanAt, onScan }: {
  stats: { count: number; top: number; bestEarn: number; huge: number } | null;
  catalog: ScoutCatalogResponse['catalog'];
  running: boolean;
  cooling: boolean;
  nextScanAt: string | null;
  onScan: () => void;
}) {
  const tiles = stats ? [
    { value: String(stats.count), label: 'מוצרים מעל הסף', icon: Gem },
    { value: rateLabel(stats.top), label: 'העמלה הגבוהה ביותר', icon: TrendingUp },
    { value: String(stats.huge), label: `עמלה של ${HUGE_RATE}%+`, icon: Flame },
    { value: `$${stats.bestEarn.toFixed(2)}`, label: 'הכי הרבה למכירה', icon: DollarSign },
  ] : [];
  const waitMin = nextScanAt ? Math.max(1, Math.ceil((Date.parse(nextScanAt) - Date.now()) / 60_000)) : 0;

  return (
    <section
      className="relative overflow-hidden rounded-2xl p-5 sm:p-8"
      style={{ background: 'linear-gradient(120deg, #065f46 0%, #0f766e 45%, #1e40af 100%)', boxShadow: 'var(--shadow-elevated)' }}
      aria-labelledby="commissions-title"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-24 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.16), transparent 70%)' }} />
      <div className="relative flex flex-col lg:flex-row lg:items-end gap-6 lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-semibold tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <Gem size={14} aria-hidden="true" /> סוכן העמלות
          </p>
          <h1 id="commissions-title" className="text-xl sm:text-3xl font-bold leading-tight mb-2" style={ON_HERO}>
            מוצרים עם עמלה גבוהה, מדורגים לפי מה שבאמת ישתלם לך
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.88)' }}>
            כל המוצרים עם {catalog?.min_rate ?? 12}% עמלה ומעלה, עד 90%. הדירוג לא מסתפק באחוז: הוא שוקל כמה מכירה משלמת, כמה המוצר נמכר והדירוג שלו, כי מוצר ב-15% שאף אחד לא קונה שווה פחות ממוצר ב-12% שנמכר באלפים.
          </p>
          {/* Before the first scan the empty state below carries the one button. */}
          {catalog && <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onScan}
              disabled={running || cooling}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: '#fff', color: '#064e3b' }}
            >
              {running ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {running ? 'סורק… (כמה דקות)' : cooling ? `אפשר לסרוק שוב בעוד ${waitMin} דק׳` : 'סרוק עכשיו'}
            </button>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
              נסרק {ago(catalog.scanned_at)} · {catalog.scanned.toLocaleString('en-US')} מוצרים נבדקו
            </span>
          </div>}
        </div>

        {tiles.length > 0 && (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 lg:min-w-[440px]">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl px-3 py-3 text-center" style={HERO_TILE}>
                <dd className="text-xl sm:text-2xl font-bold tabular-nums" style={ON_HERO}>{t.value}</dd>
                <dt className="text-[11px] mt-0.5 flex items-center justify-center gap-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  <t.icon size={11} aria-hidden="true" /> {t.label}
                </dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}

// ── What the scan found ──────────────────────────────────────────────────────

const SOURCE_LABELS: Record<ScoutSourceStat['group'], string> = {
  promo: 'רשימות המבצעים של אלי אקספרס',
  hot: 'המוצרים החמים',
  keywords: 'מילות המפתח שלך',
  categories: 'הקטגוריות',
};

/**
 * Where the products came from and where they fell out: the answer to "why so few". Closed
 * by default, so it costs the screen one line.
 */
function ScanBreakdown({ sources, funnel, minRate, calls }: { sources: ScoutSourceStat[]; funnel?: ScoutFunnel; minRate: number; calls: number }) {
  if (!sources.length && !funnel) return null;
  const failed = sources.reduce((n, s) => n + s.errors, 0);
  const steps = funnel ? [
    { n: funnel.unique, label: 'מוצרים שונים נמצאו' },
    { n: funnel.at_bar, label: `מעל ${minRate}% לפי מה שאלי אקספרס מצהירה` },
    { n: -funnel.pays_less, label: 'משלמים לך בפועל פחות מהסף (לפי ההזמנות שלך)' },
    { n: -funnel.already, label: 'כבר פורסמו או הומלצו ב-30 הימים האחרונים' },
    { n: -funnel.off_niche, label: 'מחוץ לנישה של הערוצים שלך (נכנסים לדוח רק אם חסר)' },
    { n: -funnel.floors, label: 'מעט מדי מכירות או דירוג נמוך' },
  ].filter((s) => s.n !== 0) : [];
  return (
    <details className="card px-4 py-3 group/scan">
      <summary className="cursor-pointer select-none text-sm font-medium flex items-center gap-2 list-none">
        <Layers size={15} className="text-emerald-400 shrink-0" aria-hidden="true" />
        מה הסריקה מצאה
        <span className="text-xs text-white/55 font-normal">
          {calls ? `${calls} קריאות` : ''}{failed ? ` · ${failed} נכשלו` : ''}
        </span>
        <ChevronLeft size={14} className="ms-auto text-white/50 transition group-open/scan:-rotate-90" aria-hidden="true" />
      </summary>

      {sources.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/55 text-right">
                <th scope="col" className="font-medium py-1.5 pe-2">מקור</th>
                <th scope="col" className="font-medium py-1.5 px-2 tabular-nums">קריאות</th>
                <th scope="col" className="font-medium py-1.5 px-2 tabular-nums">מוצרים</th>
                <th scope="col" className="font-medium py-1.5 px-2 tabular-nums">מעל {minRate}%</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.group} className="border-t border-[var(--border)]">
                  <th scope="row" className="font-normal text-right py-1.5 pe-2">
                    {SOURCE_LABELS[s.group]}
                    {s.errors > 0 && (
                      <span className="block text-[11px] text-amber-300" title={s.error}>
                        {s.errors === s.calls ? 'כל החיפושים נכשלו' : `${s.errors} חיפושים נכשלו`}{s.error ? `: ${s.error}` : ''}
                      </span>
                    )}
                  </th>
                  <td className="py-1.5 px-2 tabular-nums">{s.calls}</td>
                  <td className="py-1.5 px-2 tabular-nums">{s.read.toLocaleString('en-US')}</td>
                  <td className="py-1.5 px-2 tabular-nums font-semibold">{s.at_bar.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-white/60 mb-1.5">ההמלצות היומיות בטלגרם: איפה מוצרים נופלים בדרך</p>
          <ul className="space-y-1 text-xs">
            {steps.map((s) => (
              <li key={s.label} className="flex items-baseline gap-2">
                <span className={`tabular-nums font-semibold min-w-[3.5rem] ${s.n < 0 ? 'text-white/60' : ''}`}>
                  <bdi dir="ltr">{s.n < 0 ? `−${(-s.n).toLocaleString('en-US')}` : s.n.toLocaleString('en-US')}</bdi>
                </span>
                <span className="text-white/75">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium border transition ${
        active
          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
          : 'border-[var(--border-hover)] text-white/70 hover:bg-white/5 hover:text-white/90'
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar(p: {
  categories: [string, number][];
  category: string; setCategory: (c: string) => void;
  sort: SortKey; setSort: (s: SortKey) => void;
  minRate: number; setMinRate: (n: number) => void;
  nicheOnly: boolean; setNicheOnly: (b: boolean) => void;
  hidePosted: boolean; setHidePosted: (b: boolean) => void;
  query: string; setQuery: (q: string) => void;
  total: number;
}) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50" aria-hidden="true" />
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.setQuery(e.target.value)}
            placeholder="חפש בכותרות או במילת המפתח שמצאה את המוצר"
            aria-label="חיפוש מוצרים"
            className="input !pr-9"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-white/70 shrink-0">
          <span>מיון</span>
          <select
            value={p.sort}
            onChange={(e) => p.setSort(e.target.value as SortKey)}
            className="input !w-auto !py-1.5"
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-white/60 ml-1">עמלה מינימלית</span>
        {RATE_STEPS.map((r) => (
          <Chip key={r} active={p.minRate === r} onClick={() => p.setMinRate(r)}>{r}%+</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10 hidden sm:block" aria-hidden="true" />
        <Chip active={p.nicheOnly} onClick={() => p.setNicheOnly(!p.nicheOnly)}>
          <span className="inline-flex items-center gap-1"><Target size={12} aria-hidden="true" /> רק מהנישה שלי</span>
        </Chip>
        <Chip active={p.hidePosted} onClick={() => p.setHidePosted(!p.hidePosted)}>הסתר מה שכבר פרסמתי</Chip>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="קטגוריות">
        <Chip active={!p.category} onClick={() => p.setCategory('')}>הכל · {p.total}</Chip>
        {p.categories.map(([c, n]) => (
          <Chip key={c} active={p.category === c} onClick={() => p.setCategory(p.category === c ? '' : c)}>
            {c} · {n}
          </Chip>
        ))}
      </div>
    </div>
  );
}

// ── Shelf (a horizontal row, like a storefront) ──────────────────────────────

/** The card he came back to, lit for a moment so the eye finds it. */
function cardHighlight(on: boolean): string {
  return `h-full rounded-2xl transition-shadow duration-500 ${on ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-[var(--bg-primary)]' : ''}`;
}

function Shelf({ id, highlight, title, subtitle, icon: Icon, items, ranked, onAll, allCount, onPost }: {
  id: string;
  highlight: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  items: ScoutItem[];
  ranked?: boolean;
  onAll?: () => void;
  allCount?: number;
  onPost: (it: ScoutItem, card: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  // RTL: the row starts at the right, so "next" scrolls toward the left (negative).
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: -dir * row.current.clientWidth * 0.85, behavior: 'smooth' });

  return (
    <section aria-label={title}>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
            <Icon size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
            <span className="sm:truncate">{title}</span>
          </h2>
          <p className="text-xs text-white/60 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onAll && (
            <button type="button" onClick={onAll} className="text-xs font-medium text-emerald-300 hover:underline sm:ml-2 whitespace-nowrap">
              הצג את כל ה-{allCount}
            </button>
          )}
          {/* A wrapper hides them on phones (a swipe scrolls there): `.btn` sets its own display. */}
          <div className="hidden sm:flex items-center gap-1.5">
            <button type="button" onClick={() => scroll(-1)} className="btn btn-ghost btn-xs" aria-label={`הקודם ב${title}`}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scroll(1)} className="btn btn-ghost btn-xs" aria-label={`הבא ב${title}`}>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      {/* `relative` is load-bearing: the cards' sr-only text is absolutely positioned, and
          without a positioned scroller its containing block is outside the row, so nothing
          clips it. In RTL every shelf then leaked its whole scroll width into the page
          (4,162 px on a 390 px phone) and the phone zoomed the screen out to a quarter. */}
      <div ref={row} className="relative flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory py-1.5 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
        {items.map((it, i) => {
          const card = `${id}:${it.product_id}`;
          return (
            <div key={it.product_id} data-card={card} className={`snap-start shrink-0 w-[46%] sm:w-[228px] ${cardHighlight(highlight === card)}`}>
              <ProductCard item={it} rank={ranked ? i + 1 : undefined} onPost={(x) => onPost(x, card)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Product card ─────────────────────────────────────────────────────────────

/**
 * Three tiers by rate, so the eye sorts a shelf before reading a number. Solid fills with
 * white text (contrast ≥ 4.5 in both themes; `text-white` is remapped in the light theme).
 */
function rateTier(r: number): { fill: string; bar: string; label: string } {
  if (r >= HUGE_RATE) return { fill: 'linear-gradient(135deg, #c2410c, #b91c1c)', bar: '#f97316', label: 'עמלת ענק' };
  if (r >= 30) return { fill: 'linear-gradient(135deg, #6d28d9, #4338ca)', bar: '#8b5cf6', label: 'עמלה גבוהה' };
  return { fill: 'linear-gradient(135deg, #047857, #0f766e)', bar: '#10b981', label: 'עמלה' };
}

/** The top rate the API quotes; the bar under the badge is measured against it. */
const RATE_CEILING = 90;

function ProductCard({ item: it, rank, onPost }: { item: ScoutItem; rank?: number; onPost: (it: ScoutItem) => void }) {
  const hasDiscount = it.discount_percent > 0 && it.original_price > it.sale_price;
  const link = it.affiliate_url || it.product_url;
  const tier = rateTier(it.commission_rate);
  const OriginIcon = it.origin === 'niche' ? Target : it.origin === 'hot' ? Flame : Tag;
  const origin = it.origin === 'niche' ? 'מילת המפתח' : it.origin === 'hot' ? 'מוצרים חמים' : 'מבצע';
  return (
    // `relative` keeps the sr-only text inside the card (see the shelf row).
    <article className="card relative h-full flex flex-col overflow-hidden group transition duration-200 hover:-translate-y-0.5 hover:border-[var(--border-hover)] hover:shadow-lg">
      <div className="relative aspect-square overflow-hidden bg-white">
        {it.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
        ) : (
          <div className="h-full w-full flex items-center justify-center" style={{ color: '#94a3b8' }}><Tag size={28} aria-hidden="true" /></div>
        )}
        {/* The commission is the point of this screen: it gets the strongest badge. */}
        <span
          className="absolute top-2 right-2 rounded-xl px-2.5 py-1 shadow-lg leading-none text-center"
          style={{ background: tier.fill, color: '#fff' }}
        >
          <span className="block text-[15px] font-extrabold tabular-nums">{rateLabel(it.commission_rate)}</span>
          <span className="block text-[9px] font-semibold mt-0.5 opacity-90">{tier.label}</span>
        </span>
        {hasDiscount && (
          <span className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold shadow" style={{ background: '#dc2626', color: '#fff' }}>
            {it.discount_percent}%-
          </span>
        )}
        {(rank !== undefined || it.posted_recently) && (
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 px-2 pb-2 pt-6" style={{ background: 'linear-gradient(to top, rgba(15,17,23,0.72), transparent)' }}>
            {rank !== undefined
              ? <span className="text-[11px] font-bold" style={{ color: '#fff' }}>#{rank} בהמלצות</span>
              : <span />}
            {it.posted_recently && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold inline-flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.92)', color: '#0f1117' }}>
                <CheckCircle2 size={11} aria-hidden="true" /> פורסם
              </span>
            )}
          </div>
        )}
      </div>

      {/* How far up the scale the rate sits, out of the 90% the API tops out at. */}
      <div className="h-1 w-full" style={{ background: 'var(--bg-tertiary)' }} aria-hidden="true">
        <div className="h-full" style={{ width: `${Math.min(100, (it.commission_rate / RATE_CEILING) * 100)}%`, background: tier.bar }} />
      </div>

      <div className="flex-1 flex flex-col p-3 gap-2">
        <h3 className="text-[13px] leading-snug line-clamp-2 min-h-[2.5em] font-medium" title={it.title} dir="auto">{it.title}</h3>

        <div className="flex items-baseline justify-between gap-1.5 flex-wrap">
          <span className="flex items-baseline gap-1.5">
            <span className="text-base font-bold tabular-nums">{money(it.sale_price, it.currency)}</span>
            {hasDiscount && (
              <del className="text-[11px] text-white/50 tabular-nums">
                <span className="sr-only">במקום </span>{money(it.original_price, it.currency)}
              </del>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-white/60">
            {it.rating > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Star size={11} className="text-amber-400 fill-amber-400" aria-hidden="true" />
                <span className="sr-only">דירוג </span>{it.rating}
              </span>
            )}
            <span>{sold(it.orders_count)} נמכרו</span>
          </span>
        </div>

        {it.paid_basis && it.effective_rate !== undefined && (
          <p className="text-[11px] text-amber-300 leading-snug" title="לפי ההזמנות שלך ב-90 הימים האחרונים">
            בפועל שולם לך כ-{rateLabel(it.effective_rate)} {it.paid_basis === 'product' ? 'על המוצר הזה' : 'בקטגוריה הזו'}
          </p>
        )}

        {/* What one sale pays: the number the owner decides by (at the paid rate when his orders know it). */}
        <div className="rounded-xl px-2.5 py-2 bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between gap-1 whitespace-nowrap">
          <span className="text-[11px] text-emerald-300 font-medium">רווח למכירה</span>
          {/* bdi: a dollar figure inside Hebrew otherwise renders as "$4.50-כ". */}
          <span className="text-sm font-extrabold tabular-nums text-emerald-300">כ-<bdi dir="ltr">${it.earn_per_sale_usd.toFixed(2)}</bdi></span>
        </div>

        <p className="text-[11px] text-white/55 flex items-center gap-1 min-w-0" title={`${origin}: ${it.found_by}`}>
          <OriginIcon size={11} className="shrink-0" aria-hidden="true" />
          <span className="shrink-0">{origin}:</span>
          <bdi dir="auto" className="truncate min-w-0">{it.found_by}</bdi>
        </p>

        <div className="mt-auto flex gap-1.5">
          <button type="button" onClick={() => onPost(it)} className="btn btn-primary btn-sm flex-1">
            <Send size={13} aria-hidden="true" /> צור פוסט
          </button>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm !px-2"
              aria-label={`פתח באלי אקספרס: ${it.title}`}
            >
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ running, onScan }: { running: boolean; onScan: () => void }) {
  return (
    <div className="card p-10 text-center max-w-xl mx-auto">
      <Gem size={36} className="mx-auto text-emerald-400 mb-3" aria-hidden="true" />
      <h2 className="text-lg font-semibold mb-1">עוד לא נסרק</h2>
      <p className="text-sm text-white/60 mb-5">
        הסוכן סורק את רשימות המבצעים של אלי אקספרס ואת מילות המפתח של הקמפיינים שלך, ומביא את המוצרים עם עמלה של 12% ומעלה, כולל העמלות של 50–90%. הסריקה לוקחת כמה דקות.
      </p>
      <button type="button" onClick={onScan} disabled={running} className="btn btn-primary">
        {running ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
        {running ? 'סורק…' : 'סרוק עכשיו'}
      </button>
    </div>
  );
}

// ── Niche picker ─────────────────────────────────────────────────────────────

/** Pick a niche from the list and search its high-commission products on their own. */
function NichePicker({ list, value, onPick, onSearch, state, active, onBack, onShow }: {
  list: ScoutNicheList | null;
  value: string;
  onPick: (id: string) => void;
  onSearch: () => void;
  state: ScoutNicheResponse | null;
  active: boolean;
  onBack: () => void;
  onShow: () => void;
}) {
  const running = !!state?.running;
  const result = state?.result || null;
  const cooling = !!state?.next_scan_at && !running;
  return (
    <section className="card p-4" aria-labelledby="niche-title">
      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <div className="flex-1 min-w-0">
          <h2 id="niche-title" className="text-sm font-semibold flex items-center gap-1.5 mb-1">
            <Target size={15} className="text-emerald-400" aria-hidden="true" /> חיפוש לפי נישה
          </h2>
          <p className="text-xs text-white/60 mb-2">בחר נישה מהרשימה, והסוכן יחפש רק בה מוצרים עם עמלה גבוהה, לעומק (כדקה).</p>
          <select
            value={value}
            onChange={(e) => onPick(e.target.value)}
            className="input"
            aria-label="נישה"
            disabled={!list}
          >
            <option value="">{list ? 'בחר נישה…' : 'טוען את הרשימה…'}</option>
            {!!list?.mine.length && (
              <optgroup label="הנישות שלי (מילות המפתח של הקמפיינים)">
                {list.mine.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </optgroup>
            )}
            {!!list?.presets.length && (
              <optgroup label="נישות פופולריות">
                {list.presets.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </optgroup>
            )}
            {!!list?.categories.length && (
              <optgroup label="קטגוריות של אלי אקספרס">
                {list.categories.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <button type="button" onClick={onSearch} disabled={!value || running || cooling} className="btn btn-primary shrink-0">
          {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
          {running ? 'מחפש בנישה…' : result ? 'חפש שוב' : 'חפש בנישה'}
        </button>
      </div>

      {value && result && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 bg-emerald-500/10" role="status">
          <span className="text-xs text-emerald-300">
            {result.items.length.toLocaleString('en-US')} מוצרים עם עמלה של {result.min_rate}%+ ב«{result.label}» · נסרק {ago(result.scanned_at)}
            {cooling && ' · אפשר לחפש שוב בעוד כמה דקות'}
          </span>
          {active
            ? <button type="button" onClick={onBack} className="btn btn-ghost btn-xs">חזרה לכל המוצרים</button>
            : <button type="button" onClick={onShow} className="btn btn-ghost btn-xs">הצג את התוצאות</button>}
        </div>
      )}
      {value && !result && !running && state && (
        <p className="mt-3 text-xs text-white/60">הנישה עוד לא נסרקה. לחץ «חפש בנישה».</p>
      )}
      {running && (
        <p className="mt-3 text-xs text-white/60" role="status">מחפש… התוצאות יופיעו כאן לבד.</p>
      )}
    </section>
  );
}
