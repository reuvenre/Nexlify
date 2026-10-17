'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Store } from 'lucide-react';
import { storefrontApi } from '@/lib/api-client';
import type { StorefrontSettings } from '@/types';

import { FormField } from '@/components/common/FormField';
/**
 * The owner's storefront: name it, address it, switch it on.
 *
 * Off until switched on, deliberately — the store publishes the whole catalog and its
 * prices to anyone with the link, and that is not a thing to start doing by default.
 */

/**
 * The same defaults the API falls back to (backend/src/storefront/store-defaults.ts).
 * Repeated here so the box shows the owner the real text he is about to publish rather
 * than a grey placeholder he has to guess at — and so "reset" has something to restore.
 */
const DEFAULT_SHIPPING = [
  'משלוח מהיר עד הדואר הקרוב אליכם. משלוחים מותאמים אישית בהתאם לפלטפורמה הנבחרת. מעקב הזמנה זמין.',
  '',
  'שאלה: איך ניתן לבדוק את סטטוס המשלוח שלי?',
  'תשובה: לאחר ביצוע הרכישה תקבלו אישור הזמנה עם מספר הזמנה. בהמשך יישלח אליכם מספר מעקב למייל שהוזן בעת הקנייה.',
  '',
  'אם לאחר כמה ימים לא קיבלתם מייל עם פרטי המעקב, כדאי לבדוק בתיקיית הספאם, או להיכנס לאזור האישי באתר https://my.flylinking.com/ ולבדוק אם מספר המעקב כבר מופיע שם.',
  '',
  'ניתן לעקוב אחר מצב החבילה באמצעות הזנת מספר המעקב באתר https://www.17track.net/en',
].join('\n');

const DEFAULT_DETAILS =
  'איכות זהה למקור. שימו לב שאתם בוחרים את הדגם והמידה הנכונה — לא יינתנו החזרים עקב טעות בבחירה.';

function ResetToDefault({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-1.5 text-2xs text-white/35 hover:text-white/70 underline">
      החזר לנוסח ברירת המחדל
    </button>
  );
}

