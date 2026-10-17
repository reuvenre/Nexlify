'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { SettingsSaveBar } from './SettingsSaveBar';
import { authApi, credentialsApi } from '@/lib/api-client';

const CURRENCIES = [
  { value: 'USD_ILS', label: '₪ שקל (ILS)', flag: '🇮🇱' },
  { value: 'USD_EUR', label: '€ יורו (EUR)', flag: '🇪🇺' },
  { value: 'USD_GBP', label: '£ פאונד (GBP)', flag: '🇬🇧' },
  { value: 'USD_USD', label: '$ דולר (USD)', flag: '🇺🇸' },
];

const PROFILE_KEY = 'alibot-profile';

export function ProfileForm() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [currency, setCurrency] = useState('USD_ILS');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  // Editable copy of the account email — admin only. Seeded from the session user once
  // it loads; a non-admin keeps the read-only view.
  const [email, setEmail] = useState('');
  useEffect(() => { if (user?.email) setEmail(user.email); }, [user?.email]);

  useEffect(() => {
    // Load saved profile from localStorage
    try {
      const stored = localStorage.getItem(PROFILE_KEY);
      if (stored) {
        const p = JSON.parse(stored);
        if (p.firstName) setFirstName(p.firstName);
        if (p.lastName)  setLastName(p.lastName);
        if (p.phone)     setPhone(p.phone);
      }
    } catch {}

    credentialsApi.get()
      .then((c) => {
        setCurrency(c.currency_pair || 'USD_ILS');
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true); setError('');
    try {
      // Persist profile fields locally (no dedicated profile API endpoint yet)
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ firstName, lastName, phone }));
      // Admin email change rides the same save button — only when actually edited.
      if (isAdmin && email.trim() && user?.email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
        await authApi.changeEmail(email.trim());
      }
      // Save currency preference to credentials
      await credentialsApi.upsert({ currency_pair: currency } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-lg">👤</span> פרטי חשבון
        </h3>
        <form onSubmit={handleSave} className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">שם פרטי</label>
            <input aria-label="שם פרטי"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="שם פרטי"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">שם משפחה</label>
            <input aria-label="שם משפחה"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="שם משפחה"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-white/50 mb-1.5">
              אימייל{isAdmin && <span className="text-amber-400/70"> · ניתן לעריכה (אדמין)</span>}
            </label>
            {isAdmin ? (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
              />
            ) : (
              <input
                type="email"
                value={user?.email || ''}
                readOnly
                className="w-full bg-white/3 border border-edge rounded-lg px-3 py-2.5 text-sm text-white/40 outline-none cursor-not-allowed"
              />
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-white/50 mb-1.5">טלפון</label>
            <input aria-label="טלפון"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+972501234567"
              dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <div className="col-span-2 pt-1">
            {/* These fields have no column on the user record — they live in this browser
                only. Saying so beats implying they follow the account. */}
            <p className="text-2xs text-white/30 leading-relaxed">
              השם והטלפון נשמרים בדפדפן הזה בלבד (אין להם עדיין שדה בחשבון) — לא יופיעו במכשיר אחר.
              {isAdmin
                ? ' כתובת המייל היא מזהה ההתחברות שלך — שינוי כאן יחול מיידית (ההתחברות הבאה עם הכתובת החדשה). השינוי נרשם ביומן האבטחה.'
                : ' כתובת המייל היא מזהה החשבון ומנוהלת בטאב "אבטחה".'}
            </p>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          </div>
        </form>
      </section>

      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-lg">🌍</span> העדפות
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">מטבע תצוגה</label>
            <div className="grid grid-cols-2 gap-2">
              {CURRENCIES.map(({ value, label, flag }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCurrency(value)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all
                    ${currency === value
                      ? 'border-blue-500/60 bg-blue-500/10 text-white'
                      : 'border-edge bg-white/3 text-white/50 hover:border-white/20 hover:text-white/80'
                    }`}
                >
                  <span className="text-base">{flag}</span>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-2xs text-white/25 mt-2">המחירים יומרו מדולר למטבע שנבחר לפי שער חליפין בזמן אמת</p>
          </div>

        </div>
      </section>

      {/* One save for the whole tab — profile fields and preferences persist together. */}
      <SettingsSaveBar onSave={() => handleSave()} saving={saving} saved={saved} />
    </div>
  );
}
