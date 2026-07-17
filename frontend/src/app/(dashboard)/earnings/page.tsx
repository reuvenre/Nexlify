'use client';

import { DollarSign, RefreshCw, Loader2 } from 'lucide-react';
import { EarningsChart } from '@/components/earnings/EarningsChart';
import { StatCard } from '@/components/common/StatCard';
import { useEarnings } from '@/lib/hooks/useEarnings';

const PERIODS = [
  { label: '7 ימים',  value: '7d'  as const },
  { label: '30 ימים', value: '30d' as const },
  { label: '90 ימים', value: '90d' as const },
  { label: 'הכל',     value: 'all' as const },
];

const STATUS_LABEL = { estimated: 'משוער', settled: 'מוסדר', cancelled: 'בוטל' };
const STATUS_STYLE: Record<string, string> = {
  estimated: 'bg-blue-500/10 text-blue-400',
  settled:   'bg-emerald-500/10 text-emerald-400',
  cancelled: 'bg-red-500/10 text-red-400',
};

export default function EarningsPage() {
  const { summary, period, setPeriod, isLoading, sync } = useEarnings('30d');
  const [isSyncing, setIsSyncing] = React.useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    await sync().finally(() => setIsSyncing(false));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <DollarSign size={12} />
            <span>הכנסות</span>
          </div>
          <h1 className="text-2xl font-bold text-white">הכנסות ועמלות</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="flex bg-surface-secondary border border-edge rounded-xl p-1 gap-1">
            {PERIODS.map((p) => (
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

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-sm rounded-xl transition-all"
          >
            <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
            סנכרן
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : summary ? (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="מוסדר"
              value={`₪${summary.total_settled.toFixed(2)}`}
              icon={DollarSign}
              accent="green"
            />
            <StatCard
              label="משוער"
              value={`₪${summary.total_estimated.toFixed(2)}`}
              icon={DollarSign}
              accent="blue"
            />
            <StatCard
              label="בוטל"
              value={`₪${summary.total_cancelled.toFixed(2)}`}
              icon={DollarSign}
              accent="amber"
            />
          </div>

          {/* Chart */}
          <EarningsChart summary={summary} />

          {/* By campaign */}
          {summary.by_campaign.length > 0 && (
            <div className="bg-surface-secondary border border-edge rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4">לפי טייס אוטומטי</h3>
              <div className="space-y-2">
                {summary.by_campaign.map((c) => (
                  <div key={c.campaign_id} className="flex items-center gap-4">
                    <p className="flex-1 text-sm text-white/60 truncate">{c.campaign_name}</p>
                    <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{
                          width: `${Math.min(100, (c.total / Math.max(...summary.by_campaign.map((x) => x.total))) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-sm font-semibold text-white w-24 text-left">
                      ₪{c.total.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 text-center">
          <DollarSign size={36} className="text-white/15 mx-auto mb-4" />
          <p className="text-sm text-white/30">אין נתוני הכנסות עדיין</p>
        </div>
      )}
    </div>
  );
}

import React from 'react';
