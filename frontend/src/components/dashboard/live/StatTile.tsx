'use client';

import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useCountUp } from '@/lib/hooks/useCountUp';

/**
 * One headline number: the value (gliding to each new reading), what it means, an optional
 * delta, and an optional 30-day sparkline in the measure's own hue. The value is always
 * text in ink — the color only marks the line.
 */
export function StatTile({
  label, value, format, sub, icon: Icon, spark, sparkColor, sparkDays, delta, href,
}: {
  label: string;
  value: number | null;
  format: (v: number) => string;
  sub?: React.ReactNode;
  icon: React.ElementType;
  spark?: number[];
  sparkColor?: string;
  sparkDays?: string[];
  /** Percent change; null/undefined = no comparison to show. */
  delta?: number | null;
  href?: string;
}) {
  const shown = useCountUp(value ?? 0, 900);
  // Gradient ids must be plain tokens (a Hebrew label made the fill fall back to black).
  const gid = `spark-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const body = (
    <div className="card h-full p-4 sm:p-5 flex flex-col transition-all duration-300 hover:-translate-y-0.5 hover:border-edge-hover">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">{label}</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-edge bg-surface-tertiary text-ink-muted">
          <Icon size={14} />
        </span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <p className="text-2xl font-bold tracking-tight text-ink" dir="ltr">{value === null ? '—' : format(shown)}</p>
        {delta !== null && delta !== undefined && (
          <span
            dir="ltr"
            className={`mb-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-2xs font-semibold
              ${delta >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}
          >
            {delta >= 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}{delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-muted">{sub}</div>}
      {spark && spark.length > 1 && sparkColor && (
        <div className="mt-auto pt-3 h-12" dir="ltr" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ v, d: sparkDays?.[i] || '' }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={{ stroke: sparkColor, strokeOpacity: 0.3 }}
                content={({ active, payload }) => (active && payload?.length ? (
                  <div className="rounded-lg border border-edge bg-surface-secondary px-2 py-1 text-2xs text-ink shadow-card">
                    {dayLabel(String(payload[0].payload.d))}: <b>{format(Number(payload[0].value))}</b>
                  </div>
                ) : null)}
              />
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={2} fill={`url(#${gid})`} isAnimationActive={false} dot={false} activeDot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
  return href ? <a href={href} className="block h-full">{body}</a> : body;
}

/** '2026-10-11' → '11.10' (Israel style), with the weekday for the tooltip. */
export function dayLabel(key: string, withWeekday = true): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y) return key;
  const date = new Date(Date.UTC(y, m - 1, d));
  const short = `${d}.${m}`;
  return withWeekday ? `${date.toLocaleDateString('he-IL', { weekday: 'short', timeZone: 'UTC' })} ${short}` : short;
}
