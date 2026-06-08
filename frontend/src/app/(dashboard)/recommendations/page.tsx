'use client';

import { useState } from 'react';
import {
  Inbox, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  ShieldAlert, Building2, Code2, Megaphone, Play, Sparkles,
} from 'lucide-react';
import { useRecommendations } from '@/lib/hooks/useRecommendations';
import { agentsApi } from '@/lib/api-client';
import type {
  AgentRecommendation, RecommendationAgentType, RecommendationCategory,
  RecommendationStatus, RecommendationSeverity,
} from '@/types';

// ─── Labels & colors ─────────────────────────────────────────────────────────

const AGENT_LABELS: Record<RecommendationAgentType, string> = {
  site_manager: 'מנהל האתר',
  frontend_architect: 'ארכיטקט Frontend',
  backend_architect: 'ארכיטקט Backend',
  security: 'אבטחת מידע',
};

const AGENT_ICONS: Record<RecommendationAgentType, typeof Building2> = {
  site_manager: Building2,
  frontend_architect: Code2,
  backend_architect: Code2,
  security: ShieldAlert,
};

const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  strategy: 'אסטרטגיה',
  code_change: 'שינוי קוד',
  security: 'אבטחה',
  campaign_action: 'פעולת קמפיין',
};

const SEVERITY_LABELS: Record<RecommendationSeverity, string> = {
  low: 'נמוכה',
  medium: 'בינונית',
  high: 'גבוהה',
  critical: 'קריטית',
};

const SEVERITY_COLORS: Record<RecommendationSeverity, string> = {
  low: 'bg-white/[0.06] text-white/50 border-white/10',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  critical: 'bg-red-500/15 text-red-400 border-red-500/25',
};

const STATUS_LABELS: Record<RecommendationStatus, string> = {
  pending: 'ממתין',
  approved: 'אושר',
  rejected: 'נדחה',
  applied: 'הופעל',
};

const STATUS_COLORS: Record<RecommendationStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  approved: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/25',
  applied: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── Manual agent runners ────────────────────────────────────────────────────

const AGENT_RUNNERS: { key: RecommendationAgentType; label: string; run: () => Promise<{ recommendations_filed: number; summary: string; tokens: number }> }[] = [
  { key: 'site_manager', label: 'מנהל האתר', run: agentsApi.runSiteManager },
  { key: 'frontend_architect', label: 'ארכיטקט Frontend', run: agentsApi.runFrontendArchitect },
  { key: 'backend_architect', label: 'ארכיטקט Backend', run: agentsApi.runBackendArchitect },
  { key: 'security', label: 'אבטחת מידע', run: agentsApi.runSecurityScan },
];

