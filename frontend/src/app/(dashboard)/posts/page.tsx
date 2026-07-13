'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText, RefreshCw, Loader2, RotateCcw,
  CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, Settings2,
  ListOrdered, Trash2, Package, AlertTriangle, Pencil, X, Save, SendHorizontal, Eye, Users, Megaphone,
} from 'lucide-react';
import Link from 'next/link';
import { postsApi, credentialsApi, channelsApi } from '@/lib/api-client';
import { GroupMultiSelect } from '@/components/GroupMultiSelect';
import type { Post, Channel } from '@/types';

// ─── Estimated queue send times ───────────────────────────────────────────────
// Mirrors the scheduler: one post per interval, inside the [start,end) hour window.
// The SERVER runs the window in Asia/Jerusalem, so we clamp/label in that timezone
// too (not the browser's) — otherwise a user in another timezone sees a shifted
// estimate. Approximate on purpose (labelled משוער in the UI).

const TZ = 'Asia/Jerusalem';

interface ScheduleInfo {
  enabled: boolean;
  startHour: number;
  endHour: number;
  intervalMin: number;
  lastSentAt: Date | null;
}

/** Hour (0-23) of an instant, in the scheduler's timezone. */
function hourInTz(d: Date): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: TZ }).format(d);
  const n = parseInt(h, 10);
  return n === 24 ? 0 : n;
}

/** yyyy-mm-dd of an instant, in the scheduler's timezone (for today/tomorrow labels). */
function dayInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // en-CA → ISO-like
}

function computeSendSlots(count: number, s: ScheduleInfo): Date[] {
  const slots: Date[] = [];
  const start = Math.max(0, Math.min(23, s.startHour));
  const end = Math.max(start + 1, Math.min(24, s.endHour)); // guard endHour<=startHour
  const intervalMs = Math.max(1, s.intervalMin) * 60_000;
  let t = new Date(Math.max(
    Date.now(),
    s.lastSentAt ? s.lastSentAt.getTime() + intervalMs : 0,
  ));
  for (let i = 0; i < count; i++) {
    // Clamp into the window by shifting whole hours (keeps the absolute instant
    // correct; minute alignment carries from last-send — fine for an estimate).
    for (let guard = 0; guard < 4; guard++) {
      const h = hourInTz(t);
      if (h < start) t = new Date(t.getTime() + (start - h) * 3600_000);
      else if (h >= end) t = new Date(t.getTime() + (24 - h + start) * 3600_000);
      else break;
    }
    slots.push(new Date(t));
    t = new Date(t.getTime() + intervalMs);
  }
  return slots;
}

function slotLabel(d: Date): string {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  const hm = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  if (dayInTz(d) === dayInTz(now)) return `היום ~${hm}`;
  if (dayInTz(d) === dayInTz(tomorrow)) return `מחר ~${hm}`;
  return `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', timeZone: TZ })} ~${hm}`;
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
  post, index, sendAt, channels, onRemove, onEdit,
}: {
  post: Post;
  index: number;
  /** Estimated send time (null when the queue is disabled). */
  sendAt: Date | null;
  channels: Channel[];
  onRemove: (id: string) => Promise<void>;
  onEdit: (post: Post) => void;
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
        <div className="mt-1.5"><PostMeta post={post} channels={channels} /></div>
        <p className="text-xs text-white/35 line-clamp-2 leading-relaxed mt-1.5 min-h-[2rem]">
          {post.generated_text?.replace(/<[^>]+>/g, '').slice(0, 110)}
        </p>
        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-edge">
          <span className="text-sm font-bold text-white">₪{post.price_ils?.toFixed(2)}</span>
          {sendAt ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-amber-400" title="מועד פרסום משוער">
              <Clock size={11} /> יישלח {slotLabel(sendAt)}
            </span>
          ) : (
            <span className="text-2xs text-amber-400/80">התור כבוי — הפעל בהגדרות</span>
          )}
        </div>
        <p className="text-2xs text-white/25 mt-1.5">
          נוסף {new Date(post.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </p>
        <button
          onClick={() => onEdit(post)}
          className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-blue-500/10 text-xs text-white/60 hover:text-blue-300 border border-transparent hover:border-blue-500/20 transition-all"
        >
          <Eye size={12} /> תצוגה מקדימה ועריכה
        </button>
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
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => { channelsApi.list().then(setChannels).catch(() => {}); }, []);

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
            לך לעמוד המוצרים ולחץ על &quot;הוסף לתור&quot; כדי להתחיל
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
                  channels={channels}
                  onRemove={handleRemove}
                  onEdit={setPreviewPost}
                />
              ));
            })()}
          </div>
        </>
      )}

      {previewPost && (
        <EditPostModal
          post={previewPost}
          onClose={() => setPreviewPost(null)}
          onSaved={() => { setPreviewPost(null); load(true); }}
        />
      )}
    </div>
  );
}

