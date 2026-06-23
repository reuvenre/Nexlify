'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { Bot, Loader2, AlertCircle, ArrowLeft, CheckCheck } from 'lucide-react';

const FEATURES = [
  'פרסום אוטומטי לטלגרם ב-AI',
  'קישורי שותפים אוטומטיים',
  'ניתוח הכנסות בזמן אמת',
  'תמיכה בעברית, ערבית ואנגלית',
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
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

  return (
    <div className="min-h-screen flex" style={{ direction: 'rtl' }}>

      {/* ── Right panel: form ──────────────────────────────────────────────── */}
      <div className="w-full lg:w-[46%] flex flex-col bg-white">

        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
              <Bot size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900 tracking-tight">NEXUS</span>
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

            {/* Heading */}
            <div className="mb-7">
              <h1 className="text-[26px] font-bold text-gray-900 leading-tight">ברוכים הבאים</h1>
              <p className="text-sm text-gray-500 mt-1.5">התחבר לחשבון שלך להמשך</p>
            </div>

            {/* Google OAuth */}
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/google`}
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
          </div>
        </div>
      </div>

      {/* ── Left panel: hero ───────────────────────────────────────────────── */}
      <div
        className="always-dark hidden lg:flex lg:flex-1 flex-col relative overflow-hidden"
        style={{ background: 'linear-gradient(150deg, #0d1b4b 0%, #080d20 50%, #130a2a 100%)' }}
      >
        {/* Ambient glows */}
        <div className="absolute top-1/4 right-1/3 w-[32rem] h-[32rem] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.14) 0%, transparent 65%)' }} />
        <div className="absolute bottom-1/4 left-1/4 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 65%)' }} />

        {/* Grid texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

        {/* Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-center px-14">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-white/8 border border-edge-hover rounded-full px-3 py-1.5 w-fit mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-white/60 font-medium">פלטפורמת שיווק שותפים #1</span>
          </div>

          <h1 className="text-[44px] font-extrabold text-white leading-[1.1] tracking-tight mb-5">
            נהל את עסק<br />
            השותפים שלך<br />
            <span className="gradient-text-hero">בפלטפורמה אחת</span>
          </h1>

          <p className="text-[15px] text-white/70 leading-relaxed mb-10 max-w-sm">
            מוצרים, תוכן AI, פרסום אוטומטי ומעקב הכנסות —
            הכל בממשק אחד ופשוט.
          </p>

          {/* Features */}
          <div className="space-y-3">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2.5">
                <div className="w-4 h-4 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center shrink-0">
                  <CheckCheck size={9} className="text-blue-400" />
                </div>
                <span className="text-body text-white/75">{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="relative z-10 px-14 pb-8">
          <div className="flex items-center gap-3 pt-6 border-t border-edge">
            <div className="w-6 h-6 rounded-[7px] bg-white/10 flex items-center justify-center">
              <Bot size={12} className="text-white/60" />
            </div>
            <p className="text-xs text-white/45">NEXUS · כל הזכויות שמורות 2026</p>
          </div>
        </div>
      </div>
    </div>
  );
}
