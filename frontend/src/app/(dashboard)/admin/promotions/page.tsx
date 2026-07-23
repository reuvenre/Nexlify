'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, Plus, Loader2, Trash2, Pencil, X, CheckCircle2, AlertTriangle, Clock,
} from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminApi } from '@/lib/api-client';
import type { Promotion } from '@/types';

const PLAN_OPTIONS = [
  { id: 'starter', name: 'Starter' },
  { id: 'growth', name: 'Growth' },
  { id: 'autopilot', name: 'Autopilot' },
  { id: 'scale', name: 'Scale' },
];
const PACK_OPTIONS = [
  { id: '', name: 'כל החבילות' },
  { id: 'pack_5k', name: 'חבילת בוסט (5,000)' },
  { id: 'pack_15k', name: 'חבילת האצה (15,000)' },
  { id: 'pack_50k', name: 'חבילת טורבו (50,000)' },
];

const inputCls = 'w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/85 outline-none focus:border-blue-500/50';
const labelCls = 'block text-xs text-white/50 mb-1.5';

/** Local datetime-input value → ISO, empty → null. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
/** ISO → value for <input type="datetime-local"> in the user's local time. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

function statusOf(p: Promotion): { label: string; cls: string } {
  const now = Date.now();
  if (!p.is_active) return { label: 'מושהה', cls: 'bg-white/10 text-white/50' };
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return { label: 'מתוזמן', cls: 'bg-blue-500/15 text-blue-300' };
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) return { label: 'הסתיים', cls: 'bg-white/10 text-white/40' };
  return { label: 'פעיל 🔥', cls: 'bg-emerald-500/15 text-emerald-300' };
}

function targetLabel(p: Promotion): string {
  if (p.target_type === 'all_plans') return 'כל המנויים';
  if (p.target_type === 'packs') {
    return PACK_OPTIONS.find((o) => o.id === (p.target_id || ''))?.name || 'חבילות קרדיטים';
  }
  return `מנוי ${PLAN_OPTIONS.find((o) => o.id === p.target_id)?.name || p.target_id}`;
}

export default function AdminPromotionsPage() {
  const { user } = useAuth();
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminApi.promotions()
      .then(setPromos)
      .catch(() => setError('טעינת המבצעים נכשלה'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (user && user.role !== 'admin') {
    return (
      <div className="text-center py-20">
        <h1 className="text-xl font-bold text-white">גישת מנהל בלבד</h1>
      </div>
    );
  }

  const toggle = async (p: Promotion) => {
    try {
      await adminApi.updatePromotion(p.id, { is_active: !p.is_active });
      load();
    } catch { setError('העדכון נכשל'); }
  };

  const remove = async (p: Promotion) => {
    if (!confirm(`למחוק את המבצע "${p.title}"?`)) return;
    try {
      await adminApi.deletePromotion(p.id);
      load();
    } catch { setError('המחיקה נכשלה'); }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Sparkles size={19} className="text-amber-400" /> מבצעים
          </h1>
          <p className="text-sm text-white/40 mt-1">
            הנחות על מנויים וחבילות קרדיטים — מופיעות אוטומטית בעמוד המחירים ובמסך המנוי, ונכבות לבד בתאריך הסיום
          </p>
        </div>
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/90 hover:bg-amber-500 text-black text-sm font-semibold rounded-xl transition-all">
          <Plus size={14} /> מבצע חדש
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-white/40">
          <Loader2 size={20} className="animate-spin ml-2" /> טוען...
        </div>
      ) : promos.length === 0 ? (
        <div className="bg-surface-secondary border border-edge rounded-2xl p-10 text-center">
          <p className="text-3xl mb-3">🏷️</p>
          <p className="text-white/60 font-medium mb-1">אין עדיין מבצעים</p>
          <p className="text-sm text-white/35">צור מבצע ראשון — למשל 20% הנחה על Autopilot לחודש הקרוב</p>
        </div>
      ) : (
        <div className="space-y-3">
          {promos.map((p) => {
            const st = statusOf(p);
            return (
              <div key={p.id} className="bg-surface-secondary border border-edge rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-2xs font-semibold rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                    <p className="text-sm font-semibold text-white truncate">{p.title}</p>
                  </div>
                  <p className="text-xs text-white/45">
                    {targetLabel(p)}
                    {' · '}
                    {p.percent_off != null ? `${p.percent_off}% הנחה` : `מחיר קבוע ₪${p.fixed_price}`}
                    {p.ends_at && (
                      <span className="inline-flex items-center gap-1 mr-2 text-white/35">
                        <Clock size={10} />
                        עד {new Date(p.ends_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggle(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      p.is_active
                        ? 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                    }`}>
                    {p.is_active ? 'השהה' : 'הפעל'}
                  </button>
                  <button onClick={() => setEditing(p)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => remove(p)}
                    className="p-2 rounded-lg bg-white/5 hover:bg-red-500/15 text-white/50 hover:text-red-400 transition-all">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PromoModal
          promo={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function PromoModal({ promo, onClose, onSaved }: {
  promo: Promotion | null; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(promo?.title || '');
  const [targetType, setTargetType] = useState<'plan' | 'all_plans' | 'packs'>(promo?.target_type || 'plan');
  const [targetId, setTargetId] = useState(promo?.target_id || 'autopilot');
  const [mode, setMode] = useState<'percent' | 'fixed'>(promo?.fixed_price != null ? 'fixed' : 'percent');
  const [percent, setPercent] = useState(promo?.percent_off?.toString() || '20');
  const [fixed, setFixed] = useState(promo?.fixed_price?.toString() || '');
  const [startsAt, setStartsAt] = useState(toLocal(promo?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocal(promo?.ends_at ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    const data = {
      title: title.trim(),
      target_type: targetType,
      target_id: targetType === 'all_plans' ? null : (targetId || null),
      percent_off: mode === 'percent' ? Number(percent) : null,
      fixed_price: mode === 'fixed' ? Number(fixed) : null,
      starts_at: toIso(startsAt),
      ends_at: toIso(endsAt),
    };
    try {
      if (promo) await adminApi.updatePromotion(promo.id, data);
      else await adminApi.createPromotion(data);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'השמירה נכשלה');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface-secondary border border-edge rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge sticky top-0 bg-surface-secondary">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles size={17} className="text-amber-400" /> {promo ? 'עריכת מבצע' : 'מבצע חדש'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>כותרת (מוצגת ללקוחות בבאנר)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder='🔥 מבצע השקה — 20% הנחה על Autopilot' className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>על מה המבצע</label>
            <select value={targetType} onChange={(e) => {
              const t = e.target.value as typeof targetType;
              setTargetType(t);
              setTargetId(t === 'plan' ? 'autopilot' : '');
            }} className={inputCls}>
              <option value="plan">מנוי מסוים</option>
              <option value="all_plans">כל המנויים</option>
              <option value="packs">חבילות קרדיטים</option>
            </select>
          </div>

          {targetType === 'plan' && (
            <div>
              <label className={labelCls}>מנוי</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
                {PLAN_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          {targetType === 'packs' && (
            <div>
              <label className={labelCls}>חבילה</label>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
                {PACK_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>סוג ההנחה</label>
            <div className="flex gap-2 mb-2">
              {/* Selected state is SOLID amber + black text — the translucent-amber
                  + light-amber-text combo vanished entirely in the light theme. */}
              <button type="button" onClick={() => setMode('percent')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${mode === 'percent' ? 'bg-amber-500 border-amber-500 text-black shadow-sm' : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'}`}>
                אחוז הנחה
              </button>
              <button type="button" onClick={() => setMode('fixed')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${mode === 'fixed' ? 'bg-amber-500 border-amber-500 text-black shadow-sm' : 'bg-white/5 border-edge-hover text-white/50 hover:text-white/80'}`}>
                מחיר קבוע
              </button>
            </div>
            {mode === 'percent' ? (
              <input type="number" min={1} max={90} dir="ltr" value={percent}
                onChange={(e) => setPercent(e.target.value)} placeholder="20" className={inputCls} />
            ) : (
              <input type="number" min={1} dir="ltr" value={fixed}
                onChange={(e) => setFixed(e.target.value)} placeholder="199" className={inputCls} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>מתחיל (ריק = מיד)</label>
              <input type="datetime-local" dir="ltr" value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>מסתיים (ריק = ללא הגבלה)</label>
              <input type="datetime-local" dir="ltr" value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)} className={inputCls} />
            </div>
          </div>

          {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={saving || !title.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500/90 hover:bg-amber-500 disabled:opacity-60 text-black text-sm font-semibold transition-all">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {promo ? 'שמור שינויים' : 'צור מבצע'}
            </button>
            <button onClick={onClose} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-all">ביטול</button>
          </div>
        </div>
      </div>
    </div>
  );
}