function AgentRunners({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; summary: string; filed: number } | null>(null);

  async function trigger(key: RecommendationAgentType, run: () => Promise<{ recommendations_filed: number; summary: string; tokens: number }>) {
    setRunning(key);
    setResult(null);
    try {
      const res = await run();
      setResult({ key, summary: res.summary, filed: res.recommendations_filed });
      onDone();
    } catch (e: any) {
      setResult({ key, summary: e?.response?.data?.message || 'הסוכן נכשל בהרצה', filed: -1 });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="bg-surface-secondary border border-edge rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-white">הרצה ידנית של סוכני המערכת</h2>
      </div>
      <p className="text-xs text-white/35 mb-4">
        הסוכנים רצים אוטומטית לפי לו״ז, אך ניתן להריץ אותם גם ידנית. כל ההמלצות שלהם מחכות לאישורך כאן.
      </p>
      <div className="flex flex-wrap gap-2">
        {AGENT_RUNNERS.map(({ key, label, run }) => (
          <button
            key={key}
            onClick={() => trigger(key, run)}
            disabled={running !== null}
            className="flex items-center gap-2 px-3.5 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-edge text-white/70 hover:text-white text-xs font-medium rounded-xl transition-all disabled:opacity-40"
          >
            {running === key ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
            {label}
          </button>
        ))}
      </div>
      {result && (
        <div className={`mt-4 text-xs rounded-xl border px-4 py-3 ${result.filed === -1 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          {result.filed === -1
            ? result.summary
            : `הסוכן סיים: ${result.filed} המלצות חדשות נוספו. ${result.summary}`}
        </div>
      )}
    </div>
  );
}

// ─── Diff viewer ─────────────────────────────────────────────────────────────

function DiffViewer({ payload }: { payload: Record<string, any> }) {
  const [open, setOpen] = useState(false);
  const diff = payload?.diff as string | undefined;
  const filePath = payload?.file_path as string | undefined;
  if (!diff) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {open ? 'הסתר שינוי מוצע' : 'הצג שינוי מוצע (diff)'}
        {filePath && <span className="text-white/30 font-normal">— {filePath}</span>}
      </button>
      {open && (
        <pre dir="ltr" className="mt-2 bg-black/40 border border-edge rounded-xl p-4 text-2xs text-white/60 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
          {diff}
        </pre>
      )}
    </div>
  );
}

// ─── Recommendation card ─────────────────────────────────────────────────────

function RecommendationCard({
  rec, onApprove, onReject,
}: {
  rec: AgentRecommendation;
  onApprove: (id: string, note?: string) => Promise<unknown>;
  onReject: (id: string, note?: string) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState<'approve' | 'reject' | null>(null);
  const Icon = AGENT_ICONS[rec.agent_type];
  const isPending = rec.status === 'pending';

  async function handle(action: 'approve' | 'reject') {
    setBusy(action);
    try {
      if (action === 'approve') await onApprove(rec.id, note || undefined);
      else await onReject(rec.id, note || undefined);
      setShowNote(null);
      setNote('');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-surface-secondary border border-edge rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-edge flex items-center justify-center shrink-0">
            <Icon size={15} className="text-white/50" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="text-xs text-white/35">{AGENT_LABELS[rec.agent_type]}</span>
              <span className="text-white/15">•</span>
              <span className="text-2xs px-1.5 py-0.5 rounded-md bg-white/[0.05] text-white/40 border border-white/10">
                {CATEGORY_LABELS[rec.category]}
              </span>
              <span className={`text-2xs px-1.5 py-0.5 rounded-md border ${SEVERITY_COLORS[rec.severity]}`}>
                {SEVERITY_LABELS[rec.severity]}
              </span>
              <span className={`text-2xs px-1.5 py-0.5 rounded-md border ${STATUS_COLORS[rec.status]}`}>
                {STATUS_LABELS[rec.status]}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white">{rec.title}</h3>
            <p className="text-xs text-white/45 mt-1.5 leading-relaxed whitespace-pre-wrap">{rec.description}</p>
            {rec.payload && <DiffViewer payload={rec.payload} />}
            {rec.review_note && (
              <p className="text-2xs text-white/30 mt-2 italic">הערת סקירה: {rec.review_note}</p>
            )}
          </div>
        </div>
        <span className="text-2xs text-white/25 whitespace-nowrap shrink-0">{fmtDate(rec.created_at)}</span>
      </div>

      {isPending && (
        <div className="mt-4 pt-4 border-t border-edge">
          {showNote && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="הערה לסקירה (אופציונלי)"
              className="w-full mb-3 px-3 py-2 bg-white/[0.04] border border-edge rounded-lg text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-blue-500/40"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => (showNote === 'approve' ? handle('approve') : setShowNote('approve'))}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/25 text-emerald-400 text-xs font-medium rounded-xl transition-all disabled:opacity-40"
            >
              {busy === 'approve' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {showNote === 'approve' ? 'אישור סופי' : 'אשר'}
            </button>
            <button
              onClick={() => (showNote === 'reject' ? handle('reject') : setShowNote('reject'))}
              disabled={busy !== null}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 text-xs font-medium rounded-xl transition-all disabled:opacity-40"
            >
              {busy === 'reject' ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              {showNote === 'reject' ? 'דחייה סופית' : 'דחה'}
            </button>
            {showNote && (
              <button
                onClick={() => { setShowNote(null); setNote(''); }}
                className="px-3 py-2 text-xs text-white/35 hover:text-white/60 transition-colors"
              >
                ביטול
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filters bar ─────────────────────────────────────────────────────────────

function FilterSelect<T extends string>({
  value, onChange, options, placeholder,
}: {
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  options: { value: T; label: string }[];
  placeholder: string;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      className="px-3 py-2 bg-white/[0.04] border border-edge rounded-xl text-xs text-white/70 focus:outline-none focus:border-blue-500/40 cursor-pointer"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const { recommendations, filters, setFilters, isLoading, error, approve, reject, refetch } = useRecommendations({ status: 'pending' });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-white/30 text-xs mb-1">
            <Inbox size={12} />
            <span>תיבת המלצות</span>
          </div>
          <h1 className="text-2xl font-bold text-white">המלצות הסוכנים</h1>
          <p className="text-sm text-white/40 mt-1">
            סוכני האתר ממליצים — אתה מחליט. שום שינוי קוד או פעולה אסטרטגית לא מתבצע ללא אישורך.
          </p>
        </div>
      </div>

      <AgentRunners onDone={refetch} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <Megaphone size={13} className="text-white/25" />
        <FilterSelect
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          placeholder="כל הסטטוסים"
          options={(Object.keys(STATUS_LABELS) as RecommendationStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        <FilterSelect
          value={filters.agent_type}
          onChange={(v) => setFilters((f) => ({ ...f, agent_type: v }))}
          placeholder="כל הסוכנים"
          options={(Object.keys(AGENT_LABELS) as RecommendationAgentType[]).map((a) => ({ value: a, label: AGENT_LABELS[a] }))}
        />
        <FilterSelect
          value={filters.category}
          onChange={(v) => setFilters((f) => ({ ...f, category: v }))}
          placeholder="כל הקטגוריות"
          options={(Object.keys(CATEGORY_LABELS) as RecommendationCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
        />
      </div>

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
      {!isLoading && !error && recommendations.length === 0 && (
        <div className="bg-surface-secondary border border-dashed border-edge-hover rounded-2xl p-16 flex flex-col items-center text-center">
          <Inbox size={36} className="text-white/15 mb-4" />
          <h3 className="text-base font-semibold text-white/50 mb-2">אין המלצות להצגה</h3>
          <p className="text-sm text-white/25 max-w-xs">
            כשהסוכנים יזהו הזדמנויות, בעיות אבטחה או שיפורי קוד — הם יופיעו כאן לאישורך
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && recommendations.length > 0 && (
        <div className="space-y-3">
          {recommendations.map((rec) => (
            <RecommendationCard key={rec.id} rec={rec} onApprove={approve} onReject={reject} />
          ))}
        </div>
      )}
    </div>
  );
}
