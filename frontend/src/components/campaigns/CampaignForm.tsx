'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus, X, Loader2, Save, Search, Package, ShoppingCart } from 'lucide-react';
import { channelsApi, credentialsApi, suppliersApi } from '@/lib/api-client';
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

/**
 * The window we recommend per audience — Pinterest's hot hours, adjusted so the run count
 * stays the SAME in summer and winter time.
 *
 * Why the adjustment matters: a campaign's frequency ("every 3 hours") is counted on the
 * server clock (UTC), while this window is read in the zone chosen above. When the two drift
 * apart by an hour at the DST switch, a run that used to land inside the window falls out of
 * it — and the campaign quietly publishes a third less, with nothing to show for it. Each
 * window below was picked so the every-3-hours runs land inside it in BOTH offsets.
 */
const RECOMMENDED_WINDOWS: Record<string, { start: number; end: number; why: string }> = {
  'Asia/Jerusalem':      { start: 15, end: 23, why: 'אחר הצהריים עד הלילה — שעות הגלישה החזקות בישראל' },
  'America/New_York':    { start: 16, end: 23, why: 'שעות הערב החזקות של פינטרסט בארה״ב (החוף המזרחי)' },
  'America/Chicago':     { start: 15, end: 23, why: 'ערב במרכז ארה״ב, ותופס גם את ערב החוף המזרחי' },
  'America/Denver':      { start: 15, end: 23, why: 'אחה״צ־ערב באזור ההרים' },
  'America/Los_Angeles': { start: 16, end: 23, why: 'ערב בחוף המערבי — שיא הגלישה בפינטרסט' },
  'Europe/London':       { start: 15, end: 23, why: 'אחה״צ־ערב בבריטניה' },
};

/**
 * `everyMin` is how often the cron actually fires, and it exists because the cadence a
 * campaign is SET to is not always the cadence it PUBLISHES at: a campaign targeting a
 * Telegram group is paced by that group's interval, so a half-hourly campaign on a
 * one-per-hour group publishes hourly. The form compares the two and says so — the
 * alternative is what happened, which is the owner setting "כל חצי שעה", watching hourly
 * posts, and having nothing on screen explain the gap.
 */
const CRON_PRESETS = [
  { label: 'כל רבע שעה',     value: '*/15 * * * *', everyMin: 15 },
  { label: 'כל חצי שעה',     value: '*/30 * * * *', everyMin: 30 },
  { label: 'כל שעה',         value: '0 * * * *',    everyMin: 60 },
  // The step between hourly and 3-hourly was missing, and it is the one a Pinterest
  // campaign wants: the board grows on pin VOLUME spread through the day, while hourly
  // outruns the supply of fresh products (the user-wide dedup skips anything already
  // published) and doubles credit burn for runs that return nothing.
  { label: 'כל שעתיים',      value: '0 */2 * * *', everyMin: 120 },
  { label: 'כל 3 שעות',      value: '0 */3 * * *', everyMin: 180 },
  { label: 'כל 6 שעות',      value: '0 */6 * * *', everyMin: 360 },
  { label: 'פעם ביום (9:00)', value: '0 9 * * *',  everyMin: 1440 },
  { label: 'פעמיים ביום',     value: '0 9,21 * * *', everyMin: 720 },
  { label: 'פעם בשבוע',       value: '0 9 * * 1',  everyMin: 10080 },
];

/** Mirrors the backend's pacingIntervalMinutes: the group's own setting, else the
 *  account's, else an hour. */
function pacingInterval(group: number | null | undefined, account: number | null | undefined): number {
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && v > 0;
  return ok(group) ? group : ok(account) ? account : 60;
}

