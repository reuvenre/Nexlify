'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { authApi } from '@/lib/api-client';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
        <AlertCircle size={14} className="text-red-500 shrink-0" />
        <p className="text-sm text-red-600">קישור האיפוס אינו תקין. בקש קישור חדש.</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
    if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }
    setIsLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setSuccess(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'קישור האיפוס אינו תקין או פג תוקפו.');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
        <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
        <p className="text-sm text-green-700">הסיסמה עודכנה! מעביר לדף הכניסה...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">סיסמה חדשה</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-white"
          dir="ltr"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">אישור סיסמה</label>
        <input
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all bg-white"
          dir="ltr"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 rounded-lg bg-[#8b9ed4] hover:bg-[#7a8ec8] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
      >
        {isLoading && <Loader2 size={15} className="animate-spin" />}
        {isLoading ? 'מעדכן...' : 'עדכן סיסמה'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex" style={{ direction: 'rtl' }}>
      <div className="w-full lg:w-[47%] flex flex-col bg-[#f3f4f6]">
        <div className="flex-1 flex items-center justify-center px-8 py-12">
          <div className="w-full max-w-[390px] bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-8">
            <div className="mb-6 text-center">
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <KeyRound size={22} className="text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">הגדרת סיסמה חדשה</h2>
              <p className="text-gray-500 text-sm mt-1">בחר סיסמה חזקה לחשבונך</p>
            </div>

            <Suspense fallback={<Loader2 size={20} className="animate-spin mx-auto text-blue-400" />}>
              <ResetForm />
            </Suspense>

            <div className="mt-5 text-center">
              <Link href="/login" className="text-sm text-blue-600 hover:text-blue-500 transition-colors">
                → חזרה להתחברות
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div
        className="hidden lg:flex lg:flex-1 flex-col relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0d1b4b 0%, #0a0e1f 45%, #160a30 100%)' }}
      >
        <div className="absolute top-1/4 right-1/4 w-[28rem] h-[28rem] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)' }} />
        <div className="relative z-10 flex justify-start p-6">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-white p-1 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="Nexlify" className="w-full h-full object-contain" />
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Nexlify</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="relative z-10 px-12 max-w-lg text-center">
            <h1 className="text-5xl font-extrabold text-white leading-tight mb-5">
              כמעט שם
              <br />
              <span className="gradient-text-hero">חזור פנימה</span>
            </h1>
            <p className="text-white/45 text-base leading-relaxed">
              הגדר סיסמה חדשה וחזור לנהל<br />את הקמפיינים שלך.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
