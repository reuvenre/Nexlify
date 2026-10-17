'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Gift, Loader2, Plus, Power, RefreshCw, Trash2, ExternalLink, AlertTriangle, Wand2,
} from 'lucide-react';
import { campaignsApi, incentiveApi, subscriptionApi } from '@/lib/api-client';
import type { IncentiveProgram, IncentiveInput, IncentivePoolStats, PoolAudit } from '@/lib/api-client';
import type { Campaign, PlanId } from '@/types';

import { DialogA11y } from '@/components/common/DialogA11y';
/**
 * The owner's registered AliExpress incentive campaigns (portal bonus pools).
 *
 * The affiliate API has no endpoint for these — registration happens in the portal — so
 * this screen is how the fact reaches the autopilot: while a pool is live, its keywords
 * join the rotation of the campaigns publishing to the pool's groups, so the products
 * that earn a bonus get the airtime.
 */

/** The Incentive Campaign page in the affiliate portal. Verified by the owner —
 *  the older /campaign/index.htm path now answers with a 404 error page. */
const PORTAL_URL = 'https://portals.aliexpress.com/affiportals/web/incentive.htm';

/** <input type="date"> value from an ISO string. */
function toDateInput(iso?: string | null, fallback?: Date): string {
  const d = iso ? new Date(iso) : (fallback || new Date());
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function endOfThisMonth(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59);
}

