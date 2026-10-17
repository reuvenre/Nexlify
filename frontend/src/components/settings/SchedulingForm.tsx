'use client';

import { useState, useEffect } from 'react';
import {
  ListOrdered, Loader2, CheckCircle2, Clock,
  Sun, Moon, Timer, Info, Zap,
} from 'lucide-react';
import { credentialsApi, campaignsApi, optimizerApi } from '@/lib/api-client';
import { SettingsSaveBar } from './SettingsSaveBar';
import type { Campaign } from '@/types';

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const label = i === 0 ? '00:00 (חצות)'
    : i < 10 ? `0${i}:00`
    : `${i}:00`;
  return { value: i, label };
});

// END hours run 1–24, not 0–23. An end of "00:00" is the value 0, which can never be after
// any start hour — so "until midnight" was impossible to pick and the form answered with
// "שעת הסיום חייבת להיות אחרי שעת ההתחלה" for a perfectly reasonable request. 24 is the
// end-of-day sentinel the group and campaign forms already use.
const END_HOURS = Array.from({ length: 24 }, (_, i) => {
  const h = i + 1;
  const label = h === 24 ? '24:00 (חצות)' : h < 10 ? `0${h}:00` : `${h}:00`;
  return { value: h, label };
});

const INTERVALS = [
  { value: 15,   label: 'כל 15 דקות' },
  { value: 30,   label: 'כל 30 דקות' },
  { value: 60,   label: 'כל שעה' },
  { value: 120,  label: 'כל שעתיים' },
  { value: 180,  label: 'כל 3 שעות' },
  { value: 360,  label: 'כל 6 שעות' },
  { value: 720,  label: 'כל 12 שעות' },
  { value: 1440, label: 'פעם ביום' },
];

function estimatePostsPerDay(start: number, end: number, interval: number): number {
  const hours = Math.max(0, end - start);
  const minutes = hours * 60;
  return Math.floor(minutes / interval) + (minutes % interval === 0 ? 0 : 0);
}

