'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText, RefreshCw, Loader2, RotateCcw,
  CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, Settings2,
  ListOrdered, Trash2, Package, AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';
import { postsApi, credentialsApi } from '@/lib/api-client';
import type { Post } from '@/types';

// ─── Estimated queue send times ───────────────────────────────────────────────
// Mirrors the scheduler: one post per interval, inside the [start,end) hour window,
// starting from the later of "now" and "last send + interval". Approximate on
// purpose (the cron ticks once a minute) — labelled as משוער in the UI.

interface ScheduleInfo {
  enabled: boolean;
  startHour: number;
  endHour: number;
  intervalMin: number;
  lastSentAt: Date | null;
}

function computeSendSlots(count: number, s: ScheduleInfo): Date[] {
  const slots: Date[] = [];
  const intervalMs = Math.max(1, s.intervalMin) * 60_000;
  let t = new Date(Math.max(
    Date.now(),
    s.lastSentAt ? s.lastSentAt.getTime() + intervalMs : 0,
  ));
  for (let i = 0; i < count; i++) {
    // Clamp into the sending window.
    for (let guard = 0; guard < 3; guard++) {
      const h = t.getHours();
      if (h < s.startHour) {
        t = new Date(t); t.setHours(s.startHour, 0, 0, 0);
      } else if (h >= s.endHour) {
        t = new Date(t.getTime() + 24 * 3600_000); t.setHours(s.startHour, 0, 0, 0);
      } else break;
    }
    slots.push(new Date(t));
    t = new Date(t.getTime() + intervalMs);
  }
  return slots;
}

