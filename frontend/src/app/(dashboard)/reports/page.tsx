'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Loader2,
  DollarSign, FileText, Award, Calendar,
} from 'lucide-react';
import { earningsApi, postsApi, pinterestApi, type PinterestAnalytics } from '@/lib/api-client';
import type { EarningsSummary } from '@/types';

const UNIQUE_PERIODS = [
  { label: '7 ימים',   value: '7d'  as const },
  { label: '30 ימים',  value: '30d' as const },
  { label: '90 ימים',  value: '90d' as const },
  { label: 'הכל',      value: 'all' as const },
];

function MetricCard({
  label, value, sub, icon: Icon, accent, trend,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  accent: 'blue' | 'green' | 'amber' | 'violet' | 'red';
  trend?: number;
}) {
  const colors = {
    blue:   'from-blue-500/10 to-blue-500/5 border-blue-500/20 text-blue-400',
    green:  'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 text-emerald-400',
    amber:  'from-amber-500/10 to-amber-500/5 border-amber-500/20 text-amber-400',
    violet: 'from-violet-500/10 to-violet-500/5 border-violet-500/20 text-violet-400',
    red:    'from-red-500/10 to-red-500/5 border-red-500/20 text-red-400',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[accent]} border rounded-xl p-5`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-white/40">{label}</p>
        <Icon size={15} className={colors[accent].split(' ').pop()} />
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
      {trend !== undefined && (
        <div className={`flex items-center gap-1 text-xs mt-2 ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {trend >= 0 ? '+' : ''}{trend.toFixed(1)}% מתקופה קודמת
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        earningsApi.summary({ period }),
        postsApi.list({ limit: 1, status: 'sent' }),
      ]);
      setSummary(s);
      setPostCount(p.total);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const totalRevenue = summary ? summary.total_settled + summary.total_estimated : 0;
  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const dailyAvg = totalRevenue / periodDays;
  const projectedMonthly = dailyAvg * 30;
  const commissionPerPost = postCount > 0 ? totalRevenue / postCount : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <BarChart3 size={12} />
            <span>דוחות</span>
          </div>
          <h1 className="text-2xl font-bold text-white">דוחות וניתוחים</h1>
          <p className="text-sm text-white/40 mt-1">נתח ביצועים ועקוב אחר הכנסות</p>
        </div>

        {/* Period selector */}
        <div className="flex bg-surface-secondary border border-edge rounded-xl p-1 gap-1">
          {UNIQUE_PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${period === p.value
                  ? 'bg-white/10 text-white'
                  : 'text-white/30 hover:text-white/60'
                }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Projection banner */}
          <div className="bg-gradient-to-r from-blue-600/10 to-violet-600/10 border border-blue-500/20 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={14} className="text-blue-400" />
              <p className="text-sm font-semibold text-white">תחזיות חודשיות</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-white/40 mb-1">ממוצע יומי (חודש נוכחי)</p>
                <p className="text-xl font-bold text-white">₪{dailyAvg.toFixed(2)}</p>
                <p className="text-2xs text-white/30">ממוצע יומי</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">תחזית חודשית</p>
                <p className="text-xl font-bold text-white">₪{projectedMonthly.toFixed(2)}</p>
                <p className="text-2xs text-white/30">תחזית הכנסות</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">סה"כ פוסטים</p>
                <p className="text-xl font-bold text-white">{postCount}</p>
                <p className="text-2xs text-white/30">פוסטים שנשלחו</p>
              </div>
              <div>
                <p className="text-xs text-white/40 mb-1">עמלה לפוסט</p>
                <p className="text-xl font-bold text-white">₪{commissionPerPost.toFixed(2)}</p>
                <p className="text-2xs text-white/30">ממוצע לפוסט</p>
              </div>
            </div>
          </div>

          {/* Main metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              label="הכנסות"
              value={`₪${totalRevenue.toFixed(2)}`}
              sub={`${period === 'all' ? 'סה"כ' : `${periodDays} ימים אחרונים`}`}
              icon={DollarSign}
              accent="green"
            />
            <MetricCard
              label="מוסדר"
              value={`₪${(summary?.total_settled || 0).toFixed(2)}`}
              sub="עמלות שאושרו"
              icon={Award}
              accent="blue"
            />
            <MetricCard
              label="משוער"
              value={`₪${(summary?.total_estimated || 0).toFixed(2)}`}
              sub="ממתין לאישור"
              icon={TrendingUp}
              accent="amber"
            />
            <MetricCard
              label="פוסטים שנשלחו"
              value={String(postCount)}
              sub="פוסטים פעילים"
              icon={FileText}
              accent="violet"
            />
          </div>

          {/* By campaign */}
          {summary && summary.by_campaign.length > 0 && (
            <div className="bg-surface-secondary border border-edge rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4">הכנסות לפי טייס אוטומטי</h3>
              <div className="space-y-3">
                {summary.by_campaign.map((c) => {
                  const maxVal = Math.max(...summary.by_campaign.map((x) => x.total));
                  const pct = maxVal > 0 ? (c.total / maxVal) * 100 : 0;
                  return (
                    <div key={c.campaign_id} className="flex items-center gap-4">
                      <p className="text-sm text-white/60 truncate w-36 shrink-0">{c.campaign_name}</p>
                      <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full transition-all duration-700"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-sm font-semibold text-white w-24 text-left shrink-0">
                        ₪{c.total.toFixed(2)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* By month */}
          {summary && summary.by_month.length > 0 && (
            <div className="bg-surface-secondary border border-edge rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4">התפלגות חודשית</h3>
              <div className="space-y-2">
                {summary.by_month.map((m) => (
                  <div key={m.month} className="flex items-center gap-4 text-sm">
                    <p className="text-white/40 w-24 shrink-0">{m.month}</p>
                    <div className="flex gap-4 flex-1">
                      <span className="text-blue-400">משוער: ₪{m.estimated.toFixed(2)}</span>
                      <span className="text-emerald-400">מוסדר: ₪{m.settled.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalRevenue === 0 && (
            <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 text-center">
              <BarChart3 size={36} className="text-white/15 mx-auto mb-4" />
              <p className="text-sm text-white/30">אין נתוני הכנסות לתקופה זו</p>
              <p className="text-xs text-white/20 mt-1">הפעל את הטייס האוטומטי כדי לראות נתונים כאן</p>
            </div>
          )}

          <PinterestPanel />
        </div>
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

  useEffect(() => {
    pinterestApi.analytics()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

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
          <div className="space-y-2">
            {data.pins.slice(0, 8).map((p) => (
              <div key={p.pin_id} className="flex items-center gap-3 py-2 px-3 bg-white/3 rounded-lg">
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
