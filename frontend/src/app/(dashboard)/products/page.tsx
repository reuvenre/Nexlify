'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, Plus, RefreshCw, Trash2, Link2, RotateCw,
  FileText, Pencil, XCircle, CheckCircle2, ShoppingBag,
  Star, X, Upload, Globe, Tag, Loader2, AlertCircle,
  CheckCheck, Package, ListOrdered, Clock,
} from 'lucide-react';
import { catalogApi, postsApi } from '@/lib/api-client';
import type { CatalogProduct, CatalogStats } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SYMS: Record<string, string> = { ILS: '₪', EUR: '€', GBP: '£', USD: '$' };
const sym = (c: string) => SYMS[c] || '$';

function fmt(n: number) {
  return n.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function fmtOrders(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'ממתין',
  approved: 'אושר',
  rejected: 'נדחה',
};
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  approved: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/25',
};

// ─── Import Modal ─────────────────────────────────────────────────────────────

function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<'single' | 'bulk'>('single');
  const [input, setInput] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleImport() {
    if (!input.trim()) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const isUrl = input.trim().startsWith('http');
      await catalogApi.importProduct({
        [isUrl ? 'url' : 'product_id']: input.trim(),
        category: category || undefined,
      });
      setSuccess('המוצר נוסף לקטלוג בהצלחה!');
      setInput('');
      setCategory('');
      setTimeout(() => { onImported(); onClose(); }, 1200);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setError(msg || 'שגיאה בייבוא המוצר');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ direction: 'rtl' }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-secondary border border-edge rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge">
          <div>
            <h2 className="text-[15px] font-semibold text-white">ייבא מוצרים</h2>
            <p className="text-xs text-white/40 mt-0.5">ייבא מוצרים מ-AliExpress לקטלוג שלך</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all"
          >
            <X size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-edge px-6 pt-4">
          {(['single', 'bulk'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 px-1 ml-6 text-body font-medium border-b-2 transition-all ${
                tab === t
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-white/35 hover:text-white/60'
              }`}
            >
              {t === 'single' ? 'מוצר יחיד' : 'ייבוא מקובץ'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {tab === 'single' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">
                  כתובת URL או מזהה מוצר
                </label>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleImport()}
                  placeholder="https://aliexpress.com/item/... או מזהה מוצר"
                  dir="ltr"
                  className="w-full bg-surface-tertiary border border-edge rounded-xl px-3.5 py-2.5 text-body text-white/80 placeholder-white/20 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">קטגוריה (אופציונלי)</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="למשל: Electronics"
                  className="w-full bg-surface-tertiary border border-edge rounded-xl px-3.5 py-2.5 text-body text-white/80 placeholder-white/20 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 border-2 border-dashed border-edge rounded-xl">
              <Upload size={28} className="text-white/20 mb-3" />
              <p className="text-body text-white/40 text-center">
                CSV עם עמודות product_id, category
              </p>
              <p className="text-xs text-white/25 mt-1">בקרוב — תכונה זו בפיתוח</p>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
              <AlertCircle size={13} className="text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3.5 py-2.5">
              <CheckCheck size={13} className="text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-400">{success}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-edge">
          <button
            onClick={onClose}
            className="text-body text-white/40 hover:text-white/70 transition-colors"
          >
            ביטול
          </button>
          {tab === 'single' && (
            <button
              onClick={handleImport}
              disabled={loading || !input.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-body font-semibold rounded-xl transition-all"
            >
              {loading && <Loader2 size={13} className="animate-spin" />}
              <Upload size={13} />
              הוסף מוצר
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Action Button ─────────────────────────────────────────────────────────────

function ActionBtn({
  icon: Icon, label, onClick, color = 'default', loading = false, disabled = false,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  color?: 'default' | 'red' | 'green' | 'purple' | 'blue';
  loading?: boolean;
  disabled?: boolean;
}) {
  const colors: Record<string, string> = {
    default: 'text-white/35 hover:text-white/75 hover:bg-white/[0.07]',
    red: 'text-red-400/60 hover:text-red-400 hover:bg-red-500/10',
    green: 'text-emerald-400/60 hover:text-emerald-400 hover:bg-emerald-500/10',
    purple: 'text-violet-400/60 hover:text-violet-400 hover:bg-violet-500/10',
    blue: 'text-blue-400/60 hover:text-blue-400 hover:bg-blue-500/10',
  };
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled || loading}
      className={`relative group/btn w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${colors[color]}`}
    >
      {loading
        ? <Loader2 size={13} className="animate-spin" />
        : <Icon size={13} />
      }
      {/* Tooltip */}
      <span className="absolute bottom-full mb-1.5 right-1/2 translate-x-1/2 px-2 py-0.5 bg-[var(--bg-tertiary)] border border-[var(--border)] text-2xs text-[var(--text-muted)] rounded-md whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none z-20">
        {label}
      </span>
    </button>
  );
}

// ─── Product Row ──────────────────────────────────────────────────────────────

function ProductRow({
  product,
  onRefresh,
}: {
  product: CatalogProduct;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [loadingSync, setLoadingSync] = useState(false);
  const [loadingLink, setLoadingLink] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queued, setQueued] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduling, setScheduling] = useState(false);

  // min = now + 2 min (can't schedule in the past)
  const minDateTime = new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16);

  async function handleSchedule() {
    if (!scheduledAt) return;
    setScheduling(true);
    try {
      await postsApi.schedulePost({
        product_id: product.product_id,
        scheduled_at: new Date(scheduledAt).toISOString(),
        text: product.post_text || undefined,
        product_image: product.image_url || undefined,
        affiliate_url: product.affiliate_url || undefined,
      });
      setShowSchedule(false);
      setScheduledAt('');
      onRefresh();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'שגיאה בתזמון הפוסט');
    } finally {
      setScheduling(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`למחוק את "${product.title.slice(0, 40)}..."?`)) return;
    await catalogApi.remove(product.id);
    onRefresh();
  }

  async function handleCopyLink() {
    setLoadingLink(true);
    try {
      let url = product.affiliate_url;
      if (!url) {
        const res = await catalogApi.affiliateLink(product.id);
        url = res.url;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setLoadingLink(false);
    }
  }

  async function handleSync() {
    setLoadingSync(true);
    try {
      await catalogApi.sync(product.id);
      onRefresh();
    } finally {
      setLoadingSync(false);
    }
  }

  function handleCreatePost() {
    // Store product in sessionStorage for quick-post to pick up
    sessionStorage.setItem('quick_post_catalog_product', JSON.stringify({
      product_id: product.product_id,
      title: product.title,
      original_price: product.original_price,
      sale_price: product.sale_price,
      discount_percent: product.discount_percent,
      image_url: product.image_url,
      product_url: product.product_url,
      affiliate_url: product.affiliate_url,
      category: product.category,
      orders_count: product.orders_count,
      rating: product.rating,
      currency: product.currency,
    }));
    router.push('/quick-post?from_catalog=1');
  }

  async function handleQueue() {
    setLoadingQueue(true);
    try {
      await catalogApi.queue(product.id);
      setQueued(true);
      setTimeout(() => setQueued(false), 3000);
      onRefresh();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'שגיאה בהוספה לתור');
    } finally {
      setLoadingQueue(false);
    }
  }

  async function handleApprove() {
    setLoadingStatus(true);
    try { await catalogApi.approve(product.id); onRefresh(); }
    finally { setLoadingStatus(false); }
  }

  async function handleReject() {
    setLoadingStatus(true);
    try { await catalogApi.reject(product.id); onRefresh(); }
    finally { setLoadingStatus(false); }
  }

  const s = sym(product.currency);
  const hasDiscount = product.discount_percent > 0 && product.original_price > product.sale_price;

  return (
    <tr className="border-b border-edge hover:bg-white/[0.02] transition-colors group">
      {/* Product */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Image */}
          <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-white/[0.04] shrink-0">
            {product.image_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={product.image_url}
                alt={product.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package size={16} className="text-white/20" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0">
            <p className="text-xs text-white/75 line-clamp-1 leading-tight mb-1">
              {product.title}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {product.supplier && (
                <span className="text-2xs text-blue-400/70">{product.supplier}</span>
              )}
              <span className="text-2xs text-white/25">{product.product_id}</span>
              {product.rating > 0 && (
                <span className="flex items-center gap-0.5">
                  <Star size={8} className="text-amber-400 fill-amber-400" />
                  <span className="text-2xs text-white/45">{product.rating.toFixed(1)}</span>
                </span>
              )}
              {product.has_post && (
                <span className="px-1.5 py-0.5 bg-blue-500/15 border border-blue-500/25 text-[9px] text-blue-400 rounded-md font-medium">
                  פוסט
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Price */}
      <td className="px-4 py-3 text-right">
        <p className="text-body font-semibold text-white">{s}{fmt(product.sale_price)}</p>
        {hasDiscount && (
          <p className="text-2xs text-white/25 line-through">{s}{fmt(product.original_price)}</p>
        )}
        {hasDiscount && (
          <span className="text-[9px] text-red-400 font-medium">-{product.discount_percent}%</span>
        )}
      </td>

      {/* Commission */}
      <td className="px-4 py-3 text-right">
        {product.commission_rate > 0 ? (
          <div>
            <p className="text-xs text-emerald-400 font-medium">{product.commission_rate}%</p>
            <p className="text-2xs text-white/30">
              {s}{(product.sale_price * product.commission_rate / 100).toFixed(2)}
            </p>
          </div>
        ) : (
          <span className="text-xs text-white/20">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium ${STATUS_COLORS[product.status]}`}>
          {STATUS_LABELS[product.status]}
        </span>
      </td>

      {/* Date */}
      <td className="px-4 py-3 text-right">
        <p className="text-xs text-white/30">{fmtDate(product.created_at)}</p>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-0.5">
          <ActionBtn icon={Trash2} label="מחק מוצר" onClick={handleDelete} color="red" />
          <ActionBtn icon={copied ? CheckCheck : Link2} label={copied ? 'הועתק!' : 'העתק קישור שותפים'} onClick={handleCopyLink} color="blue" loading={loadingLink} />
          <ActionBtn icon={RotateCw} label="סנכרן נתונים" onClick={handleSync} color="blue" loading={loadingSync} />
          <ActionBtn icon={FileText} label="צור פוסט" onClick={handleCreatePost} color="purple" />
          <ActionBtn icon={Clock} label="תזמן פוסט" onClick={() => setShowSchedule(true)} color="purple" />
          <ActionBtn icon={queued ? CheckCheck : ListOrdered} label={queued ? 'נוסף לתור!' : 'הוסף לתור'} onClick={handleQueue} color="blue" loading={loadingQueue} />
          <ActionBtn icon={Pencil} label="ערוך מוצר" onClick={() => router.push(`/products/${product.id}/edit`)} color="blue" />
          <ActionBtn icon={XCircle} label="דחה מוצר" onClick={handleReject} color="red" loading={loadingStatus && product.status !== 'rejected'} />
          <ActionBtn icon={CheckCircle2} label="אשר מוצר" onClick={handleApprove} color="green" loading={loadingStatus && product.status !== 'approved'} />
        </div>

        {showSchedule && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowSchedule(false)}
          >
            <div
              className="bg-surface-secondary border border-edge rounded-2xl p-5 w-[360px] shadow-elevated"
              onClick={(e) => e.stopPropagation()}
              style={{ direction: 'rtl' }}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Clock size={14} className="text-blue-400" /> תזמון פרסום
                </h3>
                <button onClick={() => setShowSchedule(false)} className="text-white/30 hover:text-white/60">
                  <X size={14} />
                </button>
              </div>
              <p className="text-xs text-white/40 line-clamp-1 mb-3">{product.title}</p>

              {!product.post_text && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                  <AlertCircle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-2xs text-amber-400">
                    אין פוסט שמור — ייווצר טקסט אוטומטי. לשליטה בתוכן, ערוך ושמור פוסט קודם.
                  </p>
                </div>
              )}

              <label className="block text-2xs text-white/40 mb-1.5">תאריך ושעה לפרסום</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={minDateTime}
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 transition-colors mb-4"
                dir="ltr"
              />
              <button
                onClick={handleSchedule}
                disabled={!scheduledAt || scheduling}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
              >
                {scheduling ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />}
                {scheduling ? 'מתזמן...' : 'תזמן פרסום'}
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [postFilter, setPostFilter] = useState<'all' | 'has' | 'none'>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Import modal
  const [showImport, setShowImport] = useState(false);

  // Bulk price re-sync
  const [repricing, setRepricing] = useState(false);
  const [repriceMsg, setRepriceMsg] = useState('');

  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const resyncTimer = useRef<ReturnType<typeof setInterval>>();

  // Clear the re-price poll if the user navigates away mid-job (was leaking
  // requests + setState-on-unmounted every 2.5s until the server job finished).
  useEffect(() => () => clearInterval(resyncTimer.current), []);

  const load = useCallback(async (p = 1, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const hasPost = postFilter === 'has' ? true : postFilter === 'none' ? false : undefined;
      const [res, st] = await Promise.all([
        catalogApi.list({
          page: p, limit: LIMIT,
          status: statusFilter === 'all' ? undefined : statusFilter,
          has_post: hasPost,
          search: search || undefined,
        }),
        catalogApi.stats(),
      ]);
      setProducts(res.data);
      setTotal(res.total);
      setStats(st);
      setPage(p);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, postFilter, search]);

  useEffect(() => { load(1); }, [load]);

  // Debounced search
  function handleSearchChange(val: string) {
    setSearchInput(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(val), 400);
  }

  // Bulk re-price: starts a BACKGROUND job on the server and polls its progress —
  // a whole-catalog sync outlives any single HTTP request, so the old "wait for
  // one response" approach timed out and looked like nothing happened.
  const handleResyncPrices = async () => {
    if (!confirm('לתקן מחירים לכל המוצרים בקטלוג מ-AliExpress?')) return;
    setRepricing(true);
    setRepriceMsg('');
    try {
      const startRes = await catalogApi.resyncPrices();
      if (!startRes.started && startRes.running) {
        setRepriceMsg('סנכרון כבר רץ ברקע — ממתין לסיום...');
      }

      // Poll progress every 2.5s until the job finishes (timer ref → cleared on unmount).
      const final = await new Promise<typeof startRes>((resolve, reject) => {
        resyncTimer.current = setInterval(async () => {
          try {
            const s = await catalogApi.resyncStatus();
            if (s.running) {
              setRepriceMsg(`מסנכרן מחירים... ${s.done}/${s.total}`);
            } else {
              clearInterval(resyncTimer.current);
              resolve(s);
            }
          } catch (e) {
            clearInterval(resyncTimer.current);
            reject(e);
          }
        }, 2500);
      });

      setRepriceMsg(`✓ עודכנו ${final.updated} מתוך ${final.total} מוצרים${final.failed ? ` · ${final.failed} לא נמצאו` : ''}`);
      await load(page, true);
      setTimeout(() => setRepriceMsg(''), 10000);
    } catch {
      setRepriceMsg('שגיאה בעדכון המחירים');
    } finally {
      setRepricing(false);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  const STATUS_TABS = [
    { key: 'all', label: 'הכל', count: stats?.total },
    { key: 'approved', label: 'אושר', count: stats?.approved, color: 'emerald' },
    { key: 'pending', label: 'ממתין', count: stats?.pending, color: 'amber' },
    { key: 'rejected', label: 'נדחה', count: stats?.rejected, color: 'red' },
  ];

  return (
    <div style={{ direction: 'rtl' }}>
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => load(1, true)}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">מוצרים</h1>
          <p className="text-body text-white/35 mt-1">נהל את קטלוג המוצרים שלך</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/products/discover')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] hover:bg-blue-500/[0.14] text-xs text-blue-400 hover:text-blue-300 font-medium transition-all"
          >
            <Search size={12} />
            גלה מוצרים
          </button>
          <button
            onClick={handleResyncPrices}
            disabled={repricing}
            title="מושך מחדש מחירים נכונים מ-AliExpress לכל המוצרים"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] hover:bg-amber-500/[0.14] text-xs text-amber-400 hover:text-amber-300 font-medium transition-all disabled:opacity-50"
          >
            <Tag size={12} className={repricing ? 'animate-pulse' : ''} />
            {repricing ? 'מתקן מחירים...' : 'תקן מחירים'}
          </button>
          <button
            onClick={() => load(page, true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-edge bg-white/[0.03] hover:bg-white/[0.06] text-xs text-white/55 hover:text-white/80 transition-all disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            רענן
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-body font-semibold transition-all shadow-sm shadow-blue-600/20"
          >
            <Plus size={13} />
            ייבא מוצרים
          </button>
        </div>
      </div>

      {repriceMsg && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3.5 py-2.5 mb-4">
          <Tag size={13} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-400">{repriceMsg}</p>
        </div>
      )}

      {/* ── Stats Bar ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          {
            label: 'סה"כ מוצרים',
            value: stats?.total ?? '—',
            sub: stats ? `${stats.approved} פעיל` : '',
            icon: Package,
          },
          {
            label: 'מוצרים פעילים',
            value: stats?.approved ?? '—',
            sub: stats?.total ? `${Math.round((stats.approved / stats.total) * 100)}% מהכלל` : '',
            icon: CheckCircle2,
          },
          {
            label: 'קטגוריות',
            value: stats?.categories ?? '—',
            sub: 'קטגוריות',
            icon: Tag,
          },
          {
            label: 'ספק',
            value: stats?.suppliers ?? '—',
            sub: 'AliExpress',
            icon: Globe,
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-surface-secondary border border-edge rounded-xl px-4 py-3.5"
          >
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={13} className="text-white/25" />
              <span className="text-xs text-white/35">{card.label}</span>
            </div>
            <p className="text-[22px] font-bold text-white leading-none">{card.value}</p>
            {card.sub && <p className="text-xs text-white/30 mt-1">{card.sub}</p>}
          </div>
        ))}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="bg-surface-secondary border border-edge rounded-xl mb-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          {/* Search */}
          <div className="relative w-72">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="חפש מוצרים לפי כותרת או מזהה מוצר..."
              className="w-full bg-surface-tertiary border border-edge rounded-xl pr-8 pl-3.5 py-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/15 transition-all"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-white/30 ml-2">סטטוס:</span>
            {STATUS_TABS.map((tab) => {
              const colorMap: Record<string, string> = {
                emerald: 'bg-emerald-500 hover:bg-emerald-600',
                amber: 'bg-amber-500 hover:bg-amber-600',
                red: 'bg-red-500 hover:bg-red-600',
              };
              const isActive = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? tab.color
                        ? `${colorMap[tab.color]} text-white`
                        : 'bg-[var(--bg-tertiary)] text-[var(--text)] border border-[var(--border-hover)]'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`text-2xs ${isActive ? 'opacity-80' : 'opacity-50'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Post filter */}
            <div className="flex items-center gap-1 mr-2 border-r border-edge pr-2">
              {(['all', 'has', 'none'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setPostFilter(f)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${
                    postFilter === f
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text)] border border-[var(--border)]'
                      : 'text-white/30 hover:text-white/55 border border-transparent'
                  }`}
                >
                  <FileText size={10} />
                  {f === 'all' ? 'הכל' : f === 'has' ? 'יש פוסט' : 'אין פוסט'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Table ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-blue-500" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-edge flex items-center justify-center mb-4">
              <ShoppingBag size={22} className="text-white/20" />
            </div>
            <p className="text-sm font-medium text-white/50">אין מוצרים בקטלוג</p>
            <p className="text-xs text-white/25 mt-1 mb-4">ניתן לייבא מוצרים מ-AliExpress או לגלות מוצרים</p>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-body font-semibold rounded-xl transition-all"
            >
              <Plus size={13} /> ייבא מוצרים
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge">
                  {[
                    { label: 'מוצר', className: 'text-right' },
                    { label: 'מחיר', className: 'text-right' },
                    { label: 'עמלה', className: 'text-right' },
                    { label: 'סטטוס', className: 'text-right' },
                    { label: 'נוצר', className: 'text-right' },
                    { label: 'פעולות', className: 'text-right' },
                  ].map((col) => (
                    <th
                      key={col.label}
                      className={`px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-white/25 ${col.className}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <ProductRow key={p.id} product={p} onRefresh={() => load(page, true)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ───────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
            <p className="text-xs text-white/30">
              מציג {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} מתוך {total}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => load(page - 1)}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                הקודם
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                if (pageNum < 1 || pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    onClick={() => load(pageNum)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${
                      pageNum === page
                        ? 'bg-blue-600 text-white'
                        : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => load(page + 1)}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.05] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                הבא
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