function slotLabel(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600_000);
  const hm = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `היום ~${hm}`;
  if (d.toDateString() === tomorrow.toDateString()) return `מחר ~${hm}`;
  return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} ~${hm}`;
}

const STATUS_TABS = [
  { value: '',        label: 'הכל'     },
  { value: 'queued',  label: 'תור'      },
  { value: 'sent',    label: 'נשלח'    },
  { value: 'scheduled', label: 'מתוזמן' },
  { value: 'pending', label: 'ממתין'   },
  { value: 'failed',  label: 'נכשל'    },
] as const;

const STATUS_CONFIG: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
  sent:      { label: 'נשלח',    cls: 'bg-emerald-500/10 text-emerald-400',  Icon: CheckCircle2 },
  scheduled: { label: 'מתוזמן', cls: 'bg-purple-500/10 text-purple-400',    Icon: Clock },
  pending:   { label: 'ממתין',   cls: 'bg-blue-500/10 text-blue-400',        Icon: Clock },
  failed:    { label: 'נכשל',    cls: 'bg-red-500/10 text-red-400',          Icon: XCircle },
  queued:    { label: 'בתור',    cls: 'bg-amber-500/10 text-amber-400',      Icon: ListOrdered },
};

const LIMITS = [10, 20, 50, 100];

// ─── Queue Item ───────────────────────────────────────────────────────────────

function QueueItem({
  post, index, sendAt, onRemove,
}: {
  post: Post;
  index: number;
  /** Estimated send time (null when the queue is disabled). */
  sendAt: Date | null;
  onRemove: (id: string) => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!confirm('להסיר מוצר זה מהתור?')) return;
    setRemoving(true);
    await onRemove(post.id).catch(() => {});
    setRemoving(false);
  };

  return (
    <div className="group relative bg-surface-secondary border border-edge rounded-2xl overflow-hidden hover:border-edge-hover hover:-translate-y-0.5 transition-all duration-300">
      {/* Image */}
      <div className="relative h-40 bg-white/[0.04]">
        {post.product_image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={post.product_image} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package size={28} className="text-white/15" />
          </div>
        )}

        {/* Position badge */}
        <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-amber-500 text-black text-xs font-extrabold flex items-center justify-center shadow-md">
          {index + 1}
        </div>

        {/* Estimated send time — the headline info of a queue */}
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-black/65 backdrop-blur-sm text-white text-2xs font-medium rounded-full px-2.5 py-1">
          <Clock size={10} className="text-amber-400" />
          {sendAt ? `יישלח ${slotLabel(sendAt)}` : 'התור כבוי — הפעל בהגדרות'}
        </div>

        {/* Remove */}
        <button
          onClick={handleRemove}
          disabled={removing}
          className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/55 hover:bg-red-600 text-white/80 hover:text-white flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all disabled:opacity-60"
          title="הסר מהתור"
        >
          {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        </button>
      </div>

      {/* Body */}
      <div className="p-3.5">
        <p className="text-sm font-medium text-white/85 line-clamp-2 leading-snug min-h-[2.5rem]">{post.product_title}</p>
        <p className="text-xs text-white/35 line-clamp-2 leading-relaxed mt-1.5 min-h-[2rem]">
          {post.generated_text?.replace(/<[^>]+>/g, '').slice(0, 110)}
        </p>
        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-edge">
          <span className="text-sm font-bold text-white">₪{post.price_ils?.toFixed(2)}</span>
          <span className="text-2xs text-white/25">
            נוסף {new Date(post.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Queue Panel ──────────────────────────────────────────────────────────────

function QueuePanel() {
  const [queue, setQueue] = useState<Post[]>([]);
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [data, creds] = await Promise.all([
        postsApi.listQueue(),
        credentialsApi.get().catch(() => null),
      ]);
      setQueue(data);
      if (creds) {
        setSchedule({
          enabled: creds.schedule_enabled === true,
          startHour: creds.schedule_start_hour ?? 9,
          endHour: creds.schedule_end_hour ?? 22,
          intervalMin: creds.schedule_interval_minutes ?? 60,
          lastSentAt: creds.schedule_last_sent_at ? new Date(creds.schedule_last_sent_at) : null,
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (id: string) => {
    await postsApi.dequeue(id);
    load(true);
  };

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <ListOrdered size={13} className="text-amber-400" />
            <span className="text-body font-medium text-amber-400">{queue.length} מוצרים בתור</span>
          </div>
          {queue.length > 0 && (
            <p className="text-xs text-white/30">
              שליחה אוטומטית לפי הגדרות התזמון
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-xs rounded-xl transition-all"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            רענן
          </button>
          <Link
            href="/settings"
            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-xl transition-all"
          >
            <Settings2 size={12} />
            הגדרות תזמון
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-amber-400" />
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 text-center">
          <ListOrdered size={36} className="text-white/15 mx-auto mb-4" />
          <p className="text-sm font-medium text-white/40 mb-1">התור ריק</p>
          <p className="text-xs text-white/25">
            לך לעמוד המוצרים ולחץ על "הוסף לתור" כדי להתחיל
          </p>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 text-amber-400 text-xs font-medium rounded-xl transition-all"
          >
            <Package size={13} />
            עבור למוצרים
          </Link>
        </div>
      ) : (
        <>
          {/* Info banner — states the actual pace so "added minutes apart" isn't
              mistaken for "will send minutes apart" */}
          <div className="flex items-start gap-3 p-3.5 bg-amber-500/8 border border-amber-500/15 rounded-xl mb-4">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-amber-400/80 font-medium">תור שליחה אוטומטית</p>
              <p className="text-xs text-white/35 mt-0.5 leading-relaxed">
                {schedule?.enabled
                  ? `פוסט אחד נשלח כל ${schedule.intervalMin} דק׳, בין ${String(schedule.startHour).padStart(2, '0')}:00 ל-${String(schedule.endHour).padStart(2, '0')}:00 — זמן השליחה המשוער מופיע על כל כרטיס. ניתן לשנות בהגדרות ← תזמון אוטומטי.`
                  : '⚠️ התור כבוי — הפוסטים לא יישלחו עד שתפעיל אותו בהגדרות ← תזמון אוטומטי.'}
              </p>
            </div>
          </div>

          {/* Card grid ("windows" style) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {(() => {
              const slots = schedule?.enabled ? computeSendSlots(queue.length, schedule) : [];
              return queue.map((post, idx) => (
                <QueueItem
                  key={post.id}
                  post={post}
                  index={idx}
                  sendAt={schedule?.enabled ? slots[idx] : null}
                  onRemove={handleRemove}
                />
              ));
            })()}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Post Row ─────────────────────────────────────────────────────────────────

function PostRow({ post, onRetry }: { post: Post; onRetry: (id: string) => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const cfg = STATUS_CONFIG[post.status] || STATUS_CONFIG.pending;

  const handleRetry = async () => {
    setRetrying(true);
    await onRetry(post.id).catch(() => {});
    setRetrying(false);
  };

  return (
    <tr className="border-t border-edge hover:bg-white/[0.02] transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          {post.product_image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={post.product_image} alt="" className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-white/5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm text-white truncate max-w-xs">{post.product_title}</p>
            {post.campaign_name && (
              <p className="text-xs text-white/30">{post.campaign_name}</p>
            )}
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${cfg.cls}`}>
          <cfg.Icon size={11} />
          {cfg.label}
        </span>
      </td>
      <td className="py-3 px-4 text-sm text-white/50">
        ₪{post.price_ils?.toFixed(2) || '—'}
      </td>
      <td className="py-3 px-4 text-xs text-white/30">
        {post.status === 'scheduled' && post.scheduled_at ? (
          <span className="text-purple-400">
            🕐 {new Date(post.scheduled_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : post.sent_at ? (
          new Date(post.sent_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        ) : (
          new Date(post.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        )}
      </td>
      <td className="py-3 px-4">
        {post.status === 'failed' && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 rounded-lg transition-all"
          >
            {retrying ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            נסה שוב
          </button>
        )}
        {post.error_message && (
          <p className="text-2xs text-red-400/70 mt-1 max-w-[180px] truncate" title={post.error_message}>
            {post.error_message}
          </p>
        )}
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isQueueTab = status === 'queued';

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (isQueueTab) return; // Queue tab manages its own state
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await postsApi.list({ page, limit, status: status || undefined });
      setPosts(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, limit, status, isQueueTab]);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (id: string) => {
    await postsApi.retry(id);
    load({ silent: true });
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <FileText size={12} />
            <span>פוסטים</span>
          </div>
          <h1 className="text-2xl font-bold text-white">ניהול פוסטים</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/posts/settings"
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all">
            <Settings2 size={13} />
            הגדרות
          </Link>
          {!isQueueTab && (
            <button
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-sm rounded-xl transition-all"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              רענן
            </button>
          )}
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-xl p-1 mb-6 w-fit">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setStatus(t.value); setPage(1); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${status === t.value
                ? t.value === 'queued'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-blue-600/20 text-blue-400'
                : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
          >
            {t.value === 'queued' && <ListOrdered size={12} />}
            {t.label}
          </button>
        ))}
      </div>

      {/* Queue panel */}
      {isQueueTab ? (
        <QueuePanel />
      ) : loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 text-center">
          <FileText size={36} className="text-white/15 mx-auto mb-4" />
          <p className="text-sm text-white/30">אין פוסטים</p>
        </div>
      ) : (
        <div className="bg-surface-secondary border border-edge rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="text-xs text-white/30 border-b border-edge">
                <th className="py-3 px-4 text-right font-medium">מוצר</th>
                <th className="py-3 px-4 text-right font-medium">סטטוס</th>
                <th className="py-3 px-4 text-right font-medium">מחיר</th>
                <th className="py-3 px-4 text-right font-medium">תאריך</th>
                <th className="py-3 px-4 text-right font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <PostRow key={p.id} post={p} onRetry={handleRetry} />
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-edge">
            <div className="flex items-center gap-2 text-xs text-white/30">
              <span>שורות:</span>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                className="bg-white/5 border border-edge-hover rounded-lg px-2 py-1 text-white/60 outline-none"
              >
                {LIMITS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span>מתוך {total}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
              <span className="text-xs text-white/50 px-2">עמוד {page} מתוך {totalPages || 1}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
