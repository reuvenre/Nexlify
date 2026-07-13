'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bot, Loader2, AlertCircle, CheckCircle2, Mail, Copy, Check } from 'lucide-react';
import { authApi } from '@/lib/api-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetUrl, setResetUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await authApi.forgotPassword(email);
      if (res.reset_url) setResetUrl(res.reset_url);
      else setResetUrl('sent');
    } catch {
      setError('משהו השתבש. נסה שוב.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(resetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex" style={{ direction: 'rtl' }}>
      <div className="w-full lg:w-[47%] flex flex-col bg-[#f3f4f6]">
        <div className="flex-1 flex items-center justify-center px-8 py-12">
          <div className="w-full max-w-[390px] bg-white rounded-2xl shadow-sm border border-gray-100 px-8 py-8">

            <div className="mb-6 text-center">
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={22} className="text-blue-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">שכחת סיסמה?</h2>
              <p className="text-gray-500 text-sm mt-1">הזן את האימייל שלך לקבלת קישור איפוס</p>
            </div>

            {!resetUrl ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">אימייל</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
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
                  {isLoading ? 'שולח...' : 'שלח קישור איפוס'}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                  <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-green-700">קישור האיפוס נוצר בהצלחה.</p>
                </div>

                {resetUrl !== 'sent' && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 font-medium">קישור האיפוס שלך:</p>
                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="flex-1 text-xs text-gray-600 break-all" dir="ltr">{resetUrl}</span>
                      <button
                        onClick={handleCopy}
                        className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                        title="העתק קישור"
                      >
                        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">הקישור תקף לשעה אחת. הוא גם מודפס בלוג השרת.</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 text-center">
              <Link href="/login" className="text-sm text-blue-600 hover:text-blue-500 transition-colors">
                → חזרה להתחברות
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Hero panel */}
      <div
        className="hidden lg:flex lg:flex-1 flex-col relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0d1b4b 0%, #0a0e1f 45%, #160a30 100%)' }}
      >
        <div className="absolute top-1/4 right-1/4 w-[28rem] h-[28rem] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)' }} />
        <div className="relative z-10 flex justify-start p-6">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/90 flex items-center justify-center">
              <Bot size={14} className="text-gray-900" />
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Nexlify</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="relative z-10 px-12 max-w-lg text-center">
            <h1 className="text-5xl font-extrabold text-white leading-tight mb-5">
              איפוס
              <br />
              <span className="gradient-text-hero">סיסמה</span>
            </h1>
            <p className="text-white/45 text-base leading-relaxed">
              הקישור יופיע ישירות על המסך.<br />לא נדרש שרת דואר אלקטרוני.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
