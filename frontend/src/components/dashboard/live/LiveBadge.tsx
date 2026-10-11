'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** "How fresh is this?" — counts the seconds since the last good refresh, live. */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'עכשיו';
  if (s < 60) return `לפני ${s} שנ׳`;
  const m = Math.round(s / 60);
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  return h < 24 ? `לפני ${h} שע׳` : `לפני ${Math.round(h / 24)} ימים`;
}

export function LiveBadge({ updatedAt, error, refreshing, onRefresh }: {
  updatedAt: number | null;
  error?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stale = !!error;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface-secondary px-3 py-1.5 text-xs text-ink-muted">
      <span className="relative flex h-2 w-2" aria-hidden>
        {!stale && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
      </span>
      <span>
        {stale ? 'לא הצלחתי לרענן' : 'חי'}
        {updatedAt ? ` · עודכן ${agoText(now - updatedAt)}` : ' · טוען…'}
      </span>
      {onRefresh && (
        <button onClick={onRefresh} title="רענן עכשיו" aria-label="רענן עכשיו" className="text-ink-muted hover:text-ink transition-colors">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );
}
