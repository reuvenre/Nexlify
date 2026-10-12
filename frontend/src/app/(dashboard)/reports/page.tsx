'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3, Loader2,
  DollarSign, FileText, Award, Calendar, RefreshCw, ExternalLink, TrendingUp, MousePointerClick,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLive } from '@/lib/hooks/useLive';
import { useVizColors } from '@/lib/viz';
import { LiveBadge } from '@/components/dashboard/live/LiveBadge';
import { StatTile } from '@/components/dashboard/live/StatTile';
import { DailyChart } from '@/components/dashboard/live/DailyChart';
import { earningsApi, postsApi, pinterestApi, statsApi, type PinterestAnalytics, type AttributionSummary } from '@/lib/api-client';
import type { EarningsSummary } from '@/types';

const UNIQUE_PERIODS = [
  { label: '7 ימים',   value: '7d'  as const },
  { label: '30 ימים',  value: '30d' as const },
  { label: '90 ימים',  value: '90d' as const },
  { label: 'הכל',      value: 'all' as const },
];

const ils2 = (v: number) => `₪${v.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nf = (v: number) => Math.round(v).toLocaleString('he-IL');

/** Settled and estimated per month, in the two first categorical hues (validated pair). */
const MONTH_COLORS = { light: { settled: '#2a78d6', estimated: '#eb6834' }, dark: { settled: '#3987e5', estimated: '#d95926' } };

export default function ReportsPage() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const colors = useVizColors();
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;

  // The money for the chosen period, kept current while the report is open.
  const report = useLive(async () => {
    const [summary, posts] = await Promise.all([
      earningsApi.summary({ period }),
      postsApi.list({ limit: 1, status: 'sent' }),
    ]);
    return { summary, postCount: posts.total };
  }, { intervalMs: 60_000, deps: [period] });
  // Day by day for the same window (up to 60 days; longer periods read the monthly chart).
  const live = useLive(() => statsApi.live(Math.min(60, periodDays ?? 30)), { intervalMs: 30_000, deps: [periodDays] });

  const summary = report.data?.summary ?? null;
  const postCount = report.data?.postCount ?? 0;
  const L = live.data;
  const totalRevenue = summary ? summary.total_settled + summary.total_estimated : 0;
  const dailyAvg = periodDays ? totalRevenue / periodDays : null;
  const sum = (a: number[] | undefined) => (a || []).reduce((x, y) => x + y, 0);
  const periodClicks = L ? sum(L.daily.clicks) : null;
  const periodPosts = L ? sum(L.daily.posts) : null;
  const monthColors = colors.surface === '#ffffff' ? MONTH_COLORS.light : MONTH_COLORS.dark;
  const firstLoad = report.loading && !report.data;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-ink-muted text-xs mb-1">
            <BarChart3 size={12} />
            <span>דוחות</span>
          </div>
          <h1 className="text-2xl font-bold text-ink">דוחות וניתוחים</h1>
          <p className="text-sm text-ink-muted mt-1">הכנסות, קליקים ופוסטים — מתעדכן חי כל עוד המסך פתוח</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <LiveBadge
            updatedAt={report.updatedAt}
            error={report.error}
            refreshing={report.loading}
            onRefresh={() => { void report.refresh(); void live.refresh(); }}
          />
          {/* Period selector */}
          <div className="flex bg-surface-secondary border border-edge rounded-xl p-1 gap-1 overflow-x-auto max-w-full">
            {UNIQUE_PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap
                  ${period === p.value
                    ? 'bg-surface-tertiary text-ink shadow-card'
                    : 'text-ink-muted hover:text-ink'
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {firstLoad ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Headline numbers for the period */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatTile
              label="הכנסות בתקופה" icon={DollarSign} value={summary ? totalRevenue : null} format={ils2}
              sub={periodDays ? `${periodDays} ימים אחרונים` : 'מאז ומעולם'}
            />
            <StatTile
              label="מוסדר" icon={Award} value={summary ? summary.total_settled : null} format={ils2}
              sub="עמלות שאלי אקספרס אישרה"
            />
            <StatTile
              label="משוער" icon={TrendingUp} value={summary ? summary.total_estimated : null} format={ils2}
              sub="ממתין לאישור"
            />
            <StatTile
              label="קליקים בתקופה" icon={MousePointerClick} value={periodClicks} format={nf}
              sub={periodPosts !== null ? `${nf(periodPosts)} פוסטים יצאו${periodDays && periodDays > 60 ? ' (60 ימים אחרונים)' : ''}` : undefined}
              spark={L?.daily.clicks} sparkDays={L?.days} sparkColor={colors.clicks}
            />
          </div>

          {/* Projection */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={14} className="text-ink-muted" />
              <p className="text-sm font-semibold text-ink">קצב ותחזית</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-ink-muted mb-1">ממוצע יומי בתקופה</p>
                <p className="text-xl font-bold text-ink" dir="ltr">{dailyAvg !== null ? ils2(dailyAvg) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted mb-1">בקצב הזה, לחודש</p>
                <p className="text-xl font-bold text-ink" dir="ltr">{dailyAvg !== null ? ils2(dailyAvg * 30) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted mb-1">פוסטים שנשלחו (סה״כ)</p>
                <p className="text-xl font-bold text-ink">{nf(postCount)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted mb-1">עמלה לפוסט (סה״כ)</p>
                <p className="text-xl font-bold text-ink" dir="ltr">{period === 'all' && postCount > 0 ? ils2(totalRevenue / postCount) : '—'}</p>
                {period !== 'all' && <p className="text-2xs text-ink-muted">בחר "הכל" לחישוב</p>}
              </div>
            </div>
          </div>

          {/* Day by day — one measure per chart */}
          {L && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <DailyChart title="קליקים" days={L.days} values={L.daily.clicks} color={colors.clicks} colors={colors}
                format={nf} total={nf(sum(L.daily.clicks))} />
              <DailyChart title="פוסטים שיצאו" days={L.days} values={L.daily.posts} color={colors.posts} colors={colors}
                format={nf} total={nf(sum(L.daily.posts))} />
              <DailyChart title="עמלות ($)" days={L.commission_days ?? L.days} values={L.daily.commissions_usd} color={colors.commissions} colors={colors}
                format={(v) => `$${Math.round(v)}`} total={`$${sum(L.daily.commissions_usd).toFixed(2)}`} />
            </div>
          )}

          {/* By campaign — magnitude, one hue */}
          {summary && summary.by_campaign.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink mb-4">הכנסות לפי טייס אוטומטי</h3>
              <div className="space-y-3">
                {summary.by_campaign.map((c) => {
                  const maxVal = Math.max(...summary.by_campaign.map((x) => x.total));
                  const pct = maxVal > 0 ? (c.total / maxVal) * 100 : 0;
                  return (
                    <div key={c.campaign_id} className="flex items-center gap-4">
                      <p className="text-sm text-ink-muted truncate w-36 shrink-0" title={c.campaign_name}>{c.campaign_name}</p>
                      <div className="flex-1 bg-surface-tertiary rounded-full h-2 overflow-hidden" dir="ltr">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: colors.clicks }} />
                      </div>
                      <p className="text-sm font-semibold text-ink w-24 text-left shrink-0" dir="ltr">{ils2(c.total)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* By month — settled vs estimated, stacked, legend + tooltip */}
          {summary && summary.by_month.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-ink mb-4">הכנסות לפי חודש</h3>
              <div className="h-56" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[...summary.by_month].sort((a, b) => a.month.localeCompare(b.month))} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: colors.axis }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: colors.axis }} tickFormatter={(v: number) => `₪${Math.round(v)}`} />
                    <Tooltip
                      cursor={{ fill: colors.grid }}
                      content={({ active, payload, label }) => (active && payload?.length ? (
                        <div className="rounded-lg border border-edge bg-surface-secondary px-3 py-2 text-xs text-ink shadow-elevated" dir="rtl">
                          <p className="text-ink-muted mb-1">{label}</p>
                          {payload.map((p) => (
                            <p key={String(p.dataKey)}><span className="inline-block w-2 h-2 rounded-sm ml-1.5" style={{ background: String(p.color) }} />{p.dataKey === 'settled' ? 'מוסדר' : 'משוער'}: <span dir="ltr">{ils2(Number(p.value))}</span></p>
                          ))}
                        </div>
                      ) : null)}
                    />
                    <Legend formatter={(v: string) => <span className="text-xs text-ink-muted">{v === 'settled' ? 'מוסדר' : 'משוער'}</span>} />
                    <Bar dataKey="settled" stackId="m" maxBarSize={56} fill={monthColors.settled} stroke={colors.surface} strokeWidth={2} />
                    <Bar dataKey="estimated" stackId="m" maxBarSize={56} fill={monthColors.estimated} stroke={colors.surface} strokeWidth={2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {summary && totalRevenue === 0 && (
            <div className="card border-dashed p-16 text-center">
              <BarChart3 size={36} className="text-ink-muted mx-auto mb-4" />
              <p className="text-sm text-ink-muted">אין נתוני הכנסות לתקופה זו</p>
              <p className="text-xs text-ink-muted mt-1">הפעל את הטייס האוטומטי כדי לראות נתונים כאן</p>
            </div>
          )}
        </div>
      )}

      {/* Outside the loading branch: a period change must not unmount and refetch these. */}
      <div className="space-y-6 mt-6">
        <AttributionPanel />
        <ClickSourcesPanel />
        <PinterestPanel />
      </div>
    </div>
  );
}

// ─── Revenue attribution ──────────────────────────────────────────────────────

/**
 * "What actually earns": commissions matched back to the keyword/campaign that drove
 * them, side-by-side with short-link clicks — the money table decisions get made on.
 */
function AttributionPanel() {
  const [data, setData] = useState<AttributionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    earningsApi.attribution()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;
  const hasAny = data.by_keyword.length > 0 || data.by_campaign.length > 0;

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">💰</span>
        <h2 className="text-sm font-semibold text-white">מה מכניס כסף — לפי מילת מפתח</h2>
      </div>
      {!hasAny ? (
        <p className="text-xs text-white/35 mt-2">
          עדיין אין נתוני שיוך — ברגע שפוסטים חדשים יצברו קליקים והזמנות, תראה כאן בדיוק אילו
          מילות מפתח וקמפיינים מייצרים עמלות.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-2xs text-white/30 border-b border-edge">
                  <th className="text-right py-2 px-2 font-medium">מילת מפתח</th>
                  <th className="text-right py-2 px-2 font-medium">עמלות</th>
                  <th className="text-right py-2 px-2 font-medium">הזמנות</th>
                  <th className="text-right py-2 px-2 font-medium">קליקים</th>
                  <th className="text-right py-2 px-2 font-medium">פוסטים</th>
                </tr>
              </thead>
              <tbody>
                {data.by_keyword.slice(0, 12).map((k) => (
                  <tr key={k.keyword} className="border-b border-edge/50">
                    <td className="py-2 px-2 text-white/80">{k.keyword}</td>
                    <td className={`py-2 px-2 font-semibold ${k.revenue_ils > 0 ? 'text-emerald-400' : 'text-white/30'}`}>
                      ₪{k.revenue_ils.toFixed(2)}
                    </td>
                    <td className="py-2 px-2 text-white/50">{k.orders}</td>
                    <td className="py-2 px-2 text-white/50">{k.clicks}</td>
                    <td className="py-2 px-2 text-white/30">{k.posts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.by_campaign.length > 0 && (
            <div className="mt-4">
              <p className="text-2xs text-white/30 mb-2">לפי טייס אוטומטי</p>
              <div className="flex flex-wrap gap-2">
                {data.by_campaign.map((c) => (
                  <span key={c.campaign_id} className="text-xs bg-white/5 border border-edge rounded-lg px-3 py-1.5 text-white/70">
                    {c.name}: <b className="text-emerald-400">₪{c.revenue_ils.toFixed(2)}</b> · {c.orders} הזמנות
                  </span>
                ))}
              </div>
            </div>
          )}

          {data.unattributed.orders > 0 && (
            <p className="text-2xs text-white/25 mt-3">
              {data.unattributed.orders} הזמנות (₪{data.unattributed.revenue_ils.toFixed(2)}) ללא שיוך לפוסט —
              בעיקר הזמנות מלפני הפעלת המעקב.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Click sources ────────────────────────────────────────────────────────────

/** Platform labels for the click-source breakdown (the short link's ?s= tag). */
const CLICK_SOURCE_LABELS: Record<string, string> = {
  tg: 'טלגרם', fb: 'פייסבוק', ig: 'אינסטגרם', pin: 'פינטרסט', wa: 'וואטסאפ', other: 'לא מזוהה',
};
const CLICK_SOURCE_COLORS: Record<string, string> = {
  tg: 'bg-sky-500', fb: 'bg-blue-600', ig: 'bg-pink-500', pin: 'bg-red-500', wa: 'bg-emerald-500', other: 'bg-white/25',
};

/**
 * Where the link clicks come from (30 days): totals per platform from the ?s= tag each
 * send path stamps on its published short link. 'לא מזוהה' = clicks on links published
 * before tagging existed — kept so the numbers always add up to the click total.
 */
function ClickSourcesPanel() {
  // Clicks land all day — refreshed every minute while the report is open.
  const { data, loading } = useLive(() => statsApi.clickSources(30), { intervalMs: 60_000 });

  if (loading || !data) return null;

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🔗</span>
        <h2 className="text-sm font-semibold text-white">מאיפה מגיעים הקליקים — 30 יום</h2>
      </div>
      {data.total === 0 ? (
        <p className="text-xs text-white/35 mt-2">
          אין עדיין קליקים בתקופה. הפירוק לפי פלטפורמה נאסף על קישורים שפורסמו מרגע הפעלת הסימון —
          פוסטים חדשים יתחילו למלא את הדוח.
        </p>
      ) : (
        <>
          {/* One stacked bar — share of each platform at a glance. */}
          <div className="flex h-2.5 rounded-full overflow-hidden mt-4 mb-3 bg-white/5">
            {data.sources.map((s) => (
              <div key={s.source}
                className={CLICK_SOURCE_COLORS[s.source] || CLICK_SOURCE_COLORS.other}
                style={{ width: `${(s.clicks / data.total) * 100}%` }}
                title={`${CLICK_SOURCE_LABELS[s.source] || s.source}: ${s.clicks}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {data.sources.map((s) => (
              <span key={s.source} className="inline-flex items-center gap-1.5 text-xs text-white/60">
                <span className={`w-2 h-2 rounded-full ${CLICK_SOURCE_COLORS[s.source] || CLICK_SOURCE_COLORS.other}`} />
                {CLICK_SOURCE_LABELS[s.source] || s.source}
                <b className="text-white/85">{s.clicks}</b>
                <span className="text-white/30">({Math.round((s.clicks / data.total) * 100)}%)</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
              סה״כ <b className="text-white/85">{data.total}</b>
            </span>
          </div>
          {data.sources.some((s) => s.source === 'other') && (
            <p className="text-2xs text-white/25 mt-2">
              "לא מזוהה" = קליקים על קישורים שפורסמו לפני הפעלת סימון הפלטפורמה — עם הזמן החלק הזה יקטן.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Pinterest performance ────────────────────────────────────────────────────

/**
 * Per-pin performance (30 days) from Pinterest's analytics API. Self-contained:
 * fetches on mount, and when Pinterest isn't connected (or the tier blocks
 * analytics) renders an explanatory card instead of an error.
 */
function PinterestPanel() {
  const [data, setData] = useState<PinterestAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  // A forced refresh re-reads every pin from Pinterest (up to ~a minute) — the panel keeps
  // showing the current numbers with a spinning icon instead of collapsing to a skeleton.
  const [refreshing, setRefreshing] = useState(false);
  // The list defaults to the top pins so the money metric leads — but the cut must be
  // visible and reversible, or 25 active pins showing as 8 reads as missing data.
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    pinterestApi.analytics()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    pinterestApi.analytics(true)
      .then(setData)
      .catch(() => {}) // keep the numbers already on screen — stale beats empty
      .finally(() => setRefreshing(false));
  };

  if (loading) {
    return (
      <div className="bg-surface-secondary border border-edge rounded-xl p-8 flex items-center justify-center gap-2 text-white/30 text-sm">
        <Loader2 size={16} className="animate-spin" /> טוען נתוני פינטרסט...
      </div>
    );
  }
  if (!data) return null;

  const ctr = data.totals && data.totals.impressions > 0
    ? (data.totals.outbound_clicks / data.totals.impressions) * 100
    : 0;

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">📌</span>
        <h2 className="text-sm font-semibold text-white">ביצועי Pinterest — 30 יום</h2>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="עוקף את המטמון וקורא את הנתונים מחדש מפינטרסט (עד דקה)"
          className="mr-auto flex items-center gap-1.5 text-xs text-white/35 hover:text-white/70 disabled:text-white/25 transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'קורא מפינטרסט…' : 'רענן עכשיו'}
        </button>
      </div>

      {!data.available ? (
        <p className="text-xs text-white/35 mt-2">
          {data.reason || 'פינטרסט לא מחובר עדיין.'}{' '}
          נתונים יופיעו כאן אוטומטית אחרי חיבור הטוקן ואישור ה-Standard access.
        </p>
      ) : !data.totals || data.totals.pins === 0 ? (
        <p className="text-xs text-white/35 mt-2">אין עדיין פינים שפורסמו — הנתונים יופיעו אחרי שהטייס יתחיל לפרסם.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 mb-5">
            <div>
              <p className="text-xs text-white/40 mb-1">חשיפות</p>
              <p className="text-xl font-bold text-white">{data.totals.impressions.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1">קליקים החוצה (לינק)</p>
              <p className="text-xl font-bold text-emerald-400">{data.totals.outbound_clicks.toLocaleString()}</p>
              <p className="text-2xs text-white/30">CTR {ctr.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1">שמירות</p>
              <p className="text-xl font-bold text-white">{data.totals.saves.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-white/40 mb-1">פינים פעילים</p>
              <p className="text-xl font-bold text-white">{data.totals.pins}</p>
            </div>
          </div>

          {/* Top pins by outbound clicks — the money metric */}
          <p className="text-2xs text-white/30 mb-2">
            {showAll || data.pins.length <= 8
              ? `כל ${data.pins.length} הפינים, לפי קליקים החוצה:`
              : `שמונת הפינים המובילים לפי קליקים החוצה (מתוך ${data.pins.length}):`}
          </p>
          <div className="space-y-2">
            {(showAll ? data.pins : data.pins.slice(0, 8)).map((p) => (
              // The pin's CANONICAL address, not a pin.it share shortcut. Diagnosing a pin
              // that gets no distribution starts with opening it as a stranger would, and
              // that address appears nowhere in the Pinterest app — the share button hands
              // out a pin.it link instead, which expires and answers a different question.
              // The id is already ours (posts.pinterest_post_id); linking it turns a
              // ten-minute hunt into one click.
              <a
                key={p.pin_id}
                href={`https://www.pinterest.com/pin/${p.pin_id}/`}
                target="_blank"
                rel="noopener noreferrer"
                title="פתח את הפין בפינטרסט"
                className="flex items-center gap-3 py-2 px-3 bg-white/3 hover:bg-white/8 rounded-lg transition-colors"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image && <img src={p.image} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white/80 truncate" dir="ltr">{p.title}</p>
                  <p className="text-2xs text-white/30">
                    {p.impressions.toLocaleString()} חשיפות · {p.saves} שמירות
                  </p>
                </div>
                <div className="text-left shrink-0">
                  <p className="text-sm font-bold text-emerald-400">{p.outbound_clicks}</p>
                  <p className="text-2xs text-white/30">קליקים</p>
                </div>
                <ExternalLink size={12} className="text-white/20 shrink-0" />
              </a>
            ))}
          </div>
          {data.pins.length > 8 && (
            <button onClick={() => setShowAll((v) => !v)}
              className="mt-3 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white/60 transition-all">
              {showAll ? 'הצג רק את המובילים' : `הצג את כל ${data.pins.length} הפינים`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
