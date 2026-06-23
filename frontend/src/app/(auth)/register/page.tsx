'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { Bot, Loader2, AlertCircle, CheckCircle2, Zap, TrendingUp, Globe } from 'lucide-react';

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const requirements = [
    { label: '8 תווים לפחות', ok: password.length >= 8 },
    { label: 'אות גדולה', ok: /[A-Z]/.test(password) },
    { label: 'ספרה', ok: /\d/.test(password) },
    { label: 'סיסמאות תואמות', ok: password === confirm && confirm.length > 0 },
  ];

  const isValid = requirements.every((r) => r.ok) && email.includes('@');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError('');
    setIsLoading(true);
    try {
      await register(email, password);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string }; status?: number }; message?: string };
      if (!e.response) {
        setError('לא ניתן להתחבר לשרת. ודא שהשרת פועל על פורט 3001.');
      } else if (e.response.status === 409) {
        setError('כתובת האימייל כבר רשומה במערכת');
      } else {
        setError(e.response.data?.message || 'שגיאה ביצירת החשבון');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-row" style={{ direction: 'ltr' }}>

      {/* ── Left: form panel ───────────────────────────────────────────────── */}
      <div className="w-full lg:w-[45%] flex items-center justify-center bg-surface-primary px-8 py-12">
        <div className="w-full max-w-[340px]" style={{ direction: 'rtl' }}>

          {/* Logo */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Bot size={20} className="text-white" />
            </div>
            <span className="text-white font-bold text-lg tracking-tight">NEXUS</span>
          </div>

          <div className="mb-7">
            <h2 className="text-2xl font-bold text-white">יצירת חשבון</h2>
            <p className="text-white/40 text-sm mt-1">הצטרף ל-NEXUS בחינם</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">אימייל</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                style={{ direction: 'ltr' }}
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-blue-500/60 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">סיסמה</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ direction: 'ltr' }}
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-blue-500/60 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">אשר סיסמה</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{ direction: 'ltr' }}
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 outline-none focus:border-blue-500/60 transition-all"
              />
            </div>

            {password.length > 0 && (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 py-1">
                {requirements.map((req) => (
                  <div key={req.label} className="flex items-center gap-1.5 text-xs">
                    <CheckCircle2 size={11} className={req.ok ? 'text-emerald-400' : 'text-white/20'} />
                    <span className={req.ok ? 'text-white/60' : 'text-white/25'}>{req.label}</span>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertCircle size={14} className="text-red-400 shrink-0" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !isValid}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 mt-1"
            >
              {isLoading && <Loader2 size={15} className="animate-spin" />}
              {isLoading ? 'יוצר חשבון...' : 'צור חשבון'}
            </button>
          </form>

          {/* divider */}
          <div className="mt-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-xs text-white/25">או הרשם עם</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* Google button */}
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/auth/google`}
            className="mt-4 w-full flex items-center justify-center gap-3 py-2.5 rounded-xl border border-edge-hover bg-white/4 hover:bg-white/8 transition-all text-sm text-white/70 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.7 37.3 46.5 31.3 46.5 24.5z"/>
              <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6L2.5 13.3A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.5 10.6l8-6z"/>
              <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.3-7.7 2.3-6.3 0-11.6-4.2-13.5-10l-8 6.2C6.6 42.6 14.6 48 24 48z"/>
            </svg>
            הרשם עם Google
          </a>

          <p className="mt-5 text-center text-sm text-white/30">
            יש לך כבר חשבון?{' '}
            <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
              התחבר
            </Link>
          </p>
        </div>
      </div>

      {/* ── Right: hero panel ──────────────────────────────────────────────── */}
      <div className="always-dark hidden lg:flex lg:flex-1 relative overflow-hidden items-center justify-center" style={{ background: 'linear-gradient(135deg, #0d1b4b 0%, #0a0e1f 40%, #1a0b3b 100%)' }}>
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)' }} />
        <div className="absolute bottom-1/3 left-1/4 w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.15) 0%, transparent 70%)' }} />

        <div className="relative z-10 px-12 max-w-lg text-center" style={{ direction: 'rtl' }}>
          <div className="mb-6 inline-flex items-center gap-2 bg-white/5 border border-edge-hover rounded-full px-4 py-1.5 text-xs text-white/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
            פלטפורמת שיווק שותפים מקצועית
          </div>

          <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
            הצטרף אלינו
            <br />
            <span style={{ background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              היום בחינם
            </span>
          </h1>

          <p className="text-white/70 text-base leading-relaxed mb-8">
            צור חשבון תוך שניות ותתחיל לאוטמט את שיווק השותפים שלך עם כלים מתקדמים.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            {[
              { icon: Zap, label: 'פרסום אוטומטי' },
              { icon: TrendingUp, label: 'מעקב הכנסות' },
              { icon: Globe, label: 'AliExpress API' },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 border border-edge-hover rounded-full px-4 py-1.5 text-sm text-white/75"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <Icon size={13} className="text-blue-400" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
