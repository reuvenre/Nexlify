'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Save } from 'lucide-react';
import { credentialsApi } from '@/lib/api-client';
import type { CredentialSetInput, VerifyResult, AiProvider } from '@/types';

type VerifyStatus = VerifyResult | null;

export function CredentialsForm() {
  const [form, setForm] = useState<CredentialSetInput>({
    aliexpress_app_key: '',
    aliexpress_app_secret: '',
    aliexpress_tracking_id: '',
    telegram_bot_token: '',
    telegram_channel_id: '',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    ai_provider: 'anthropic',
    anthropic_api_key: '',
    anthropic_model: 'claude-sonnet-4-6',
    gemini_api_key: '',
    gemini_model: 'gemini-2.5-flash',
    apify_api_token: '',
    currency_pair: 'USD_ILS',
  });
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    credentialsApi.get()
      .then((c) => {
        setForm((prev) => ({
          ...prev,
          aliexpress_app_key: c.aliexpress_app_key || '',
          aliexpress_tracking_id: c.aliexpress_tracking_id || '',
          telegram_channel_id: c.telegram_channel_id || '',   // non-secret, always load
          openai_model: c.openai_model || 'gpt-4o-mini',
          ai_provider: c.ai_provider || 'anthropic',
          anthropic_model: c.anthropic_model || 'claude-sonnet-4-6',
          gemini_model: c.gemini_model || 'gemini-2.5-flash',
          currency_pair: c.currency_pair || 'USD_ILS',
          // Secrets: leave empty — backend keeps existing value when empty is submitted
          aliexpress_app_secret: '',
          telegram_bot_token: '',
          openai_api_key: '',
          anthropic_api_key: '',
          gemini_api_key: '',
          apify_api_token: '',
        }));
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await credentialsApi.upsert(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const res = await credentialsApi.verify();
      setVerifyStatus(res);
    } finally {
      setIsVerifying(false);
    }
  };

  const toggleShow = (key: string) => setShow((s) => ({ ...s, [key]: !s[key] }));

  const Field = ({
    label,
    field,
    placeholder,
    secret = false,
    hint,
  }: {
    label: string;
    field: keyof CredentialSetInput;
    placeholder?: string;
    secret?: boolean;
    hint?: string;
  }) => (
    <div>
      <label className="block text-xs font-medium text-white/50 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={secret && !show[field] ? 'password' : 'text'}
          value={form[field] as string}
          onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
          placeholder={placeholder}
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors pr-10"
          dir="ltr"
        />
        {secret && (
          <button
            type="button"
            onClick={() => toggleShow(field)}
            className="absolute top-1/2 left-3 -translate-y-1/2 text-white/30 hover:text-white/60"
          >
            {show[field] ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
      {hint && <p className="text-2xs text-white/25 mt-1">{hint}</p>}
    </div>
  );

  const VerifyIcon = ({ ok }: { ok: boolean }) =>
    ok ? <CheckCircle2 size={13} className="text-emerald-400" /> : <XCircle size={13} className="text-red-400" />;

  return (
    <div className="space-y-6">
      {/* AliExpress */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-lg">🛍</span> AliExpress API
          {verifyStatus && (
            <VerifyIcon ok={verifyStatus.aliexpress} />
          )}
        </h3>
        <div className="grid grid-cols-1 gap-4">
          <Field label="מפתח אפליקציה (App Key)" field="aliexpress_app_key" placeholder="1234567890" />
          <Field label="סוד אפליקציה (App Secret)" field="aliexpress_app_secret" secret placeholder="מפתח סודי..." hint="ממולא רק בעת עדכון" />
          <Field label="מזהה מעקב (Tracking ID)" field="aliexpress_tracking_id" placeholder="affiliate_tracking_id" />
        </div>
      </section>

      {/* AI Engine — multi-provider */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <span className="text-lg">🧠</span> מנוע ה-AI
        </h3>
        <p className="text-2xs text-white/30 mb-4">בחר את ספק יצירת התוכן. המערכת תשתמש בספק שבחרת, ותיפול אוטומטית לספק אחר עם מפתח תקין.</p>

        {/* Provider selector */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {([
            { id: 'anthropic', label: 'Claude', emoji: '🟣' },
            { id: 'openai', label: 'OpenAI', emoji: '🤖' },
            { id: 'gemini', label: 'Gemini', emoji: '✦' },
          ] as { id: AiProvider; label: string; emoji: string }[]).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setForm((f) => ({ ...f, ai_provider: p.id }))}
              className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-medium transition-all
                ${form.ai_provider === p.id
                  ? 'bg-blue-600/15 text-blue-300 border-blue-500/40'
                  : 'text-white/50 border-edge-hover hover:bg-white/5'}`}
            >
              <span className="text-base">{p.emoji}</span>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4">
          {form.ai_provider === 'anthropic' && (
            <>
              <Field label="Anthropic API Key" field="anthropic_api_key" secret placeholder="sk-ant-..." hint="ברירת מחדל: משתמש במפתח השרת אם ריק" />
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">מודל Claude</label>
                <select
                  value={form.anthropic_model}
                  onChange={(e) => setForm((f) => ({ ...f, anthropic_model: e.target.value }))}
                  className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
                >
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6 (מומלץ)</option>
                  <option value="claude-opus-4-8">claude-opus-4-8 (איכות מקסימלית)</option>
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (מהיר וזול)</option>
                </select>
              </div>
            </>
          )}

          {form.ai_provider === 'openai' && (
            <>
              <Field label="OpenAI API Key" field="openai_api_key" secret placeholder="sk-proj-..." />
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">מודל</label>
                <select
                  value={form.openai_model}
                  onChange={(e) => setForm((f) => ({ ...f, openai_model: e.target.value }))}
                  className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini (מהיר וחסכוני)</option>
                  <option value="gpt-4o">gpt-4o (איכות גבוהה)</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo (זול ביותר)</option>
                </select>
              </div>
            </>
          )}

          {form.ai_provider === 'gemini' && (
            <>
              <Field label="Google Gemini API Key" field="gemini_api_key" secret placeholder="AIza..." hint="מ-Google AI Studio" />
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">מודל Gemini</label>
                <select
                  value={form.gemini_model}
                  onChange={(e) => setForm((f) => ({ ...f, gemini_model: e.target.value }))}
                  className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash (מהיר)</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro (איכות גבוהה)</option>
                </select>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Apify — product discovery */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <span className="text-lg">🔎</span> Apify — גילוי מוצרים
          {verifyStatus && <VerifyIcon ok={verifyStatus.apify} />}
        </h3>
        <div className="grid grid-cols-1 gap-4">
          <Field label="Apify API Token" field="apify_api_token" secret placeholder="apify_api_..." hint="מפעיל סורק AliExpress בעמוד 'גילוי מוצרים'" />
        </div>
      </section>

      {/* Amazon */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span className="text-lg">📦</span> Amazon Associates
          </h3>
          <span className="text-2xs bg-amber-500/15 text-amber-400 border border-amber-500/25 rounded-full px-2.5 py-0.5 font-medium">בקרוב</span>
        </div>
        <p className="text-xs text-white/35 mb-4">שילוב עם Amazon Affiliate Program לייבוא מוצרים ומעקב עמלות.</p>
        <div className="grid grid-cols-1 gap-4 opacity-50 pointer-events-none">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Access Key</label>
            <input disabled placeholder="AKIAIOSFODNN7EXAMPLE" dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Secret Key</label>
            <input disabled placeholder="wJalrXUtnFEMI/K7MDENG..." dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Partner Tag</label>
            <input disabled placeholder="mytag-20" dir="ltr"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none" />
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saved ? 'נשמר ✓' : isSaving ? 'שומר...' : 'שמור הגדרות'}
        </button>

        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-white/70 text-sm rounded-xl transition-all"
        >
          {isVerifying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          בדוק חיבורים
        </button>
      </div>
    </div>
  );
}
