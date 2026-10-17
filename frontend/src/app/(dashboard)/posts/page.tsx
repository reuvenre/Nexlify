'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText, RefreshCw, Loader2, RotateCcw,
  CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, Settings2,
  ListOrdered, Trash2, Package, AlertTriangle, Pencil, X, Save, SendHorizontal, Eye, Users, Megaphone,
  ExternalLink, Wand2, Copy, Check, Star, Upload,
} from 'lucide-react';
import Link from 'next/link';
import { postsApi, credentialsApi, channelsApi, suppliersApi, type PushPlatform } from '@/lib/api-client';
import { GroupMultiSelect } from '@/components/GroupMultiSelect';
import type { Post, Channel } from '@/types';

import { DialogA11y } from '@/components/common/DialogA11y';
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

/**
 * Publishing-platform filter. A post carries no platform column — the backend answers this
 * from the per-platform message id it stamps on a successful send, PLUS the campaign's
 * declared platforms for anything not sent yet, so a pin that is still scheduled (or that
 * failed) shows up here too.
 */
const PLATFORM_TABS = [
  { v: '' as const,          l: 'כל הפלטפורמות' },
  { v: 'telegram' as const,  l: '📨 טלגרם',     cls: 'bg-sky-500/15 text-sky-300' },
  { v: 'facebook' as const,  l: '📘 פייסבוק',   cls: 'bg-blue-500/15 text-blue-300' },
  { v: 'instagram' as const, l: '📸 אינסטגרם',  cls: 'bg-pink-500/15 text-pink-300' },
  { v: 'pinterest' as const, l: '📌 פינטרסט',   cls: 'bg-red-500/15 text-red-300' },
  { v: 'whatsapp' as const,  l: '💬 וואטסאפ',   cls: 'bg-emerald-500/15 text-emerald-300' },
];

type PlatformKey = Exclude<(typeof PLATFORM_TABS)[number]['v'], ''>;

/** One platform list for every dialog that targets platforms (push, republish). */
const REPUBLISH_PLATFORMS: { id: PushPlatform; label: string }[] = [
  { id: 'telegram', label: '📨 טלגרם' },
  { id: 'facebook', label: '📘 פייסבוק' },
  { id: 'instagram', label: '📸 אינסטגרם' },
  { id: 'pinterest', label: '📌 פינטרסט' },
  { id: 'whatsapp', label: '💬 וואטסאפ' },
];