// ─── Post Row ─────────────────────────────────────────────────────────────────

// Infer the post's product source from its affiliate link (FLYLINK posts link to
// flylinking.com; everything else is an AliExpress product).
function postSource(post: Post): 'flylink' | 'aliexpress' {
  return /flylink/i.test(post.affiliate_url || '') ? 'flylink' : 'aliexpress';
}

// The target group(s) a post publishes to, resolved to display names. `channel_overrides`
// (multi-group) wins over the single `channel_override`; empty = the default channel.
function postTargetIds(post: Post): string[] {
  let ids: string[] = [];
  try { ids = post.channel_overrides ? JSON.parse(post.channel_overrides) : []; } catch { /* ignore */ }
  ids = ids.filter(Boolean);
  if (!ids.length && post.channel_override) ids = [post.channel_override];
  return ids;
}

function postTargets(post: Post, channels: Channel[]): string[] {
  return postTargetIds(post).map((id) => channels.find((c) => c.channel_id === id)?.name || id);
}

/** Platform + target-group chips shown under a post's title. */
function PostMeta({ post, channels }: { post: Post; channels: Channel[] }) {
  const targets = postTargets(post, channels);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {postSource(post) === 'flylink' ? (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/25 font-medium">FLYLINK</span>
      ) : (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/25 font-medium">AliExpress</span>
      )}
      {targets.length ? (
        targets.map((name, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/25 font-medium max-w-[120px]">
            <Users size={9} className="shrink-0" />
            <span className="truncate">{name}</span>
          </span>
        ))
      ) : (
        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/45 border border-edge font-medium">
          <Users size={9} /> ברירת מחדל
        </span>
      )}
    </div>
  );
}

