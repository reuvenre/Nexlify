'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Gem, RefreshCw, Loader2, Star, ExternalLink, Sparkles, Target, Tag, CheckCircle2,
  ChevronLeft, ChevronRight, Search, AlertTriangle, TrendingUp, DollarSign, Layers, Flame,
} from 'lucide-react';
import { commissionScoutApi } from '@/lib/api-client';
import type { ScoutCatalogResponse, ScoutItem } from '@/types';

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

  const catalog = data?.catalog || null;
  const all = useMemo(() => catalog?.items || [], [catalog]);

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
      && (!nicheOnly || it.origin === 'niche')
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

  /** The boosted rates, highest first: the shelf the owner asked for. */
  const huge = useMemo(() => sortItems(filtered.filter((it) => it.commission_rate >= HUGE_RATE), 'rate'), [filtered]);

  const [shown, setShown] = useState(GRID_PAGE);
  useEffect(() => { setShown(GRID_PAGE); }, [minRate, category, nicheOnly, hidePosted, query, sort]);

  // The shelves view (like a storefront) is the default; any filter switches to one grid.
  const browsing = !category && !query.trim() && !nicheOnly && !hidePosted && minRate === 12 && sort === 'smart';

  const createPost = (it: ScoutItem) => {
    sessionStorage.setItem('quick_post_catalog_product', JSON.stringify({
      product_id: it.product_id, title: it.title,
      original_price: it.original_price, sale_price: it.sale_price, discount_percent: it.discount_percent,
      image_url: it.image_url, product_url: it.product_url, affiliate_url: it.affiliate_url,
      category: it.category, orders_count: it.orders_count, rating: it.rating, currency: it.currency,
    }));
    router.push('/quick-post?from_catalog=1');
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

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-white/50" aria-label="טוען" /></div>
      ) : !catalog ? (
        <EmptyState running={running} onScan={scan} />
      ) : (
        <>
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
                title={`עמלות ענק: ${HUGE_RATE}% ומעלה`}
                subtitle={`${huge.length} מוצרים, העמלה הגבוהה ביותר קודם`}
                icon={Flame}
                items={huge.slice(0, SHELF_SIZE)}
                onAll={huge.length > SHELF_SIZE ? () => { setMinRate(HUGE_RATE); setSort('rate'); } : undefined}
                allCount={huge.length}
                onPost={createPost}
              />
              <Shelf
                title="ההמלצות של הסוכן"
                subtitle="המוצרים שהכי שווה לפרסם עכשיו: הרבה כסף לכל מכירה, מוצר שנמכר ודירוג גבוה"
                icon={Sparkles}
                items={filtered.slice(0, SHELF_SIZE)}
                ranked
                onPost={createPost}
              />
              {categories.slice(0, 12).map(([cat, n]) => (
                <Shelf
                  key={cat}
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
                    {filtered.slice(0, shown).map((it) => <ProductCard key={it.product_id} item={it} onPost={createPost} />)}
                  </div>
                  {shown < filtered.length && (
                    <div className="flex justify-center pt-5">
                      <button type="button" onClick={() => setShown((n) => n + GRID_PAGE)} className="btn btn-ghost">
                        טען עוד ({(filtered.length - shown).toLocaleString('en-US')} נוספים)
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
            אחוז העמלה הוא מה שאלי אקספרס מצהירה ב-API לשותפים. בפועל העמלה יכולה להיות נמוכה יותר (תקרות לפי קטגוריה, לקוח חדש מול חוזר).
            הסוכן סורק את רשימות המבצעים של אלי אקספרס, את פיד המוצרים החמים (שם נמצאות עמלות של 50–90%) בכל הקטגוריות ואת מילות המפתח של הקמפיינים הפעילים שלך, 50 מוצרים בכל קריאה. כל בוקר וגם כשתלחץ «סרוק עכשיו».
            {catalog.budget_hit && ' הסריקה האחרונה עצרה במכסת הקריאות שלה, והבאה תתחיל מקטגוריות אחרות.'}
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
      className="relative overflow-hidden rounded-2xl p-6 sm:p-8"
      style={{ background: 'linear-gradient(120deg, #065f46 0%, #0f766e 45%, #1e40af 100%)', boxShadow: 'var(--shadow-elevated)' }}
      aria-labelledby="commissions-title"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-16 -top-24 h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.16), transparent 70%)' }} />
      <div className="relative flex flex-col lg:flex-row lg:items-end gap-6 lg:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-semibold tracking-wide mb-2 flex items-center gap-1.5" style={{ color: 'rgba(255,255,255,0.85)' }}>
            <Gem size={14} aria-hidden="true" /> סוכן העמלות
          </p>
          <h1 id="commissions-title" className="text-2xl sm:text-3xl font-bold leading-tight mb-2" style={ON_HERO}>
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
            className="input pr-9"
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
        <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
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

function Shelf({ title, subtitle, icon: Icon, items, ranked, onAll, allCount, onPost }: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  items: ScoutItem[];
  ranked?: boolean;
  onAll?: () => void;
  allCount?: number;
  onPost: (it: ScoutItem) => void;
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
            <span className="truncate">{title}</span>
          </h2>
          <p className="text-xs text-white/60 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onAll && (
            <button type="button" onClick={onAll} className="text-xs font-medium text-emerald-300 hover:underline ml-2">
              הצג את כל ה-{allCount}
            </button>
          )}
          <button type="button" onClick={() => scroll(-1)} className="btn btn-ghost btn-xs hidden sm:inline-flex" aria-label={`הקודם ב${title}`}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => scroll(1)} className="btn btn-ghost btn-xs hidden sm:inline-flex" aria-label={`הבא ב${title}`}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div ref={row} className="flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'thin' }}>
        {items.map((it, i) => (
          <div key={it.product_id} className="snap-start shrink-0 w-[46%] sm:w-[220px]">
            <ProductCard item={it} rank={ranked ? i + 1 : undefined} onPost={onPost} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Product card ─────────────────────────────────────────────────────────────

function ProductCard({ item: it, rank, onPost }: { item: ScoutItem; rank?: number; onPost: (it: ScoutItem) => void }) {
  const hasDiscount = it.discount_percent > 0 && it.original_price > it.sale_price;
  const link = it.affiliate_url || it.product_url;
  return (
    <article className="card h-full flex flex-col overflow-hidden group transition hover:border-[var(--border-hover)]">
      <div className="relative aspect-square bg-white/5 overflow-hidden">
        {it.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.image_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-white/30"><Tag size={28} aria-hidden="true" /></div>
        )}
        {/* The commission is the point of this screen: it gets the strongest badge. */}
        <span className="absolute top-2 right-2 rounded-lg px-2 py-1 text-xs font-bold shadow-md text-on-accent" style={{ background: '#047857' }}>
          {rateLabel(it.commission_rate)} עמלה
        </span>
        {hasDiscount && (
          <span className="absolute top-2 left-2 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-on-accent" style={{ background: '#dc2626' }}>
            {it.discount_percent}%-
          </span>
        )}
        {rank !== undefined && (
          <span className="absolute bottom-2 right-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-on-accent" style={{ background: 'rgba(15,17,23,0.78)' }}>
            #{rank} המלצה
          </span>
        )}
        {it.posted_recently && (
          <span className="absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-on-accent inline-flex items-center gap-1" style={{ background: 'rgba(15,17,23,0.78)' }}>
            <CheckCircle2 size={11} aria-hidden="true" /> פורסם
          </span>
        )}
      </div>

      <div className="flex-1 flex flex-col p-3 gap-1.5">
        <h3 className="text-[13px] leading-snug line-clamp-2 min-h-[2.5em]" title={it.title} dir="auto">{it.title}</h3>

        <div className="flex items-center gap-2 text-[11px] text-white/60">
          {it.rating > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Star size={11} className="text-amber-400 fill-amber-400" aria-hidden="true" />
              <span className="sr-only">דירוג </span>{it.rating}
            </span>
          )}
          <span>{sold(it.orders_count)} נמכרו</span>
        </div>

        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold tabular-nums">{money(it.sale_price, it.currency)}</span>
          {hasDiscount && (
            <del className="text-[11px] text-white/50 tabular-nums">
              <span className="sr-only">במקום </span>{money(it.original_price, it.currency)}
            </del>
          )}
        </div>

        <div className="rounded-lg px-2 py-1.5 text-[12px] font-semibold bg-emerald-500/10 text-emerald-300 flex items-center justify-between gap-1">
          <span>כ-${it.earn_per_sale_usd.toFixed(2)} לכל מכירה</span>
          <DollarSign size={13} aria-hidden="true" />
        </div>

        <p className="text-[11px] text-white/55 truncate flex items-center gap-1" title={it.found_by}>
          {it.origin === 'niche'
            ? <><Target size={11} className="shrink-0" aria-hidden="true" /> מילת המפתח «{it.found_by}»</>
            : it.origin === 'hot'
              ? <><Flame size={11} className="shrink-0" aria-hidden="true" /> מוצרים חמים «{it.found_by}»</>
            : <><Tag size={11} className="shrink-0" aria-hidden="true" /> מבצע «{it.found_by}»</>}
        </p>

        <div className="mt-auto pt-1.5 flex gap-1.5">
          <button type="button" onClick={() => onPost(it)} className="btn btn-primary btn-sm flex-1">
            צור פוסט
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