export function StorefrontForm() {
  const [store, setStore] = useState<StorefrontSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setStore(await storefrontApi.get());
    } catch {
      setError('טעינת החנות נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof StorefrontSettings>(key: K, value: StorefrontSettings[K]) =>
    setStore((s) => (s ? { ...s, [key]: value } : s));

  const save = async () => {
    if (!store) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const next = await storefrontApi.update({
        slug: store.slug,
        name: store.name,
        tagline: store.tagline,
        enabled: store.enabled,
        link_in_posts: store.link_in_posts,
        whatsapp: store.whatsapp,
        shipping_text: store.shipping_text,
        details_text: store.details_text,
        sources: store.sources,
      });
      setStore(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!store) return;
    try {
      await navigator.clipboard.writeText(store.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the address is on screen to copy by hand */ }
  };

  const toggleSource = (key: 'suppliers' | 'posts') => {
    if (!store) return;
    const current = store.sources.split(',').filter(Boolean);
    const next = current.includes(key) ? current.filter((s) => s !== key) : [...current, key];
    if (!next.length) return;   // one source must stay on; the store would be empty
    set('sources', next.join(','));
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-400" /></div>;
  if (!store) return <p className="text-sm text-red-400">{error || 'לא ניתן לטעון את החנות'}</p>;

  const sources = store.sources.split(',');

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface-secondary p-4">
        <Store className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-sm text-white/60 leading-relaxed">
          חנות ציבורית שמרכזת את כל המוצרים שאתה מפרסם. עוקב שגלל ופספס דיל לא יכול למצוא אותו
          שוב בפיד — כאן הוא כן. הוסף את הכתובת לפוסטים, ומי שנכנס למוצר אחד יראה את כל השאר.
          <span className="block mt-1 text-white/40">
            קליקים מהחנות נספרים למוח הלומד בדיוק כמו קליקים מהקבוצות.
          </span>
        </div>
      </div>

      <label className="flex items-center justify-between rounded-xl border border-edge bg-surface-secondary p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={store.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
          className="w-5 h-5 accent-blue-600"
        />
        <div className="text-right">
          <div className="text-sm font-medium text-white">החנות פעילה</div>
          <div className="text-xs text-white/40">כשכבויה, הכתובת מחזירה &quot;החנות לא נמצאה&quot; והקישור יורד מהפוסטים</div>
        </div>
      </label>

      {/* Two decisions, two switches: whether the shop exists, and whether the channels
          advertise it. Turning the shop off to get clean posts would also break every
          address already printed in older posts. */}
      <label className="flex items-center justify-between rounded-xl border border-edge bg-surface-secondary p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={store.link_in_posts !== false}
          onChange={(e) => set('link_in_posts', e.target.checked)}
          className="w-5 h-5 accent-blue-600"
        />
        <div className="text-right">
          <div className="text-sm font-medium text-white">הוסף קישור לחנות בפוסטים</div>
          <div className="text-xs text-white/40">
            כשכבוי, הפוסטים יוצאים בלי שורת החנות — החנות עצמה נשארת פעילה ופתוחה בכתובת שלה
          </div>
        </div>
      </label>

      <Field label="כתובת החנות" hint="אותיות באנגלית, ספרות ומקפים. הכתובת מודפסת לפוסטים — כדאי לקבוע אותה פעם אחת.">
        <div className="flex items-center gap-2" dir="ltr">
          <input
            value={store.slug}
            onChange={(e) => set('slug', e.target.value.toLowerCase())}
            className="flex-1 bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50 font-mono"
          />
          <span className="text-xs text-white/30 shrink-0">/s/</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button onClick={copyUrl} className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'הועתק' : 'העתק כתובת'}
          </button>
          <a href={store.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
            <ExternalLink size={12} /> פתח
          </a>
          <span className="text-xs text-white/25 truncate" dir="ltr">{store.url}</span>
        </div>
      </Field>

      <Field label="שם החנות" hint="מופיע ככותרת בראש האתר">
        <input value={store.name} onChange={(e) => set('name', e.target.value)}
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50" />
      </Field>

      <Field label="שורת תיאור (אופציונלי)" hint="שורה אחת מתחת לשם, בתחתית העמוד">
        <input value={store.tagline || ''} onChange={(e) => set('tagline', e.target.value)}
          placeholder="מבחר יוקרתי"
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50" />
      </Field>

      <Field label="וואטסאפ לפניות (אופציונלי)" hint="עם קידומת מדינה, למשל 972501234567 — מוסיף כפתור &quot;התייעץ בוואטסאפ&quot;">
        <input value={store.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value)}
          placeholder="972501234567" dir="ltr"
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50 font-mono" />
      </Field>

      <Field label="אילו מוצרים יופיעו">
        <div className="space-y-2">
          <SourceToggle
            on={sources.includes('suppliers')}
            onChange={() => toggleSource('suppliers')}
            title="קטלוג הספקים"
            desc="המותגים המוסתרים — כל מוצר עם קישור FLYLINK, גם אם עדיין לא פורסם"
          />
          <SourceToggle
            on={sources.includes('posts')}
            onChange={() => toggleSource('posts')}
            title="מה שפורסם לקבוצות"
            desc="כל דיל שיצא לערוצים, מוצר אחד לכל פריט גם אם פורסם כמה פעמים"
          />
        </div>
      </Field>

      <Field
        label="טקסט משלוח"
        hint="נפתח באקורדיון בכל דף מוצר. אם תשאיר ריק — יוצג נוסח ברירת המחדל שמופיע כאן."
      >
        <textarea value={store.shipping_text ?? DEFAULT_SHIPPING} onChange={(e) => set('shipping_text', e.target.value)}
          rows={8}
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50" />
        <ResetToDefault onClick={() => set('shipping_text', DEFAULT_SHIPPING)} />
      </Field>

      <Field
        label="פרטי מוצר"
        hint="איכות, מידות ומדיניות החזרות. נפתח פתוח בדף המוצר — זו השאלה הראשונה של קונה."
      >
        <textarea value={store.details_text ?? DEFAULT_DETAILS} onChange={(e) => set('details_text', e.target.value)}
          rows={3}
          className="w-full bg-white/5 border border-edge-hover rounded-lg px-3 py-2.5 text-sm text-white/80 outline-none focus:border-blue-500/50" />
        <ResetToDefault onClick={() => set('details_text', DEFAULT_DETAILS)} />
      </Field>

      {error && <div className="flex items-center gap-2 text-xs text-red-400"><AlertTriangle size={13} /> {error}</div>}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} שמור
        </button>
        {saved && <span className="text-xs text-emerald-400">נשמר</span>}
      </div>
    </div>
  );
}

function SourceToggle({ on, onChange, title, desc }: {
  on: boolean; onChange: () => void; title: string; desc: string;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-edge bg-surface-secondary p-3 cursor-pointer">
      <input type="checkbox" checked={on} onChange={onChange} className="w-4 h-4 mt-0.5 accent-blue-600" />
      <div className="text-right flex-1">
        <div className="text-sm text-white">{title}</div>
        <div className="text-xs text-white/40">{desc}</div>
      </div>
    </label>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <FormField label={label} hint={hint} labelClassName="block text-xs font-medium text-white/50 mb-1.5" hintClassName="text-2xs text-white/30 mt-1.5">
      {children}
    </FormField>
  );
}
