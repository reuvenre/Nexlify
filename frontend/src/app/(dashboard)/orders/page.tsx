'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingCart, TrendingUp, DollarSign, CheckCircle2, Clock, XCircle,
  Loader2, AlertTriangle, Download, CalendarRange, FileSearch, X, Upload, FileDown,
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

/**
 * Calendar month `offset` months back, as the yyyy-mm-dd pair the date inputs and the API
 * both speak. Built from local date parts rather than toISOString(), which would shift the
 * boundary by the UTC offset and drop the 1st of the month for anyone east of Greenwich.
 */
function monthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0); // day 0 = last of prev
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(start), to: fmt(end) };
}

const MONTH_LABEL = new Date().toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

export default function OrdersPage() {
  const [orders, setOrders] = useState<Earning[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ amount_usd: 0, commission_usd: 0, commission_ils: 0, count: 0 });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | EarningStatus>('all');
  // Default to the CURRENT MONTH, not all time. The totals above the table are the point of
  // this screen, and an all-time figure answers a question nobody asks day to day — it just
  // grows forever and makes "how am I doing this month?" unanswerable without manual filtering.
  const [from, setFrom] = useState(monthRange(0).from);
  const [to, setTo] = useState(monthRange(0).to);
  // 'paid' = filter by payment-completed time — the SAME definition as the AliExpress
  // portal's "Completed Payments Time", so counts match its screen 1:1.
  const [dateBasis, setDateBasis] = useState<'order' | 'paid'>('paid');
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
        from: from || undefined,
        to: to || undefined,
        date_basis: dateBasis,
      });
      setOrders(res.data);
      setTotal(res.total);
      setTotals(res.totals);
      setPage(p);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'טעינת ההזמנות נכשלה');
    } finally {
      setLoading(false);
    }
  }, [filter, from, to, dateBasis]);

  useEffect(() => { load(1); }, [load]);

  /**
   * Pulls fresh orders from AliExpress. The sync runs in the BACKGROUND server-side
   * (a full pass can outlive the host's request timeout — it used to show "failed"
   * while actually succeeding), so we start it and poll for the outcome.
   */
  const handleSync = async () => {
    setSyncing(true); setError(''); setSyncMsg('');
    try {
      await earningsApi.sync(); // starts (or joins) the background job
      const HE: Record<string, string> = {
        'Payment Completed': 'שולם',
        'Buyer Confirmed Goods Receipt': 'התקבל אצל הקונה',
        'Completed Settlement': 'הוסדר (עמלה אושרה)',
        Invalid: 'בוטל/נפסל',
      };
      setSyncMsg('⏳ הסנכרון רץ ברקע — התוצאה תופיע כאן בעוד רגע...');
      // Poll every 4s, up to 5 minutes.
      for (let i = 0; i < 75; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const s = await earningsApi.syncStatus().catch(() => null);
        if (!s || s.state === 'running') continue;
        if (s.state === 'error') {
          setSyncMsg('');
          setError(s.error || 'הסנכרון נכשל — בדוק את פרטי ה-AliExpress בהגדרות');
        } else if (s.state === 'done' && s.result) {
          const parts = Object.entries(s.result.by_status || {}).map(([api, d]: [string, any]) =>
            d?.error ? `${HE[api] || api}: ⚠️ ${d.error}` : `${HE[api] || api}: ${d?.found ?? 0}`);
          setSyncMsg(`✓ ${s.result.synced} הזמנות חדשות · ${s.result.updated} עודכנו${parts.length ? ` · נמצאו — ${parts.join(' · ')}` : ''}`);
          load(1);
        }
        break;
      }
    } catch (e: any) {
      setSyncMsg('');
      setError(e?.response?.data?.message || 'הסנכרון נכשל — בדוק את פרטי ה-AliExpress בהגדרות');
    } finally {
      setSyncing(false);
    }
  };

  // Totals come from the backend across the WHOLE filtered range (not just this page);
  // cancelled orders are already excluded server-side — they aren't money.
  const totalAmount = totals.amount_usd;
  const totalComm = totals.commission_usd;
  const commRate = totalAmount > 0 ? (totalComm / totalAmount) * 100 : 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  // The count card used `total` — every row matching the filter, CANCELLED INCLUDED — while
  // the three money cards beside it come from `totals`, which excludes cancelled server-side.
  // So one row of four described a different population than the rest, and the count silently
  // disagreed with the money above it. All four now describe the same orders.
  //
  // That leaves the count differing from the rows in the table, which DOES list cancelled —
  // so the difference is stated rather than left as a puzzle. On the "בוטל" tab there is
  // nothing to explain: every row is cancelled and the money cards are legitimately zero.
  const cancelledCount = filter === 'cancelled' ? 0 : Math.max(0, total - totals.count);
  const orderCount = filter === 'cancelled' ? total : totals.count;

  // Name the period the figures below cover. Without it a filtered total is indistinguishable
  // from an all-time one, which is exactly the confusion this screen had.
  const rangeLabel = (() => {
    if (!from && !to) return 'כל הזמנים';
    if (from === monthRange(0).from && to === monthRange(0).to) return MONTH_LABEL;
    if (from === monthRange(1).from && to === monthRange(1).to) return 'החודש שעבר';
    return `${from || '…'} — ${to || 'היום'}`;
  })();

  // Dates on the ALIEXPRESS clock (US Pacific) — the owner reconciles this table row-by-row
  // against the AliExpress portal, which logs orders on that clock. Israel-time dates here
  // put the same order on a different day than the portal and read as a wrong date.
  // Portal reconciliation: the export and our sync count the same thing (one row per
  // SUB-order), so "the portal says 67 and the system says 66" has one concrete answer —
  // which id is in the file and not in the DB. Reading 19-digit numbers by eye is how a
  // missing order stays missing.
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileRes, setReconcileRes] = useState<Awaited<ReturnType<typeof earningsApi.reconcile>> | null>(null);
  const [reconcileErr, setReconcileErr] = useState('');
  // The portal export is a file, and pasting 25KB of CSV into a phone textarea is not a
  // thing anyone should be asked to do. Reading the file locally sends the same text.
  const pickCsvFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setReconcileErr(''); setReconcileRes(null);
    setReconciling(true);
    try {
      setReconcileRes(await earningsApi.reconcile(text));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setReconcileErr(err?.response?.data?.message || 'ההשוואה נכשלה');
    } finally {
      setReconciling(false);
    }
  };

  // Our own orders as a file — the mirror of the portal export, for a side-by-side diff.
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await earningsApi.exportCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nexlify-orders.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setReconcileErr('הייצוא נכשל');
    } finally {
      setExporting(false);
    }
  };

  const runReconcile = async () => {
    setReconciling(true); setReconcileErr(''); setReconcileRes(null);
    try {
      setReconcileRes(await earningsApi.reconcile(csvText));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setReconcileErr(err?.response?.data?.message || 'ההשוואה נכשלה');
    } finally {
      setReconciling(false);
    }
  };

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">הזמנות</h1>
          <p className="text-sm text-white/40 mt-1">הזמנות ועמלות אמיתיות מ-AliExpress</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCsv} disabled={exporting}
            title="מוריד את ההזמנות שבמערכת כקובץ CSV — אותו פורמט כמו הייצוא מהפורטל"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/70 text-sm rounded-xl transition-all whitespace-nowrap">
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            ייצוא CSV
          </button>
          <button onClick={() => setReconcileOpen((v) => !v)}
            title="הדבק את קובץ ההזמנות מהפורטל — המערכת תגיד לך איזו הזמנה חסרה אצלה"
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 text-sm rounded-xl transition-all whitespace-nowrap">
            <FileSearch size={14} />
            השווה מול הפורטל
          </button>
          <button onClick={handleSync} disabled={syncing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all whitespace-nowrap">
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {syncing ? 'מסנכרן מ-AliExpress...' : 'סנכרן הזמנות'}
          </button>
        </div>
      </div>

      {syncMsg && <p className="text-xs text-emerald-400 mb-4">{syncMsg}</p>}

      {reconcileOpen && (
        <div className="mb-6 rounded-2xl border border-edge bg-surface-secondary p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileSearch size={15} className="text-blue-400" />
                השוואה מול פורטל השותפים
              </h3>
              <p className="text-xs text-white/40 mt-1">
                בפורטל: דוחות ← הזמנות ← ייצוא CSV. הדבק כאן את כל הקובץ (או רשימת מזהי הזמנה, שורה לכל אחת).
              </p>
            </div>
            <button onClick={() => setReconcileOpen(false)} className="text-white/30 hover:text-white/60 transition-colors">
              <X size={16} />
            </button>
          </div>

          <label className="mb-3 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-edge-hover bg-white/[0.03] hover:bg-white/[0.06] text-sm text-white/70 cursor-pointer transition-colors">
            <Upload size={15} />
            בחר את קובץ ה-CSV שהורדת מהפורטל
            <input type="file" accept=".csv,text/csv,text/plain" className="hidden"
              onChange={(e) => { pickCsvFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <p className="text-2xs text-white/30 mb-2">או הדבק את תוכן הקובץ ידנית:</p>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            dir="ltr"
            rows={5}
            placeholder='"CompletedPaymentsTime",...,"OrderID","SubOrderID",...'
            className="w-full bg-surface border border-edge rounded-xl px-3 py-2.5 text-xs text-white/80 font-mono resize-y"
          />
          <button onClick={runReconcile} disabled={reconciling || !csvText.trim()}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-xl transition-all">
            {reconciling ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={14} />}
            השווה
          </button>

          {reconcileErr && <p className="text-xs text-red-400 mt-3">⚠️ {reconcileErr}</p>}

          {reconcileRes && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-white/60">
                בקובץ: <span className="font-semibold text-white">{reconcileRes.portal_rows}</span> הזמנות ·
                נמצאו במערכת: <span className="font-semibold text-emerald-300">{reconcileRes.matched}</span> ·
                חסרות: <span className={`font-semibold ${reconcileRes.missing.length ? 'text-red-300' : 'text-emerald-300'}`}>{reconcileRes.missing.length}</span>
              </p>
              {reconcileRes.note && <p className="text-xs text-amber-300">{reconcileRes.note}</p>}

              {reconcileRes.missing.length === 0 && !reconcileRes.note && (
                <p className="text-sm text-emerald-300">✓ כל ההזמנות שבקובץ קיימות במערכת.</p>
              )}

              {!!reconcileRes.uncounted?.length && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-3 space-y-2">
                  <p className="text-xs text-amber-200">
                    {reconcileRes.uncounted.length === 1
                      ? 'הזמנה אחת מהקובץ קיימת במערכת אבל לא נספרת בסיכום שלמטה:'
                      : `${reconcileRes.uncounted.length} הזמנות מהקובץ קיימות במערכת אבל לא נספרות בסיכום שלמטה:`}
                  </p>
                  {reconcileRes.uncounted.map((u) => (
                    <div key={u.sub_order_id}>
                      <p className="text-sm text-white">{u.title || 'ללא כותרת'}</p>
                      <p className="text-xs text-amber-100/80 mt-0.5">{u.reason}</p>
                      <p className="text-2xs text-white/40 mt-0.5" dir="ltr">sub-order {u.sub_order_id}</p>
                    </div>
                  ))}
                </div>
              )}

              {reconcileRes.missing.map((m) => (
                <div key={m.sub_order_id} className="rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-3">
                  <p className="text-sm text-white font-medium">{m.title || 'ללא כותרת'}</p>
                  <p className="text-xs text-white/50 mt-1" dir="ltr">
                    sub-order {m.sub_order_id} · order {m.order_id} · product {m.product_id}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5">
                    {m.paid_at} · ${m.amount_usd.toFixed(2)} · עמלה ${m.commission_usd.toFixed(2)} · {m.status}
                  </p>
                </div>
              ))}

              {reconcileRes.extra_count > 0 && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-3">
                  <p className="text-xs text-amber-200">
                    {reconcileRes.extra_count} הזמנות קיימות אצלנו בטווח התאריכים של הקובץ ואינן מופיעות בו
                    (בדרך כלל הזמנה שבוטלה בפורטל):
                  </p>
                  <p className="text-xs text-white/50 mt-1" dir="ltr">
                    {reconcileRes.extra.map((e) => e.order_id).join(', ')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/25 rounded-xl px-3.5 py-2.5 mb-4">
          <AlertTriangle size={13} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-2 mb-2">
        <CalendarRange size={13} className="text-white/30" />
        <p className="text-xs text-white/45">
          מציג נתונים עבור <span className="font-semibold text-white/70">{rangeLabel}</span>
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'אחוז עמלה', value: totalAmount > 0 ? `${commRate.toFixed(1)}%` : '—', icon: TrendingUp, accent: 'blue' },
          { label: 'סך הזמנות', value: `$${totalAmount.toFixed(2)}`, icon: DollarSign, accent: 'green' },
          { label: 'סך עמלות', value: `$${totalComm.toFixed(2)}`, icon: DollarSign, accent: 'violet' },
          {
            label: 'מספר הזמנות', value: orderCount, icon: ShoppingCart, accent: 'amber',
            sub: cancelledCount > 0
              ? `+${cancelledCount} ${cancelledCount === 1 ? 'בוטלה' : 'בוטלו'} — מופיעות בטבלה, לא בסכומים`
              : null,
          },
        ].map(({ label, value, icon: Icon, accent, sub }) => {
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
              {sub && <p className="text-[10px] text-white/35 mt-1 leading-tight">{sub}</p>}
            </div>
          );
        })}
      </div>

      {/* Status filter */}
      <div className="flex bg-surface-secondary border border-edge rounded-xl p-1 gap-1 mb-5 w-fit flex-wrap overflow-x-auto max-w-full">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f.key ? 'bg-blue-600/20 text-blue-400' : 'text-white/40 hover:text-white/70'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-lg p-0.5 ml-1">
          {([
            { key: 'this', label: 'החודש', range: monthRange(0) },
            { key: 'last', label: 'חודש שעבר', range: monthRange(1) },
            { key: 'all', label: 'הכל', range: { from: '', to: '' } },
          ] as const).map((p) => {
            const active = from === p.range.from && to === p.range.to;
            return (
              <button key={p.key}
                onClick={() => { setFrom(p.range.from); setTo(p.range.to); }}
                className={`px-2.5 py-1 rounded-md text-2xs font-medium transition-all ${
                  active ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/70'
                }`}>
                {p.label}
              </button>
            );
          })}
        </div>
        <span className="text-2xs text-white/40 ml-1">טווח מותאם:</span>
        <input
          type="date" value={from} max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="bg-surface-secondary border border-edge rounded-lg px-3 py-1.5 text-xs text-white/70 outline-none focus:border-blue-500/50"
          dir="ltr"
        />
        <span className="text-white/30 text-xs">—</span>
        <input
          type="date" value={to} min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="bg-surface-secondary border border-edge rounded-lg px-3 py-1.5 text-xs text-white/70 outline-none focus:border-blue-500/50"
          dir="ltr"
        />
        {/* Date basis: 'paid' mirrors the AliExpress portal ("Completed Payments Time")
            so the count here matches its Live Order Tracking screen 1:1. */}
        <div className="flex items-center gap-1 mr-2 bg-surface-secondary border border-edge rounded-lg p-0.5">
          <button onClick={() => setDateBasis('paid')}
            className={`px-2.5 py-1 rounded-md text-2xs font-medium transition-all ${
              dateBasis === 'paid' ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/70'
            }`}
            title='לפי מועד השלמת התשלום — תואם 1:1 את מסך "Live Order Tracking" באלי אקספרס'>
            לפי תשלום
          </button>
          <button onClick={() => setDateBasis('order')}
            className={`px-2.5 py-1 rounded-md text-2xs font-medium transition-all ${
              dateBasis === 'order' ? 'bg-blue-600 text-white' : 'text-white/40 hover:text-white/70'
            }`}
            title="לפי מועד יצירת ההזמנה">
            לפי הזמנה
          </button>
        </div>
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
                  <th className="px-4 py-3 font-medium hidden md:table-cell">תאריך <span className="text-white/25 font-normal">(שעון אלי אקספרס)</span></th>
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
