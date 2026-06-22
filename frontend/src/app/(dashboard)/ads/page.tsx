'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Rocket, Loader2, TrendingUp, MousePointerClick, Megaphone, DollarSign, Play } from 'lucide-react';
import { StatCard } from '@/components/common/StatCard';
import { adsApi } from '@/lib/api-client';
import type { AdBoost, AdsSummary, PerformanceRunResult } from '@/types';

const STATUS_STYLE: Record<string, string> = {
  boosted: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  skipped: 'bg-white/5 text-white/40 border-edge',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
};
const STATUS_LABEL: Record<string, string> = { boosted: 'קודם', skipped: 'דולג', failed: 'נכשל' };

export default function AdsPage() {
  const [summary, setSummary] = useState<AdsSummary | null>(null);
  const [boosts, setBoosts] = useState<AdBoost[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<PerformanceRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([adsApi.summary(), adsApi.list()])
      .then(([s, b]) => { setSummary(s); setBoosts(b); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const runPerformance = async () => {
    setRunning(true);
    setError(null);
    setRunResult(null);
    try {
      setRunResult(await adsApi.run());
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הרצת הביצועים נכשלה — ודא ש-Facebook ו-Meta Ads מוגדרים');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Rocket size={22} className="text-blue-400" /> מודעות Boost
          </h1>
          <p className="text-sm text-white/40 mt-1">
            ניטור פוסטים שפורסמו בפייסבוק וקידום אוטומטי של המנצחים כמודעות Meta Ads לפי ROAS
          </p>
        </div>
        <button
          onClick={runPerformance}
          disabled={running}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {running ? 'בודק ביצועים...' : 'הרץ בדיקת ביצועים'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="פוסטים שקודמו" value={summary?.boosted ?? 0} icon={Rocket} accent="green" />
        <StatCard label="פורסמו בפייסבוק" value={summary?.published ?? 0} icon={Megaphone} accent="blue" />
        <StatCard label="סך קליקים" value={summary?.total_clicks ?? 0} icon={MousePointerClick} accent="violet" />
        <StatCard label="ROAS ממוצע" value={summary?.avg_roas ?? 0} icon={TrendingUp} accent="amber" />
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>
      )}

      {runResult && (
        <div className="bg-surface-secondary border border-blue-500/25 rounded-xl px-5 py-4 mb-5 text-sm text-white/70">
          נבדקו <b className="text-white">{runResult.evaluated}</b> פוסטים ·
          קודמו <b className="text-emerald-400">{runResult.boosted}</b> ·
          דולגו <b className="text-white/50">{runResult.skipped}</b>
        </div>
      )}

      {/* Boost table */}
      <section className="bg-surface-secondary border border-edge rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-edge flex items-center gap-2">
          <DollarSign size={15} className="text-white/40" />
          <h3 className="text-sm font-semibold text-white">היסטוריית Boost</h3>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
        ) : boosts.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-white/40">עוד לא בוצעו בדיקות ביצועים.</p>
            <p className="text-xs text-white/25 mt-1">
              פרסם מוצרים לפייסבוק (ב<Link href="/settings" className="text-blue-400 hover:underline">הגדרות → אינטגרציות</Link>) ואז הרץ בדיקה.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-edge">
            {boosts.map((b) => (
              <div key={b.id} className="px-5 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{b.product_title || '—'}</p>
                  <p className="text-2xs text-white/30 mt-0.5">{b.note}</p>
                </div>
                <div className="text-center shrink-0 w-16">
                  <p className="text-sm font-semibold text-white">{b.clicks}</p>
                  <p className="text-2xs text-white/30">קליקים</p>
                </div>
                <div className="text-center shrink-0 w-16">
                  <p className="text-sm font-semibold text-white">{b.roas >= 999 ? '∞' : b.roas.toFixed(1)}</p>
                  <p className="text-2xs text-white/30">ROAS</p>
                </div>
                <span className={`text-2xs px-2.5 py-0.5 rounded-full border shrink-0 ${STATUS_STYLE[b.status] || STATUS_STYLE.skipped}`}>
                  {STATUS_LABEL[b.status] || b.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
