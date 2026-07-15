'use client';

import { useState, useEffect } from 'react';
import { Send, Copy, RefreshCw, Check, Clock, X, CalendarClock, ListPlus, Loader2 } from 'lucide-react';
import type { PostPreview as PostPreviewType } from '@/types';

const SYMBOLS: Record<string, string> = { ILS: '₪', EUR: '€', GBP: '£', USD: '$' };

// Format a Date as a `datetime-local` value in the user's LOCAL time (the raw
// toISOString() is UTC, which showed the wrong hour for non-UTC users).
function toLocalInput(d: Date): string {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
// Default schedule = one hour ahead, but kept inside the user's publishing window
// (הגדרות פרסום) — otherwise "+1h" at 23:20 defaulted to 00:20, outside 06:00–23:00.
function defaultScheduleLocal(window?: { start: number; end: number }): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  if (window && window.end > window.start) {
    const h = d.getHours();
    if (h < window.start) {
      d.setHours(window.start, d.getMinutes(), 0, 0);            // before window today → window start today
    } else if (h >= window.end) {
      d.setDate(d.getDate() + 1);
      d.setHours(window.start, d.getMinutes(), 0, 0);            // after window → window start tomorrow
    }
  }
  return toLocalInput(d);
}

interface PostPreviewProps {
  preview: PostPreviewType;
  onPost: (text: string) => Promise<void>;
  onSchedule: (text: string, scheduledAt: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  /** One-click add to the auto-send queue (timing decided by the user's schedule settings). */
  onQueue?: (text: string) => Promise<{ queue_active: boolean; interval_minutes: number }>;
  /** The user's publishing window (hours) — the schedule default is kept inside it. */
  scheduleWindow?: { start: number; end: number };
  isPosting?: boolean;
  isRegenerating?: boolean;
}

export function PostPreview({
  preview, onPost, onSchedule, onRegenerate, onQueue, scheduleWindow, isPosting, isRegenerating,
}: PostPreviewProps) {
  const [text, setText] = useState(preview.generated_text);
  const [copied, setCopied] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(() => defaultScheduleLocal(scheduleWindow));
  const [isScheduling, setIsScheduling] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [queue, setQueue] = useState<{ msg: string; tone: 'ok' | 'warn' | 'error' } | null>(null);

  // Resync the editable text whenever a NEW server-generated preview arrives (e.g. after
  // "regenerate"). Keying the effect on preview.generated_text means user edits — which
  // only change local `text`, not the prop — are preserved; only a fresh server text resets it.
  useEffect(() => {
    setText(preview.generated_text);
  }, [preview.generated_text]);

  const sym = SYMBOLS[preview.product.currency] || preview.product.currency || '₪';

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSchedule = async () => {
    if (!scheduledAt) return;
    setIsScheduling(true);
    try {
      await onSchedule(text, new Date(scheduledAt).toISOString());
      setShowScheduler(false);
      setScheduledAt(defaultScheduleLocal(scheduleWindow));
    } finally {
      setIsScheduling(false);
    }
  };

  const handleQueue = async () => {
    if (!onQueue) return;
    setIsQueueing(true);
    setQueue(null);
    try {
      const res = await onQueue(text);
      // Tone comes from a real boolean, not a fragile string match on the message.
      setQueue(res.queue_active
        ? { tone: 'ok', msg: `✓ נכנס לתור — יישלח אוטומטית (כל ${res.interval_minutes} דק׳ בחלון שהגדרת)` }
        : { tone: 'warn', msg: '✓ נכנס לתור — אבל התור כבוי! הפעל אותו בהגדרות ← תזמון אוטומטי' });
    } catch (e: any) {
      setQueue({ tone: 'error', msg: e?.response?.data?.message || 'הוספה לתור נכשלה — נסה שוב' });
    } finally {
      setIsQueueing(false);
    }
  };

  // min datetime = now + 2 minutes (can't schedule in the past), in LOCAL time.
  const minDateTime = toLocalInput(new Date(Date.now() + 2 * 60 * 1000));

  return (
    <div className="space-y-4">
      {/* Telegram preview */}
      <div className="bg-surface-secondary rounded-xl p-4 border border-edge">
        <p className="text-2xs text-blue-400/60 uppercase tracking-widest mb-3 flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#2aabee]" />
          תצוגה מקדימה — Telegram
        </p>

        {preview.product.image_url && (
          <div className="rounded-lg overflow-hidden mb-3 max-h-48">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.product.image_url} alt="" className="w-full object-cover" />
          </div>
        )}

        {/* Editable text */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full bg-transparent text-sm text-white leading-relaxed resize-none outline-none font-mono"
          dir="rtl"
        />

        {/* Auto-appended coupon. Shown read-only rather than merged into the editable text
            because it is resolved again at send time — editing it here would be a lie. */}
        {preview.coupon_line && (
          <div className="mt-2 rounded-lg border border-pink-500/25 bg-pink-500/[0.06] px-3 py-2">
            <p className="text-2xs text-pink-300/70 mb-1">נוסף אוטומטית בשליחה:</p>
            <p className="text-xs text-pink-200 whitespace-pre-line leading-relaxed" dir="rtl">
              {preview.coupon_line}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-edge text-2xs text-white/30">
          <span>{sym}{preview.price_ils.toLocaleString('he-IL')}</span>
          <span>·</span>
          <span>{text.length} תווים</span>
        </div>
      </div>

      {/* Schedule panel */}
      {showScheduler && (
        <div className="bg-surface-secondary border border-blue-500/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-blue-400 flex items-center gap-2">
              <CalendarClock size={13} />
              תזמון פרסום
            </p>
            <button
              onClick={() => setShowScheduler(false)}
              className="text-white/30 hover:text-white/60"
            >
              <X size={13} />
            </button>
          </div>

          <div>
            <label className="block text-2xs text-white/40 mb-1.5">תאריך ושעה לפרסום <span className="text-white/25">(ברירת מחדל: עוד שעה)</span></label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              min={minDateTime}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
          </div>

          <button
            onClick={handleSchedule}
            disabled={!scheduledAt || isScheduling}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-60 border border-blue-500/30 text-blue-400 text-sm font-medium rounded-xl transition-all"
          >
            <Clock size={13} className={isScheduling ? 'animate-pulse' : ''} />
            {isScheduling ? 'מתזמן...' : 'אשר תזמון'}
          </button>
        </div>
      )}

      {/* Queue result message */}
      {queue && (
        <div className={`text-xs rounded-xl px-4 py-3 border ${
          queue.tone === 'ok'
            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
            : queue.tone === 'warn'
              ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
              : 'bg-red-500/10 border-red-500/25 text-red-300'
        }`}>
          {queue.msg}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPost(text)}
          disabled={isPosting}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
        >
          <Send size={14} />
          {isPosting ? 'שולח...' : 'שלח עכשיו'}
        </button>

        {onQueue && (
          // Solid violet — the translucent violet-300 version was unreadable on the
          // light theme (looked like a disabled button).
          <button
            onClick={handleQueue}
            disabled={isQueueing}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
            title="הוסף לתור — יישלח אוטומטית לפי הגדרות התזמון שלך"
          >
            {isQueueing ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />}
            הוסף לתור
          </button>
        )}

        <button
          onClick={() => setShowScheduler((v) => !v)}
          className={`p-2.5 rounded-xl border transition-all ${
            showScheduler
              ? 'bg-blue-600/20 border-blue-500/30 text-blue-400'
              : 'bg-white/5 hover:bg-white/10 border-edge-hover text-white/70'
          }`}
          title="תזמן לתאריך ושעה"
        >
          <Clock size={14} />
        </button>

        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="p-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 border border-edge-hover text-white/70 rounded-xl transition-all"
          title="צור טקסט מחדש"
        >
          <RefreshCw size={14} className={isRegenerating ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={handleCopy}
          className="p-2.5 bg-white/5 hover:bg-white/10 border border-edge-hover text-white/70 rounded-xl transition-all"
          title="העתק טקסט"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      </div>

      {/* Icon-button legend — the icons alone were not self-explanatory */}
      <p className="text-2xs text-white/30 flex items-center gap-3 justify-end">
        <span className="flex items-center gap-1"><Clock size={10} /> תזמון ידני</span>
        <span className="flex items-center gap-1"><RefreshCw size={10} /> צור מחדש</span>
        <span className="flex items-center gap-1"><Copy size={10} /> העתק</span>
      </p>
    </div>
  );
}
