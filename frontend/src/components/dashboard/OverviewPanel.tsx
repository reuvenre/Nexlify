'use client';

import { BadgeDollarSign, MousePointerClick, Send, TrendingDown, TrendingUp } from 'lucide-react';
import { statsApi } from '@/lib/api-client';
import { useCountUp } from '@/lib/hooks/useCountUp';
import { useLive } from '@/lib/hooks/useLive';
import type { MonthMetric, OverviewStats } from '@/types';

/**
 * The dashboard headline, cut by CALENDAR month — the clock the owner actually reconciles
 * against: AliExpress reports commissions by calendar month, so every tile answers "how is
 * THIS month doing" with the full previous month printed right under it. The delta badge
 * compares the same elapsed stretch of the previous month (comparing a half-finished month
 * against a whole one would fake a collapse every month), and the bar chart keeps the long
 * trend as one bar per month.
 */

const MONTHS = 12;

/** '2026-08' → 'אוגוסט' (with the year when it isn't this year's). */
function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const d = new Date(Date.UTC(y, m - 1, 1));
  const name = d.toLocaleDateString('he-IL', { month: style, timeZone: 'UTC' });
  return y === new Date().getFullYear() ? name : `${name} ${y}`;
}

function Sparkline({ points, positive }: { points: number[]; positive: boolean }) {
  const max = Math.max(...points, 1);
  // A single data point has no line to draw; render nothing rather than a stray dot.
  if (points.length < 2) return <span className="h-5" />;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1)) * 56},${18 - (p / max) * 15}`)
    .join(' ');
  return (
    <svg width="56" height="20" viewBox="0 0 56 20" className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={positive ? '#34d399' : '#60a5fa'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DeltaBadge({ pct }: { pct: number | null }) {
  // Null means there was no previous month to compare with — showing "+100%" for a first
  // month of data would be an invented claim, so the badge simply doesn't appear.
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      title="לעומת אותו קטע חולף של החודש הקודם"
      className={`flex items-center gap-0.5 text-2xs font-semibold px-1.5 py-0.5 rounded-full
        ${up ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
      dir="ltr"
    >
      <Icon size={9} />{up ? '+' : ''}{pct}%
    </span>
  );
}

function Tile({
  label, value, prevLine, note, metric, icon: Icon, accent,
}: {
  label: string; value: string; prevLine: string; note?: string; metric: MonthMetric;
  icon: typeof Send; accent: string;
}) {
  return (
    <div className="bg-surface-secondary border border-edge rounded-2xl p-4 shadow-card">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-ink-muted">{label}</p>
        <Icon size={13} className={accent} />
      </div>
      <p className="text-2xl font-bold text-ink tracking-tight" dir="ltr">{value}</p>
      <p className="text-2xs text-ink-muted h-4">{prevLine}</p>
      <p className="text-2xs text-ink-muted h-4 mb-1">{note ?? ''}</p>
      <div className="flex items-center justify-between">
        <Sparkline points={metric.series} positive={(metric.delta_pct ?? 0) >= 0} />
        <DeltaBadge pct={metric.delta_pct} />
      </div>
    </div>
  );
}

function MonthlyBars({ series, monthKeys }: { series: number[]; monthKeys: string[] }) {
  const max = Math.max(...series, 1);
  return (
    <div dir="ltr">
      <div className="relative flex items-end gap-1 h-24">
        {series.map((v, i) => {
          const current = i === series.length - 1;
          return (
            <div
              key={monthKeys[i] ?? i}
              // A zero month must still be visible as a baseline tick, otherwise a gap reads
              // as "no bar rendered" — a rendering bug rather than a quiet month.
              className="flex-1 rounded-t-[3px] min-h-[2px] transition-all duration-500"
              style={{
                height: `${Math.max(2, (v / max) * 100)}%`,
                background: current
                  ? 'linear-gradient(180deg,#3b82f6,#6366f1)'
                  : 'linear-gradient(180deg,#3b82f6aa,#3b82f633)',
              }}
              title={`${monthLabel(monthKeys[i] ?? '')} · $${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
            />
          );
        })}
      </div>
      <div className="flex gap-1 mt-1">
        {series.map((_, i) => (
          <p key={monthKeys[i] ?? i} className="flex-1 text-center text-2xs text-ink-muted truncate">
            {monthLabel(monthKeys[i] ?? '', 'short')}
          </p>
        ))}
      </div>
    </div>
  );
}

export function OverviewPanel() {
  // Kept current while on screen (a minute is plenty for month totals); the tiles glide
  // to each new value instead of recounting from zero.
  const live = useLive(() => statsApi.overview(MONTHS), { intervalMs: 60_000 });
  const data: OverviewStats | null = live.data;
  const failed = !!live.error && !live.data;

  const m = data?.metrics;
  const commissions = useCountUp(m?.commissions.current.total ?? 0);
  const clicks = useCountUp(m?.clicks.current.total ?? 0);
  const posts = useCountUp(m?.posts.current.total ?? 0);

  if (failed) return null; // the rest of the dashboard still works without the headline

  if (!data || !m) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface-secondary border border-edge rounded-2xl p-4 h-[130px] animate-pulse" />
        ))}
      </div>
    );
  }

  const hasAnything = m.commissions.series.some((v) => v > 0)
    || m.clicks.current.total > 0 || m.posts.current.total > 0;

  const prevOf = (metric: MonthMetric, fmt: (n: number) => string) =>
    `${monthLabel(metric.previous.key)} (מלא): ${fmt(metric.previous.total)}`;

  return (
    <section className="mb-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Tile
          label={`עמלות · ${monthLabel(m.commissions.current.key)}`} icon={BadgeDollarSign} accent="text-emerald-300"
          value={`$${commissions.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
          prevLine={prevOf(m.commissions, (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)}
          note={data.ils_approx
            ? `≈ ₪${(commissions * data.ils_approx.rate).toLocaleString('he-IL', { maximumFractionDigits: 0 })} בשער היום`
            : undefined}
          metric={m.commissions}
        />
        <Tile
          label={`קליקים · ${monthLabel(m.clicks.current.key)}`} icon={MousePointerClick} accent="text-blue-300"
          value={Math.round(clicks).toLocaleString('he-IL')}
          prevLine={prevOf(m.clicks, (n) => n.toLocaleString('he-IL'))}
          metric={m.clicks}
        />
        <Tile
          label={`פוסטים · ${monthLabel(m.posts.current.key)}`} icon={Send} accent="text-violet-300"
          value={Math.round(posts).toLocaleString('he-IL')}
          prevLine={prevOf(m.posts, (n) => n.toLocaleString('he-IL'))}
          metric={m.posts}
        />
      </div>

      <div className="bg-surface-secondary border border-edge rounded-2xl px-4 pt-4 pb-3 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white/70">עמלות · {data.months} חודשים אחרונים</p>
          <span className="text-xs text-ink-muted" dir="ltr">
            ${m.commissions.series.reduce((a, b) => a + b, 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} סה״כ
          </span>
        </div>
        {hasAnything ? (
          <MonthlyBars series={m.commissions.series} monthKeys={data.month_keys} />
        ) : (
          // A brand-new account has a flat chart, which reads as broken rather than empty.
          <div className="h-24 flex flex-col items-center justify-center text-center gap-1">
            <p className="text-sm text-white/45">עוד אין נתונים להצגה</p>
            <p className="text-xs text-ink-muted">ברגע שהפוסטים הראשונים יפורסמו, המגמה תופיע כאן</p>
          </div>
        )}
      </div>
    </section>
  );
}
