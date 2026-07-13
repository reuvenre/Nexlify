'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Cpu, AlertTriangle, ChevronLeft } from 'lucide-react';
import { usageApi } from '@/lib/api-client';
import type { AiUsageSummary } from '@/types';

const fmt = (n: number) => n.toLocaleString('he-IL');
/** Compact token count: 12,300 → "12.3K", 4,500,000 → "4.5M". */
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`
  : `${n}`;

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
};

export function AiUsagePanel() {
  const [data, setData] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    usageApi.ai(14).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);

  const maxDay = data ? Math.max(1, ...data.days.map((d) => d.total_tokens)) : 1;
  const pct = data && data.budget ? Math.min(100, Math.round((data.month_total / data.budget) * 100)) : 0;
  const near = pct >= 90;
  const warn = pct >= 70 && pct < 90;
  const barColor = near ? 'from-red-500 to-rose-500' : warn ? 'from-amber-500 to-orange-500' : 'from-blue-500 to-violet-500';

  return (
    <div className="card p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/20 to-cyan-500/5 flex items-center justify-center text-cyan-300">
            <Cpu size={14} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">צריכת טוקנים — AI (Gemini)</h2>
            <p className="text-2xs text-white/35">מעקב יומי (00:00–23:59) וחיווי מכסה חודשית</p>
          </div>
        </div>
        <Link href="/settings" className="text-2xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
          הגדר תקציב <ChevronLeft size={11} />
        </Link>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center text-white/25 text-sm">טוען נתוני שימוש…</div>
      ) : !data ? (
        <div className="h-24 flex items-center justify-center text-white/25 text-sm">אין נתוני שימוש עדיין</div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: today + month/budget gauge */}
          <div className="lg:w-64 shrink-0 space-y-4">
            <div>
              <p className="text-2xs text-white/40 mb-1">טוקנים היום</p>
              <p className="text-3xl font-bold text-white tracking-tight">{fmt(data.today.total_tokens)}</p>
              <p className="text-2xs text-white/30 mt-0.5">
                {fmt(data.today.calls)} בקשות · {fmt(data.today.prompt_tokens)} קלט / {fmt(data.today.output_tokens)} פלט
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-2xs text-white/40">שימוש החודש</p>
                <p className="text-2xs font-semibold text-white/70">
                  {compact(data.month_total)}{data.budget ? ` / ${compact(data.budget)}` : ''}
                </p>
              </div>
              {data.budget ? (
                <>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className={`text-2xs font-medium ${near ? 'text-red-400' : warn ? 'text-amber-400' : 'text-white/40'}`}>
                      {pct}% מהמכסה
                    </span>
                    <span className="text-2xs text-white/40">נותרו {compact(data.remaining ?? 0)}</span>
                  </div>
                  {(near || warn) && (
                    <div className={`mt-2 flex items-start gap-1.5 text-2xs ${near ? 'text-red-400' : 'text-amber-400'}`}>
                      <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                      {near ? 'קרוב למכסה — שקול לרכוש טוקנים נוספים.' : 'עברת 70% מהמכסה החודשית.'}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-2xs text-white/30 mt-1">
                  לא הוגדר תקציב חודשי. הגדר אותו בהגדרות כדי לראות כמה טוקנים נותרו וחיווי מכסה.
                </p>
              )}
            </div>
          </div>

          {/* Right: 14-day bar chart */}
          <div className="flex-1 min-w-0">
            <p className="text-2xs text-white/40 mb-2">14 הימים האחרונים</p>
            <div className="flex items-end gap-1.5 h-32">
              {data.days.map((d) => {
                const h = Math.round((d.total_tokens / maxDay) * 100);
                const isToday = d.day === data.today.day;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1 group/bar" title={`${dayLabel(d.day)} · ${fmt(d.total_tokens)} טוקנים · ${fmt(d.calls)} בקשות`}>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t transition-all group-hover/bar:opacity-100 ${isToday ? 'bg-gradient-to-t from-cyan-500 to-blue-400 opacity-100' : 'bg-white/15 opacity-70'}`}
                        style={{ height: `${Math.max(d.total_tokens > 0 ? 4 : 0, h)}%` }}
                      />
                    </div>
                    <span className={`text-[9px] leading-none ${isToday ? 'text-cyan-300 font-semibold' : 'text-white/25'}`}>{dayLabel(d.day)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