/** Minutes as the owner would say them: "45 דקות", "שעה", "שעתיים", "3 שעות". */
function minutesLabel(min: number): string {
  if (min < 60) return `${min} דקות`;
  if (min === 60) return 'שעה';
  if (min === 120) return 'שעתיים';
  if (min % 60 === 0) return `${min / 60} שעות`;
  return `${min} דקות`;
}

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
  // What each group is paced at, and what the account is paced at — the two numbers that
  // decide whether this campaign's chosen cadence is the cadence it will actually publish
  // at. Keyed by channel_id, which is what target_channels holds.
  const [groupIntervals, setGroupIntervals] = useState<Record<string, number | null>>({});
  const [accountInterval, setAccountInterval] = useState<number | null>(null);
  /** Supplier catalogs and the group each one is linked to — the FLYLINK shelf map. */
  const [catalogs, setCatalogs] = useState<{ id: string; name: string; target_channel_id: string }[]>([]);
  // Custom send window: on when the campaign already carries one (edit mode).
  const [useWindow, setUseWindow] = useState(
    initial.window_start_hour != null || initial.window_end_hour != null || !!initial.window_tz,
  );

  // What this campaign is SET to, and what it will actually PUBLISH at.
  //
  // The runner paces a Telegram-publishing campaign against its FIRST target group (see
  // nextGroupSlot) — so that group's interval, not the cron, is the real floor. A campaign
  // with no group, or one filtered to platforms other than Telegram, runs on its cron alone.
  const cronMin = CRON_PRESETS.find((p) => p.value === form.schedule_cron)?.everyMin ?? 60;
  const pacingChannelId = (form.target_channels ?? [])[0];
  const pacedByGroup = !!pacingChannelId
    && (!form.target_platforms?.length || form.target_platforms.includes('telegram'));
  const groupPacing = pacedByGroup
    ? pacingInterval(groupIntervals[pacingChannelId], accountInterval)
    : null;
  const effectiveMin = Math.max(cronMin, groupPacing ?? 0);
  const throttled = effectiveMin > cronMin;
  const pacingGroupName = channels.find((c) => c.channel_id === pacingChannelId)?.name || 'שנבחרה';

  const source: CampaignSource = form.source ?? 'aliexpress';
  const isFlylink = source === 'flylink';
  const isAmazon = source === 'amazon';
  const needsKeywords = !isFlylink;            // AliExpress + Amazon keyword-search
  const needsGroups = isFlylink || isAmazon;   // FLYLINK + Amazon require a target group
  // The commercial calendar injects SEARCH terms, and only the AliExpress runner searches:
  // FLYLINK rotates a linked catalog (it has no search API at all) and Amazon walks its own
  // cursor. Offering the toggle there was a control that changed nothing — it sat on for a
  // FLYLINK campaign through a whole Tishrei window while 36 posts went out with no seasonal
  // product among them, and nothing said why.
  const canUseSeasonal = !isFlylink && !isAmazon;

  // WHICH SHELF this autopilot rotates. A catalog linked to a group belongs to that group,
  // and only a campaign publishing there may draw from it; an unlinked catalog belongs to
  // nobody in particular and stays open to all. Mirrors catalogsForCampaign on the server —
  // shown here so the answer is visible at edit time rather than read off where posts landed.
  const chosenGroups = form.target_channels ?? [];
  const rotatedCatalogs = catalogs.filter((c) => !c.target_channel_id || chosenGroups.includes(c.target_channel_id));
  const otherCatalogs = catalogs.filter((c) => c.target_channel_id && !chosenGroups.includes(c.target_channel_id));

  // Groups are only needed to pick FLYLINK targets, but loading them upfront keeps the
  // toggle instant.
  useEffect(() => {
    channelsApi.list()
      .then((list) => {
        setChannels(list.map((c) => ({ id: c.id, name: c.name, channel_id: c.channel_id })));
        const intervals: Record<string, number | null> = {};
        for (const c of list) intervals[c.channel_id] = c.schedule_interval_minutes ?? null;
        setGroupIntervals(intervals);
      })
      .catch(() => setChannels([]));
    credentialsApi.get()
      .then((c) => setAccountInterval(c.schedule_interval_minutes ?? null))
      .catch(() => {});
    // Supplier catalogs decide WHICH products a FLYLINK autopilot may rotate — a catalog
    // linked to a group is that group's shelf. Load them so the screen can say so before a
    // save, instead of the owner discovering it from where the posts landed.
    suppliersApi.listCatalogs()
      .then((list) => setCatalogs(list.map((c) => ({
        id: c.id, name: c.name, target_channel_id: c.target_channel_id || '',
      }))))
      .catch(() => setCatalogs([]));
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
      // seasonal_keywords is cleared for the sources that cannot act on it — otherwise a
      // campaign switched over from AliExpress keeps a stored `true` behind a hidden toggle,
      // which is the same lie one layer down: nothing shows it, nothing honours it, and
      // nothing can be switched off to explain why no seasonal products appear.
      const base: CampaignInput = isFlylink
        ? { ...form, source: 'flylink', keywords: [], min_price: undefined, max_price: undefined, min_discount: undefined, seasonal_keywords: false }
        : isAmazon
          ? { ...form, source: 'amazon', target_channels: form.target_channels ?? [], min_discount: undefined, min_rating: undefined, seasonal_keywords: false }
          : { ...form, source: 'aliexpress', target_channels: form.target_channels ?? [] };
      // Custom window off → explicit nulls so a previously-saved window is CLEARED,
      // not silently kept. On → store ONLY what the user actually picked: an hour left on
      // "ירושה" stays null and keeps inheriting. The old `?? 9` / `?? 22` here was the same
      // trap as the group card — the toggle self-enables for a campaign that has only a
      // timezone, and any save then silently wrote 9–22 as the campaign's window, which
      // outranks both the group's hours and the account's. A form must not invent settings.
      const payload: CampaignInput = {
        ...base,
        ...(useWindow
          ? {
              // The tz default is visible, not silent — the buttons show Jerusalem active.
              window_tz: form.window_tz || 'Asia/Jerusalem',
              window_start_hour: form.window_start_hour ?? null,
              window_end_hour: form.window_end_hour ?? null,
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

            {/* Which catalogs this autopilot will actually rotate. Until the server honoured
                the catalog's linked group, a FLYLINK campaign drew from EVERY catalog — so
                the tactical autopilot published brand items to the tactical group and the
                dedup then locked the mama campaign out of them. */}
            {isFlylink && catalogs.length > 0 && (
              <div className="mt-4 pt-4 border-t border-edge">
                <p className="text-2xs text-white/40 mb-2">קטלוגים שהטייס הזה יסובב:</p>
                {rotatedCatalogs.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {rotatedCatalogs.map((c) => (
                      <span key={c.id} className="text-2xs bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 rounded-lg px-2.5 py-1">
                        {c.name}{!c.target_channel_id && ' · לא מקושר לקבוצה'}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-2xs text-amber-400">
                    אף קטלוג לא מקושר לקבוצות שבחרת — הטייס לא ימצא מוצרים לפרסום. קשר קטלוג
                    לקבוצה במסך הספקים, או נקה שם את &quot;קבוצה מקושרת&quot; כדי לפתוח אותו לכל הטייסים.
                  </p>
                )}
                {otherCatalogs.length > 0 && (
                  <p className="text-2xs text-white/30 mt-2">
                    לא ייגע ב: {otherCatalogs.map((c) => c.name).join(', ')} — מקושרים לקבוצות אחרות.
                  </p>
                )}
              </div>
            )}
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

              {/* THE GAP BETWEEN THE SETTING AND REALITY.
                  A campaign publishing to a Telegram group is paced by that GROUP's interval
                  — deliberately, it is what stops two campaigns on one group from colliding.
                  But it means the cadence chosen here is a ceiling, not a promise, and
                  nothing said so: the owner set "כל חצי שעה", watched hourly posts, and had
                  no way to find out why. Now the form does the same arithmetic the runner
                  does and reports the number that will actually happen. */}
              {throttled && (
                <p className="text-2xs text-amber-400/90 mt-1.5 leading-relaxed">
                  ⚠️ בפועל יפרסם <b>כל {minutesLabel(effectiveMin)}</b>, לא כל {minutesLabel(cronMin)} —
                  הקבוצה <b>{pacingGroupName}</b> מוגדרת למרווח של {minutesLabel(effectiveMin)} בין פוסטים,
                  והיא זו שקובעת. כדי שהקצב כאן ייכנס לתוקף, שנה את המרווח של הקבוצה במסך
                  <b> קבוצות</b> (או את המרווח הכללי ב<b>הגדרות ← תזמון</b>).
                </p>
              )}

              {/* A fast cadence is a legitimate choice — but it multiplies both the credit
                  burn and the demand for FRESH products (the user-wide dedup skips anything
                  already published), so the daily number belongs on screen BEFORE saving,
                  not on the invoice. Counted at the EFFECTIVE cadence, so it never promises
                  posts the group's pacing will not allow. */}
              {effectiveMin < 60 && !throttled && (
                <p className="text-2xs text-amber-400/80 mt-1.5 leading-relaxed">
                  ⚡ קצב מהיר — בחלון של 9:00–22:00 זה כ־
                  <b>{Math.round((13 * 60) / effectiveMin) * Math.max(1, Number(form.posts_per_run) || 1)}</b>{' '}
                  פוסטים ביום מהקמפיין הזה. כל פוסט צורך קרדיט, וצריך מספיק מוצרים חדשים —
                  מוצר שכבר פורסם לא יחזור.
                </p>
              )}
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

        {/* Seasonal search keywords: opt-in, because they change WHICH products are found.
            A niche channel does not want beach gear in July just because it is summer.
            AliExpress only — see canUseSeasonal: the other sources never search. */}
        {canUseSeasonal && (
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0 pl-4">
              <h2 className="text-sm font-semibold text-white">🗓️ מילות מפתח עונתיות</h2>
              <p className="text-xs text-white/35 mt-1">
                בתקופת חג או עונה, הלוח המסחרי יוסיף לרוטציה של הקמפיין הזה מילות חיפוש
                מתאימות (למשל "אביזרי ים ובריכה" בקיץ). מומלץ רק לקמפיינים כלליים —
                בערוץ ממוקד נושא זה יביא מוצרים לא קשורים.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, seasonal_keywords: !f.seasonal_keywords }))}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${form.seasonal_keywords ? 'bg-blue-500' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.seasonal_keywords ? 'right-0.5' : 'right-4'}`} />
            </button>
          </div>
        </div>
        )}

        {/* Order-driven learning. Off by default and per-campaign for the same reason the
            seasonal toggle is: the winning categories are learned from ALL orders on the
            account, including traffic the autopilot never posted, so a top earner can be
            plainly off-brand for one channel. The winners appear in the daily digest either
            way — only adding them to this campaign's rotation is opt-in. */}
        <div className="bg-surface-secondary border border-edge rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0 pl-4">
              <h2 className="text-sm font-semibold text-white">💰 לימוד מהזמנות</h2>
              <p className="text-xs text-white/35 mt-1">
                המנוע הלומד יבדוק כל בוקר אילו קטגוריות באמת הניבו מכירות, ויוסיף את
                המרוויחות ביותר לרוטציה של הקמפיין הזה (עד 2 ביום, ולא מילה שהוצאה בעבר).
                הקטגוריות המנצחות מדווחות בדו"ח היומי בכל מקרה — גם כשזה כבוי.
                שים לב: הלמידה היא חשבונית, ולכן קטגוריה מנצחת עלולה לא להתאים לערוץ ממוקד.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, learn_from_orders: !f.learn_from_orders }))}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${form.learn_from_orders ? 'bg-blue-500' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.learn_from_orders ? 'right-0.5' : 'right-4'}`} />
            </button>
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
                  <select
                    value={form.window_start_hour ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, window_start_hour: e.target.value === '' ? null : +e.target.value }))}
                    className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors appearance-none cursor-pointer"
                    dir="ltr"
                  >
                    {/* Inherit is the DEFAULT. Preselecting 09:00 here is how a campaign
                        with only a timezone silently gained a 9–22 window on save. */}
                    <option value="">ירושה (קבוצה/כללי)</option>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">עד שעה</label>
                  <select
                    value={form.window_end_hour ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, window_end_hour: e.target.value === '' ? null : +e.target.value }))}
                    className="w-full bg-white/5 border border-edge-hover rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-blue-500/60 transition-colors appearance-none cursor-pointer"
                    dir="ltr"
                  >
                    <option value="">ירושה (קבוצה/כללי)</option>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                      <option key={h} value={h}>{h === 24 ? '24:00 (חצות)' : `${String(h).padStart(2, '0')}:00`}</option>
                    ))}
                  </select>
                </div>
              </div>
              {form.window_start_hour != null && form.window_end_hour != null
                && form.window_end_hour <= form.window_start_hour && (
                <p className="text-2xs text-red-400">⚠️ &quot;עד שעה&quot; חייבת להיות אחרי &quot;משעה&quot; — אחרת החלון לא יגביל כלום.</p>
              )}
              {/* The recommendation for the CHOSEN audience — hot hours, and a window whose
                  run count doesn't shrink at the DST switch (see RECOMMENDED_WINDOWS). */}
              {(() => {
                const tzKey = form.window_tz || 'Asia/Jerusalem';
                const rec = RECOMMENDED_WINDOWS[tzKey];
                if (!rec) return null;
                const applied = form.window_start_hour === rec.start && form.window_end_hour === rec.end;
                return (
                  <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2.5">
                    <span className="text-sm leading-none mt-0.5">💡</span>
                    <div className="flex-1">
                      <p className="text-2xs text-white/60">
                        {/* Spelled out as "from X until Y" rather than a dash range: inside
                            right-to-left text a range reads backwards to half the people who
                            see it, and "is it 16 to 23 or 23 to 16?" is not a question a hint
                            should provoke. */}
                        מומלץ לקהל הזה: <b className="text-blue-400">משעה {String(rec.start).padStart(2, '0')}:00</b>
                        {' '}<b className="text-blue-400">עד שעה {String(rec.end).padStart(2, '0')}:00</b>
                        {' '}— {rec.why}.
                      </p>
                      <p className="text-2xs text-white/30 mt-1">
                        החלון הזה נבחר גם כך שמספר ההרצות היומי יישאר זהה בשעון קיץ ובשעון חורף.
                      </p>
                    </div>
                    {applied ? (
                      <span className="text-2xs text-green-400 whitespace-nowrap mt-0.5">מוגדר ✓</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({
                          ...f, window_start_hour: rec.start, window_end_hour: rec.end,
                        }))}
                        className="text-2xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap mt-0.5"
                      >
                        החל
                      </button>
                    )}
                  </div>
                );
              })()}
              <p className="text-2xs text-white/30">
                השעות נקראות באזור הזמן שנבחר. למשל, חלון שמתחיל ב-16:00 ומסתיים ב-23:00 בניו-יורק
                מתרחש בישראל בין 23:00 ל-06:00 לפנות בוקר. הרצות של הטייס מחוץ לחלון מדולגות אוטומטית.
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
