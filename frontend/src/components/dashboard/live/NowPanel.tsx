'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, MousePointerClick, Send, ShoppingBag } from 'lucide-react';
import type { LiveStats } from '@/lib/api-client';
import { agoText } from './LiveBadge';

/** "In" phrasing for a time ahead: «בעוד 12 דק׳». */
function inText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'עכשיו';
  if (m < 60) return `בעוד ${m} דק׳`;
  const h = Math.round(m / 60);
  return h < 24 ? `בעוד ${h} שע׳` : `בעוד ${Math.round(h / 24)} ימים`;
}

/**
 * What is happening right now: the last click, the last post, what is waiting to go out,
 * and anything that failed today. Re-renders every second so "לפני 40 שנ׳" stays true
 * between refreshes.
 */
export function NowPanel({ live }: { live: LiveStats | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = (iso: string | null) => (iso ? agoText(now - new Date(iso).getTime()) : '—');
  const q = live?.queue;
  const waiting = q ? q.scheduled + q.queued + q.pending : 0;
  const rows: Array<{ icon: React.ElementType; label: string; value: React.ReactNode; tone?: 'warn' }> = [
    { icon: MousePointerClick, label: 'קליק אחרון', value: ago(live?.last_click_at ?? null) },
    { icon: Send, label: 'פוסט אחרון יצא', value: ago(live?.last_post_at ?? null) },
    {
      icon: Clock,
      label: 'ממתינים לשליחה',
      value: q ? `${waiting}${q.next_at ? ` · הבא ${inText(new Date(q.next_at).getTime() - now)}` : ''}` : '—',
    },
    { icon: ShoppingBag, label: 'הזמנה אחרונה שסונכרנה', value: ago(live?.last_order_at ?? null) },
  ];
  if (live && live.today.failed > 0) {
    rows.push({ icon: AlertTriangle, label: 'נכשלו היום', value: <Link href="/posts?status=failed" className="underline">{live.today.failed} פוסטים</Link>, tone: 'warn' });
  }
  return (
    <div className="card p-5">
      <h2 className="section-title mb-4">קורה עכשיו</h2>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${r.tone === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'border-edge bg-surface-tertiary text-ink-muted'}`}>
              <r.icon size={14} />
            </span>
            <span className="flex-1 text-xs text-ink-muted">{r.label}</span>
            <span className={`text-sm font-medium ${r.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-ink'}`}>{r.value}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-2xs text-ink-muted leading-relaxed">
        הזמנות חדשות מגיעות מאלי אקספרס בסנכרון כל שעה (ועדכוני סטטוס כל 3 שעות), ולכן העמלות מתעדכנות בקפיצות ולא בזמן אמת כמו קליקים ופוסטים. המשבצת סופרת את 24 השעות האחרונות, כך שהיא לא מתאפסת בחצות; הגרף היומי מחולק לפי היום של אלי אקספרס (שעון החוף המערבי בארה"ב, מתחיל ב-10:00 שעון ישראל), כמו בפורטל ובמסך ההזמנות.
      </p>
    </div>
  );
}
