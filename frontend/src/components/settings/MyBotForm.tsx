'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Brain, Check, Copy, ExternalLink, Link2, Loader2, Lock, Unlink } from 'lucide-react';
import { myBotApi, type MyBotStatus } from '@/lib/api-client';

/**
 * The account's own Telegram bot (backend: telegram-bot/tenant-bot.ts).
 *
 * Readers search the account's products through it, set price-drop alerts and track parcels
 * (Growth). The account owner links his own private chat to the same bot and talks to the
 * manager there (Autopilot). Everything goes out under the account's bot name and earns
 * through the account's own links.
 */
export function MyBotForm() {
  const [status, setStatus] = useState<MyBotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'' | 'connect' | 'disconnect' | 'link' | 'unlink'>('');
  const [error, setError] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await myBotApi.status());
    } catch {
      setError('טעינת מצב הבוט נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Until the owner taps the link, keep checking — the screen turns green on its own.
  useEffect(() => {
    if (!linkUrl || status?.manager_linked) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [linkUrl, status?.manager_linked, load]);

  const connect = async () => {
    setBusy('connect'); setError('');
    try {
      const r = await myBotApi.connect(token.trim());
      if (!r.ok) setError(r.error || 'החיבור נכשל');
      else { setToken(''); await load(); }
    } catch (e: any) {
      setError(e?.response?.data?.message || 'החיבור נכשל');
    } finally { setBusy(''); }
  };

  const disconnect = async () => {
    if (!window.confirm('לנתק את הבוט? הקוראים יפסיקו לקבל תשובות ממנו, והצ\'אט של המנהל ינותק.')) return;
    setBusy('disconnect'); setError('');
    try { await myBotApi.disconnect(); setLinkUrl(''); await load(); }
    catch { setError('הניתוק נכשל'); }
    finally { setBusy(''); }
  };

  const createLink = async () => {
    setBusy('link'); setError('');
    try {
      const r = await myBotApi.link();
      if (r.url) setLinkUrl(r.url); else setError(r.error || 'יצירת הקישור נכשלה');
    } catch { setError('יצירת הקישור נכשלה'); }
    finally { setBusy(''); }
  };

  const unlink = async () => {
    setBusy('unlink'); setError('');
    try { await myBotApi.unlink(); setLinkUrl(''); await load(); }
    catch { setError('הניתוק נכשל'); }
    finally { setBusy(''); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-blue-400" /></div>;

  const s = status;
  const botLink = s?.username ? `https://t.me/${s.username}` : '';

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* ── The readers' bot ─────────────────────────────────────────── */}
      <section className="card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0"><Bot size={18} className="text-blue-400" /></div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">בוט חיפוש לקוראים</h3>
            <p className="text-xs text-white/45 mt-0.5 leading-relaxed">
              הקוראים שלך כותבים לבוט מה הם מחפשים ומקבלים 3 מוצרים עם הקישורים שלך, התראה כשמחיר יורד וקישור למעקב חבילה.
              בתחתית כל פוסט בטלגרם תופיע הזמנה לבוט.
            </p>
          </div>
          {!s?.search_bot_allowed && <PlanBadge plan="Growth" />}
        </div>

        {s?.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-sm ${s.webhook_ok && !s.webhook_error ? 'text-emerald-400' : 'text-amber-400'}`}>
                {s.webhook_ok && !s.webhook_error ? <Check size={15} /> : <AlertTriangle size={15} />}
                {s.username ? <bdi dir="ltr">@{s.username}</bdi> : 'הבוט'} {s.webhook_ok && !s.webhook_error ? 'מחובר ועונה' : 'לא עונה כרגע'}
              </span>
              {botLink && (
                <a href={botLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline">
                  פתח בטלגרם <ExternalLink size={12} />
                </a>
              )}
            </div>
            {s.webhook_error && <p className="text-xs text-amber-400">{s.webhook_error}</p>}
            {!s.search_bot_allowed && (
              <p className="text-xs text-amber-400">הבוט מחובר, אבל החיפוש לקוראים פעיל רק בתוכנית Growth ומעלה. עד השדרוג הקוראים יקבלו הודעה שהחיפוש מושבת.</p>
            )}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => { setToken(''); setStatus({ ...s, connected: false }); }} className="btn btn-ghost text-sm">חבר מחדש / החלף בוט</button>
              <button onClick={disconnect} disabled={!!busy} className="px-3 py-2 text-sm rounded-xl text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                {busy === 'disconnect' ? <Loader2 size={14} className="animate-spin inline" /> : 'נתק בוט'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ol className="text-xs text-white/55 space-y-1 list-decimal pr-4 leading-relaxed">
              <li>בטלגרם, פתח את <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">@BotFather</a> ושלח <code dir="ltr">/newbot</code>.</li>
              <li>בחר שם (למשל &quot;דילים של הערוץ שלי&quot;) ושם משתמש שמסתיים ב-bot.</li>
              <li>העתק את הטוקן שקיבלת והדבק כאן. אפשר גם בוט קיים, אבל חיבור מחליף אינטגרציה אחרת שהייתה עליו.</li>
            </ol>
            <div className="flex gap-2 flex-wrap">
              <input value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" placeholder="1234567890:AAH..."
                className="input flex-1 min-w-[240px] font-mono text-sm" />
              <button onClick={connect} disabled={!token.trim() || !!busy} className="btn btn-primary text-sm">
                {busy === 'connect' ? <Loader2 size={14} className="animate-spin" /> : 'חבר בוט'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── The manager in the owner's own chat ─────────────────────── */}
      <section className="card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 flex items-center justify-center shrink-0"><Brain size={18} className="text-violet-400" /></div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">המנהל החכם בטלגרם</h3>
            <p className="text-xs text-white/45 mt-0.5 leading-relaxed">
              שואלים בעברית (&quot;מה הכי עבד השבוע?&quot;, &quot;למה ירדו הקליקים?&quot;) ומקבלים תשובה מהנתונים של החשבון.
              הצעות לשינוי מגיעות עם כפתורי ✅/❌, ובכל יום ראשון בבוקר מגיעה סקירה שבועית.
            </p>
          </div>
          {!s?.manager_allowed && <PlanBadge plan="Autopilot" />}
        </div>

        {!s?.connected ? (
          <p className="text-xs text-white/40">חבר קודם את הבוט למעלה. המנהל מדבר איתך באותו בוט, רק בצ&apos;אט הפרטי שלך.</p>
        ) : s.manager_linked ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400"><Check size={15} /> הצ&apos;אט שלך מקושר</span>
            {!s.manager_allowed && <span className="text-xs text-amber-400">המנהל יענה אחרי שדרוג ל-Autopilot.</span>}
            <button onClick={unlink} disabled={!!busy} className="px-3 py-1.5 text-xs rounded-lg text-white/50 hover:text-white/80 hover:bg-white/5 inline-flex items-center gap-1">
              <Unlink size={12} /> נתק את הצ&apos;אט
            </button>
          </div>
        ) : linkUrl ? (
          <div className="space-y-2">
            <p className="text-sm text-white/70">פתח את הקישור מהטלפון שלך ולחץ &quot;Start&quot;. הקישור תקף ל-30 דקות ולשימוש אחד.</p>
            <div className="flex gap-2 flex-wrap items-center">
              <a href={linkUrl} target="_blank" rel="noreferrer" className="btn btn-primary text-sm inline-flex items-center gap-1.5"><Link2 size={14} /> פתח בטלגרם</a>
              <button onClick={() => copy(linkUrl)} className="btn btn-ghost text-sm inline-flex items-center gap-1.5">
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'הועתק' : 'העתק קישור'}
              </button>
              <span className="text-xs text-white/35 inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> ממתין לחיבור…</span>
            </div>
          </div>
        ) : (
          <button onClick={createLink} disabled={!!busy} className="btn btn-primary text-sm inline-flex items-center gap-1.5">
            {busy === 'link' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} קשר את הצ&apos;אט שלי
          </button>
        )}
      </section>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return (
    <a href="/settings?tab=subscription" className="badge-warning inline-flex items-center gap-1 text-2xs shrink-0">
      <Lock size={11} /> זמין מ-{plan}
    </a>
  );
}
