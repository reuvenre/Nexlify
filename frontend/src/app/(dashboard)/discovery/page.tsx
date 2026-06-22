'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Radar, Loader2, Plus, X, ShieldCheck, PackageSearch, ArrowLeft } from 'lucide-react';
import { discoveryApi } from '@/lib/api-client';
import type { HuntResult, ValidateResult } from '@/types';

export default function DiscoveryPage() {
  const [keywords, setKeywords] = useState<string[]>(['tacti gear']);
  const [draft, setDraft] = useState('');
  const [hunting, setHunting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [huntResult, setHuntResult] = useState<HuntResult | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addKeyword = () => {
    const k = draft.trim();
    if (k && !keywords.includes(k)) setKeywords((ks) => [...ks, k]);
    setDraft('');
  };

  const runHunt = async () => {
    if (keywords.length === 0) return;
    setHunting(true);
    setError(null);
    setHuntResult(null);
    try {
      setHuntResult(await discoveryApi.hunt(keywords));
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הסריקה נכשלה — ודא שמפתח Apify מוגדר בהגדרות');
    } finally {
      setHunting(false);
    }
  };

  const runValidate = async () => {
    setValidating(true);
    setError(null);
    setValidateResult(null);
    try {
      setValidateResult(await discoveryApi.validate());
    } catch (e: any) {
      setError(e?.response?.data?.message || 'אימות הלינקים נכשל');
    } finally {
      setValidating(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Radar size={22} className="text-blue-400" /> גילוי מוצרים
          </h1>
          <p className="text-sm text-white/40 mt-1">
            סורק AliExpress דרך Apify ומוסיף מוצרים חמים לקטלוג (דירוג ≥ 4.5, ‎500+‎ מכירות)
          </p>
        </div>
        <Link href="/products" className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors">
          לקטלוג <ArrowLeft size={15} />
        </Link>
      </div>

      {/* Keywords */}
      <section className="bg-surface-secondary border border-edge rounded-xl p-5 mb-5">
        <label className="block text-xs font-medium text-white/50 mb-2">מילות חיפוש</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {keywords.map((k) => (
            <span key={k} className="flex items-center gap-1.5 bg-blue-600/15 text-blue-300 border border-blue-500/25 rounded-full px-3 py-1 text-sm">
              {k}
              <button onClick={() => setKeywords((ks) => ks.filter((x) => x !== k))} className="text-blue-300/60 hover:text-red-400">
                <X size={13} />
              </button>
            </span>
          ))}
          {keywords.length === 0 && <span className="text-xs text-white/30 py-1">הוסף לפחות מילת חיפוש אחת</span>}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
            placeholder="לדוגמה: smart watch, kitchen gadget..."
            className="flex-1 bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/50 transition-colors"
            dir="ltr"
          />
          <button onClick={addKeyword} className="flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 text-sm rounded-lg transition-all">
            <Plus size={14} /> הוסף
          </button>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={runHunt}
          disabled={hunting || keywords.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all"
        >
          {hunting ? <Loader2 size={15} className="animate-spin" /> : <PackageSearch size={15} />}
          {hunting ? 'סורק... (עד 3 דקות)' : 'הפעל סריקה'}
        </button>
        <button
          onClick={runValidate}
          disabled={validating}
          className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all"
        >
          {validating ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
          אמת לינקים בקטלוג
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3 mb-5">{error}</div>
      )}

      {huntResult && (
        <div className="bg-surface-secondary border border-emerald-500/25 rounded-xl p-5 mb-5">
          <h3 className="text-sm font-semibold text-white mb-3">תוצאות הסריקה</h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            <Metric label="מילות חיפוש" value={huntResult.keyword_count} />
            <Metric label="נסרקו" value={huntResult.scraped} />
            <Metric label="נשמרו חדשים" value={huntResult.saved} accent="emerald" />
            <Metric label="כבר קיימים" value={huntResult.skipped_existing} />
          </div>
          {huntResult.saved > 0 && (
            <Link href="/products" className="inline-flex items-center gap-1.5 mt-4 text-sm text-blue-400 hover:text-blue-300">
              צפה ב-{huntResult.saved} המוצרים החדשים בקטלוג <ArrowLeft size={14} />
            </Link>
          )}
        </div>
      )}

      {validateResult && (
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">אימות לינקים</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Metric label="נבדקו" value={validateResult.checked} />
            <Metric label="תקינים" value={validateResult.valid} accent="emerald" />
            <Metric label="שבורים" value={validateResult.invalid} accent="red" />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'red' }) {
  const color = accent === 'emerald' ? 'text-emerald-400' : accent === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-white/3 rounded-lg py-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-white/40 mt-0.5">{label}</p>
    </div>
  );
}
