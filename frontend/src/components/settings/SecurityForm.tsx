'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, ShieldCheck, Smartphone, Check, X } from 'lucide-react';
import { authApi } from '@/lib/api-client';
import { useAuth } from '@/lib/hooks/useAuth';

// ── Two-factor auth panel ─────────────────────────────────────────────────────
function TwoFactorPanel() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean>(!!user?.totp_enabled);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [disabling, setDisabling] = useState(false);

  useEffect(() => { setEnabled(!!user?.totp_enabled); }, [user?.totp_enabled]);

  const startSetup = async () => {
    setError(''); setBusy(true);
    try { setSetup(await authApi.setup2fa()); }
    catch (e: any) { setError(e?.response?.data?.message || 'שגיאה'); }
    finally { setBusy(false); }
  };

  const confirmEnable = async () => {
    setError(''); setBusy(true);
    try {
      await authApi.enable2fa(code.trim());
      setEnabled(true); setSetup(null); setCode('');
    } catch (e: any) { setError(e?.response?.data?.message || 'קוד שגוי'); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    setError(''); setBusy(true);
    try {
      await authApi.disable2fa(code.trim());
      setEnabled(false); setDisabling(false); setCode('');
    } catch (e: any) { setError(e?.response?.data?.message || 'קוד שגוי'); }
    finally { setBusy(false); }
  };

  return (
    <section className="bg-surface-secondary border border-edge rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
        <Smartphone size={16} className="text-blue-400" />
        אימות דו-שלבי (2FA)
        {enabled && <span className="text-2xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 rounded-full px-2 py-0.5">פעיל</span>}
      </h3>
      <p className="text-xs text-white/40 mb-4">שכבת אבטחה נוספת — קוד מאפליקציית אימות (Google Authenticator / Authy) בכל התחברות.</p>

      {error && <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-xs text-red-400 mb-3">{error}</div>}

      {/* State A: disabled, not setting up */}
      {!enabled && !setup && (
        <button onClick={startSetup} disabled={busy}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          הפעל אימות דו-שלבי
        </button>
      )}

      {/* State B: setup in progress — show QR + verify */}
      {!enabled && setup && (
        <div className="space-y-4">
          <ol className="text-xs text-white/60 space-y-1.5 list-decimal pr-4">
            <li>פתח אפליקציית אימות (Google Authenticator, Authy וכו')</li>
            <li>סרוק את הקוד, או הזן ידנית את המפתח</li>
            <li>הזן את הקוד בן 6 הספרות שמופיע</li>
          </ol>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR" className="w-40 h-40 rounded-lg bg-white p-2 shrink-0" />
            <div className="flex-1 w-full">
              <p className="text-2xs text-white/40 mb-1">מפתח ידני:</p>
              <code className="block text-xs text-white/70 bg-white/5 border border-edge rounded-lg px-3 py-2 break-all mb-3" dir="ltr">{setup.secret}</code>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                maxLength={6} inputMode="numeric" placeholder="000000" dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-center text-lg tracking-[0.4em] font-semibold text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors mb-3" />
              <div className="flex gap-2">
                <button onClick={confirmEnable} disabled={busy || code.length !== 6}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} אמת והפעל
                </button>
                <button onClick={() => { setSetup(null); setCode(''); setError(''); }}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all">ביטול</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* State C: enabled — allow disable (requires a code) */}
      {enabled && (
        !disabling ? (
          <button onClick={() => { setDisabling(true); setError(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/15 border border-red-500/25 text-red-400 text-sm font-medium rounded-xl transition-all">
            <X size={14} /> כבה אימות דו-שלבי
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/50">הזן קוד נוכחי לאישור:</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6} inputMode="numeric" placeholder="000000" dir="ltr"
              className="w-28 bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-center tracking-widest text-white placeholder-white/20 outline-none focus:border-blue-500/50" />
            <button onClick={disable} disabled={busy || code.length !== 6}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white text-sm rounded-xl transition-all">
              {busy ? <Loader2 size={13} className="animate-spin" /> : 'כבה'}
            </button>
            <button onClick={() => { setDisabling(false); setCode(''); setError(''); }}
              className="px-3 py-2 text-white/50 text-sm">ביטול</button>
          </div>
        )
      )}
    </section>
  );
}

export function SecurityForm() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.next !== form.confirm) {
      setError('הסיסמאות אינן תואמות');
      return;
    }
    if (form.next.length < 6) {
      setError('הסיסמה החדשה חייבת להכיל לפחות 6 תווים');
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword(form.current, form.next);
      setSuccess(true);
      setForm({ current: '', next: '', confirm: '' });
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'שגיאה בשינוי הסיסמה');
    } finally {
      setSaving(false);
    }
  };

  const Field = ({
    label, field, placeholder,
  }: {
    label: string; field: 'current' | 'next' | 'confirm'; placeholder?: string;
  }) => (
    <div>
      <label className="block text-xs font-medium text-white/50 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show[field] ? 'text' : 'password'}
          value={form[field]}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          placeholder={placeholder}
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
          dir="ltr"
        />
        <button
          type="button"
          onClick={() => setShow((s) => ({ ...s, [field]: !s[field] }))}
          className="absolute top-1/2 right-3 -translate-y-1/2 text-white/30 hover:text-white/60"
        >
          {show[field] ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <TwoFactorPanel />

      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <ShieldCheck size={16} className="text-blue-400" />
          שינוי סיסמה
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="סיסמה נוכחית" field="current" placeholder="הסיסמה הנוכחית שלך" />
          <div className="h-px bg-white/5" />
          <Field label="סיסמה חדשה" field="next" placeholder="לפחות 6 תווים" />
          <Field label="אימות סיסמה חדשה" field="confirm" placeholder="הכנס שוב את הסיסמה החדשה" />

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5 text-xs text-red-400">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5 text-xs text-emerald-400">
              ✓ הסיסמה עודכנה בהצלחה
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {saving ? 'שומר...' : 'עדכן סיסמה'}
          </button>
        </form>
      </section>
    </div>
  );
}
