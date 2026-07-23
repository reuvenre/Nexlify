'use client';

import { useEffect, useState } from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { integrationsApi, type ClickleadRoi } from '@/lib/api-client';

const nis = (n: number) =>
  (n || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });

/**
 * Scale-only ROI widget: the user's ClickLead campaigns (ad spend + leads)
 * joined with the affiliate commissions their Telegram groups earned here.
 * Renders nothing for non-Scale users, when the bridge isn't configured, or
 * when no campaign is ROI-tracked yet — the dashboard stays clean.
 */
export function ClickleadRoiPanel() {
  const { user } = useAuth();
  const isScale = user?.subscription_plan === 'scale';
  const [data, setData] = useState<ClickleadRoi | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isScale) { setLoading(false); return; }
    integrationsApi.clickleadRoi().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [isScale]);

  if (!isScale || loading || !data?.configured || data.campaigns.length === 0) return null;

  const totalSpend = data.campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalRevenue = data.campaigns.reduce((s, c) => s + (c.revenue_ils || 0), 0);
  const roas = totalSpend > 0 ? totalRevenue / totalSpend : null;

  return (
    <div className="card p-5 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 flex items-center justify-center text-emerald-300">
            <Target size={14} />
          </span>
          <h2 className="section-title">ROI קמפיינים (ClickLead)</h2>
        </div>
        {roas != null && (
          <span className={`flex items-center gap-1 text-xs font-semibold ${roas >= 1 ? 'text-emerald-300' : 'text-rose-300'}`}>
            <TrendingUp size={12} />
            ROAS ×{roas.toFixed(2)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div>
          <p className="text-lg font-bold text-white">{nis(totalSpend)}</p>
          <p className="text-[11px] text-white/35">הוצאה</p>
        </div>
        <div>
          <p className="text-lg font-bold text-emerald-300">{nis(totalRevenue)}</p>
          <p className="text-[11px] text-white/35">עמלות מהקבוצות</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">
            {data.campaigns.reduce((s, c) => s + (c.leads || 0), 0).toLocaleString('he-IL')}
          </p>
          <p className="text-[11px] text-white/35">לידים</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {data.campaigns.map((c) => (
          <div key={c.id} className="flex items-center justify-between text-xs bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
            <span className="text-white/70 truncate ml-3">{c.name || c.chat_id}</span>
            <span className="flex items-center gap-4 shrink-0 tabular-nums" dir="ltr">
              <span className="text-white/40">{nis(c.spend)} ←</span>
              <span className="text-emerald-300 font-medium">{nis(c.revenue_ils)}</span>
              <span className={`font-semibold ${c.roas != null && c.roas >= 1 ? 'text-emerald-300' : c.roas != null ? 'text-rose-300' : 'text-white/30'}`}>
                {c.roas != null ? `×${c.roas.toFixed(2)}` : '—'}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
