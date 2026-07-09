'use client';

import { useState, useEffect } from 'react';
import { Loader2, Save, Check, Calculator } from 'lucide-react';
import { credentialsApi } from '@/lib/api-client';

type Rounding = 'natural' | 'charming' | 'exact';

const ROUNDING: { id: Rounding; label: string; desc: string }[] = [
  { id: 'natural', label: 'טבעי', desc: 'עיגול כלפי מעלה ל-₪1 · מעל 50 ל-₪5 הקרוב' },
  { id: 'charming', label: 'מסתיים ב-9', desc: 'עיגול כלפי מטה למחיר שמסתיים ב-9 (49, 99)' },
  { id: 'exact', label: 'מדויק', desc: 'עיגול ל-₪0.10 הקרוב' },
];

// Mirror of the backend rounding logic, for the live preview.
function roundPrice(v: number, mode: Rounding): number {
  if (!(v > 0)) return 0;
  if (mode === 'exact') return Math.round(v * 100) / 100;   // true exact — matches the site
  if (mode === 'charming') { const d = Math.floor(v); const e = d - ((d + 1) % 10); return e > 0 ? e : d; }
  return v > 50 ? Math.ceil(v / 5) * 5 : Math.ceil(v);
}

export function PricingForm() {
  const [markup, setMarkup] = useState(0);
  const [buffer, setBuffer] = useState(0);
  // Default 'exact' — the system-wide default that keeps displayed prices identical
  // to the AliExpress site. A 'natural' fallback here could silently flip the user
  // back to rounded (wrong-looking) prices on the next settings save.
  const [rounding, setRounding] = useState<Rounding>('exact');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    credentialsApi.get()
      .then((c) => {
        setMarkup(c.price_markup_pct ?? 0);
        setBuffer(c.price_shipping_buffer_ils ?? 0);
        setRounding((c.price_rounding_mode as Rounding) || 'exact');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await credentialsApi.upsert({
        price_markup_pct: markup,
        price_shipping_buffer_ils: buffer,
        price_rounding_mode: rounding,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  // Live preview: a ₪50 cost through the pipeline.
  const sampleCost = 50;
  const previewFinal = roundPrice((sampleCost + buffer) * (1 + markup / 100), rounding);

  if (loading) {
    return <div className="py-12 flex justify-center"><Loader2 size={20} className="animate-spin text-blue-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <section className="bg-surface-secondary border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <span className="text-lg">🧮</span> ממיר מחירים (USD → ₪)
        </h3>
        <p className="text-2xs text-white/30 mb-5">
          המחירים מומרים לשקלים לפי השער החי. כאן מוסיפים רווח, תוספת משלוח ועיגול — בדיוק כמו במכירה קבוצתית.
          ברירת מחדל (0% רווח) מתאימה לשיווק שותפים; מוכרים מעלים רווח.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">אחוז רווח (markup) %</label>
            <input
              type="number" min={0} max={100} value={markup}
              onChange={(e) => setMarkup(Math.min(100, Math.max(0, +e.target.value)))}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
            <p className="text-2xs text-white/25 mt-1">0 = ללא רווח (אפיליאצייט)</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">תוספת משלוח (₪)</label>
            <input
              type="number" min={0} max={200} value={buffer}
              onChange={(e) => setBuffer(Math.min(200, Math.max(0, +e.target.value)))}
              className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/50 transition-colors"
              dir="ltr"
            />
            <p className="text-2xs text-white/25 mt-1">נוסף לעלות לפני הרווח</p>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-white/50 mb-2">שיטת עיגול</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {ROUNDING.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRounding(r.id)}
                className={`text-right p-3 rounded-xl border transition-all
                  ${rounding === r.id ? 'bg-blue-600/15 border-blue-500/40' : 'border-edge-hover hover:bg-white/5'}`}
              >
                <span className={`text-sm font-medium ${rounding === r.id ? 'text-blue-300' : 'text-white/70'}`}>{r.label}</span>
                <p className="text-2xs text-white/35 mt-1 leading-snug">{r.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Live preview */}
      <section className="bg-gradient-to-bl from-blue-600/10 to-violet-600/10 border border-edge rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Calculator size={15} className="text-blue-400" /> תצוגה מקדימה
        </h3>
        <div className="flex items-center gap-2 text-sm text-white/60 flex-wrap" dir="rtl">
          <span>עלות ₪{sampleCost}</span>
          <span className="text-white/30">+ משלוח ₪{buffer}</span>
          <span className="text-white/30">× רווח {markup}%</span>
          <span className="text-white/30">→ עיגול</span>
          <span className="text-lg font-bold text-emerald-400">= ₪{previewFinal}</span>
        </div>
      </section>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-all"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
        {saved ? 'נשמר ✓' : saving ? 'שומר...' : 'שמור הגדרות תמחור'}
      </button>
    </div>
  );
}