/** Platform labels for the click-source breakdown (the link's ?s= tag). */
const CLICK_SOURCE_LABELS: Record<string, string> = {
  tg: 'טלגרם', fb: 'פייסבוק', ig: 'אינסטגרם', pin: 'פינטרסט', wa: 'וואטסאפ', other: 'לא מזוהה',
};

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
        <button aria-label="הסר מהתור"
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
          <span className="text-sm font-bold text-white">{post.currency_symbol || '₪'}{post.price_ils?.toFixed(2)}</span>
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

  /**
   * Estimated send time per post. Each GROUP has its own queue and its own clock, so
   * slots are computed per bucket (group, or "default" for posts with no group) using
   * that group's schedule — falling back to the global one for any field it inherits.
   * Computing one global sequence would show times that no longer match the scheduler.
   */
  const slotByPost = useMemo(() => {
    const map = new Map<string, Date>();
    if (!schedule?.enabled) return map;
    const buckets = new Map<string, Post[]>();
    for (const p of queue) {
      const key = p.channel_override || '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(p);
    }
    for (const [key, posts] of buckets) {
      const ch = key ? channels.find((c) => c.channel_id === key) : undefined;
      const enabled = ch?.schedule_enabled ?? schedule.enabled;
      if (!enabled) continue;
      const eff: ScheduleInfo = {
        enabled: true,
        startHour: ch?.schedule_start_hour ?? schedule.startHour,
        endHour: ch?.schedule_end_hour ?? schedule.endHour,
        intervalMin: ch?.schedule_interval_minutes ?? schedule.intervalMin,
        lastSentAt: ch
          ? (ch.schedule_last_sent_at ? new Date(ch.schedule_last_sent_at) : null)
          : schedule.lastSentAt,
      };
      const slots = computeSendSlots(posts.length, eff);
      posts.forEach((p, i) => { if (slots[i]) map.set(p.id, slots[i]); });
    }
    return map;
  }, [queue, schedule, channels]);

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
            {queue.map((post, idx) => (
              <QueueItem
                key={post.id}
                post={post}
                index={idx}
                sendAt={slotByPost.get(post.id) ?? null}
                channels={channels}
                onRemove={handleRemove}
                onEdit={setPreviewPost}
              />
            ))}
          </div>
        </>
      )}

      {previewPost && (
        <EditPostModal
          post={previewPost}
          channels={channels}
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

/**
 * The group(s) a row is LABELLED with: where the post actually published when we know it
 * (a manual push records that), otherwise where it is aimed. Without this a product pushed
 * by hand to one group kept displaying the group it was created for.
 */
function postDisplayIds(post: Post): string[] {
  try {
    const delivered = post.delivered_channels ? JSON.parse(post.delivered_channels) : [];
    if (Array.isArray(delivered) && delivered.filter(Boolean).length) return delivered.filter(Boolean);
  } catch { /* unreadable → fall back to targeting */ }
  return postTargetIds(post);
}

function postTargets(post: Post, channels: Channel[]): string[] {
  return postDisplayIds(post).map((id) => channels.find((c) => c.channel_id === id)?.name || id);
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
  const [isSource, setIsSource] = useState(!!post.is_repost_source);
  const [settingSrc, setSettingSrc] = useState(false);

  const handleSetSource = async () => {
    setSettingSrc(true);
    try { await postsApi.setRepostSource(post.id); setIsSource(true); }
    catch { /* surfaced by the disabled state resetting */ }
    finally { setSettingSrc(false); }
  };
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
            <p className="text-sm text-white truncate max-w-xs">
              {post.recycled_from && <span title="מיחזור אוטומטי של פוסט מנצח">🏆 </span>}
              {post.product_title}
            </p>
            <div className="mt-1"><PostMeta post={post} channels={channels} /></div>
            <span className="text-xs text-white/30 truncate block mt-0.5">
              {post.campaign_name}
              {/* The search keyword that pulled THIS product — so an off-brand product in a
                  group is traceable to its keyword at a glance, without asking anyone. */}
              {post.keyword && <span className="text-white/40"> · 🔎 {post.keyword}</span>}
            </span>
          </div>
        </div>
      </td>
      <td className="py-3 px-4">
        {/* A 'sent' post that still carries an error published to SOME channels but
            failed on another (e.g. Telegram OK, Facebook rejected) — show it as a
            partial success (amber) instead of a misleading all-green "נשלח". */}
        {post.status === 'sent' && post.error_message ? (
          <button type="button" onClick={() => alert(post.error_message)}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 cursor-pointer" title={post.error_message}>
            <AlertTriangle size={11} />
            פורסם חלקית
          </button>
        ) : (
          <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${cfg.cls}`}>
            <cfg.Icon size={11} />
            {cfg.label}
          </span>
        )}
        {/* ANY status can carry an error (a pending FLYLINK post whose send hiccuped,
            a failed post…) — surface it as a CLICKABLE row, not a hover-only tooltip
            the user can't discover. */}
        {post.error_message && post.status !== 'sent' && (
          <button type="button" onClick={() => alert(post.error_message)}
            className="mt-1 flex items-center gap-1 text-2xs text-amber-400/90 hover:text-amber-300 max-w-[180px] text-right"
            title={post.error_message}>
            <AlertTriangle size={10} className="shrink-0" />
            <span className="truncate">{post.error_message}</span>
          </button>
        )}
      </td>
      <td className="py-3 px-4 text-sm text-white/50">
        {/* The post's OWN currency — a USD Pinterest campaign is priced in dollars, and
            stamping ₪ on it turned a correct $6.40 into a wrong ₪6.40. */}
        {post.price_ils != null ? `${post.currency_symbol || '₪'}${post.price_ils.toFixed(2)}` : '—'}
        {/* Click count from the trackable short link — the fast performance signal. */}
        {(post.clicks_count ?? 0) > 0 && (
          <span className="block text-2xs text-emerald-400 mt-0.5" title="קליקים על הלינק בפוסט">
            🔗 {post.clicks_count} קליקים
          </span>
        )}
        {/* Per-platform breakdown from the link's ?s= tag; 'לא מזוהה' = clicks on links
            published before tagging existed. */}
        {post.clicks_by_source && Object.keys(post.clicks_by_source).length > 0 && (
          <span className="block text-2xs text-white/40 mt-0.5" title="מאיזו פלטפורמה הגיעו הקליקים">
            {Object.entries(post.clicks_by_source)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => `${CLICK_SOURCE_LABELS[s] || s} ${n}`)
              .join(' · ')}
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-xs text-white/30">
        {post.status === 'scheduled' && post.scheduled_at ? (
          // The zone is spelled out because a campaign's send WINDOW can live in another
          // one — a US-audience Pinterest campaign runs 16:00-23:00 New York, and its posts
          // rendered in the viewer's own clock read as "scheduled outside the window" when
          // they were exactly at its start (23:01 Israel = 16:01 New York).
          <span className="text-purple-400">
            🕐 {new Date(post.scheduled_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
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
            <button aria-label="נסה שוב (כל הערוצים)" onClick={handleRetry} disabled={retrying} title="נסה שוב (כל הערוצים)"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-blue-400/70 hover:text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 transition-all">
              {retrying ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            </button>
          )}
          {isPartial && (
            <button aria-label="שלח שוב רק לפלטפורמה שנכשלה" onClick={handleRetryFailed} disabled={retryingFailed} title="שלח שוב רק לפלטפורמה שנכשלה"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50 transition-all">
              {retryingFailed ? <Loader2 size={13} className="animate-spin" /> : <SendHorizontal size={13} />}
            </button>
          )}
          <button aria-label="דחוף לפלטפורמה/קבוצה (בלי חיוב, בלי כפילות)" onClick={() => onPush(post)} title="דחוף לפלטפורמה/קבוצה (בלי חיוב, בלי כפילות)"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-teal-400/70 hover:text-teal-300 hover:bg-teal-500/10 transition-all">
            <Megaphone size={13} />
          </button>
          <button aria-label="פרסם מחדש — לתור או בתזמון" onClick={() => onRepublish(post)} title="פרסם מחדש — לתור או בתזמון"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-violet-400/70 hover:text-violet-400 hover:bg-violet-500/10 transition-all">
            <RefreshCw size={13} />
          </button>
          <button aria-label={isSource ? 'זה פוסט המקור — פרסומים חוזרים של FLYLINK ישכפלו אותו בדיוק' : 'קבע כפוסט מקור — פרסומים חוזרים של FLYLINK ישכפלו את הטקסט והתמונות של הפוסט הזה'} onClick={handleSetSource} disabled={settingSrc || isSource}
            title={isSource ? 'זה פוסט המקור — פרסומים חוזרים של FLYLINK ישכפלו אותו בדיוק' : 'קבע כפוסט מקור — פרסומים חוזרים של FLYLINK ישכפלו את הטקסט והתמונות של הפוסט הזה'}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-100
              ${isSource ? 'text-amber-400' : 'text-amber-400/50 hover:text-amber-400 hover:bg-amber-500/10'}`}>
            {settingSrc ? <Loader2 size={13} className="animate-spin" /> : <Star size={13} fill={isSource ? 'currentColor' : 'none'} />}
          </button>
          <button aria-label="ערוך פוסט" onClick={() => onEdit(post)} title="ערוך פוסט"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.07] transition-all">
            <Pencil size={13} />
          </button>
          <button aria-label="מחק פוסט" onClick={handleDelete} disabled={deleting} title="מחק פוסט"
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

/**
 * The direct AliExpress product page for a post — reconstructed from product_id, which is
 * the item id for AliExpress posts. Lets the user open the real listing to verify the
 * price/variant. Returns '' for FLYLINK/supplier posts (the item id is a hidden SKU, not a
 * public aliexpress.com page).
 */
function directProductUrl(post: Post): string {
  const isAli = !post.affiliate_url || /aliexpress/i.test(post.affiliate_url);
  if (isAli && /^\d{6,}$/.test(String(post.product_id || ''))) {
    return `https://www.aliexpress.com/item/${post.product_id}.html`;
  }
  return '';
}

function EditPostModal({ post, channels, onClose, onSaved }: {
  post: Post; channels: Channel[]; onClose: () => void; onSaved: () => void;
}) {
  const isScheduled = post.status === 'scheduled';
  // Re-targeting: only meaningful while the post hasn't gone out. On a SENT post the
  // targeting field is history — changing it would rewrite where the message that already
  // published claims to have gone (the push dialog is the way to send it somewhere else).
  const canRetarget = post.status !== 'sent';
  const [groupIds, setGroupIds] = useState<string[]>(() => postTargetIds(post));
  const toggleGroup = (id: string) =>
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  const [text, setText] = useState(post.generated_text || '');
  const [title, setTitle] = useState(post.product_title || '');
  const [price, setPrice] = useState<string>(post.price_ils != null ? String(post.price_ils) : '');
  const [image, setImage] = useState(post.product_image || '');
  const [zoom, setZoom] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState(post.affiliate_url || '');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput(post.scheduled_at));
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');

  // Gallery re-selection (FLYLINK posts): the full catalog album to pick from, and the
  // ORDERED selection — click order decides, first pick is the main image, exactly like
  // the supplier composer. Loaded lazily; a post with no catalog match still shows its
  // own current images so they can be reordered/trimmed.
  const isFlylink = /flylink/i.test(post.affiliate_url || '');
  const [galleryChoices, setGalleryChoices] = useState<string[] | null>(null);
  const [gallerySel, setGallerySel] = useState<string[]>([]);
  useEffect(() => {
    if (!isFlylink) return;
    suppliersApi.postGalleryOptions(post.id)
      .then((r) => {
        const choices = r.catalog.length ? r.catalog : r.current;
        if (!choices.length) return;
        setGalleryChoices(choices);
        setGallerySel(r.current);
      })
      .catch(() => { /* editor simply doesn't show the gallery section */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleGalleryImage = (u: string) =>
    setGallerySel((prev) => (prev.includes(u) ? prev.filter((x) => x !== u) : [...prev, u]));

  const directUrl = directProductUrl(post);

  const save = async () => {
    if (galleryChoices && gallerySel.length === 0) { setError('בחר לפחות תמונה אחת לגלריה'); return; }
    setSaving(true); setError('');
    try {
      await postsApi.update(post.id, {
        text,
        product_title: title,
        price_ils: price.trim() !== '' ? Number(price) : undefined,
        product_image: galleryChoices && gallerySel.length ? gallerySel[0] : image,
        affiliate_url: link,
        scheduled_at: isScheduled && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        gallery: galleryChoices ? gallerySel : undefined,
        channels: canRetarget ? groupIds : undefined,
      });
      onSaved();
    } catch (e: any) { setError(e?.response?.data?.message || 'שמירה נכשלה'); setSaving(false); }
  };

  /** Rewrite the post text with AI from the CURRENT (edited) fields. Server-side the
   *  post's actual photo(s) — the edited main image first — go to the model as vision,
   *  and the edited title is the authoritative identity, so a swapped image/title
   *  produces copy about the NEW product, not a rewrite of the old one. */
  const regenerate = async () => {
    setRegenerating(true); setError('');
    try {
      const r = await postsApi.regeneratePost(post.id, {
        title,
        image_url: image,
        price_ils: price.trim() !== '' ? Number(price) : undefined,
      });
      if (r.generated_text) setText(r.generated_text);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'ייצור הטקסט נכשל');
    } finally { setRegenerating(false); }
  };

  const copy = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(''), 1500);
  };

  const inputCls = 'w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <DialogA11y label="עריכת פוסט" onClose={onClose} />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white truncate">עריכת פוסט</h3>
          <button aria-label="סגור" onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          {/* Click-to-enlarge: a 56px thumbnail can't answer "is this the right image /
              is it sharp?", which is exactly what one opens a post to check. */}
          {image ? (
            <button type="button" onClick={() => setZoom(true)} title="הגדל תמונה"
              className="shrink-0 cursor-zoom-in rounded-xl overflow-hidden border border-edge hover:border-blue-500/50 transition-colors">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="w-20 h-20 object-cover bg-white/5" />
            </button>
          ) : <div className="w-20 h-20 rounded-xl bg-white/5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <label className="block text-xs text-white/50 mb-1">שם המוצר</label>
            <input aria-label="שם המוצר" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} dir="ltr" />
          </div>
        </div>

        <div className="mb-3">
          {/* The parenthesized symbol is isolated as its own LTR run. Without it, the bidi
              algorithm scrambles the parens the moment the Hebrew word next to them becomes
              English (Chrome's page translation): "מחיר ($)" turned into ")$ Price (". */}
          <label className="block text-xs text-white/50 mb-1">מחיר <span dir="ltr">({post.currency_symbol || '₪'})</span></label>
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputCls} max-w-[160px]`} dir="ltr" />
        </div>

        {/* Direct product page — reconstructed from the item id so the user can open the
            real listing and verify price/variant before publishing. AliExpress posts only. */}
        {directUrl && (
          <div className="mb-3">
            <label className="block text-xs text-white/50 mb-1">קישור ישיר למוצר (לבדיקה)</label>
            <div className="flex items-center gap-1.5">
              <input readOnly value={directUrl} className={`${inputCls} text-white/60`} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
              <button aria-label="העתק" type="button" onClick={() => copy(directUrl, 'direct')} title="העתק" className="shrink-0 p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/50">
                {copied === 'direct' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
              <a aria-label="פתח באתר" href={directUrl} target="_blank" rel="noopener noreferrer" title="פתח באתר" className="shrink-0 p-2 bg-white/5 hover:bg-white/10 rounded-lg text-blue-400">
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        )}

        {/* Affiliate link — full width; this is what actually goes in the post. */}
        <div className="mb-3">
          <label className="block text-xs text-white/50 mb-1">קישור שותפים (מתפרסם)</label>
          <div className="flex items-center gap-1.5">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className={inputCls} dir="ltr" />
            {link && (
              <>
                <button aria-label="העתק" type="button" onClick={() => copy(link, 'aff')} title="העתק" className="shrink-0 p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/50">
                  {copied === 'aff' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
                <a aria-label="פתח" href={link} target="_blank" rel="noopener noreferrer" title="פתח" className="shrink-0 p-2 bg-white/5 hover:bg-white/10 rounded-lg text-blue-400">
                  <ExternalLink size={14} />
                </a>
              </>
            )}
          </div>
        </div>

        {/* Gallery re-selection (FLYLINK): full catalog album, click-to-pick in order.
            The first pick (amber 1) is the main image — same rule as the composer. */}
        {galleryChoices ? (
          <div className="mb-3">
            <label className="block text-xs text-white/50 mb-1.5">
              גלריית הפוסט — לחץ לבחירה לפי סדר; הבחירה הראשונה (1, בכתום) היא התמונה הראשית
            </label>
            <div className="grid grid-cols-4 gap-1.5 max-h-56 overflow-y-auto pr-1">
              {galleryChoices.map((u) => {
                const idx = gallerySel.indexOf(u);
                const picked = idx >= 0;
                return (
                  <button key={u} type="button" onClick={() => toggleGalleryImage(u)}
                    className={`relative rounded-lg overflow-hidden border transition-all aspect-square
                      ${picked ? (idx === 0 ? 'border-amber-400 ring-1 ring-amber-400/60' : 'border-blue-500 ring-1 ring-blue-500/50') : 'border-edge opacity-60 hover:opacity-100'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="w-full h-full object-cover" loading="lazy" />
                    {picked && (
                      <span className={`absolute top-1 right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-white
                        ${idx === 0 ? 'bg-amber-500' : 'bg-blue-600'}`}>{idx + 1}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-white/30 mt-1.5">
              נבחרו {gallerySel.length} תמונות. השמירה קובעת את האלבום לפרסום מחדש ולריפוסטים של הטייס מהפוסט הזה.
            </p>
          </div>
        ) : (
          <>
            <label className="block text-xs text-white/50 mb-1.5">כתובת תמונה ראשית</label>
            <div className="flex items-center gap-2 mb-3">
              <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" className={inputCls} dir="ltr" />
              {/* Device upload — phone gallery / computer file. The file goes to the server
                  (normalized + stored) and comes back as a public URL every platform can
                  ingest; the field simply receives that URL like any pasted one. */}
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                title="העלה תמונה מהמכשיר"
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-600/15 hover:bg-teal-600/25 border border-teal-500/30 text-teal-300 text-xs font-medium disabled:opacity-60 transition-all">
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {uploading ? 'מעלה…' : 'העלה'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ''; // allow re-picking the same file
                  if (!f) return;
                  setUploading(true); setError('');
                  try {
                    const res = await postsApi.uploadImage(f);
                    setImage(res.url);
                  } catch (err: any) {
                    setError(err?.response?.data?.message || 'העלאת התמונה נכשלה');
                  } finally { setUploading(false); }
                }} />
            </div>
          </>
        )}

        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs text-white/50">טקסט הפוסט</label>
          <button type="button" onClick={regenerate} disabled={regenerating}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors">
            {regenerating ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {regenerating ? 'מייצר...' : 'צור מחדש עם AI'}
          </button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8}
          className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white leading-relaxed outline-none focus:border-blue-500/50 resize-none font-mono" dir="rtl" />

        {/* Target group(s) — a post aimed at the wrong audience is fixed here instead of
            being deleted and rebuilt. Hidden once sent: then the field is a record of where
            the message went, and the push dialog is how it reaches another group. */}
        {canRetarget && channels.length > 0 && (
          <div className="mt-4">
            <label className="block text-xs text-white/50 mb-1.5">קבוצת יעד</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {channels.map((c) => (
                <label key={c.channel_id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors
                  ${groupIds.includes(c.channel_id) ? 'border-blue-500/60 bg-blue-500/10' : 'border-edge hover:border-edge-hover bg-white/[0.03]'}`}>
                  <input type="checkbox" checked={groupIds.includes(c.channel_id)}
                    onChange={() => toggleGroup(c.channel_id)} className="accent-blue-500" />
                  <span className="text-sm text-white/80 flex-1 truncate">{c.name}</span>
                </label>
              ))}
            </div>
            <p className="text-2xs text-white/30 mt-1.5">
              {groupIds.length === 0
                ? 'לא נבחרה קבוצה — הפוסט יפורסם לערוץ ברירת המחדל.'
                : 'הפוסט יפורסם לקבוצות המסומנות בלבד.'}
            </p>
          </div>
        )}

        {isScheduled && (
          <div className="mt-3">
            <label className="block text-xs text-white/50 mb-1.5">מועד פרסום</label>
            <input aria-label="מועד פרסום" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className={inputCls} dir="ltr" />
          </div>
        )}
        {post.status === 'sent' && (
          <p className="text-2xs text-amber-400/80 mt-2">הפוסט כבר נשלח — העריכה לא תשנה את ההודעה שכבר פורסמה, אבל תחול על &quot;פרסום מחדש&quot;. כדי לשלוח אותו לקבוצה אחרת השתמש ב&quot;דחוף עכשיו&quot;.</p>
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

      {/* Full-screen image preview. Any click closes it — inspect, done, back to editing. */}
      {zoom && image && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6 cursor-zoom-out"
          onClick={(e) => { e.stopPropagation(); setZoom(false); }}>
          <DialogA11y label="תמונה מוגדלת" onClose={() => setZoom(false)} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" className="max-w-full max-h-full rounded-xl object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
}

// ─── Republish modal (re-queue or schedule; never immediate) ───────────────────
function RepublishModal({ post, channels, onClose, onDone }: {
  post: Post; channels: Channel[]; onClose: () => void; onDone: () => void;
}) {
  const [mode, setMode] = useState<'queue' | 'schedule'>('queue');
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInput());
  // Pre-filled with where the post went LAST time — republishing unchanged stays one
  // click, and retargeting (the winner deserves the other group too / send this one to
  // Pinterest) is a checkbox away instead of impossible.
  const [groupIds, setGroupIds] = useState<string[]>(() => postTargetIds(post));
  const [platforms, setPlatforms] = useState<PushPlatform[]>(() => {
    try {
      const arr = post.target_platforms ? JSON.parse(post.target_platforms) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const togglePlatform = (p: PushPlatform) =>
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await postsApi.requeue(
        post.id,
        mode === 'schedule' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        groupIds,
        platforms,
      );
      setDone(mode === 'queue' ? 'נוסף לתור — יישלח בתור הבא' : 'תוזמן בהצלחה');
      setTimeout(onDone, 1100);
    } catch (e: any) { setError(e?.response?.data?.message || 'הפעולה נכשלה'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <DialogA11y label="פרסום מחדש" onClose={onClose} />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-sm p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><RefreshCw size={15} className="text-violet-400" /> פרסום מחדש</h3>
          <button aria-label="סגור" onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>
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

        <div className="mb-3">
          <label className="block text-xs text-white/50 mb-1.5">קבוצות יעד</label>
          <GroupMultiSelect channels={channels} value={groupIds} onChange={setGroupIds} disabled={busy} />
          <p className="text-2xs text-white/30 mt-1">ללא בחירה = ערוץ ברירת המחדל.</p>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-white/50 mb-1.5">פלטפורמות</label>
          <div className="flex flex-wrap gap-2">
            {REPUBLISH_PLATFORMS.map((p) => {
              const on = platforms.includes(p.id);
              return (
                <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    on ? 'bg-violet-600/20 border-violet-500/50 text-violet-200' : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'
                  }`}>
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-violet-500 border-violet-500' : 'border-white/30'}`}>
                    {on && <Check size={10} className="text-on-accent" strokeWidth={3} />}
                  </span>
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="text-2xs text-white/30 mt-1">
            ללא בחירה = לפי הגדרות החשבון/הקמפיין (כמו בפרסום המקורי). בחירה מפרסמת <b>רק</b> למה שסימנת.
          </p>
        </div>

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

// ─── Smart link intake: paste a product URL → keyword + campaign + scheduled post ─
function SmartIntakeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof postsApi.smartIntake>> | null>(null);
  // The owner's pick(s) when the judge couldn't place the product: campaign ids (more
  // than one publishes the product through EACH chosen campaign's routing), or 'queue'
  // for the explicit default-queue choice — exclusive with campaign picks by definition.
  const [choices, setChoices] = useState<string[]>([]);

  const toggleChoice = (id: string) => {
    setChoices((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      return id === 'queue' ? ['queue'] : [...prev.filter((c) => c !== 'queue'), id];
    });
  };

  const submit = async (opts?: { campaign_id?: string; campaign_ids?: string[]; to_queue?: boolean }) => {
    setBusy(true); setError('');
    try {
      setResult(await postsApi.smartIntake(url, opts));
      setChoices([]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הקליטה נכשלה');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <DialogA11y label="קליטה חכמה מקישור" onClose={onClose} />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-md p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><Wand2 size={15} className="text-teal-400" /> קליטה חכמה מקישור</h3>
          <button aria-label="סגור" onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>
        </div>
        <p className="text-xs text-white/40 mb-4">
          הדבק קישור מוצר מ-AliExpress — המערכת תזהה את המוצר, תיצור מילת מפתח, תשייך לטייס
          המתאים לפי הקהל, ותתזמן פוסט דרך ההגדרות שלו. המילה מצטרפת לרוטציה של הטייס.
        </p>

        {!result && (
          <>
            <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr"
              placeholder="https://he.aliexpress.com/item/... או s.click.aliexpress.com/..."
              className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-teal-500/50 mb-3" />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button onClick={() => submit()} disabled={busy || !url.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {busy ? 'מזהה, שופט ומתזמן…' : 'נתח ותזמן'}
            </button>
          </>
        )}

        {/* The judge couldn't place the product — the choice is the OWNER's, not a silent
            fall-through to the default queue. */}
        {result?.needs_choice && (
          <div className="space-y-2.5">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 space-y-1">
              <p className="text-sm text-amber-300 font-medium">הסוכן לא הצליח לשייך לטייס — הבחירה שלך</p>
              {result.product_title && <p className="text-xs text-white/70" dir="ltr">{result.product_title}</p>}
              <p className="text-xs text-white/50">מילת מפתח מוצעת: <b dir="ltr">{result.keyword}</b></p>
            </div>
            <p className="text-2xs text-white/35">אפשר לסמן יותר מטייס אחד — ייווצר פוסט נפרד דרך כל טייס שנבחר, לפי הקבוצות והשפה שלו.</p>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {(result.campaigns || []).map((c) => (
                <label key={c.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors
                  ${choices.includes(c.id) ? 'border-teal-500/60 bg-teal-500/10' : 'border-edge hover:border-edge-hover bg-white/[0.03]'}`}>
                  <input type="checkbox" checked={choices.includes(c.id)} onChange={() => toggleChoice(c.id)} className="accent-teal-500" />
                  <span className="text-sm text-white/80 flex-1">{c.name}</span>
                  {c.status === 'paused' && <span className="text-2xs text-white/30">מושהה</span>}
                </label>
              ))}
              <label className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors
                ${choices.includes('queue') ? 'border-teal-500/60 bg-teal-500/10' : 'border-edge hover:border-edge-hover bg-white/[0.03]'}`}>
                <input type="checkbox" checked={choices.includes('queue')} onChange={() => toggleChoice('queue')} className="accent-teal-500" />
                <span className="text-sm text-white/60 flex-1">ללא טייס — לתור של ערוץ ברירת המחדל</span>
              </label>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setResult(null); setChoices([]); }}
                className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm">ביטול</button>
              <button disabled={busy || !choices.length}
                onClick={() => submit(choices.includes('queue')
                  ? { to_queue: true }
                  : choices.length > 1 ? { campaign_ids: choices } : { campaign_id: choices[0] })}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-sm font-medium">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                {choices.length > 1 && !choices.includes('queue') ? `שייך ותזמן (${choices.length} טייסים)` : 'שייך ותזמן'}
              </button>
            </div>
          </div>
        )}

        {result && !result.needs_choice && (
          <div className="space-y-2.5">
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-sm text-emerald-300 font-medium">
                {(result.posts?.length ?? 0) > 1 ? `✓ נוצרו ${result.posts!.length} פוסטים` : '✓ הפוסט נוצר'}
              </p>
              <p className="text-xs text-white/70">
                טייס: <b>{result.campaign_name || 'ערוץ ברירת המחדל'}</b>
                {result.note ? <span className="text-white/40"> — {result.note}</span> : null}
              </p>
              {(result.posts?.length ?? 0) > 1 && (
                <div className="space-y-0.5">
                  {result.posts!.map((p) => (
                    <p key={p.post_id} className="text-2xs text-white/50">
                      {p.campaign_name || 'ערוץ ברירת המחדל'}
                      {p.scheduled_at ? ` · ${new Date(p.scheduled_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-xs text-white/70">
                מילת מפתח: <b dir="ltr">{result.keyword}</b>
                {result.keyword_added && <span className="text-teal-300"> (נוספה לרוטציה של הטייס)</span>}
              </p>
              {result.scheduled_at && (
                <p className="text-xs text-white/70">
                  מתוזמן ל: <b>{new Date(result.scheduled_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</b>
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setResult(null); setUrl(''); }}
                className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm">קישור נוסף</button>
              <button onClick={onDone}
                className="flex-1 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium">סגור</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Push-to-platform modal (back-fill: send to a platform/group, no re-charge) ─
function PushModal({ post, channels, onClose, onDone }: {
  post: Post; channels: Channel[]; onClose: () => void; onDone: () => void;
}) {
  // No platform pre-checked. The dialog began life as a Facebook back-fill tool and
  // pre-checked Facebook; once it offered five platforms that leftover became a trap —
  // a quick "דחוף עכשיו" published to Facebook whether or not that was the intent.
  // An explicit pick is still the only way anything gets sent, but submit() enforces it
  // with a message rather than a disabled button, which on a phone just looks broken.
  const [platforms, setPlatforms] = useState<(PushPlatform)[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>(() => postTargetIds(post));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  // Pushing a Hebrew Telegram post to a US board lands Hebrew copy priced in ₪ — the
  // push deliberately re-sends the post as is. Opting in rewrites the PIN only.
  // Defaults ON when Pinterest is picked (that is the wanted behaviour ~always), and
  // the note below states the credit cost so it is never a silent charge.
  const [pinRewrite, setPinRewrite] = useState(true);

  const togglePlatform = (p: PushPlatform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
    setError('');
  };

  const submit = async () => {
    // The nothing-selected tap answers with words instead of a disabled button — on a
    // phone a greyed-out button is indistinguishable from a broken one.
    if (!platforms.length) {
      setError('לא סומנה אף פלטפורמה — סמן למעלה לאן לדחוף (טלגרם, פייסבוק וכו׳) ואז לחץ שוב.');
      return;
    }
    setBusy(true); setError('');
    try {
      await postsApi.push(post.id, platforms, groupIds.length ? groupIds : undefined,
        platforms.includes('pinterest') && pinRewrite);
      setDone('✓ נשלח');
      setTimeout(onDone, 900);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'השליחה נכשלה');
      setBusy(false);
    }
  };

  const PLATFORMS = REPUBLISH_PLATFORMS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <DialogA11y label="דחיפת פוסט לפלטפורמות" onClose={onClose} />
      <div className="bg-surface-secondary border border-edge rounded-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><Megaphone size={17} className="text-teal-400" /> דחיפת פוסט לפלטפורמה</h3>
          <button aria-label="סגור" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-white/70 line-clamp-1">{post.product_title}</p>

          <div>
            <label className="block text-xs text-white/50 mb-1.5">פלטפורמות</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const on = platforms.includes(p.id);
                return (
                  // Same selected-blue as the group chips below. These are two rows of the
                  // same control in one dialog, and giving each its own colour read as a
                  // difference in meaning rather than a difference in category.
                  <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      on ? 'bg-blue-600/20 border-blue-500/50 text-blue-200' : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'
                    }`}>
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${on ? 'bg-blue-500 border-blue-500' : 'border-white/30'}`}>
                      {on && <Check size={10} className="text-on-accent" strokeWidth={3} />}
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

          {platforms.includes('pinterest') && (
            <button type="button" onClick={() => setPinRewrite((v) => !v)} disabled={busy}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-right transition-all ${
                pinRewrite ? 'bg-teal-500/10 border-teal-500/40' : 'bg-white/[0.03] border-edge hover:border-edge-hover'
              }`}>
              <span className={`shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center ${pinRewrite ? 'bg-teal-500 border-teal-500' : 'border-white/30'}`}>
                {pinRewrite && <Check size={10} className="text-on-accent" strokeWidth={3} />}
              </span>
              <span className="flex-1">
                <span className={`block text-xs font-medium ${pinRewrite ? 'text-teal-200' : 'text-white/60'}`}>
                  כתוב מחדש לפינטרסט — אנגלית + מחיר ב-$
                </span>
                <span className="block text-2xs text-white/35 mt-0.5 leading-relaxed">
                  הפין מקבל כותרת ותיאור בסגנון SEO של פינטרסט ומחיר בדולרים. הפוסט המקורי (והודעת הטלגרם שכבר יצאה) לא משתנים. עולה יצירת AI אחת.
                </span>
              </span>
            </button>
          )}

          <p className="text-2xs text-white/30 flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-0.5 text-white/25" />
            נשלח רק לפלטפורמות ולקבוצות שבחרת — בלי חיוב קרדיט ובלי לשלוח שוב למה שכבר יצא. (טלגרם ישלח לכל הקבוצות שבחרת, כך שלמניעת כפילות בחר רק את הקבוצה החסרה.)
            {(platforms.includes('pinterest') || platforms.includes('whatsapp')) && (
              <> פינטרסט ווואטסאפ אינם מושפעים מבחירת הקבוצות — הם מפרסמים ללוח ולקבוצה שהוגדרו בהגדרות.</>
            )}
          </p>

          {done && <p className="text-xs text-emerald-400">{done}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button onClick={submit} disabled={busy || !!done}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg disabled:opacity-60 text-white text-sm font-medium transition-all ${
                platforms.length ? 'bg-teal-600 hover:bg-teal-500' : 'bg-teal-600/40'
              }`}>
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
  const [platform, setPlatform] = useState<'' | PlatformKey>('');
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
      const res = await postsApi.list({
        page, limit,
        status: status || undefined,
        source: source || undefined,
        platform: platform || undefined,
      });
      setPosts(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, limit, status, source, platform, isQueueTab]);

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
  const [importing, setImporting] = useState(false);
  const [intaking, setIntaking] = useState(false);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <FileText size={12} />
            <span>פוסטים</span>
          </div>
          <h1 className="text-2xl font-bold text-white">ניהול פוסטים</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setIntaking(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600/15 hover:bg-teal-600/25 border border-teal-500/30 text-teal-300 text-sm rounded-xl transition-all whitespace-nowrap">
            <Wand2 size={13} />
            קליטה מקישור
          </button>
          <button onClick={() => setImporting(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 text-sm rounded-xl transition-all whitespace-nowrap">
            <Upload size={13} />
            ייבוא מקובץ
          </button>
          <Link href="/settings"
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all whitespace-nowrap">
            <Settings2 size={13} />
            הגדרות
          </Link>
          {!isQueueTab && (
            <button
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-sm rounded-xl transition-all whitespace-nowrap"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              רענן
            </button>
          )}
        </div>
      </div>

      {/* Filters: status + product source. Each pill row is wider than a phone screen, so
          every row scrolls horizontally on its own (max-w-full + overflow-x-auto) — without
          it the trailing pills were simply cut off on mobile with no way to reach them. */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-xl p-1 w-fit max-w-full overflow-x-auto">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => { setStatus(t.value); setPage(1); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all shrink-0 whitespace-nowrap
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
          <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-xl p-1 w-fit max-w-full overflow-x-auto">
            {([
              { v: '' as const, l: 'כל המקורות' },
              { v: 'aliexpress' as const, l: 'AliExpress', cls: 'bg-orange-500/15 text-orange-300' },
              { v: 'flylink' as const, l: 'FLYLINK', cls: 'bg-violet-500/15 text-violet-300' },
            ]).map((s) => (
              <button
                key={s.v}
                onClick={() => { setSource(s.v); setPage(1); }}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all shrink-0 whitespace-nowrap
                  ${source === s.v ? (s.cls || 'bg-blue-600/20 text-blue-400') : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
              >
                {s.l}
              </button>
            ))}
          </div>
        )}

        {/* Publishing platform */}
        {!isQueueTab && (
          <div className="flex items-center gap-1 bg-surface-secondary border border-edge rounded-xl p-1 w-fit max-w-full overflow-x-auto">
            {PLATFORM_TABS.map((s) => (
              <button
                key={s.v}
                onClick={() => { setPlatform(s.v); setPage(1); }}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all shrink-0 whitespace-nowrap
                  ${platform === s.v ? (s.cls || 'bg-blue-600/20 text-blue-400') : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
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
              <button aria-label="עמוד ראשון"
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
              <button aria-label="עמוד קודם"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
              <span className="text-xs text-white/50 px-2">עמוד {page} מתוך {totalPages || 1}</span>
              <button aria-label="עמוד הבא"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 text-white/30 hover:text-white/70 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <button aria-label="עמוד אחרון"
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
          channels={channels}
          onClose={() => setRepublishingPost(null)}
          onDone={() => { setRepublishingPost(null); load({ silent: true }); }}
        />
      )}

      {intaking && (
        <SmartIntakeModal
          onClose={() => setIntaking(false)}
          onDone={() => { setIntaking(false); load({ silent: true }); }}
        />
      )}

      {editingPost && (
        <EditPostModal
          post={editingPost}
          channels={channels}
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

      {importing && (
        <ImportFileModal
          channels={channels}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); load({ silent: true }); }}
        />
      )}
    </div>
  );
}

// ─── File import (the owner's old products spreadsheet → queued posts) ─────────
//
// Columns are detected by their Hebrew headers with positional fallback, matching the
// real file: Keyword | שם המוצר | ✔️יתרון 1..3 | קישור למוצר. Parsing happens here in the
// browser (SheetJS, dynamically imported); rows are sent to the backend in batches of 10 —
// each batch resolves short links + enriches price/image server-side, so the whole file
// imports with live progress instead of one long request.
interface ImportRow { keyword?: string; title: string; benefits: string[]; link: string }

function ImportFileModal({ channels, onClose, onDone }: {
  channels: Channel[]; onClose: () => void; onDone: () => void;
}) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [skippedRows, setSkippedRows] = useState(0);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{ queued: number; duplicates: number; enriched: number; failed: number } | null>(null);
  const [misses, setMisses] = useState<Array<{ title: string; reason: string }>>([]);
  const [error, setError] = useState('');

  const onFile = async (f: File) => {
    setError('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (!aoa.length) { setError('הקובץ ריק'); return; }
      const header = (aoa[0] || []).map((c) => String(c ?? ''));
      const col = (pred: (h: string) => boolean, fallback: number) => {
        const i = header.findIndex(pred);
        return i >= 0 ? i : fallback;
      };
      const iKw = col((h) => /keyword/i.test(h), 0);
      const iTitle = col((h) => /שם/.test(h), 1);
      const iB1 = col((h) => /יתרון\s*1/.test(h), 2);
      const iB2 = col((h) => /יתרון\s*2/.test(h), 3);
      const iB3 = col((h) => /יתרון\s*3/.test(h), 4);
      const iLink = col((h) => /קישור|link/i.test(h), 5);
      const parsed: ImportRow[] = [];
      let skipped = 0;
      for (const r of aoa.slice(1)) {
        const title = String(r?.[iTitle] ?? '').trim();
        const link = String(r?.[iLink] ?? '').trim();
        if (!title || !/^https?:\/\//i.test(link)) { if (title || link) skipped++; continue; }
        parsed.push({
          keyword: String(r?.[iKw] ?? '').trim() || undefined,
          title,
          benefits: [r?.[iB1], r?.[iB2], r?.[iB3]].map((x) => String(x ?? '').trim()).filter(Boolean),
          link,
        });
      }
      if (!parsed.length) { setError('לא נמצאו שורות תקינות (שם מוצר + קישור)'); return; }
      setRows(parsed); setFileName(f.name); setSkippedRows(skipped);
    } catch {
      setError('קריאת הקובץ נכשלה — ודא שזה קובץ Excel/CSV תקין');
    }
  };

  const start = async () => {
    if (!rows?.length || running) return;
    setRunning(true); setError(''); setProgress(0);
    const totals = { queued: 0, duplicates: 0, enriched: 0, failed: 0 };
    const missList: Array<{ title: string; reason: string }> = [];
    try {
      for (let i = 0; i < rows.length; i += 10) {
        const r = await postsApi.importRows(rows.slice(i, i + 10), groupIds.length ? groupIds : undefined);
        totals.queued += r.queued; totals.duplicates += r.duplicates; totals.enriched += r.enriched || 0; totals.failed += r.failed;
        // Rows that imported (or already existed) but stayed without image/price carry
        // the reason — surface them so "why is this one bare?" is answerable.
        for (const x of r.results || []) if (x.reason) missList.push({ title: x.title, reason: x.reason });
        setProgress(Math.min(rows.length, i + 10));
      }
      setSummary(totals); setMisses(missList);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הייבוא נעצר באמצע — אפשר להריץ שוב, שורות שכבר נכנסו לא ישוכפלו');
    }
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={running ? undefined : onClose}>
      <DialogA11y label="ייבוא מוצרים מקובץ" onClose={() => { if (!running) onClose(); }} />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-md p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-white flex items-center gap-2"><Upload size={15} className="text-emerald-400" /> ייבוא מוצרים מקובץ</h3>
          {!running && <button aria-label="סגור" onClick={onClose} className="text-white/30 hover:text-white/60"><X size={16} /></button>}
        </div>
        <p className="text-2xs text-white/35 mb-4 leading-relaxed">
          קובץ Excel עם העמודות: שם מוצר, יתרונות, קישור שותפים. הפוסטים נבנים מהטקסט שבקובץ,
          מועשרים בתמונה ומחיר מאלי אקספרס, ונכנסים לתור השליחה האוטומטי.
        </p>

        {!rows && (
          <label className="block border-2 border-dashed border-edge-hover hover:border-emerald-500/40 rounded-xl p-8 text-center cursor-pointer transition-colors">
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            <Upload size={22} className="mx-auto text-white/25 mb-2" />
            <span className="text-sm text-white/50">לחץ לבחירת קובץ (xlsx / csv)</span>
          </label>
        )}

        {rows && !summary && (
          <>
            <div className="bg-white/3 border border-edge rounded-xl px-3 py-2.5 mb-3 text-xs text-white/70">
              📄 {fileName} — <b className="text-emerald-400">{rows.length}</b> מוצרים מוכנים לייבוא
              {skippedRows > 0 && <span className="text-white/35"> · {skippedRows} שורות חלקיות דולגו</span>}
            </div>
            <label className="block text-xs text-white/50 mb-1.5">לאילו קבוצות לפרסם</label>
            <GroupMultiSelect channels={channels} value={groupIds} onChange={setGroupIds} />
            <p className="text-2xs text-white/30 mt-1.5 mb-3">
              ללא בחירה — הפוסטים ילכו לערוץ ברירת המחדל. הפוסטים יוצאים בקצב הרגיל של התור
              (אחד למרווח, בחלון השעות) — לא בבת אחת.
            </p>
            {running && (
              <div className="mb-3">
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(progress / rows.length) * 100}%` }} />
                </div>
                <p className="text-2xs text-white/40 mt-1">{progress} / {rows.length} (פתיחת קישורים ומשיכת מחירים — לוקח זמן)</p>
              </div>
            )}
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={start} disabled={running}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {running ? 'מייבא…' : `ייבא ${rows.length} מוצרים לתור`}
              </button>
              {!running && (
                <button onClick={() => { setRows(null); setFileName(''); }} className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl">
                  קובץ אחר
                </button>
              )}
            </div>
          </>
        )}

        {summary && (
          <div className="text-center py-2">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm text-white/85 mb-1">
              נוספו לתור <b className="text-emerald-400">{summary.queued}</b> פוסטים
              {summary.enriched > 0 && <> · עודכנו <b className="text-sky-400">{summary.enriched}</b> קיימים (תמונה/מחיר)</>}
            </p>
            <p className="text-2xs text-white/40 mb-4">
              {summary.duplicates > 0 && <>‏{summary.duplicates} דולגו (כבר קיימים במערכת) · </>}
              {summary.failed > 0 && <span className="text-amber-400">‏{summary.failed} נכשלו</span>}
              {summary.failed === 0 && summary.duplicates === 0 && summary.enriched === 0 && 'הכל עבר חלק'}
            </p>
            {misses.length > 0 && (
              <div className="text-right mb-4">
                <p className="text-2xs text-amber-400/90 mb-1.5">
                  ⚠️ {misses.length} מוצרים נשארו בלי תמונה/מחיר — העלאה חוזרת של הקובץ תנסה אותם שוב:
                </p>
                <div className="max-h-36 overflow-y-auto bg-white/3 border border-edge rounded-lg px-3 py-2 space-y-1">
                  {misses.map((m, i) => (
                    <p key={i} className="text-2xs text-white/50 leading-relaxed">
                      <span className="text-white/75">{m.title}</span> — {m.reason}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onDone} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-xl">
              לתור השליחה
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