export function SchedulingForm() {
  const [enabled, setEnabled] = useState(false);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(22);
  const [interval, setInterval] = useState(60);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  // Winner recycling: republish proven posts (clicks/commissions) with fresh AI copy.
  const [seasonalOn, setSeasonalOn] = useState(true);
  const [recycleOn, setRecycleOn] = useState(false);
  const [optimizerOn, setOptimizerOn] = useState(false);
  // Manual optimizer run — the nightly pass is the only other way to see a digest, and
  // "wait until tomorrow morning" is a poor way to find out whether it works.
  const [optimizerRunning, setOptimizerRunning] = useState(false);
  const [optimizerDigest, setOptimizerDigest] = useState<string | null>(null);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [recycleMinClicks, setRecycleMinClicks] = useState(10);
  // Sales recovery: when orders drop below a threshold, auto-push extra hot products.
  const [recoveryOn, setRecoveryOn] = useState(false);
  const [recoveryMinOrders, setRecoveryMinOrders] = useState(5);
  const [recoveryWindowDays, setRecoveryWindowDays] = useState(3);
  const [recoveryPostsPerDay, setRecoveryPostsPerDay] = useState(3);
  // Which campaigns participate in recovery. Empty = all active campaigns.
  const [recoveryCampaignIds, setRecoveryCampaignIds] = useState<string[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    credentialsApi.get()
      .then((c) => {
        setEnabled(c.schedule_enabled ?? false);
        setStartHour(c.schedule_start_hour ?? 9);
        setEndHour(c.schedule_end_hour ?? 22);
        setInterval(c.schedule_interval_minutes ?? 60);
        setLastSentAt(c.schedule_last_sent_at ?? null);
        setSeasonalOn(c.seasonal_enabled ?? true);
        setRecycleOn(c.recycle_winners_enabled ?? false);
        setOptimizerOn(c.optimizer_enabled ?? false);
        setRecycleMinClicks(c.recycle_min_clicks ?? 10);
        setRecoveryOn(c.recovery_enabled ?? false);
        setRecoveryMinOrders(c.recovery_min_orders ?? 5);
        setRecoveryWindowDays(c.recovery_window_days ?? 3);
        setRecoveryPostsPerDay(c.recovery_posts_per_day ?? 3);
        setRecoveryCampaignIds(c.recovery_campaign_ids ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Active campaigns feed the recovery opt-in checklist.
    campaignsApi.list({ status: 'active', limit: 100 })
      .then((res) => setActiveCampaigns(res?.data ?? []))
      .catch(() => {});
  }, []);

  const postsPerDay = estimatePostsPerDay(startHour, endHour, interval);

  async function handleSave() {
    // A legacy stored 0 means end-of-day (see the select) — validate and save it as 24,
    // or the one value that MEANS "after every start hour" would fail the check.
    const effectiveEnd = endHour === 0 ? 24 : endHour;
    if (startHour >= effectiveEnd) {
      setError('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await credentialsApi.upsert({
        aliexpress_app_key: '',
        aliexpress_app_secret: '',
        aliexpress_tracking_id: '',
        telegram_bot_token: '',
        telegram_channel_id: '',
        openai_api_key: '',
        schedule_enabled: enabled,
        schedule_start_hour: startHour,
        schedule_end_hour: effectiveEnd,
        schedule_interval_minutes: interval,
        seasonal_enabled: seasonalOn,
        recycle_winners_enabled: recycleOn,
        optimizer_enabled: optimizerOn,
        recycle_min_clicks: Math.max(1, recycleMinClicks || 10),
        recovery_enabled: recoveryOn,
        recovery_min_orders: Math.max(1, recoveryMinOrders || 5),
        recovery_window_days: Math.max(1, recoveryWindowDays || 3),
        recovery_posts_per_day: Math.max(1, Math.min(20, recoveryPostsPerDay || 3)),
        recovery_campaign_ids: recoveryCampaignIds,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('שגיאה בשמירה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Run the optimizer on demand. The pass can take a while on an account with many
   * campaigns, so the digest is rendered inline when it returns — the same text the
   * morning email carries.
   */
  async function runOptimizerNow() {
    setOptimizerRunning(true);
    setOptimizerError(null);
    setOptimizerDigest(null);
    try {
      const res = await optimizerApi.run();
      if (res.ok && res.digest) setOptimizerDigest(res.digest);
      else setOptimizerError(res.reason || 'המנוע לא החזיר דו״ח — ודא שיש קמפיינים פעילים.');
    } catch (err: any) {
      setOptimizerError(err?.response?.data?.message || 'הרצת המנוע נכשלה. נסה שוב.');
    } finally {
      setOptimizerRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={22} className="animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ direction: 'rtl' }}>

      {/* Master toggle */}
      <div className="bg-surface-secondary border border-edge rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${enabled ? 'bg-amber-500/15' : 'bg-white/[0.05]'}`}>
              <Zap size={18} className={enabled ? 'text-amber-400' : 'text-white/25'} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">שליחה אוטומטית</p>
              <p className="text-xs text-white/35 mt-0.5">
                {enabled ? 'פעיל — הפוסטים יישלחו אוטומטית לפי לוח הזמנים' : 'כבוי — הפוסטים נשמרים בתור אך לא נשלחים'}
              </p>
            </div>
          </div>

          {/* Toggle switch */}
          <button
            onClick={() => setEnabled(!enabled)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${enabled ? 'bg-amber-500' : 'bg-white/10'}`}
            aria-label="Toggle auto-scheduling"
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-200 ${enabled ? 'right-0.5' : 'right-6'}`}
            />
          </button>
        </div>

        {lastSentAt && (
          <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-white/[0.03] rounded-xl">
            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
            <p className="text-xs text-white/40">
              שליחה אחרונה: {new Date(lastSentAt).toLocaleDateString('he-IL', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        )}
      </div>

      {/* Time Window */}
      <div className={`bg-surface-secondary border border-edge rounded-2xl p-5 space-y-4 transition-opacity ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Clock size={15} className="text-amber-400" />
          <h3 className="text-body font-semibold text-white">חלון שליחה</h3>
        </div>
        <p className="text-xs text-white/35 -mt-2">
          הגדר את שעות היום שבהן מותר לשלוח פוסטים אוטומטית
        </p>

        <div className="grid grid-cols-2 gap-4">
          {/* Start hour */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-white/50 mb-2">
              <Sun size={11} className="text-amber-300" />
              שעת התחלה
            </label>
            <select
              value={startHour}
              onChange={(e) => setStartHour(Number(e.target.value))}
              className="w-full bg-surface-tertiary border border-edge rounded-xl px-3 py-2.5 text-body text-white/80 outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>

          {/* End hour */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-white/50 mb-2">
              <Moon size={11} className="text-blue-300" />
              שעת סיום
            </label>
            <select
              // A stored 0 (saved back when "00:00" was offered here) means end-of-day;
              // show it as 24 so it reads as the midnight it always meant.
              value={endHour === 0 ? 24 : endHour}
              onChange={(e) => setEndHour(Number(e.target.value))}
              className="w-full bg-surface-tertiary border border-edge rounded-xl px-3 py-2.5 text-body text-white/80 outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
            >
              {END_HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* No visual timeline. It was drawn left-to-right inside an RTL page, so its
            direction read backwards, and it repeated what the two selects above already
            say precisely. A decorative element that misleads is worth less than nothing —
            the owner circled it and asked what it was for, which was the correct review. */}
      </div>

      {/* Interval */}
      <div className={`bg-surface-secondary border border-edge rounded-2xl p-5 space-y-3 transition-opacity ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <Timer size={15} className="text-amber-400" />
          <h3 className="text-body font-semibold text-white">מרווח בין פוסטים</h3>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {INTERVALS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setInterval(opt.value)}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all text-center
                ${interval === opt.value
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  : 'bg-white/[0.03] border-edge text-white/40 hover:text-white/70 hover:bg-white/[0.06]'
                }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      {enabled && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/8 border border-amber-500/15 rounded-2xl">
          <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-body font-medium text-amber-400">סיכום לוח שליחה</p>
            <p className="text-xs text-white/45 mt-1 leading-relaxed">
              שליחה בין <strong className="text-white/60">{startHour}:00</strong> ל-<strong className="text-white/60">{endHour}:00</strong>
              {' '}— עד <strong className="text-white/60">{postsPerDay}</strong> פוסטים ביום
              {' '}({INTERVALS.find(i => i.value === interval)?.label || `כל ${interval} דקות`})
            </p>
            <p className="text-xs text-white/30 mt-1">
              הפוסטים ישלחו לפי הסדר שנקבע בתור. המערכת בודקת כל דקה.
            </p>
          </div>
        </div>
      )}

      {/* Commercial-calendar seasonality — auto keywords + copy context during event windows. */}
      <div className="bg-surface-secondary border border-edge rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">🗓️ עונתיות אוטומטית</h3>
            <p className="text-xs text-white/35 mt-1">
              בתקופות מסחריות (חגי תשרי, 11.11, Black Friday, קריסמס לקהל האמריקאי ועוד) הטייסים
              מקבלים אוטומטית מילות מפתח עונתיות והכתיבה מתחברת לאווירת התקופה. כבוי = התנהגות רגילה.
            </p>
          </div>
          <button role="switch" aria-checked={!!(seasonalOn)} aria-label="עונתיות אוטומטית"
            type="button"
            onClick={() => setSeasonalOn((v) => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${seasonalOn ? 'bg-amber-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${seasonalOn ? 'right-0.5' : 'right-4'}`} />
          </button>
        </div>
      </div>

      {/* Learning optimizer — the loop-closer: nightly keyword scoring -> retire/boost + digest. */}
      <div className="bg-surface-secondary border border-edge rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">🧠 מנוע אופטימיזציה לומד</h3>
            <p className="text-xs text-white/35 mt-1">
              כל לילה המנוע מדרג את מילות המפתח לפי קליקים ועמלות אמיתיות: מוציא מהרוטציה מילים
              שקיבלו הזדמנות הוגנת בלי קליק אחד (נשמרות ב"בארכיון" וניתנות להחזרה), מכפיל את המילה
              שמייצרת עמלות, ושולח לך כל בוקר למייל דו"ח — מה שונה ולמה.
            </p>
          </div>
          <button role="switch" aria-checked={!!(optimizerOn)} aria-label="מנוע אופטימיזציה לומד"
            type="button"
            onClick={() => setOptimizerOn((v) => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${optimizerOn ? 'bg-violet-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${optimizerOn ? 'right-0.5' : 'right-4'}`} />
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-edge">
          <button
            type="button"
            disabled={optimizerRunning}
            onClick={runOptimizerNow}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all
                       bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50"
          >
            {optimizerRunning ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            {optimizerRunning ? 'המנוע רץ…' : 'הרץ עכשיו וקבל דו״ח'}
          </button>
          <p className="text-[11px] text-white/30 mt-2">
            מריץ את אותה ריצה של 03:15 — כולל השינויים במילות המפתח ושליחת המייל.
          </p>

          {optimizerError && (
            <div className="mt-3 rounded-xl border px-3 py-2 text-xs font-medium
                            bg-red-50 border-red-300 text-red-900
                            dark:bg-red-500/15 dark:border-red-400/50 dark:text-red-100">
              ⚠️ {optimizerError}
            </div>
          )}

          {optimizerDigest && (
            <pre className="mt-3 rounded-xl border p-3 text-[11px] leading-relaxed whitespace-pre-wrap
                            font-sans overflow-x-auto
                            bg-violet-50 border-violet-300 text-violet-950
                            dark:bg-violet-500/10 dark:border-violet-400/30 dark:text-violet-50"
                 dir="rtl">
              {optimizerDigest}
            </pre>
          )}
        </div>
      </div>

      {/* Winner recycling — republish proven posts (clicks/commissions) with fresh AI copy. */}
      <div className="bg-surface-secondary border border-edge rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">🏆 מיחזור מנצחים</h3>
            <p className="text-xs text-white/35 mt-1">
              פוסט שהוכיח את עצמו (קליקים או עמלה) מפורסם מחדש אוטומטית עם טקסט חדש —
              מקסימום אחד ביום, צינון 14 יום למוצר, ורק אם המחיר לא עלה בינתיים.
            </p>
          </div>
          <button role="switch" aria-checked={!!(recycleOn)} aria-label="מיחזור מנצחים"
            type="button"
            onClick={() => setRecycleOn((v) => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${recycleOn ? 'bg-amber-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${recycleOn ? 'right-0.5' : 'right-4'}`} />
          </button>
        </div>
        {recycleOn && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-white/50 mb-1.5">סף קליקים ל"מנצח"</label>
            <select aria-label="סף קליקים ל&quot;מנצח&quot;"
              value={recycleMinClicks}
              onChange={(e) => setRecycleMinClicks(+e.target.value)}
              className="bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/60 transition-colors appearance-none cursor-pointer"
              dir="ltr"
            >
              {[5, 10, 15, 20, 30, 50].map((n) => (
                <option key={n} value={n}>{n} קליקים</option>
              ))}
            </select>
            <p className="text-2xs text-white/30 mt-1.5">פוסט עם עמלה משויכת נחשב מנצח גם בלי לעמוד בסף.</p>
          </div>
        )}
      </div>

      {/* Sales recovery — when orders drop, auto-push extra hot products until they recover. */}
      <div className="bg-surface-secondary border border-edge rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">🚀 התאוששות מכירות אוטומטית</h3>
            <p className="text-xs text-white/35 mt-1">
              אם כמות ההזמנות יורדת מתחת לסף שתגדיר — המערכת "מעלה הילוך" ומפרסמת אוטומטית מוצרים חמים נוספים
              (מוצרים שקנו ולא פורסמו + הנמכרים-ביותר ב-AliExpress) לקבוצות של הקמפיינים הפעילים, עד שההזמנות חוזרות.
              כל פוסט צורך קרדיט פרסום.
            </p>
          </div>
          <button role="switch" aria-checked={!!(recoveryOn)} aria-label="התאוששות מכירות אוטומטית"
            type="button"
            onClick={() => setRecoveryOn((v) => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${recoveryOn ? 'bg-amber-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${recoveryOn ? 'right-0.5' : 'right-4'}`} />
          </button>
        </div>
        {recoveryOn && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3" dir="rtl">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">סף: פחות מ-</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={recoveryMinOrders} onChange={(e) => setRecoveryMinOrders(+e.target.value)}
                  className="w-20 bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/60" dir="ltr" />
                <span className="text-xs text-white/40">הזמנות</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">בתוך</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={recoveryWindowDays} onChange={(e) => setRecoveryWindowDays(+e.target.value)}
                  className="w-20 bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/60" dir="ltr" />
                <span className="text-xs text-white/40">ימים</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">פוסטי boost ביום</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={20} value={recoveryPostsPerDay} onChange={(e) => setRecoveryPostsPerDay(+e.target.value)}
                  className="w-20 bg-white/5 border border-edge-hover rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-amber-500/60" dir="ltr" />
                <span className="text-xs text-white/40">עד</span>
              </div>
            </div>
            <p className="sm:col-span-3 text-2xs text-white/30">
              נעצר אוטומטית ברגע שההזמנות חוזרות מעל הסף. דורש קמפיין פעיל אחד לפחות (משם נלקחות קבוצות היעד).
            </p>
          </div>
        )}
        {recoveryOn && (
          <div className="mt-4 pt-4 border-t border-edge" dir="rtl">
            <label className="block text-xs font-medium text-white/50 mb-2">אילו קמפיינים משתתפים בהתאוששות?</label>
            {activeCampaigns.length === 0 ? (
              <p className="text-2xs text-white/30">אין קמפיינים פעילים. הפעל קמפיין כדי לבחור קבוצות יעד.</p>
            ) : (
              <>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pl-1">
                  {activeCampaigns.map((c) => {
                    const checked = recoveryCampaignIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setRecoveryCampaignIds((prev) =>
                              e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                            )
                          }
                          className="w-4 h-4 rounded accent-amber-500 shrink-0"
                        />
                        <span className="text-sm text-white/80 group-hover:text-white truncate">{c.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-2xs text-white/30 mt-2">
                  {recoveryCampaignIds.length === 0
                    ? 'לא נבחר כלום — ברירת מחדל: כל הקמפיינים הפעילים משתתפים.'
                    : `נבחרו ${recoveryCampaignIds.length} קמפיינים — רק הקבוצות שלהם יקבלו פוסטי boost.`}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <SettingsSaveBar onSave={handleSave} saving={saving} saved={saved} />
    </div>
  );
}