function PostRow({ post, channels, onRetry, onRetryFailed, onDelete, onEdit, onRepublish, onPush }: {
  post: Post;
  channels: Channel[];
  onRetry: (id: string) => Promise<void>;
  onRetryFailed: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onEdit: (post: Post) => void;
  onRepublish: (post: Post) => void;
  onPush: (post: Post) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cfg = STATUS_CONFIG[post.status] || STATUS_CONFIG.pending;
  // A 'sent' post that still carries an error published to SOME channels but failed on
  // another → offer a retry that hits ONLY the platform(s) that didn't go out.
  const isPartial = post.status === 'sent' && !!post.error_message;

  const handleRetry = async () => {
    setRetrying(true);
    await onRetry(post.id).catch(() => {});
    setRetrying(false);
  };

  const handleRetryFailed = async () => {
    setRetryingFailed(true);
    await onRetryFailed(post.id).catch(() => {});
    setRetryingFailed(false);
  };

  const handleDelete = async () => {
    if (!confirm('למחוק את הפוסט?')) return;
    setDeleting(true);
    await onDelete(post.id).catch(() => setDeleting(false));
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
            <div className="mt-1"><PostMeta post={post} channels={channels} /></div>
            {post.campaign_name && <span className="text-xs text-white/30 truncate block mt-0.5">{post.campaign_name}</span>}
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        {/* A 'sent' post that still carries an error published to SOME channels but
            failed on another (e.g. Telegram OK, Facebook rejected) — show it as a
            partial success (amber) instead of a misleading all-green "נשלח". */}
        {post.status === 'sent' && post.error_message ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400" title={post.error_message}>
            <AlertTriangle size={11} />
            פורסם חלקית
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${cfg.cls}`}>
            <cfg.Icon size={11} />
            {cfg.label}
          </span>
        )}
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
        <div className="flex items-center gap-1">
          {post.status === 'failed' && (
            <button onClick={handleRetry} disabled={retrying} title="נסה שוב (כל הערוצים)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400/70 hover:text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 transition-all">
              {retrying ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            </button>
          )}
          {isPartial && (
            <button onClick={handleRetryFailed} disabled={retryingFailed} title="שלח שוב רק לפלטפורמה שנכשלה"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 transition-all">
              {retryingFailed ? <Loader2 size={13} className="animate-spin" /> : <SendHorizontal size={13} />}
            </button>
          )}
          <button onClick={() => onPush(post)} title="דחוף לפלטפורמה/קבוצה (בלי חיוב, בלי כפילות)"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-teal-400/70 hover:text-teal-300 hover:bg-teal-500/10 transition-all">
            <Megaphone size={13} />
          </button>
          <button onClick={() => onRepublish(post)} title="פרסם מחדש — לתור או בתזמון"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-400/70 hover:text-violet-400 hover:bg-violet-500/10 transition-all">
            <RefreshCw size={13} />
          </button>
          <button onClick={() => onEdit(post)} title="ערוך פוסט"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.07] transition-all">
            <Pencil size={13} />
          </button>
          <button onClick={handleDelete} disabled={deleting} title="מחק פוסט"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-all">
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
        {post.error_message && (
          <p className="text-2xs text-red-400/70 mt-1 max-w-[180px] truncate" title={post.error_message}>
            {post.error_message}
          </p>
        )}
      </td>
    </tr>
  );
}

// ─── Edit post modal ──────────────────────────────────────────────────────────
function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function EditPostModal({ post, onClose, onSaved }: {
  post: Post; onClose: () => void; onSaved: () => void;
}) {
  const isScheduled = post.status === 'scheduled';
  const [text, setText] = useState(post.generated_text || '');
  const [title, setTitle] = useState(post.product_title || '');
  const [price, setPrice] = useState<string>(post.price_ils != null ? String(post.price_ils) : '');
  const [image, setImage] = useState(post.product_image || '');
  const [link, setLink] = useState(post.affiliate_url || '');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(post.scheduled_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await postsApi.update(post.id, {
        text,
        product_title: title,
        price_ils: price.trim() !== '' ? Number(price) : undefined,
        product_image: image,
        affiliate_url: link,
        scheduled_at: isScheduled && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      });
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.message || 'שמירה נכשלה'); setSaving(false); }
  };

  const inputCls = 'w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white truncate">עריכת פוסט</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={image} alt="" className="w-14 h-14 rounded-lg object-cover bg-white/5 shrink-0" /> : <div className="w-14 h-14 rounded-lg bg-white/5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-white/50 mb-1">שם המוצר</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} dir="ltr" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-white/50 mb-1">מחיר (₪)</label>
            <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} dir="ltr" />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1">קישור שותפים</label>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className={inputCls} dir="ltr" />
          </div>
        </div>

        <label className="block text-xs text-white/50 mb-1.5">כתובת תמונה ראשית</label>
        <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" className={`${inputCls} mb-3`} dir="ltr" />

        <label className="block text-xs text-white/50 mb-1.5">טקסט הפוסט</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
          className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white leading-relaxed outline-none focus:border-blue-500/50 resize-none font-mono" dir="rtl" />

        {isScheduled && (
          <div className="mt-3">
            <label className="block text-xs text-white/50 mb-1.5">מועד פרסום</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className={inputCls} dir="ltr" />
          </div>
        )}
        {post.status === 'sent' && (
          <p className="text-2xs text-amber-400/80 mt-2">הפוסט כבר נשלח — העריכה לא תשנה את ההודעה שכבר פורסמה, אבל תחול על &quot;פרסום מחדש&quot;.</p>
        )}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} שמור
          </button>
          <button onClick={onClose} className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ─── Republish modal (re-queue or schedule; never immediate) ───────────────────
function RepublishModal({ post, onClose, onDone }: {
  post: Post; onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode] = useState<'queue' | 'schedule'>('queue');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await postsApi.requeue(post.id, mode === 'schedule' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined);
      setDone(mode === 'queue' ? 'נוסף לתור — יישלח בתור הבא' : 'תוזמן בהצלחה');
      setTimeout(onDone, 1100);
    } catch (e: any) { setError(e?.response?.data?.message || 'הפעולה נכשלה'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-sm p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><RefreshCw size={15} className="text-violet-400" /> פרסום מחדש</h3>
          <button onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>
        </div>
        <p className="text-xs text-white/40 truncate mb-4" dir="ltr">{post.product_title}</p>

        <div className="space-y-2 mb-4">
          <button type="button" onClick={() => setMode('queue')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm transition-all ${mode === 'queue' ? 'bg-violet-600/15 border-violet-500/40 text-white' : 'bg-white/3 border-edge-hover text-white/60'}`}>
            <ListOrdered size={15} className="text-violet-400" />
            <span className="text-right"><span className="block font-medium">הוסף לתור</span><span className="block text-2xs text-white/40">יישלח בתור הבא לפי הגדרות התזמון — לא מיידי</span></span>
          </button>
          <button type="button" onClick={() => setMode('schedule')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm transition-all ${mode === 'schedule' ? 'bg-violet-600/15 border-violet-500/40 text-white' : 'bg-white/3 border-edge-hover text-white/60'}`}>
            <Clock size={15} className="text-violet-400" />
            <span className="text-right"><span className="block font-medium">תזמן לשעה מסוימת</span><span className="block text-2xs text-white/40">בחר תאריך ושעה לפרסום</span></span>
          </button>
        </div>

        {mode === 'schedule' && (
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-violet-500/50 mb-4" dir="ltr" />
        )}

        {done && <p className="text-xs text-emerald-400 mb-3">✓ {done}</p>}
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <button onClick={submit} disabled={busy || !!done}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {mode === 'queue' ? 'הוסף לתור' : 'תזמן'}
        </button>
      </div>
    </div>
  );
}

// ─── Push-to-platform modal (back-fill: send to a platform/group, no re-charge) ─
function PushModal({ post, channels, onClose, onDone }: {
  post: Post; channels: Channel[]; onClose: () => void; onDone: () => void;
}) {
  const [platforms, setPlatforms] = useState<('telegram' | 'facebook' | 'instagram')[]>(['facebook']);
  const [groupIds, setGroupIds] = useState<string[]>(() => postTargetIds(post));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const togglePlatform = (p: 'telegram' | 'facebook' | 'instagram') =>
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await postsApi.push(post.id, platforms, groupIds.length ? groupIds : undefined);
      setDone('✓ נשלח');
      setTimeout(onDone, 900);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'השליחה נכשלה');
      setBusy(false);
    }
  };

  const PLATFORMS: { id: 'telegram' | 'facebook' | 'instagram'; label: string }[] = [
    { id: 'facebook', label: 'פייסבוק' },
    { id: 'telegram', label: 'טלגרם' },
    { id: 'instagram', label: 'אינסטגרם' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-secondary border border-edge rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><Megaphone size={17} className="text-teal-400" /> דחיפת פוסט לפלטפורמה</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-white/70 line-clamp-1">{post.product_title}</p>

          <div>
            <label className="block text-xs text-white/50 mb-1.5">פלטפורמות</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const on = platforms.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      on ? 'bg-teal-600/20 border-teal-500/50 text-teal-200' : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'
                    }`}>
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-teal-500 border-teal-500' : 'border-white/30'}`}>
                      {on && <CheckCircle2 size={10} className="text-white" />}
                    </span>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs text-white/50 mb-1.5">קבוצות יעד</label>
            <GroupMultiSelect channels={channels} value={groupIds} onChange={setGroupIds} disabled={busy} />
          </div>

          <p className="text-2xs text-white/30 flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-0.5 text-white/25" />
            נשלח רק לפלטפורמות ולקבוצות שבחרת — בלי חיוב קרדיט ובלי לשלוח שוב למה שכבר יצא. (טלגרם ישלח לכל הקבוצות שבחרת, כך שלמניעת כפילות בחר רק את הקבוצה החסרה.)
          </p>

          {done && <p className="text-xs text-emerald-400">{done}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button onClick={submit} disabled={busy || !!done || !platforms.length}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-sm font-medium transition-all">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />} דחוף עכשיו
            </button>
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState<'' | 'aliexpress' | 'flylink'>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => { channelsApi.list().then(setChannels).catch(() => {}); }, []);

  const isQueueTab = status === 'queued';

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (isQueueTab) return; // Queue tab manages its own state
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await postsApi.list({ page, limit, status: status || undefined, source: source || undefined });
      setPosts(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, limit, status, source, isQueueTab]);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (id: string) => {
    await postsApi.retry(id);
    load({ silent: true });
  };

  const handleRetryFailed = async (id: string) => {
    await postsApi.retryFailed(id);
    load({ silent: true });
  };

  const handleDelete = async (id: string) => {
    await postsApi.remove(id);
    load({ silent: true });
  };

  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [republishingPost, setRepublishingPost] = useState<Post | null>(null);
  const [pushingPost, setPushingPost] = useState<Post | null>(null);

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

      {/* Filters: status + product source */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-xl p-1 w-fit">
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

        {/* Product source */}
        {!isQueueTab && (
          <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-xl p-1 w-fit">
            {([
              { v: '' as const, l: 'כל המקורות' },
              { v: 'aliexpress' as const, l: 'AliExpress', cls: 'bg-orange-500/15 text-orange-300' },
              { v: 'flylink' as const, l: 'FLYLINK', cls: 'bg-violet-500/15 text-violet-300' },
            ]).map((s) => (
              <button
                key={s.v}
                onClick={() => { setSource(s.v); setPage(1); }}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all
                  ${source === s.v ? (s.cls || 'bg-blue-600/20 text-blue-400') : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
              >
                {s.l}
              </button>
            ))}
          </div>
        )}
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
                <PostRow key={p.id} post={p} channels={channels} onRetry={handleRetry} onRetryFailed={handleRetryFailed} onDelete={handleDelete} onEdit={setEditingPost} onRepublish={setRepublishingPost} onPush={setPushingPost} />
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

      {republishingPost && (
        <RepublishModal
          post={republishingPost}
          onClose={() => setRepublishingPost(null)}
          onDone={() => { setRepublishingPost(null); load({ silent: true }); }}
        />
      )}

      {editingPost && (
        <EditPostModal
          post={editingPost}
          onClose={() => setEditingPost(null)}
          onSaved={() => { setEditingPost(null); load({ silent: true }); }}
        />
      )}

      {pushingPost && (
        <PushModal
          post={pushingPost}
          channels={channels}
          onClose={() => setPushingPost(null)}
          onDone={() => { setPushingPost(null); load({ silent: true }); }}
        />
      )}
    </div>
  );
}