function parseKeywords(json: string): string[] {
  try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function parseTargets(json: string | null): string[] {
  try { const a = json ? JSON.parse(json) : []; return Array.isArray(a) ? a : []; } catch { return []; }
}

/**
 * Stored to mean "every autopilot". Mirrors ALL_CAMPAIGNS in the backend's pool-targets.ts.
 *
 * An unaimed pool steers NOTHING — it used to steer everything, which is how a Home & Living
 * bonus put kitchen organisers into a tactical channel with a boost on top. The fan-out is
 * still available; it just has to be said.
 */
const ALL_CAMPAIGNS = '*';

function statusOf(p: IncentiveProgram): { label: string; cls: string } {
  const now = Date.now();
  if (!p.active) return { label: 'כבוי', cls: 'bg-white/5 text-white/40 border-edge' };
  if (new Date(p.starts_at).getTime() > now) return { label: 'מתוכנן', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30' };
  if (new Date(p.ends_at).getTime() < now) return { label: 'הסתיים', cls: 'bg-white/5 text-white/40 border-edge' };
  return { label: 'פעיל — מזכה בבונוס', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
}

/** Steering the rotation is Autopilot+; recording pools and the monthly reminder are open
 *  to every plan (see FEATURE_MIN_PLAN.incentive_steering). */
const PLAN_ORDER: PlanId[] = ['starter', 'growth', 'autopilot', 'scale'];
const steeringIncluded = (plan: PlanId) => PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf('autopilot');

const inputCls = 'w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-amber-500/50';
const labelCls = 'block text-xs text-white/50 mb-1.5';

export default function IncentivesPage() {
  const [rows, setRows] = useState<IncentiveProgram[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [plan, setPlan] = useState<PlanId>('autopilot');

  const [stats, setStats] = useState<Record<string, IncentivePoolStats>>({});
  const [audit, setAudit] = useState<Record<string, PoolAudit>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, camps, st, au] = await Promise.all([
        incentiveApi.list(),
        campaignsApi.list({ limit: 100 }).then((r) => r.data).catch(() => [] as Campaign[]),
        incentiveApi.stats().catch(() => ({} as Record<string, IncentivePoolStats>)),
        incentiveApi.audit().catch(() => ({} as Record<string, PoolAudit>)),
      ]);
      setRows(list); setCampaigns(camps); setStats(st); setAudit(au); setError('');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'טעינת קמפייני הבונוס נכשלה');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  // effective_plan, not plan: during the trial the SERVER steers the rotation, so showing
  // the "locked, upgrade to Autopilot" notice here would contradict what is actually
  // happening — and teach the owner that this screen's notices mean nothing.
  useEffect(() => {
    subscriptionApi.status().then((st) => setPlan(st.effective_plan ?? st.plan)).catch(() => {});
  }, []);

  const liveCount = rows.filter((p) => statusOf(p).label.startsWith('פעיל')).length;
  // Only a proven mismatch counts toward the banner. An unrecognised NAME is not a fault —
  // the portal invents names faster than any table can follow — and counting it here would
  // turn the banner into background noise the owner learns to scroll past.
  const flagged = rows.filter((p) => audit[p.id]?.verdict === 'mismatch').length;

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Gift size={22} className="text-amber-400" /> קמפייני בונוס
          </h1>
          <p className="text-sm text-white/40 mt-1">
            הפולים של תוכנית השותפים באלי אקספרס — הטייס יעדיף מוצרים מהקטגוריות שנרשמת אליהן.
          </p>
        </div>
        <div className="flex items-center gap-2 max-w-full overflow-x-auto pb-1">
          <a href={PORTAL_URL} target="_blank" rel="noopener noreferrer"
            className="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/70 text-sm rounded-xl transition-all">
            <ExternalLink size={14} /> לפורטל להרשמה
          </a>
          <button onClick={() => setAdding(true)}
            className="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-xl transition-all">
            <Plus size={14} /> הוסף קמפיין
          </button>
          <button onClick={load} disabled={loading}
            className="shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> רענן
          </button>
        </div>
      </div>

      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mb-5">
        <p className="text-xs text-white/60 leading-relaxed">
          <b className="text-amber-300">איך זה עובד:</b> נרשמים לקמפיין בפורטל (חינם), ואז מוסיפים אותו כאן עם
          מילות החיפוש של הקטגוריה. כל עוד הקמפיין פעיל, הטייסים שבחרת יכניסו את
          המילים האלה לרוטציה — כך שהמוצרים שמזכים בבונוס מקבלים זמן אוויר. בתום התאריך הכל חוזר לשגרה לבד.
          תזכורת להירשם מחדש נשלחת ב-1 לכל חודש.
        </p>
      </div>

      {!steeringIncluded(plan) && (
        <div className="bg-violet-500/10 border border-violet-500/25 rounded-xl p-4 mb-5">
          <p className="text-xs text-white/70 leading-relaxed">
            🔒 <b>ההטיה האוטומטית של הטייס זמינה מתוכנית Autopilot.</b> אפשר לרשום כאן את הפולים
            ולקבל את התזכורת החודשית בכל תוכנית — אבל המשיכה בפועל של מוצרים מהקטגוריות שמזכות
            בבונוס מופעלת בשדרוג. <Link href="/settings?tab=subscription" className="text-violet-300 underline">לשדרוג</Link>
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 flex items-center gap-1.5 mb-4"><AlertTriangle size={14} /> {error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-white/30" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-surface-secondary border border-edge rounded-xl p-8 text-center">
          <Gift size={28} className="text-white/20 mx-auto mb-3" />
          <p className="text-sm text-white/50">עדיין לא הוספת קמפייני בונוס.</p>
          <p className="text-xs text-white/30 mt-1">היכנס לפורטל, הירשם למה שרלוונטי לקהל שלך, וחזור לכאן להוסיף.</p>
        </div>
      ) : (
        <>
          {liveCount > 0 && (
            <p className="text-xs text-emerald-300/80 mb-3">{liveCount} קמפייני בונוס פעילים כרגע ומשפיעים על הטייסים.</p>
          )}
          {/* One line for "check all my pools". A pool filled by the old matcher looks
              perfectly healthy on its card — same green badge, same window — while the
              autopilot searches a category the bonus is not paid on. This is the only place
              that difference is visible. */}
          {flagged > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3.5 mb-3">
              <p className="text-xs text-white/70 leading-relaxed">
                <AlertTriangle size={13} className="inline align-[-2px] text-amber-300 me-1.5" />
                <b className="text-amber-300">{flagged} {flagged === 1 ? 'פול דורש' : 'פולים דורשים'} בדיקה</b> —
                המילים ששמורות בהם נראות מקטגוריה אחרת מהשם. זה נוצר על ידי באג שתוקן:
                לחץ <b>ערוך</b> ואז <b>&quot;הצע לי מילים&quot;</b> כדי לקבל את המילים הנכונות.
              </p>
            </div>
          )}
          <div className="space-y-3">
            {rows.map((p) => (
              <ProgramCard key={p.id} program={p} campaigns={campaigns}
                stats={stats[p.id]} audit={audit[p.id]} onChanged={load} />
            ))}
          </div>
        </>
      )}

      {adding && (
        <ProgramModal campaigns={campaigns} onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }} />
      )}
    </div>
  );
}

