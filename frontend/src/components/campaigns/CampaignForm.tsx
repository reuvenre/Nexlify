'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus, X, Loader2, Save, Search, Package, ShoppingCart } from 'lucide-react';
import { channelsApi } from '@/lib/api-client';
import { GroupMultiSelect, type GroupOption } from '@/components/GroupMultiSelect';
import type { Campaign, CampaignInput, CampaignSource } from '@/types';

const PLATFORMS = [
  { key: 'telegram', label: 'Telegram', emoji: '📨' },
  { key: 'facebook', label: 'Facebook', emoji: '📘' },
  { key: 'instagram', label: 'Instagram', emoji: '📸' },
  { key: 'pinterest', label: 'Pinterest', emoji: '📌' },
  { key: 'whatsapp', label: 'WhatsApp', emoji: '💬' },
] as const;

const CURRENCIES = [
  { key: undefined, label: 'ברירת מחדל (חשבון)' },
  { key: 'USD_ILS', label: '₪ שקל' },
  { key: 'USD_USD', label: '$ דולר' },
  { key: 'USD_EUR', label: '€ אירו' },
  { key: 'USD_GBP', label: '£ ליש״ט' },
] as const;

const TIMEZONES = [
  { key: 'Asia/Jerusalem', label: '🇮🇱 ישראל' },
  { key: 'America/New_York', label: '🇺🇸 ניו-יורק (מזרח)' },
  { key: 'America/Chicago', label: '🇺🇸 שיקגו (מרכז)' },
  { key: 'America/Denver', label: '🇺🇸 דנוור (הרים)' },
  { key: 'America/Los_Angeles', label: '🇺🇸 לוס-אנג׳לס (מערב)' },
  { key: 'Europe/London', label: '🇬🇧 לונדון' },
] as const;

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
  // Custom send window: on when the campaign already carries one (edit mode).
  const [useWindow, setUseWindow] = useState(
    initial.window_start_hour != null || initial.window_end_hour != null || !!initial.window_tz,
  );

  const source: CampaignSource = form.source ?? 'aliexpress';
  const isFlylink = source === 'flylink';
  const isAmazon = source === 'amazon';
  const needsKeywords = !isFlylink;            // AliExpress + Amazon keyword-search
  const needsGroups = isFlylink || isAmazon;   // FLYLINK + Amazon require a target group

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
    if (needsGroups && !form.target_channels?.length) {
      setError('בחר לפחות קבוצת יעד אחת לפרסום');
      return;
    }
    if (needsKeywords && form.keywords.length === 0) {
      setError('יש להוסיף לפחות מילת מפתח אחת');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      // Send only the fields relevant to the chosen source so a leftover keyword/group from
      // toggling back and forth doesn't get persisted for the wrong source. Amazon is a hybrid:
      // it keyword-searches (like AliExpress) but publishes to a chosen group (like FLYLINK),
      // and PA-API exposes no rating/discount, so those filters are dropped.
      const base: CampaignInput = isFlylink
        ? { ...form, source: 'flylink', keywords: [], min_price: undefined, max_price: undefined, min_discount: undefined }
        : isAmazon
          ? { ...form, source: 'amazon', target_channels: form.target_channels ?? [], min_discount: undefined, min_rating: undefined }
          : { ...form, source: 'aliexpress', target_channels: form.target_channels ?? [] };
      // Custom window off → explicit nulls so a previously-saved window is CLEARED,
      // not silently kept. On → fill sensible defaults for anything left empty.
      const payload: CampaignInput = {
        ...base,
        ...(useWindow
          ? {
              window_tz: form.window_tz || 'Asia/Jerusalem',
              window_start_hour: form.window_start_hour ?? 9,
              window_end_hour: form.window_end_hour ?? 22,
            }
          : { window_tz: null, window_start_hour: null, window_end_hour: null }),
      };
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
              : isAmazon
                ? 'הטייס האוטומטי מחפש מוצרים ב-Amazon לפי מילות מפתח ומפרסם לקבוצה שתבחר. הפין/הפוסט נושא את קישור השותפים שלך.'
                : 'הטייס האוטומטי מחפש מוצרים חדשים ב-AliExpress לפי מילות מפתח.'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {([
              { key: 'aliexpress', label: 'AliExpress', desc: 'חיפוש לפי מילות מפתח', icon: Search },
              { key: 'flylink', label: 'FLYLINK', desc: 'סבב הקטלוג המקושר', icon: Package },
              { key: 'amazon', label: 'Amazon', desc: 'חיפוש PA-API לפי מילות מפתח', icon: ShoppingCart },
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

        {/* Per-campaign platform targeting + currency. Platforms empty = the account's
            global toggles (legacy). A Pinterest-only English campaign uses both: publish
            only to Pinterest, price in USD. */}
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">פלטפורמות פרסום</h2>
          <p className="text-2xs text-white/35 mb-4">
            לאן הטייס הזה מפרסם. אם לא תבחר כלום — הוא ישתמש ב&quot;ערוצי פרסום ברירת מחדל&quot; מההגדרות.
            בחירה כאן מבודדת את הטייס: הפוסטים שלו יגיעו <b>רק</b> לפלטפורמות שנבחרו, ופוסטים של
            טייסים אחרים לא יגיעו אליהן דרכו.
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {PLATFORMS.map((p) => {
              const selected = form.target_platforms?.includes(p.key) ?? false;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setForm((f) => {
                    const cur = f.target_platforms ?? [];
                    return {
                      ...f,
                      target_platforms: selected ? cur.filter((k) => k !== p.key) : [...cur, p.key],
                    };
                  })}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-all
                    ${selected
                      ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                      : 'bg-white/5 text-white/40 border border-edge hover:bg-white/10'}`}
                >
                  <span>{p.emoji}</span>{p.label}
                </button>
              );
            })}
          </div>
          {(form.target_platforms?.length === 1 && form.target_platforms[0] === 'pinterest') && (
            <p className="text-2xs text-emerald-400/80 mb-4">
              📌 טייס ייעודי לפינטרסט: התיאורים ייכתבו בסגנון מותאם לחיפוש בפינטרסט, בלי הפוטר של הקבוצות.
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">מטבע המחירים</label>
            <div className="flex gap-2 flex-wrap">
              {CURRENCIES.map((c) => {
                const active = (form.currency_pair ?? undefined) === c.key;
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, currency_pair: c.key ?? null }))}
                    className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-all
                      ${active
                        ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                        : 'bg-white/5 text-white/40 border border-edge hover:bg-white/10'}`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-white/30 mt-2">
              לקהל בינלאומי (למשל פינטרסט באנגלית) בחר $ — המחירים בפוסטים יוצגו בדולרים.
            </p>
          </div>
        </div>

        {/* FLYLINK / Amazon: pick which group(s) the products publish to. */}
        {needsGroups && (
          <div className="bg-surface-secondary border border-edge rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1">קבוצות יעד *</h2>
            <p className="text-2xs text-white/35 mb-4">
              {isAmazon
                ? 'מוצרי אמזון שיימצאו יתפרסמו לקבוצות שתבחר, בסגנון הכתיבה של הקבוצה.'
                : 'המוצרים המקושרים יתפרסמו לקבוצות שתבחר, בסגנון הכתיבה של הקבוצה. הטקסט נכתב מחדש ב-AI לכל פוסט.'}
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

        {/* Target group(s) — AliExpress only. A campaign can publish to a SPECIFIC group,
            isolated from the others; empty = the account's default channel. Without this an
            AliExpress campaign always went to the default channel (leaked into other groups). */}
        {!isFlylink && (
          <div className="bg-surface-secondary border border-edge rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-1">קבוצות יעד</h2>
            <p className="text-2xs text-white/35 mb-4">
              בחר לאיזו קבוצה (או קבוצות) הטייס יפרסם. בחירת קבוצה מבטיחה שהפוסטים של הטייס הזה
              לא ידלפו לקבוצות אחרות. אם תשאיר ריק — הפוסטים ילכו לערוץ ברירת המחדל שלך.
            </p>
            <GroupMultiSelect
              channels={channels}
              value={form.target_channels ?? []}
              onChange={(ids) => setForm((f) => ({ ...f, target_channels: ids }))}
            />
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
            {!isAmazon && (
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
            )}
          </div>
          {isAmazon && (
            <p className="text-2xs text-white/30 mt-3">אמזון (PA-API) תומך בסינון טווח מחירים בלבד — דירוג/הנחה אינם זמינים דרך ה-API.</p>
          )}

          {/* Minimum rating — enforced against each product's AliExpress feedback score.
              Best-sellers cluster at 4.5–4.9★, so these thresholds actually filter.
              Hidden for Amazon: PA-API doesn't expose a star rating. */}
          {!isAmazon && (
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
          )}
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

        {/* Per-campaign send window in its own timezone — a US-audience Pinterest campaign
            publishes on New-York evening hours while everything else stays on Israel time. */}
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-white">🕐 חלון שליחה מותאם</h2>
            <button
              type="button"
              onClick={() => setUseWindow((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${useWindow ? 'bg-blue-500' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${useWindow ? 'right-0.5' : 'right-4'}`} />
            </button>
          </div>
          <p className="text-2xs text-white/35 mb-4">
            כבוי — הטייס מפרסם לפי חלון השליחה הכללי (הגדרות ← תזמון, שעון ישראל).
            דלוק — הטייס הזה מקבל שעות משלו <b>באזור זמן משלו</b> — למשל ערב בארה&quot;ב לקהל אמריקאי בפינטרסט.
          </p>
          {useWindow && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/50 mb-2">אזור זמן</label>
                <div className="flex gap-2 flex-wrap">
                  {TIMEZONES.map((tz) => {
                    const active = (form.window_tz || 'Asia/Jerusalem') === tz.key;
                    return (
                      <button
                        key={tz.key}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, window_tz: tz.key }))}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all
                          ${active
                            ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40'
                            : 'bg-white/5 text-white/40 border border-edge hover:bg-white/10'}`}
                      >
                        {tz.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">משעה</label>
                  <input
                    type="number" min={0} max={23}
                    value={form.window_start_hour ?? 9}
                    onChange={(e) => setForm((f) => ({ ...f, window_start_hour: Math.max(0, Math.min(23, +e.target.value)) }))}
                    className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">עד שעה</label>
                  <input
                    type="number" min={1} max={24}
                    value={form.window_end_hour ?? 22}
                    onChange={(e) => setForm((f) => ({ ...f, window_end_hour: Math.max(1, Math.min(24, +e.target.value)) }))}
                    className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors"
                    dir="ltr"
                  />
                </div>
              </div>
              <p className="text-2xs text-white/30">
                השעות נקראות באזור הזמן שנבחר. לדוגמה: ניו-יורק 17–22 = שעות הערב החזקות של פינטרסט בארה&quot;ב
                (00:00–05:00 לפנות בוקר בישראל). הרצות של הטייס מחוץ לחלון מדולגות אוטומטית.
              </p>
            </div>
          )}
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
