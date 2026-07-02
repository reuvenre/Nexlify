'use client';

import { useState, useEffect } from 'react';
import { Send, Copy, RefreshCw, Check, Clock, X, CalendarClock } from 'lucide-react';
import type { PostPreview as PostPreviewType } from '@/types';

const SYMBOLS: Record<string, string> = { ILS: '₪', EUR: '€', GBP: '£', USD: '$' };

interface PostPreviewProps {
  preview: PostPreviewType;
  onPost: (text: string) => Promise<void>;
  onSchedule: (text: string, scheduledAt: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  isPosting?: boolean;
  isRegenerating?: boolean;
}

export function PostPreview({
  preview, onPost, onSchedule, onRegenerate, isPosting, isRegenerating,
}: PostPreviewProps) {
  const [text, setText] = useState(preview.generated_text);
  const [copied, setCopied] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

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
      setScheduledAt('');
    } finally {
      setIsScheduling(false);
    }
  };

  // min datetime = now + 2 minutes (can't schedule in the past)
  const minDateTime = new Date(Date.now() + 2 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

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
            <label className="block text-2xs text-white/40 mb-1.5">תאריך ושעה לפרסום</label>
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

        <button
          onClick={() => setShowScheduler((v) => !v)}
          className={`p-2.5 rounded-xl transition-all ${
            showScheduler
              ? 'bg-blue-600/20 border border-blue-500/30 text-blue-400'
              : 'bg-white/5 hover:bg-white/10 text-white/60'
          }`}
          title="תזמן פרסום"
        >
          <Clock size={14} />
        </button>

        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className="p-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 rounded-xl transition-all"
          title="צור טקסט מחדש"
        >
          <RefreshCw size={14} className={isRegenerating ? 'animate-spin' : ''} />
        </button>

        <button
          onClick={handleCopy}
          className="p-2.5 bg-white/5 hover:bg-white/10 text-white/60 rounded-xl transition-all"
          title="העתק טקסט"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
