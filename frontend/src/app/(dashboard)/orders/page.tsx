'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart, TrendingUp, DollarSign, CheckCircle2, Clock, XCircle,
  Loader2, AlertTriangle, Download,
} from 'lucide-react';
import { earningsApi } from '@/lib/api-client';
import type { Earning, EarningStatus } from '@/types';

/**
 * Real orders from AliExpress (aliexpress.affiliate.order.list, via the earnings sync).
 * Every figure on this screen comes from AliExpress — nothing is invented locally, and an
 * empty table means there genuinely are no commissionable orders yet.
 */

const STATUS_CFG: Record<EarningStatus, { label: string; cls: string; icon: React.ElementType }> = {
  settled: { label: 'שולם', cls: 'bg-emerald-500/10 text-emerald-400', icon: CheckCircle2 },
  estimated: { label: 'משוער', cls: 'bg-blue-500/10 text-blue-400', icon: Clock },
  cancelled: { label: 'בוטל', cls: 'bg-red-500/10 text-red-400', icon: XCircle },
};

const FILTERS: { key: 'all' | EarningStatus; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'estimated', label: 'משוער' },
  { key: 'settled', label: 'שולם' },
  { key: 'cancelled', label: 'בוטל' },
];

const LIMIT = 20;

export default function OrdersPage() {
  const [orders, setOrders] = useState<Earning[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | EarningStatus>('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError('');
    try {
      const res = await earningsApi.list({
        page: p, limit: LIMIT,
        status: filter === 'all' ? undefined : filter,
      });
      setOrders(res.data);
      setTotal(res.total);
      setPage(p);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'טעינת ההזמנות נכשלה');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(1); }, [load]);

  /** Pulls fresh orders from AliExpress — this is what actually populates the screen. */
  const handleSync = async () => {
    setSyncing(true); setError(''); setSyncMsg('');
    try {
      const r = await earningsApi.sync();
      setSyncMsg(`✓ ${r.synced} הזמנות חדשות · ${r.updated} עודכנו`);
      load(1);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הסנכרון נכשל — בדוק את פרטי ה-AliExpress בהגדרות');
    } finally {
      setSyncing(false);
    }
  };

  // Totals for the orders in view. Cancelled orders are excluded — they aren't money.
  const live = orders.filter((o) => o.status !== 'cancelled');
  const totalAmount = live.reduce((s, o) => s + (o.order_amount_usd || 0), 0);
  const totalComm = live.reduce((s, o) => s + (o.commission_usd || 0), 0);
  const commRate = totalAmount > 0 ? (totalComm / totalAmount) * 100 : 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">הזמנות</h1>
          <p className="text-sm text-white/40 mt-1">הזמנות ועמלות אמיתיות מ-AliExpress</p>
        </div>
        <button onClick={handleSync} disabled={syncing}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {syncing ? 'מסנכרן מ-AliExpress...' : 'סנכרן הזמנות'}
        </button>
      </div>

      {syncMsg && <p className="text-xs text-emerald-400 mb-4">{syncMsg}</p>}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/25 rounded-xl px-3.5 py-2.5 mb-4">
          <AlertTriangle size={13} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'אחוז עמלה', value: totalAmount > 0 ? `${commRate.toFixed(1)}%` : '—', icon: TrendingUp, accent: 'blue' },
          { label: 'סך הזמנות', value: `$${totalAmount.toFixed(2)}`, icon: DollarSign, accent: 'green' },
          { label: 'סך עמלות', value: `$${totalComm.toFixed(2)}`, icon: DollarSign, accent: 'violet' },
          { label: 'מספר הזמנות', value: total, icon: ShoppingCart, accent: 'amber' },
        ].map(({ label, value, icon: Icon, accent }) => {
          const map: Record<string, string> = {
            blue: 'text-blue-400 bg-blue-500/10', green: 'text-emerald-400 bg-emerald-500/10',
            violet: 'text-violet-400 bg-violet-500/10', amber: 'text-amber-400 bg-amber-500/10',
          };
          return (
            <div key={label} className="bg-surface-secondary border border-edge rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-white/40">{label}</p>
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${map[accent]}`}>
                  <Icon size={13} />
                </span>
              </div>
              <p className="text-xl font-bold text-white">{value}</p>
            </div>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex bg-surface-secondary border border-edge rounded-xl p-1 gap-1 mb-5 w-fit flex-wrap">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.key ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface-secondary border border-edge rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 size={22} className="animate-spin text-blue-400" /></div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center px-6">
            <ShoppingCart size={32} className="text-white/15 mx-auto mb-3" />
            <p className="text-sm font-medium text-white/50 mb-1">
              {filter === 'all' ? 'אין עדיין הזמנות' : 'אין הזמנות בסטטוס הזה'}
            </p>
            <p className="text-xs text-white/30 max-w-md mx-auto leading-relaxed">
              {filter === 'all'
                ? 'הזמנות מופיעות כאן אחרי שמישהו קונה דרך קישור השותפים שלך. לחץ "סנכרן הזמנות" כדי למשוך את הנתונים העדכניים מ-AliExpress.'
                : 'נסה סינון אחר.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge text-right text-2xs text-white/35">
                  <th className="px-4 py-3 font-medium">סטטוס</th>
                  <th className="px-4 py-3 font-medium">מזהה מוצר</th>
                  <th className="px-4 py-3 font-medium">סכום</th>
                  <th className="px-4 py-3 font-medium">עמלה</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">מזהה הזמנה</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const cfg = STATUS_CFG[o.status] || STATUS_CFG.estimated;
                  const StatusIcon = cfg.icon;
                  return (
                    <tr key={o.id} className="border-b border-edge last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-2xs px-2 py-0.5 rounded-full ${cfg.cls}`}>
                          <StatusIcon size={10} /> {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/45 font-mono text-xs" dir="ltr">{o.product_id}</td>
                      <td className="px-4 py-3 text-white/70 text-sm" dir="ltr">${(o.order_amount_usd || 0).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="text-emerald-400 font-medium text-sm" dir="ltr">${(o.commission_usd || 0).toFixed(2)}</span>
                        <span className="text-2xs text-white/30 block" dir="ltr">₪{(o.commission_ils || 0).toFixed(2)}</span>
                      </td>
                      <td className="px-4 py-3 text-white/45 font-mono text-xs hidden md:table-cell" dir="ltr">{o.order_id}</td>
                      <td className="px-4 py-3 text-2xs text-white/45 hidden md:table-cell">{fmtDate(o.order_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button disabled={page <= 1} onClick={() => load(page - 1)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/60 text-sm rounded-xl">הקודם</button>
          <span className="text-xs text-white/40">עמוד {page} מתוך {pages}</span>
          <button disabled={page >= pages} onClick={() => load(page + 1)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/60 text-sm rounded-xl">הבא</button>
        </div>
      )}

      <p className="text-2xs text-white/25 mt-5 leading-relaxed">
        הנתונים נמשכים ישירות מדוח ההזמנות של AliExpress. &quot;משוער&quot; = העמלה טרם אושרה סופית ·
        &quot;שולם&quot; = הועברה בפועל. הזמנות שבוטלו לא נספרות בסכומים.
      </p>
    </div>
  );
}
