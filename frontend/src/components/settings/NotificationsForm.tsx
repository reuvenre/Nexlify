'use client';

import { useState, useEffect } from 'react';
import { Save, Loader2, AlertCircle, Send, CheckCircle2 } from 'lucide-react';
import { notificationsApi } from '@/lib/api-client';
import type { NotificationPrefs } from '@/types';

/**
 * Only notifications that are ACTUALLY sent appear here. Each toggle maps to real code:
 * daily_summary → the hourly digest cron; campaign_errors → the scheduler's failure path.
 * Toggles for things nothing sends were removed rather than left as decoration.
 */
const TOGGLES: { id: 'daily_summary' | 'campaign_errors'; label: string; desc: string }[] = [
  {
    id: 'daily_summary',
    label: 'סיכום ביצועים יומי',
    desc: 'מייל אחד ביום (09:00) — פוסטים שנשלחו, כשלים, ממתינים בתור, הזמנות, עמלות וקרדיטים שנותרו.',
  },
  {
    id: 'campaign_errors',
    label: 'שגיאות בטייס האוטומטי',
    desc: 'מייל כשהטייס האוטומטי נכשל. בלי זה הכשל נרשם רק בלוג של השרת ולא תדע עליו.',
  },
];

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${enabled ? 'bg-blue-600' : 'bg-white/15'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${enabled ? 'left-0.5' : 'right-0.5'}`} />
    </button>
  );
}

export function NotificationsForm() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    notificationsApi.get()
      .then(setPrefs)
      .catch(() => setError('טעינת ההעדפות נכשלה'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: 'daily_summary' | 'campaign_errors') =>
    setPrefs((p) => (p ? { ...p, [id]: !p[id] } : p));

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true); setError(null); setTestMsg('');
    try {
      const updated = await notificationsApi.update({
        daily_summary: prefs.daily_summary,
        campaign_errors: prefs.campaign_errors,
      });
      setPrefs((p) => (p ? { ...p, ...updated } : p));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('שמירת ההעדפות נכשלה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  };

  /** Sends the real digest to the account's address — proof, not a promise. */
  const handleTest = async () => {
    setTesting(true); setTestMsg(''); setError(null);
    try {
      const r = await notificationsApi.testDaily();
      setTestMsg(r.sent ? '✓ נשלח — בדוק את תיבת הדואר שלך' : 'לא נשלח — לא נמצאה כתובת מייל לחשבון');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'שליחת הבדיקה נכשלה');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-white/40">
        <Loader2 size={20} className="animate-spin ml-2" /> טוען העדפות...
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Without SMTP nothing can be delivered — say it instead of letting a switch lie. */}
      {prefs && !prefs.smtp_ready && (
        <div className="flex items-start gap-2.5 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-amber-400 font-medium">שרת המייל (SMTP) לא מוגדר</p>
            <p className="text-2xs text-white/40 mt-0.5 leading-relaxed">
              אפשר להפעיל את ההעדפות, אבל שום מייל לא יישלח עד שיוגדרו SMTP_HOST / SMTP_USER / SMTP_PASS בשרת.
            </p>
          </div>
        </div>
      )}

      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1">התראות במייל</h3>
        <p className="text-2xs text-white/35 mb-4">
          נשלחות לכתובת החשבון{prefs?.last_daily_sent_on ? ` · סיכום אחרון נשלח ב-${prefs.last_daily_sent_on}` : ''}
        </p>

        <div className="space-y-1">
          {TOGGLES.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-4 py-3 border-b border-edge last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-white/85">{t.label}</p>
                <p className="text-2xs text-white/35 mt-0.5 leading-relaxed">{t.desc}</p>
              </div>
              <Toggle enabled={!!prefs?.[t.id]} onChange={() => toggle(t.id)} />
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
        {testMsg && <p className="text-xs text-emerald-400 mt-3">{testMsg}</p>}

        <div className="flex items-center gap-2 mt-5 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
            {saved ? 'נשמר ✓' : saving ? 'שומר...' : 'שמור העדפות'}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            title="שולח את הסיכום של היום לכתובת שלך עכשיו"
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/60 text-sm rounded-xl transition-all"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            שלח סיכום לבדיקה
          </button>
        </div>
      </section>
    </div>
  );
}
