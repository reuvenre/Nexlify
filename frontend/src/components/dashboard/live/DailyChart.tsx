'use client';

import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dayLabel } from './StatTile';
import type { VizColors } from '@/lib/viz';

/**
 * One measure over the last N days. One series and one axis per chart — clicks, posts and
 * commissions live on different scales, so they are three small charts side by side, never
 * one chart with two y-axes. The title carries the total as text; hovering any day shows
 * that day's value.
 */
export function DailyChart({ title, days, values, color, colors, format, total }: {
  title: string;
  days: string[];
  values: number[];
  color: string;
  colors: VizColors;
  format: (v: number) => string;
  total: string;
}) {
  const data = days.map((d, i) => ({ d, v: values[i] ?? 0 }));
  // A gradient id must be a plain token — a title with Hebrew, spaces or '$' broke the url(#…) reference and the fill fell back to solid black.
  const id = `daily-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-ink-muted"><span dir="ltr" className="font-semibold text-ink">{total}</span> ב-{days.length} ימים</p>
      </div>
      <div className="h-40" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis
              dataKey="d" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28}
              tick={{ fill: colors.axis }} tickFormatter={(d: string) => dayLabel(d, false)}
            />
            <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fill: colors.axis }} tickFormatter={(v: number) => format(v)} />
            <Tooltip
              cursor={{ stroke: colors.cursor, strokeWidth: 1 }}
              content={({ active, payload }) => (active && payload?.length ? (
                <div className="rounded-lg border border-edge bg-surface-secondary px-3 py-2 text-xs text-ink shadow-elevated" dir="rtl">
                  <p className="text-ink-muted">{dayLabel(String(payload[0].payload.d))}</p>
                  <p className="font-semibold mt-0.5"><span className="inline-block w-2 h-2 rounded-full ml-1.5" style={{ background: color }} />{title}: <span dir="ltr">{format(Number(payload[0].value))}</span></p>
                </div>
              ) : null)}
            />
            <Area
              type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`}
              dot={false} activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