function ProgramCard({ program, campaigns, stats, audit, onChanged }: {
  program: IncentiveProgram; campaigns: Campaign[]; stats?: IncentivePoolStats;
  audit?: PoolAudit; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const status = statusOf(program);
  const keywords = parseKeywords(program.keywords_json);
  const targetIds = parseTargets(program.target_campaigns);
  const steersAll = targetIds.includes(ALL_CAMPAIGNS);
  // An unaimed pool is the state worth SAYING OUT LOUD: it looks live on this card, and it
  // is — the bonus still accrues on anything that happens to sell — but no autopilot is
  // searching for it. Reading "כל הטייסים" here while nothing was actually steered is how
  // the misconfiguration used to hide.
  const unaimed = !targetIds.length;
  const targetNames = steersAll
    ? 'כל הטייסים'
    : targetIds.map((id) => campaigns.find((c) => c.id === id)?.name || id).join(', ');
  /** keyword → the category it actually belongs to, for the flagged ones only. */
  const offByKeyword: Record<string, string> = {};
  for (const o of audit?.offCategory || []) offByKeyword[o.keyword.trim().toLowerCase()] = o.category;

  const toggle = async () => {
    setBusy(true);
    try { await incentiveApi.update(program.id, { active: !program.active }); onChanged(); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await incentiveApi.remove(program.id); onChanged(); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-surface-secondary border border-edge rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-white truncate">{program.name}</h3>
            <span className={`text-2xs px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>
          </div>
          <p className="text-2xs text-white/40 mt-1.5">
            {new Date(program.starts_at).toLocaleDateString('he-IL')} — {new Date(program.ends_at).toLocaleDateString('he-IL')}
            {!unaimed && <> · יעד: {targetNames}</>}
          </p>
          {unaimed && (
            <button type="button" onClick={() => setEditing(true)}
              className="mt-1.5 flex items-center gap-1.5 text-2xs text-amber-300/90 hover:text-amber-200 text-right">
              <AlertTriangle size={11} className="shrink-0" />
              לא שויך לאף טייס — המילים לא נכנסות לרוטציה. לחץ לבחירת טייסים
            </button>
          )}
          {stats && (
            <p className="text-2xs text-white/50 mt-1.5">
              📊 בחלון הקמפיין: <b className="text-white/75">{stats.posts}</b> פוסטים
              {' · '}<b className="text-white/75">{stats.clicks}</b> קליקים
              {' · '}<b className={stats.orders > 0 ? 'text-emerald-300' : 'text-white/75'}>{stats.orders}</b> הזמנות
              {stats.revenue_ils > 0 && (
                <> {' · '}<span className="text-emerald-300 font-semibold">₪{stats.revenue_ils.toLocaleString()}</span>
                  <span className="text-white/30"> עמלות בסיס</span></>
              )}
            </p>
          )}
          {/* The bonus itself never reaches our data — AliExpress pays it separately — so
              it is ESTIMATED from the rate the owner read off the portal, applied to the
              order value (which is how the portal computes it). Labelled as an estimate,
              never mixed into the base-commission figure above. */}
          {stats && stats.order_amount_usd > 0 && (
            <p className="text-2xs mt-1">
              {stats.bonus_paid_usd > 0 ? (
                // The portal's own figure — nothing left to estimate.
                <span className="text-amber-300">
                  🎁 בונוס ששולם: <b>${stats.bonus_paid_usd.toLocaleString()}</b>
                  <span className="text-white/30"> — נתון מאלי אקספרס, לא הערכה</span>
                </span>
              ) : stats.bonus_estimate_usd !== null ? (
                <span className="text-amber-300">
                  🎁 בונוס משוער: <b>${stats.bonus_estimate_usd.toLocaleString()}</b>
                  <span className="text-white/30">
                    {' '}({program.bonus_rate_pct}% על ${stats.order_amount_usd.toLocaleString()} מכירות) — הערכה לפי האחוז שהזנת, לא נתון מהפורטל
                  </span>
                </span>
              ) : (
                <span className="text-white/35">
                  🎁 ${stats.order_amount_usd.toLocaleString()} מכירות במסלול — הזן את אחוז הבונוס מהפורטל (ערוך) כדי לראות הערכת בונוס
                </span>
              )}
            </p>
          )}
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {keywords.map((k) => {
                // A keyword proven to belong elsewhere is marked ON the chip. The banner
                // says how many pools are affected; this says WHICH WORD to delete, which
                // is the only part the owner can act on.
                const off = offByKeyword[k.trim().toLowerCase()];
                return (
                  <span key={k} dir="ltr" title={off ? `שייך ל: ${off}` : undefined}
                    className={`text-2xs rounded-full px-2 py-0.5 border ${off
                      ? 'bg-red-500/15 border-red-400/40 text-red-200 line-through decoration-red-400/60'
                      : 'bg-white/5 border-edge text-white/60'}`}>
                    {k}
                  </span>
                );
              })}
            </div>
          )}

          {/* The check itself. Three states, and only one of them is a problem. */}
          {audit?.verdict === 'mismatch' && (
            <div className="mt-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2">
              <p className="text-2xs text-amber-200 leading-relaxed">
                ⚠️ השם נקרא כ־<b>{audit.nameCategory}</b>, אבל{' '}
                {audit.offCategory.length === 1 ? 'מילה אחת שמורה כאן שייכת' : `${audit.offCategory.length} מילים שמורות כאן שייכות`}{' '}
                לקטגוריה אחרת ({Array.from(new Set(audit.offCategory.map((o) => o.category))).join(', ')}).
                המוצרים שיפורסמו מהן לא מזכים בבונוס של הפול הזה.
              </p>
              <button type="button" onClick={() => setEditing(true)}
                className="mt-1.5 text-2xs font-semibold text-amber-300 hover:text-amber-200 underline">
                תקן — ערוך והצע לי מילים מחדש
              </button>
            </div>
          )}
          {audit?.verdict === 'ok' && audit.nameCategory && (
            <p className="text-2xs text-emerald-300/70 mt-2">✓ זוהה כ־{audit.nameCategory} — המילים תואמות</p>
          )}
          {audit?.verdict === 'unrecognized' && (
            <p className="text-2xs text-white/35 mt-2">
              השם לא זוהה בטבלה — לא נבדק אוטומטית
              {audit.keywordCategories.length > 0 && (
                <>. המילים שאצלך נקראות כ־<b className="text-white/55">{audit.keywordCategories.join(', ')}</b> —
                  ודא שזו הקטגוריה שבפורטל</>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setEditing(true)} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs">ערוך</button>
          <button aria-label={program.active ? 'כבה' : 'הפעל'} onClick={toggle} disabled={busy} title={program.active ? 'כבה' : 'הפעל'}
            className={`p-2 rounded-lg ${program.active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-white/40'} hover:opacity-80`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
          </button>
          <button aria-label="מחק" onClick={remove} disabled={busy} title="מחק"
            className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"><Trash2 size={13} /></button>
        </div>
      </div>

      {editing && (
        <ProgramModal program={program} campaigns={campaigns} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged(); }} />
      )}
    </div>
  );
}

function ProgramModal({ program, campaigns, onClose, onSaved }: {
  program?: IncentiveProgram; campaigns: Campaign[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(program?.name || '');
  const [keywords, setKeywords] = useState(parseKeywords(program?.keywords_json || '[]').join(', '));
  const [startsAt, setStartsAt] = useState(toDateInput(program?.starts_at));
  const [endsAt, setEndsAt] = useState(toDateInput(program?.ends_at, endOfThisMonth()));
  const [targetIds, setTargetIds] = useState<string[]>(parseTargets(program?.target_campaigns || null));
  const [bonusRate, setBonusRate] = useState(
    program?.bonus_rate_pct != null ? String(program.bonus_rate_pct) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState('');

  /** Fill the keywords from the pool name — the lists are the same every month, so this
   *  is the step that turns "what do I even type here" into one click. */
  const suggest = async () => {
    if (!name.trim()) { setError('כתוב קודם את שם הקמפיין כדי שאדע מה להציע'); return; }
    setSuggesting(true); setError(''); setSuggestNote('');
    try {
      const r = await incentiveApi.suggestKeywords(name.trim());
      if (!r.keywords.length) { setSuggestNote('לא הצלחתי להציע — כתוב מילים ידנית'); return; }
      setKeywords(r.keywords.join(', '));
      // Name the category that was recognised, never just "✓". A suggestion typed into the
      // field looks authoritative, and if the name was read as the wrong category the
      // autopilot searches it for a month and the pool's bonus is never earned. Seeing
      // "זוהה כ־חיות מחמד" on a textiles pool is how that gets caught in two seconds.
      setSuggestNote(r.matched
        ? `זוהה כ־${r.matched} — ודא שזו הקטגוריה שבפורטל, ותקן אם לא`
        : 'הוצע על ידי ה-AI — ודא שהמילים תואמות לקטגוריה שבפורטל');
    } catch (e: any) {
      setSuggestNote(e?.response?.data?.message || 'ההצעה נכשלה');
    } finally { setSuggesting(false); }
  };

  const save = async () => {
    const kws = keywords.split(',').map((k) => k.trim()).filter(Boolean);
    if (!name.trim()) { setError('תן שם לקמפיין (כמו בפורטל)'); return; }
    if (!kws.length) { setError('הוסף לפחות מילת חיפוש אחת באנגלית'); return; }
    setSaving(true); setError('');
    const dto: IncentiveInput = {
      name: name.trim(), keywords: kws, target_campaigns: targetIds,
      starts_at: new Date(`${startsAt}T00:00:00`).toISOString(),
      ends_at: new Date(`${endsAt}T23:59:59`).toISOString(),
      // Empty clears the rate → the card goes back to showing no estimate.
      bonus_rate_pct: bonusRate.trim() === '' ? null : Number(bonusRate),
    };
    try {
      if (program) await incentiveApi.update(program.id, dto);
      else await incentiveApi.create(dto);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'השמירה נכשלה');
      setSaving(false);
    }
  };

  const steersAll = targetIds.includes(ALL_CAMPAIGNS);

  const toggleTarget = (id: string) =>
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /** "All" replaces the individual picks rather than sitting alongside them — a saved
   *  list of both would read as a contradiction on the card. */
  const toggleAll = () => setTargetIds((prev) => (prev.includes(ALL_CAMPAIGNS) ? [] : [ALL_CAMPAIGNS]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <DialogA11y label={program ? 'עריכת קמפיין בונוס' : 'קמפיין בונוס חדש'} onClose={onClose} />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-surface-secondary border border-edge rounded-2xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto"
        dir="rtl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <Gift size={16} className="text-amber-400" /> {program ? 'עריכת קמפיין בונוס' : 'קמפיין בונוס חדש'}
        </h3>

        <div className="space-y-4">
          <div>
            <label className={labelCls}>שם הקמפיין (כמו בפורטל)</label>
            <input aria-label="שם הקמפיין (כמו בפורטל)" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Home & Living Pool" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>אחוז הבונוס (Incentive Commission Rate)</label>
            <input aria-label="אחוז הבונוס (Incentive Commission Rate)" type="number" min={0} max={100} step="0.1" value={bonusRate} dir="ltr"
              onChange={(e) => setBonusRate(e.target.value)}
              placeholder="11" className={`${inputCls} max-w-[140px]`} />
            <p className="text-2xs text-white/30 mt-1">
              מהעמודה &quot;Incentive Commission Rate&quot; בפורטל. משמש לחישוב הערכת הבונוס על סכום המכירות במסלול. ריק = לא תוצג הערכה.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs text-white/50">מילות חיפוש באנגלית — מופרדות בפסיק</label>
              <button type="button" onClick={suggest} disabled={suggesting}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50">
                {suggesting ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                {suggesting ? 'מציע…' : 'הצע לי מילים'}
              </button>
            </div>
            <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={3} dir="ltr"
              placeholder="storage box, kitchen organizer, closet organizer"
              className={`${inputCls} resize-none`} />
            <p className="text-2xs text-white/30 mt-1">אלה המילים שהטייס יחפש בהן — כדאי 3–6 ממוקדות לקטגוריה שמזכה בבונוס.</p>
            {suggestNote && <p className="text-2xs text-amber-300/80 mt-1">{suggestNote}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>מתאריך</label>
              <input aria-label="מתאריך" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} dir="ltr" />
            </div>
            <div>
              <label className={labelCls}>עד תאריך</label>
              <input aria-label="עד תאריך" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputCls} dir="ltr" />
            </div>
          </div>

          <div>
            <label className={labelCls}>לאילו טייסים זה רלוונטי</label>
            {/* The keywords of a pool aimed at the wrong autopilot don't merely earn
                nothing — they arrive BOOSTED and take the cycle's best slots from products
                that audience actually wants. So the aim is asked for explicitly, and "all"
                is one of the answers rather than the silence-default it used to be. */}
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              <label className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors
                ${steersAll ? 'border-amber-500/60 bg-amber-500/10' : 'border-edge hover:border-edge-hover bg-white/[0.03]'}`}>
                <input type="checkbox" checked={steersAll} onChange={toggleAll} className="accent-amber-500" />
                <span className="text-sm text-white/80 flex-1">כל הטייסים</span>
              </label>
              {campaigns.map((c) => {
                const on = steersAll || targetIds.includes(c.id);
                return (
                  <label key={c.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-colors
                    ${steersAll ? 'opacity-45 cursor-not-allowed border-edge bg-white/[0.03]' : 'cursor-pointer'}
                    ${on && !steersAll ? 'border-amber-500/60 bg-amber-500/10' : 'border-edge hover:border-edge-hover bg-white/[0.03]'}`}>
                    <input type="checkbox" checked={on} disabled={steersAll}
                      onChange={() => toggleTarget(c.id)} className="accent-amber-500" />
                    <span className="text-sm text-white/80 flex-1 truncate">{c.name}</span>
                    {c.status !== 'active' && <span className="text-2xs text-white/30">מושהה</span>}
                  </label>
                );
              })}
              {campaigns.length === 0 && <p className="text-2xs text-white/30">אין טייסים מוגדרים.</p>}
            </div>
            {targetIds.length === 0 ? (
              <p className="text-2xs text-amber-300/80 mt-1.5 leading-relaxed">
                ⚠️ בלי בחירה הפול יירשם ויוצג עם הערכת הבונוס, אבל <b>המילים לא ייכנסו לאף רוטציה</b> —
                כך מוצר מקטגוריה זרה לא נכנס לקבוצה שלא מתאימה לו.
              </p>
            ) : (
              <p className="text-2xs text-white/30 mt-1.5">
                מילות הפול ייכנסו לרוטציה של הטייסים שסימנת בלבד, ובעדיפות גבוהה כל עוד החלון פתוח.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-black text-sm font-bold">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} שמור
            </button>
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}
