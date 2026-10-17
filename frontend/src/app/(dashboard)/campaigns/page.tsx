'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { Plus, Megaphone, Loader2, Languages, ShieldAlert, X } from 'lucide-react';
import { CampaignCard } from '@/components/campaigns/CampaignCard';
import { useCampaigns } from '@/lib/hooks/useCampaigns';
import { campaignsApi, type KeywordAudit } from '@/lib/api-client';

export default function CampaignsPage() {
  const router = useRouter();
  const { campaigns, total, isLoading, error, toggle, runNow, remove } = useCampaigns();

  const [translating, setTranslating] = useState(false);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);
  const translateKeywords = async () => {
    if (!confirm('לתרגם את כל מילות המפתח בכל הקמפיינים מעברית לאנגלית? הפעולה מעדכנת את הקמפיינים.')) return;
    setTranslating(true); setTranslateMsg(null);
    try {
      const r = await campaignsApi.translateKeywords();
      setTranslateMsg(r.translations.length
        ? `✓ עודכנו ${r.campaigns_updated} קמפיינים · ${r.translations.length} מילות מפתח תורגמו: ${r.translations.slice(0, 8).map((t) => `${t.before}→${t.after}`).join(' · ')}${r.translations.length > 8 ? ' …' : ''}`
        : '✓ כל מילות המפתח כבר באנגלית — לא נדרש שינוי.');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setTranslateMsg(`⚠️ ${err?.response?.data?.message || 'התרגום נכשל'}`);
    } finally {
      setTranslating(false);
    }
  };

  // Brand-keyword sweep across every campaign. A report the owner reads — nothing is
  // changed automatically, because only he knows which brand he sells on purpose.
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<KeywordAudit | null>(null);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const runAudit = async () => {
    setAuditing(true); setAuditErr(null);
    try {
      setAudit(await campaignsApi.keywordAudit());
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setAuditErr(err?.response?.data?.message || 'הבדיקה נכשלה');
    } finally {
      setAuditing(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <Megaphone size={12} />
            <span>הטייס האוטומטי</span>
          </div>
          <h1 className="text-2xl font-bold text-white">הטייס האוטומטי</h1>
          {!isLoading && (
            <p className="text-sm text-white/40 mt-1">{total} טייסים אוטומטיים סה״כ</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runAudit}
            disabled={auditing}
            title="סורק את מילות המפתח בכל הטייסים ומסמן שמות מותג וניסוחים שמושכים מוצרים מזויפים"
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all whitespace-nowrap"
          >
            {auditing ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
            בדוק מילות מותג
          </button>
          <button
            onClick={translateKeywords}
            disabled={translating}
            title="תרגם את מילות המפתח בכל הקמפיינים מעברית לאנגלית — כדי שהחיפוש ב-AliExpress יתאים לאתר"
            className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all whitespace-nowrap"
          >
            {translating ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
            תרגם מילות מפתח לאנגלית
          </button>
          <Link
            href="/campaigns/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all whitespace-nowrap"
          >
            <Plus size={15} />
            טייס אוטומטי חדש
          </Link>
        </div>
      </div>

      {translateMsg && (
        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${translateMsg.startsWith('✓')
          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
          : 'bg-red-500/10 border-red-500/25 text-red-300'}`}>
          {translateMsg}
        </div>
      )}

      {auditErr && (
        <div className="mb-6 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          ⚠️ {auditErr}
        </div>
      )}

      {/* Brand-keyword report */}
      {audit && (
        <div className="mb-6 rounded-2xl border border-edge bg-surface-secondary p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <ShieldAlert size={15} className="text-amber-400" />
                בדיקת מילות מותג
              </h3>
              <p className="text-xs text-white/40 mt-1">
                נסרקו {audit.keywords_scanned} מילות מפתח ב-{audit.campaigns} טייסים ·{' '}
                <span className="text-red-300">{audit.high} בסיכון גבוה</span> ·{' '}
                <span className="text-amber-300">{audit.watch} לבדיקה</span>
              </p>
            </div>
            <button aria-label="סגור" onClick={() => setAudit(null)} className="text-white/30 hover:text-white/60 transition-colors">
              <X size={16} />
            </button>
          </div>

          {audit.findings.length === 0 ? (
            <p className="text-sm text-emerald-300">✓ לא נמצאו שמות מותג או ניסוחים בעייתיים. מצוין.</p>
          ) : (
            <div className="space-y-2">
              {audit.findings.map((f, i) => (
                <div
                  key={`${f.campaign_id}-${f.keyword}-${i}`}
                  className={`rounded-xl border px-3.5 py-3 ${f.risk === 'high'
                    ? 'border-red-500/25 bg-red-500/[0.07]'
                    : 'border-amber-500/25 bg-amber-500/[0.07]'}`}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-[11px] px-2 py-0.5 rounded-lg font-medium ${f.risk === 'high'
                      ? 'bg-red-500/20 text-red-200' : 'bg-amber-500/20 text-amber-200'}`}>
                      {f.risk === 'high' ? 'סיכון גבוה' : 'לבדיקה'}
                    </span>
                    <span className="text-sm font-semibold text-white">{f.keyword}</span>
                    <Link href={`/campaigns/${f.campaign_id}`} className="text-xs text-blue-300 hover:underline">
                      {f.campaign_name}
                    </Link>
                    {f.retired && <span className="text-[11px] text-white/30">(הוצאה מרוטציה)</span>}
                    {f.status !== 'active' && !f.retired && (
                      <span className="text-[11px] text-white/30">(טייס מושהה)</span>
                    )}
                  </div>
                  <p className="text-xs text-white/55 leading-relaxed">{f.reason}</p>
                  {f.suggestion && (
                    <p className="text-xs text-white/40 mt-1">
                      חלופה מוצעת: <span className="text-white/70 font-medium">{f.suggestion}</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-5 py-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && campaigns.length === 0 && (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 flex flex-col items-center text-center">
          <Megaphone size={36} className="text-white/15 mb-4" />
          <h3 className="text-base font-semibold text-white/50 mb-2">עדיין לא הגדרת טייס אוטומטי</h3>
          <p className="text-sm text-white/25 mb-6 max-w-xs">
            הטייס האוטומטי מריץ את הבוט בשבילך — מחפש מוצרים, מייצר טקסט, ומפרסם לטלגרם
          </p>
          <Link
            href="/campaigns/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl transition-all"
          >
            <Plus size={14} />
            הגדר טייס אוטומטי ראשון
          </Link>
        </div>
      )}

      {/* Grid */}
      {!isLoading && campaigns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onToggle={toggle}
              onRunNow={runNow}
              onDelete={remove}
              onClick={(id) => router.push(`/campaigns/${id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
