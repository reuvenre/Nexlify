'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus, X, Loader2, Save, Search, Package } from 'lucide-react';
import { channelsApi } from '@/lib/api-client';
import { GroupMultiSelect, type GroupOption } from '@/components/GroupMultiSelect';
import type { Campaign, CampaignInput, CampaignSource } from '@/types';

const CRON_PRESETS = [
  { label: 'כל שעה',         value: '0 * * * *' },
  { label: 'כל 3 שעות',      value: '0 */3 * * *' },
  { label: 'כל 6 שעות',      value: '0 */6 * * *' },
  { label: 'פעם ביום (9:00)', value: '0 9 * * *' },
  { label: 'פעמיים ביום',     value: '0 9,21 * * *' },
  { label: 'פעם בשבוע',       value: '0 9 * * 1' },
];

/**
 * The create AND edit forms are the same fields, so they share one component — a change to
 * a field (or a new one) can never drift between "new" and "edit". `mode` only swaps the
 * heading, the button copy, and the icon; the field markup is identical.
 */
export function CampaignForm({
  mode,
  initial,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial: CampaignInput;
  onSubmit: (data: CampaignInput) => Promise<Campaign>;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [kwInput, setKwInput] = useState('');
  const [form, setForm] = useState<CampaignInput>({ source: 'aliexpress', target_channels: [], ...initial });
  const [channels, setChannels] = useState<GroupOption[]>([]);

  const source: CampaignSource = form.source ?? 'aliexpress';
  const isFlylink = source === 'flylink';

  // Groups are only needed to pick FLYLINK targets, but loading them upfront keeps the
  // toggle instant.
  useEffect(() => {
    channelsApi.list()
      .then((list) => setChannels(list.map((c) => ({ id: c.id, name: c.name, channel_id: c.channel_id }))))
      .catch(() => setChannels([]));
  }, []);

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (kw && !form.keywords.includes(kw)) {
      setForm((f) => ({ ...f, keywords: [...f.keywords, kw] }));
    }
    setKwInput('');
  };

  const removeKeyword = (kw: string) =>
    setForm((f) => ({ ...f, keywords: f.keywords.filter((k) => k !== kw) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Each source has its own required input: AliExpress searches keywords, FLYLINK rotates
    // a catalog into chosen groups.
    if (isFlylink) {
      if (!form.target_channels?.length) {
        setError('בחר לפחות קבוצת יעד אחת לפרסום');
        return;
      }
    } else if (form.keywords.length === 0) {
      setError('יש להוסיף לפחות מילת מפתח אחת');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      // Send only the fields relevant to the chosen source so a leftover keyword/group from
      // toggling back and forth doesn't get persisted for the wrong source.
      const payload: CampaignInput = isFlylink
        ? { ...form, source: 'flylink', keywords: [], min_price: undefined, max_price: undefined, min_discount: undefined }
        : { ...form, source: 'aliexpress', target_channels: [] };
      const c = await onSubmit(payload);
      router.push(`/campaigns/${c.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || (mode === 'create' ? 'שגיאה ביצירת הטייס האוטומטי' : 'שגיאה בשמירת הטייס האוטומטי'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-white/40 hover:text-white text-sm mb-6 transition-colors"
      >
        <ArrowRight size={14} />
        חזרה להטייס האוטומטי
      </button>

      <h1 className="text-2xl font-bold text-white mb-8">
        {mode === 'create' ? 'טייס אוטומטי חדש' : 'עריכת טייס אוטומטי'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Source — AliExpress (keyword search) vs FLYLINK (rotate linked catalog). */}
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">מקור המוצרים</h2>
          <p className="text-2xs text-white/35 mb-4">
            {isFlylink
              ? 'הטייס האוטומטי מסובב את מוצרי FLYLINK שכבר קישרת — אין חיפוש, רק המוצרים שבחרת.'
              : 'הטייס האוטומטי מחפש מוצרים חדשים ב-AliExpress לפי מילות מפתח.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { key: 'aliexpress', label: 'AliExpress', desc: 'חיפוש לפי מילות מפתח', icon: Search },
              { key: 'flylink', label: 'FLYLINK', desc: 'סבב הקטלוג המקושר', icon: Package },
            ] as const).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setForm((f) => ({ ...f, source: opt.key }))}
                className={`flex items-start gap-2.5 p-3.5 rounded-xl border text-right transition-all
                  ${source === opt.key
                    ? 'bg-blue-600/20 border-blue-500/50'
                    : 'bg-white/5 border-edge hover:bg-white/10'}`}
              >
                <opt.icon size={16} className={source === opt.key ? 'text-blue-400 mt-0.5' : 'text-white/40 mt-0.5'} />
                <div>
                  <p className={`text-sm font-medium ${source === opt.key ? 'text-blue-200' : 'text-white/70'}`}>{opt.label}</p>
                  <p className="text-2xs text-white/35 mt-0.5">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Name + language */}
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">פרטים בסיסיים</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">שם הטייס האוטומטי *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="מבצעי אוזניות"
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/60 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">שפת הפוסטים</label>
              <div className="flex gap-2">
                {(['he', 'en', 'ar'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, language: lang }))}
                    className={`px-4 py-2 rounded-lg text-xs font-medium transition-all
                      ${form.language === lang
                        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                        : 'bg-white/5 text-white/40 border border-edge hover:bg-white/10'
                      }`}
                  >
                    {lang === 'he' ? '🇮🇱 עברית' : lang === 'en' ? '🇺🇸 English' : '🇸🇦 عربي'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* FLYLINK: pick which group(s) the rotated products publish to. */}
        {isFlylink && (
          <div className="bg-surface-secondary border border-edge rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1">קבוצות יעד *</h2>
            <p className="text-2xs text-white/35 mb-4">
              המוצרים המקושרים יתפרסמו לקבוצות שתבחר, בסגנון הכתיבה של הקבוצה. הטקסט נכתב מחדש ב-AI לכל פוסט.
            </p>
            <GroupMultiSelect
              channels={channels}
              value={form.target_channels ?? []}
              onChange={(ids) => setForm((f) => ({ ...f, target_channels: ids }))}
            />
          </div>
        )}

        {/* Keywords — AliExpress only (FLYLINK has no search). */}
        {!isFlylink && (
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">מילות מפתח לחיפוש</h2>
          <p className="text-2xs text-white/35 mb-4">
            אפשר לכתוב בעברית — הקטלוג של AliExpress מאונדקס באנגלית, ולכן המערכת מתרגמת את מילת המפתח לאנגלית לפני החיפוש.
          </p>
          <div className="flex gap-2 mb-3">
            <input
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
              placeholder="הוסף מילת מפתח..."
              className="flex-1 bg-white/5 border border-edge-hover rounded-xl px-4 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/60 transition-colors"
            />
            <button
              type="button"
              onClick={addKeyword}
              className="px-4 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-xl transition-all"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {form.keywords.map((kw) => (
              <span key={kw} className="flex items-center gap-1.5 bg-white/8 border border-edge-hover text-white/70 text-xs px-3 py-1.5 rounded-lg">
                {kw}
                <button type="button" onClick={() => removeKeyword(kw)} className="text-white/30 hover:text-red-400 transition-colors">
                  <X size={11} />
                </button>
              </span>
            ))}
            {form.keywords.length === 0 && (
              <p className="text-xs text-white/20">לדוגמה: &quot;אוזניות אלחוטיות&quot;, &quot;מעמד לטלפון&quot;</p>
            )}
          </div>
        </div>
        )}

        {/* Filters — AliExpress only (FLYLINK prices come from the linked catalog). */}
        {!isFlylink && (
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">פילטרים (אופציונלי)</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">מחיר מינ׳ ($)</label>
              <input
                type="number"
                min={0}
                value={form.min_price ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, min_price: e.target.value ? +e.target.value : undefined }))}
                placeholder="0"
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">מחיר מקס׳ ($)</label>
              <input
                type="number"
                min={0}
                value={form.max_price ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, max_price: e.target.value ? +e.target.value : undefined }))}
                placeholder="ללא הגבלה"
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5">הנחה מינ׳ (%)</label>
              <input
                type="number"
                min={0}
                max={99}
                value={form.min_discount ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, min_discount: e.target.value ? +e.target.value : undefined }))}
                placeholder="20"
                className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-blue-500/60 transition-colors"
              />
            </div>
          </div>

          {/* Minimum rating — enforced against each product's AliExpress feedback score.
              Best-sellers cluster at 4.5–4.9★, so these thresholds actually filter. */}
          <div className="mt-4">
            <label className="block text-xs font-medium text-white/50 mb-1.5">דירוג מינימלי</label>
            <div className="flex gap-2 flex-wrap">
              {([
                { v: undefined, label: 'כל דירוג' },
                { v: 4, label: '4+ ⭐' },
                { v: 4.5, label: '4.5+ ⭐' },
                { v: 4.8, label: '4.8+ ⭐' },
              ] as const).map((opt) => {
                const active = (form.min_rating ?? undefined) === opt.v;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, min_rating: opt.v }))}
                    className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all
                      ${active
                        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                        : 'bg-white/5 text-white/40 border border-edge hover:bg-white/10'}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-white/30 mt-2">
              רק מוצרים בדירוג הזה ומעלה יפורסמו. אם אף מוצר לא עומד בסף, ההרצה תיכשל בהודעה ברורה במקום לפרסם מוצר לא מתאים.
            </p>
          </div>
        </div>
        )}

        {/* Schedule */}
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">תזמון ופרסום</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-2">תדירות</label>
              <div className="grid grid-cols-3 gap-2">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, schedule_cron: p.value }))}
                    className={`py-2 px-3 rounded-lg text-xs font-medium transition-all text-center
                      ${form.schedule_cron === p.value
                        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                        : 'bg-white/5 text-white/40 border border-edge hover:bg-white/10'
                      }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-2xs text-white/30 mt-2">
                כל הרצה מכניסה פוסטים לתור; הם מתפרסמים לפי חלון התזמון בהגדרות.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">פוסטים בכל הרצה</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={form.posts_per_run}
                  onChange={(e) => setForm((f) => ({ ...f, posts_per_run: +e.target.value }))}
                  className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">מארק-אפ לשקל (%)</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={form.markup_percent ?? 15}
                  onChange={(e) => setForm((f) => ({ ...f, markup_percent: +e.target.value }))}
                  className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors"
                />
                <p className="text-2xs text-white/25 mt-1">תוסף על המחיר בשקל</p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-all"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : mode === 'create' ? <Plus size={14} /> : <Save size={14} />}
            {isLoading ? 'שומר...' : mode === 'create' ? 'צור טייס אוטומטי' : 'שמור שינויים'}
          </button>

          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-3 text-white/40 hover:text-white text-sm transition-colors"
          >
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}
