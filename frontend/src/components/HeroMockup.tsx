'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Zap, BadgeDollarSign, Send } from 'lucide-react';

/**
 * Animated product mockup for the auth/landing heroes — a live-feeling dashboard
 * built entirely in code (no screenshot to go stale): counting stats, a growing
 * bar chart, a cycling activity feed and floating commission toasts.
 */

/** Ease-out cubic count-up, respects reduced motion by jumping straight to target. */
function useCountUp(target: number, duration = 1800): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

const BARS = [34, 48, 42, 62, 55, 78, 60, 88, 72, 96, 84, 100];

const FEED = [
  { icon: '📨', text: 'פוסט פורסם ל-Telegram · טקטי בקליק' },
  { icon: '💰', text: 'עמלה חדשה שויכה לפוסט · $4.20' },
  { icon: '🔍', text: 'סוכן AI מצא 3 מוצרים חמים חדשים' },
  { icon: '📌', text: 'פין עלה ל-Pinterest · US Deals' },
  { icon: '🖱️', text: '17 קליקים בשעה האחרונה על לינק חכם' },
  { icon: '🏆', text: 'פוסט מנצח מוחזר אוטומטית לתור' },
];

function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  const max = Math.max(...points);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1)) * 48},${18 - (p / max) * 16}`)
    .join(' ');
  return (
    <svg width="48" height="20" viewBox="0 0 48 20" className="overflow-visible">
      <path d={path} fill="none" stroke={up ? '#10b981' : '#3b82f6'} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeroMockup() {
  const posts = useCountUp(9241);
  const clicks = useCountUp(14832);
  const commissions = useCountUp(1576);
  const [feedIdx, setFeedIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFeedIdx((i) => (i + 1) % FEED.length), 2600);
    return () => clearInterval(id);
  }, []);

  const stats = [
    { label: 'פוסטים', value: posts.toLocaleString(), delta: '+12.4%', spark: [3, 5, 4, 7, 6, 9, 11], icon: Send },
    { label: 'קליקים', value: clicks.toLocaleString(), delta: '+31.8%', spark: [2, 4, 3, 6, 8, 7, 12], icon: Zap },
    { label: 'עמלות', value: `$${commissions.toLocaleString()}`, delta: '+24.6%', spark: [1, 3, 2, 5, 4, 8, 10], icon: BadgeDollarSign },
  ];

  return (
    <div className="relative max-w-md w-full" dir="rtl">
      {/* Floating toasts — the "money is happening" moments */}
      <div className="hero-float absolute -top-5 -right-5 z-20 flex items-center gap-2 bg-white rounded-xl shadow-xl shadow-black/25 px-3.5 py-2.5 border border-emerald-100">
        <span className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center text-sm">💰</span>
        <div>
          <p className="text-[10px] text-gray-400 leading-none mb-0.5">עמלה חדשה</p>
          <p className="text-[13px] font-bold text-emerald-600 leading-none" dir="ltr">+$12.40</p>
        </div>
      </div>
      <div className="hero-float-slow absolute -bottom-5 -left-4 z-20 flex items-center gap-2 bg-white rounded-xl shadow-xl shadow-black/25 px-3.5 py-2.5 border border-blue-100">
        <span className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center text-sm">🚀</span>
        <div>
          <p className="text-[10px] text-gray-400 leading-none mb-0.5">פוסט אחד</p>
          <p className="text-[12px] font-bold text-blue-600 leading-none">פורסם ל-5 פלטפורמות</p>
        </div>
      </div>

      {/* Main card */}
      <div className="relative rounded-2xl overflow-hidden bg-white shadow-2xl shadow-black/40 ring-1 ring-white/20">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-50/90 border-b border-gray-100" dir="ltr">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <span className="mx-auto flex items-center gap-1.5 text-[10px] text-gray-400 bg-white border border-gray-200 rounded-md px-5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            nexlify.win-solutions.co.il
          </span>
        </div>

        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white text-[11px] font-bold">
                ר
              </div>
              <p className="text-[12px] font-semibold text-gray-800">הטייס האוטומטי שלך</p>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
              <span className="hero-pulse-ring w-1.5 h-1.5 rounded-full bg-emerald-500" />
              פעיל
            </span>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-2 mb-3.5">
            {stats.map(({ label, value, delta, spark, icon: Icon }, i) => (
              <div key={label} className="hero-fade-up bg-gray-50 border border-gray-100 rounded-xl px-2.5 py-2"
                style={{ animationDelay: `${i * 140}ms` }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[9px] text-gray-400">{label}</p>
                  <Icon size={10} className="text-gray-300" />
                </div>
                <p className="text-[14px] font-extrabold text-gray-900 leading-none mb-1" dir="ltr">{value}</p>
                <div className="flex items-center justify-between">
                  <Sparkline points={spark} up />
                  <span className="flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600" dir="ltr">
                    <TrendingUp size={8} />{delta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Bar chart — staggered grow-in, shimmer sweep on top */}
          <div className="relative rounded-xl bg-gradient-to-b from-gray-50 to-white border border-gray-100 px-3 pt-3 pb-2 mb-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-500">עמלות · 12 שבועות</p>
              <span className="text-[9px] text-gray-400">$1,576 סה״כ</span>
            </div>
            <div className="relative flex items-end gap-1 h-16" dir="ltr">
              <div className="hero-shimmer absolute inset-0 pointer-events-none rounded" />
              {BARS.map((h, i) => (
                <div key={i} className="hero-bar flex-1 rounded-t-[3px]"
                  style={{
                    height: `${h}%`,
                    animationDelay: `${200 + i * 70}ms`,
                    background: i >= BARS.length - 3
                      ? 'linear-gradient(180deg,#3b82f6,#6366f1)'
                      : 'linear-gradient(180deg,#dbeafe,#bfdbfe)',
                  }} />
              ))}
            </div>
          </div>

          {/* Live activity feed — one line, cycling */}
          <div key={feedIdx} className="hero-fade-up flex items-center gap-2 bg-blue-50/70 border border-blue-100 rounded-lg px-3 py-2">
            <span className="text-[13px]">{FEED[feedIdx].icon}</span>
            <p className="text-[11px] text-gray-600 font-medium">{FEED[feedIdx].text}</p>
            <span className="mr-auto text-[9px] text-gray-400">עכשיו</span>
          </div>
        </div>
      </div>
    </div>
  );
}
