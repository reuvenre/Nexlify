'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Ticket, Loader2, Trash2, RefreshCw, Sparkles, AlertTriangle, CheckCircle2, Clock, Power, Plus, Wand2,
} from 'lucide-react';
import { couponsApi } from '@/lib/api-client';
import type { Coupon, ParsedCoupon } from '@/types';

/** Local <input type="datetime-local"> value from an ISO string (or now + hours). */
function toLocalInput(iso?: string | null, plusHours = 0): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + plusHours * 3600_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type Status = 'active' | 'expired' | 'scheduled' | 'off';
function statusOf(c: Coupon): Status {
  if (!c.is_active) return 'off';
  const now = Date.now();
  if (c.ends_at && new Date(c.ends_at).getTime() < now) return 'expired';
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return 'scheduled';
  return 'active';
}
const STATUS_META: Record<Status, { label: string; cls: string }> = {
  active: { label: 'פעיל', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25' },
  expired: { label: 'פג תוקף', cls: 'bg-white/5 text-white/40 border-edge' },
  scheduled: { label: 'עתידי', cls: 'bg-purple-500/10 text-purple-400 border-purple-500/25' },
  off: { label: 'כבוי', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/25' },
};

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [campaign, setCampaign] = useState('');
  const [startsAt, setStartsAt] = useState(toLocalInput());
  const [endsAt, setEndsAt] = useState(toLocalInput(null, 24 * 7));
  const [parsed, setParsed] = useState<ParsedCoupon[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  // Manual fallback
  const [manual, setManual] = useState(false);
  const [mCode, setMCode] = useState('');
  const [mDisc, setMDisc] = useState('');
  const [mMin, setMMin] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setCoupons(await couponsApi.list().catch(() => []));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live parse preview — shows what was detected before anything is saved. Editing the
  // text supersedes any earlier AI result, so the regex verdict takes over again.
  useEffect(() => {
    setAiUsed(false);
    if (!text.trim()) { setParsed(null); return; }
    let alive = true;
    couponsApi.preview(text)
      .then((r) => { if (alive) setParsed(r.coupons); })
      .catch(() => { if (alive) setParsed([]); });
    return () => { alive = false; };
  }, [text]);

  const doImport = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      const r = await couponsApi.import({
        text,
        campaign: campaign.trim() || undefined,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
      });
      setDone(`✓ נשמרו ${r.imported} קופונים`);
      setText(''); setParsed(null);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הייבוא נכשל');
    } finally {
      setBusy(false);
    }
  };

  /** On-demand AI extraction — replaces the regex preview with what the model found. */
  const parseAi = async () => {
    setAiBusy(true); setError('');
    try {
      const r = await couponsApi.previewAi(text);
      setParsed(r.coupons);
      setAiUsed(true);
      if (!r.coupons.length) setError('גם ה-AI לא זיהה קודים — נסה הוספה ידנית.');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'הניתוח עם AI נכשל');
    } finally {
      setAiBusy(false);
    }
  };

  const addManual = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      await couponsApi.add({
        code: mCode.trim(),
        discount_usd: Number(mDisc),
        min_spend_usd: Number(mMin),
        campaign: campaign.trim() || undefined,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
      });
      setDone(`✓ נוסף ${mCode.trim().toUpperCase()}`);
      setMCode(''); setMDisc(''); setMMin('');
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'ההוספה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: Coupon) => {
    await couponsApi.setActive(c.id, !c.is_active).catch(() => {});
    load();
  };
  const remove = async (c: Coupon) => {
    if (!confirm(`למחוק את הקופון ${c.code}?`)) return;
    await couponsApi.remove(c.id).catch(() => {});
    load();
  };

  const fmt = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div>
      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Ticket size={22} className="text-pink-400" /> קופונים
          </h1>
          <p className="text-sm text-white/40 mt-1">
            הדבק את הקודים מהמייל של AliExpress — המערכת תצמיד לכל פוסט של AliExpress את הקופון המשתלם ביותר לפי מחיר המוצר.
          </p>
          <p className="text-2xs text-amber-400/80 mt-1.5 flex items-center gap-1.5">
            <AlertTriangle size={11} className="shrink-0" />
            הקופונים חלים רק על פוסטים של AliExpress. פוסטים של FLYLINK לא מקבלים קופון (הקוד תקף רק בקנייה ב-AliExpress).
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white/70 text-sm rounded-xl transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> רענן
        </button>
      </div>

      {/* ── Import ── */}
      <section className="bg-surface-secondary border border-edge rounded-2xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Sparkles size={15} className="text-pink-400" /> ייבוא קודים
        </h2>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          dir="ltr"
          placeholder={`הדבק כאן את הבלוק מהמייל, למשל:\n\nILAFF1  $2 OFF $15+\nILAFF2  $4 OFF $30+\nILAFF3  $7 OFF $55+`}
          className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white/85 outline-none focus:border-pink-500/50 font-mono resize-y"
        />
        <p className="text-2xs text-white/30 mt-1.5">
          אפשר להדביק את כל המייל — שורות שאינן קודים (כותרות, תקופת מבצע) פשוט יתעלמו.
        </p>

        {/* Parse preview */}
        {parsed && (
          <div className={`mt-3 rounded-xl border p-3 ${parsed.length ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
            {parsed.length ? (
              <>
                <p className="text-xs text-emerald-400 mb-2 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> זוהו {parsed.length} קודים
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.map((p) => (
                    <span key={p.code} className="text-2xs bg-white/[0.06] border border-edge rounded-lg px-2 py-1 text-white/70" dir="ltr">
                      <b className="text-pink-300">{p.code}</b> ${p.discount_usd} off ${p.min_spend_usd}+
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div>
                <p className="text-xs text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> לא זוהו קודים בטקסט
                </p>
                <p className="text-2xs text-white/40 mt-1.5">
                  אלי אקספרס כנראה שינתה ניסוח. נסה ניתוח עם AI, או הוסף ידנית.
                </p>
              </div>
            )}
            {aiUsed && parsed.length > 0 && (
              <p className="text-2xs text-violet-300/70 mt-2 flex items-center gap-1">
                <Wand2 size={10} /> נותח עם AI — ודא שהערכים נכונים לפני שמירה
              </p>
            )}
          </div>
        )}

        {/* AI fallback — on demand (costs a generation), for wording the parser can't read */}
        {text.trim() && (
          <button onClick={parseAi} disabled={aiBusy}
            className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-violet-600/15 hover:bg-violet-600/25 border border-violet-500/30 disabled:opacity-50 text-violet-200 text-xs rounded-lg transition-all">
            {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {parsed && parsed.length === 0 ? 'נתח עם AI' : 'לא זוהה נכון? נתח עם AI'}
          </button>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <div>
            <label className="block text-xs text-white/50 mb-1.5">שם קמפיין (אופציונלי)</label>
            <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="IL [Vacation Sale]"
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-pink-500/50" />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">בתוקף מ־</label>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-pink-500/50" />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-1.5">בתוקף עד</label>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-pink-500/50" />
          </div>
        </div>
        <p className="text-2xs text-white/30 mt-1.5">
          אחרי תאריך הסיום המערכת תפסיק לצרף את הקודים אוטומטית — גם לפוסטים שכבר ממתינים בתור.
        </p>

        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
        {done && <p className="text-xs text-emerald-400 mt-3">{done}</p>}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button onClick={doImport} disabled={busy || !parsed?.length}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Ticket size={14} />}
            שמור {parsed?.length ? `${parsed.length} קופונים` : 'קופונים'}
          </button>
          <button onClick={() => setManual((m) => !m)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/60 text-sm rounded-xl transition-all">
            <Plus size={14} /> הוספה ידנית
          </button>
        </div>

        {/* Manual fallback — always works, whatever wording AliExpress ships this week */}
        {manual && (
          <div className="mt-4 border-t border-edge pt-4">
            <p className="text-xs text-white/50 mb-3">
              הזנה ידנית — למקרה שהניסוח של אלי אקספרס לא זוהה אוטומטית.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-2xs text-white/40 mb-1">קוד</label>
                <input value={mCode} onChange={(e) => setMCode(e.target.value)} dir="ltr" placeholder="ILAFF3"
                  className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-pink-500/50 font-mono" />
              </div>
              <div>
                <label className="block text-2xs text-white/40 mb-1">הנחה ($)</label>
                <input type="number" step="0.01" min="0" value={mDisc} onChange={(e) => setMDisc(e.target.value)} dir="ltr" placeholder="7"
                  className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-pink-500/50" />
              </div>
              <div>
                <label className="block text-2xs text-white/40 mb-1">מעל ($)</label>
                <input type="number" step="0.01" min="0" value={mMin} onChange={(e) => setMMin(e.target.value)} dir="ltr" placeholder="55"
                  className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-pink-500/50" />
              </div>
            </div>
            <button onClick={addManual} disabled={busy || !mCode.trim() || !mDisc || !mMin}
              className="mt-3 flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-all">
              <Plus size={13} /> הוסף קופון
            </button>
            <p className="text-2xs text-white/25 mt-1.5">משתמש באותם תאריכי תוקף שנבחרו למעלה.</p>
          </div>
        )}
      </section>

      {/* ── List ── */}
      <section className="bg-surface-secondary border border-edge rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-edge">
          <h3 className="text-sm font-semibold text-white">הקופונים שלי ({coupons.length})</h3>
        </div>
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-pink-400" /></div>
        ) : coupons.length === 0 ? (
          <p className="py-12 text-center text-sm text-white/40">אין עדיין קופונים — הדבק בלוק קודים למעלה.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-2xs text-white/35 border-b border-edge">
                  <th className="px-5 py-2.5 font-medium">קוד</th>
                  <th className="px-3 py-2.5 font-medium">הנחה</th>
                  <th className="px-3 py-2.5 font-medium">מעל</th>
                  <th className="px-3 py-2.5 font-medium">קמפיין</th>
                  <th className="px-3 py-2.5 font-medium">תוקף</th>
                  <th className="px-3 py-2.5 font-medium">סטטוס</th>
                  <th className="px-3 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => {
                  const st = STATUS_META[statusOf(c)];
                  return (
                    <tr key={c.id} className="border-b border-edge last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="px-5 py-3 font-mono font-bold text-pink-300" dir="ltr">{c.code}</td>
                      <td className="px-3 py-3 text-white/80" dir="ltr">${c.discount_usd}</td>
                      <td className="px-3 py-3 text-white/50" dir="ltr">${c.min_spend_usd}+</td>
                      <td className="px-3 py-3 text-white/45 truncate max-w-[160px]">{c.campaign || '—'}</td>
                      <td className="px-3 py-3 text-2xs text-white/45">{fmt(c.starts_at)} ← {fmt(c.ends_at)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border ${st.cls}`}>
                          <Clock size={9} /> {st.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggle(c)} title={c.is_active ? 'כבה' : 'הפעל'}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-amber-400 hover:bg-amber-500/10 transition-all">
                            <Power size={13} />
                          </button>
                          <button onClick={() => remove(c)} title="מחק"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
