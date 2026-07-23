'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { Loader2, AlertCircle, ArrowLeft, CheckCheck } from 'lucide-react';

/** The channels the autopilot fans out to + the product sources it shops from. */
const PLATFORMS = ['📨 Telegram', '📸 Instagram', '📘 Facebook', '📌 Pinterest', '💬 WhatsApp'];

export default function LoginPage() {
  const { login, completeMfa } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // 2FA challenge state
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const { mfaToken } = await login(email, password);
      if (mfaToken) setMfaToken(mfaToken); // account has 2FA → ask for the code
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      if (!e.response) {
        setError('שגיאת חיבור — ודא שהשרת פועל');
      } else {
        setError('אימייל או סיסמה שגויים');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setIsLoading(true);
    try {
      await completeMfa(mfaToken, code.trim());
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      setError(!e.response ? 'שגיאת חיבור — ודא שהשרת פועל'
        : e.response.status === 401 ? 'קוד שגוי או שפג תוקפו — נסה שוב'
        : 'האימות נכשל');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ direction: 'rtl' }}>

      {/* ── Right panel: form ──────────────────────────────────────────────── */}
      <div className="w-full lg:w-[46%] flex flex-col bg-white">

        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            {/* This panel is already white, so the mark needs no plate of its own. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="w-8 h-8 object-contain" />
            <span className="text-sm font-semibold text-gray-900 tracking-tight">Nexlify</span>
          </div>
          <Link
            href="/register"
            className="flex items-center gap-1 text-body text-gray-500 hover:text-gray-800 transition-colors"
          >
            הירשם
            <ArrowLeft size={13} />
          </Link>
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center px-8 py-12">
          <div className="w-full max-w-[380px]">

            {mfaToken ? (
              /* ── 2FA code step ─────────────────────────────────────────── */
              <div>
                <div className="mb-7">
                  <h1 className="text-[26px] font-bold text-gray-900 leading-tight">אימות דו-שלבי</h1>
                  <p className="text-sm text-gray-500 mt-1.5">הזן את הקוד בן 6 הספרות מאפליקציית האימות שלך</p>
                </div>
                <form onSubmit={handleMfaSubmit} className="space-y-4">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    dir="ltr"
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-3 text-center text-2xl tracking-[0.5em] font-semibold text-gray-900 placeholder-gray-300 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all bg-white"
                    style={{ WebkitTextFillColor: '#111827', color: '#111827' }}
                  />
                  {error && (
                    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3">
                      <AlertCircle size={14} className="text-red-500 shrink-0" />
                      <p className="text-body text-red-600">{error}</p>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-55 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm shadow-blue-600/20"
                  >
                    {isLoading && <Loader2 size={15} className="animate-spin" />}
                    {isLoading ? 'מאמת...' : 'אמת והתחבר'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMfaToken(null); setCode(''); setError(''); }}
                    className="w-full text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    חזרה להתחברות
                  </button>
                </form>
              </div>
            ) : (
            <>
            {/* Heading */}
            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-gray-900 leading-tight">ברוכים הבאים</h1>
              <p className="text-sm text-gray-500 mt-1.5">התחבר לחשבון שלך להמשך</p>
            </div>

            {/* Google OAuth */}
            <a
              href="/api/auth/google"
              className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all text-body text-gray-700 font-medium shadow-sm mb-5"
            >
              <svg width="17" height="17" viewBox="0 0 48 48" className="shrink-0">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13 17.7 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.7 37.3 46.5 31.3 46.5 24.5z"/>
                <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6L2.5 13.3A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8-6z"/>
                <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.3-7.7 2.3-6.3 0-11.6-4.2-13.5-10l-8 6.2C6.6 42.6 14.6 48 24 48z"/>
              </svg>
              המשך עם Google
            </a>

            {/* Divider */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400 font-medium tracking-wider">או</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {/* Email/Password form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-body font-medium text-gray-700 mb-1.5">אימייל</label>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  dir="ltr"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all bg-white"
                  style={{ WebkitTextFillColor: '#111827', color: '#111827' }}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-body font-medium text-gray-700">סיסמה</label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-blue-600 hover:text-blue-500 transition-colors"
                  >
                    שכחת סיסמה?
                  </Link>
                </div>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all bg-white"
                  style={{ WebkitTextFillColor: '#111827', color: '#111827' }}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-body text-red-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-55 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all duration-150 flex items-center justify-center gap-2 shadow-sm shadow-blue-600/20"
              >
                {isLoading && <Loader2 size={15} className="animate-spin" />}
                {isLoading ? 'מתחבר...' : 'כניסה'}
              </button>
            </form>

            <p className="text-center text-xs text-gray-400 mt-6">
              אין לך חשבון?{' '}
              <Link href="/register" className="text-blue-600 font-semibold hover:text-blue-500 transition-colors">
                הירשם בחינם
              </Link>
            </p>
            </>
            )}
          </div>
        </div>
      </div>

      {/* ── Left panel: hero — clean deep-blue "Afflow-style": product mockup +
             proof badges over a saturated blue gradient (was near-black). ──────── */}
      <div
        className="always-dark hidden lg:flex lg:flex-1 flex-col relative overflow-hidden"
        style={{ background: 'linear-gradient(165deg, #1d4ed8 0%, #1e40af 40%, #101f5e 100%)' }}
      >
        {/* Ambient glows */}
        <div className="absolute top-[12%] right-[20%] w-[30rem] h-[30rem] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 65%)' }} />
        <div className="absolute bottom-[8%] left-[10%] w-96 h-96 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.22) 0%, transparent 65%)' }} />

        {/* Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center px-14 py-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/15 rounded-full px-3.5 py-1.5 w-fit mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-white/80 font-medium">נבנתה על ידי משווק שותפים, בשביל משווקי שותפים</span>
          </div>

          <h1 className="text-[40px] font-extrabold text-white leading-[1.12] tracking-tight mb-4">
            אוטומציה לשיווק שותפים<br />
            <span className="text-blue-200">#withNexlify</span>
          </h1>

          <p className="text-[15px] text-white/75 leading-relaxed mb-5 max-w-md">
            המערכת מוצאת מוצרים טרנדיים, כותבת פוסטים מותאמים עם AI, מפרסמת אוטומטית לכל
            הערוצים שלך — ועוקבת אחרי כל עמלה עד לפוסט שהניב אותה.
          </p>

          {/* Proof checks — Afflow-style one-liner trio */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 mb-8">
            {['עובד בזמן שאתם ישנים', 'שיוך פוסט-למכירה', 'סוכן גילוי מוצרים AI'].map((f) => (
              <span key={f} className="flex items-center gap-1.5 text-xs text-white/80">
                <CheckCheck size={13} className="text-emerald-300" /> {f}
              </span>
            ))}
          </div>

          {/* Dashboard mockup — pure CSS, no image asset to go stale */}
          <div className="bg-white rounded-2xl shadow-2xl shadow-black/40 overflow-hidden max-w-md w-full" dir="ltr">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span className="mx-auto text-[10px] text-gray-400 bg-white border border-gray-200 rounded-md px-6 py-0.5">
                nexlify.win-solutions.co.il
              </span>
            </div>
            <div className="p-4" dir="rtl">
              <p className="text-[11px] font-semibold text-gray-800 mb-3">שלום, רובי 👋</p>
              {/* Stat tiles */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: 'פוסטים', value: '9,241' },
                  { label: 'קליקים', value: '14,832' },
                  { label: 'עמלות', value: '$1,576' },
                ].map((s) => (
                  <div key={s.label} className="bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2">
                    <p className="text-[9px] text-gray-400">{s.label}</p>
                    <p className="text-[13px] font-bold text-gray-800">{s.value}</p>
                  </div>
                ))}
              </div>
              {/* Mini bar chart */}
              <div className="flex items-end gap-1 h-14">
                {[35, 55, 40, 70, 52, 85, 62, 92, 74, 100, 88, 96].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t"
                    style={{ height: `${h}%`, background: i % 3 === 2 ? '#3b82f6' : '#dbeafe' }} />
                ))}
              </div>
            </div>
          </div>

          {/* Publish targets + sources — the fan-out is the wow, show it */}
          <div className="flex flex-wrap gap-2 mt-7">
            {PLATFORMS.map((p) => (
              <span key={p} className="text-xs bg-white/10 border border-white/15 rounded-full px-3 py-1.5 text-white/80">
                {p}
              </span>
            ))}
            <span className="text-xs bg-white/10 border border-white/15 rounded-full px-3 py-1.5 text-white/80">🛒 AliExpress</span>
            <span className="text-xs bg-white/10 border border-white/15 rounded-full px-3 py-1.5 text-white/80">📦 Amazon</span>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="relative z-10 px-14 pb-8">
          <div className="flex items-center gap-3 pt-6 border-t border-edge">
            <div className="bg-white rounded-lg p-1 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="" className="w-5 h-5 object-contain" />
            </div>
            <p className="text-xs text-white/45">
              Nexlify · מבית{' '}
              <a href="https://win-solutions.co.il" target="_blank" rel="noopener noreferrer"
                className="text-white/70 hover:text-white underline-offset-2 hover:underline">Win Solutions</a>
              {' '}· כל הזכויות שמורות 2026
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
