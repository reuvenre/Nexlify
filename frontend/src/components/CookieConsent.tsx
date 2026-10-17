'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { OPEN_PREFERENCES_EVENT, readConsent, saveConsent } from '@/lib/consent';

/**
 * Cookie consent: a first-layer banner and a preferences dialog.
 *
 * Built to carry no dark patterns:
 *  - "אישור הכל", "דחיית הכל" and "בחירה אישית" are the same size, weight and colour, so
 *    refusing takes exactly one click, like accepting. (The first version painted accept
 *    solid blue and reject grey.)
 *  - No category is pre-ticked; the dialog opens on the visitor's current choice.
 *  - The page stays usable behind the banner — nothing is held hostage to a click.
 *  - The choice can be changed at any time (footer «הגדרות עוגיות», the privacy page),
 *    through openCookiePreferences().
 * Nothing non-essential runs before the choice (lib/consent.ts, components/Analytics.tsx).
 *
 * Themed with the design TOKENS: the banner floats over light marketing pages and the dark
 * dashboard alike, and `text-white` is not white in the light theme (globals.css).
 */

const btn = 'px-4 py-2 rounded-xl text-sm font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500';
const btnStyle = { color: 'var(--text)', background: 'var(--bg-tertiary)', borderColor: 'var(--border)' } as const;

export function CookieConsent() {
  const [banner, setBanner] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const c = readConsent();
    if (!c) setBanner(true);
    const open = () => {
      const now = readConsent();
      setAnalytics(!!now?.analytics);
      opener.current = document.activeElement as HTMLElement | null;
      setPrefsOpen(true);
    };
    window.addEventListener(OPEN_PREFERENCES_EVENT, open);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, open);
  }, []);

  const decide = useCallback((choice: { analytics: boolean }) => {
    saveConsent({ analytics: choice.analytics, marketing: false });
    setBanner(false);
    setPrefsOpen(false);
    opener.current?.focus?.();
  }, []);

  const openPrefs = () => {
    setAnalytics(!!readConsent()?.analytics);
    opener.current = document.activeElement as HTMLElement | null;
    setPrefsOpen(true);
  };

  return (
    <>
      {banner && !prefsOpen && (
        <section
          role="region"
          aria-label="הסכמה לשימוש בעוגיות"
          dir="rtl"
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border backdrop-blur p-4 sm:p-5"
          style={{
            background: 'color-mix(in srgb, var(--bg-secondary) 97%, transparent)',
            borderColor: 'var(--border)',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text)' }}>
            האתר משתמש בעוגיות הכרחיות כדי לפעול (למשל כדי שתישאר מחובר). בהסכמתך בלבד נפעיל גם
            עוגיות <b>אנליטיקה</b> (Google Analytics) שעוזרות לנו להבין איך משתמשים באתר. האתר לא משתמש
            בעוגיות פרסום. פרטים ב<Link href="/privacy#cookies" className="underline text-blue-600 hover:text-blue-500">מדיניות הפרטיות</Link>.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => decide({ analytics: true })} className={btn} style={btnStyle}>אישור הכל</button>
            <button type="button" onClick={() => decide({ analytics: false })} className={btn} style={btnStyle}>דחיית הכל</button>
            <button type="button" onClick={openPrefs} className={btn} style={btnStyle}>בחירה אישית</button>
          </div>
        </section>
      )}
      {prefsOpen && (
        <PreferencesDialog
          analytics={analytics}
          onAnalytics={setAnalytics}
          onSave={() => decide({ analytics })}
          onAcceptAll={() => decide({ analytics: true })}
          onRejectAll={() => decide({ analytics: false })}
          onClose={() => { setPrefsOpen(false); opener.current?.focus?.(); }}
        />
      )}
    </>
  );
}

function PreferencesDialog({ analytics, onAnalytics, onSave, onAcceptAll, onRejectAll, onClose }: {
  analytics: boolean; onAnalytics: (v: boolean) => void;
  onSave: () => void; onAcceptAll: () => void; onRejectAll: () => void; onClose: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  const box = useRef<HTMLDivElement>(null);

  // Focus moves into the dialog, Escape closes it, and Tab stays inside while it is open.
  useEffect(() => {
    const el = box.current;
    el?.querySelector<HTMLElement>('input:not([disabled]), button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border p-5"
        style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-elevated)', color: 'var(--text)' }}
      >
        <h2 id={titleId} className="text-base font-semibold mb-1">הגדרות עוגיות</h2>
        <p id={descId} className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          בחר אילו סוגי עוגיות לאפשר. אפשר לשנות את הבחירה בכל עת דרך «הגדרות עוגיות» בתחתית האתר.
        </p>

        <Category
          title="הכרחיות"
          checked disabled
          note="תמיד פעילות"
          text="נדרשות כדי שהאתר יעבוד: שמירת ההתחברות (עוגיית refresh_token מאובטחת, 30 יום), ערכת הצבעים שבחרת, ותיעוד בחירת העוגיות עצמה."
        />
        <Category
          title="אנליטיקה"
          checked={analytics}
          onChange={onAnalytics}
          text="Google Analytics 4 (Google LLC): מודד ביקורים ושימוש באתר כדי לשפר אותו. עוגיות _ga ו-_ga_* (עד שנתיים). כבוי עד שתאשר. בלי פרסום מותאם ובלי Google Signals."
        />
        <Category
          title="שיווק ופרסום"
          checked={false} disabled
          note="לא בשימוש"
          text="האתר לא מפעיל כיום פיקסלים או עוגיות פרסום (Meta, TikTok, Pinterest ודומיהם). אם יתווספו, נבקש את הסכמתך לפני כן."
        />

        <div className="flex flex-wrap gap-2 mt-5">
          <button type="button" onClick={onSave} className={btn} style={btnStyle}>שמירת הבחירה</button>
          <button type="button" onClick={onRejectAll} className={btn} style={btnStyle}>דחיית הכל</button>
          <button type="button" onClick={onAcceptAll} className={btn} style={btnStyle}>אישור הכל</button>
          <button type="button" onClick={onClose} className={`${btn} ms-auto`} style={btnStyle}>סגירה</button>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          <Link href="/privacy#cookies" className="underline">פירוט מלא במדיניות הפרטיות</Link>
        </p>
      </div>
    </div>
  );
}

function Category({ title, text, checked, disabled, note, onChange }: {
  title: string; text: string; checked: boolean; disabled?: boolean; note?: string; onChange?: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-describedby={`${id}-text`}
        className="mt-1 h-4 w-4 accent-blue-600 shrink-0"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {title}{note && <span className="text-xs font-normal ms-2" style={{ color: 'var(--text-muted)' }}>({note})</span>}
        </label>
        <p id={`${id}-text`} className="text-xs leading-relaxed mt-0.5" style={{ color: 'var(--text-muted)' }}>{text}</p>
      </div>
    </div>
  );
}

/** «הגדרות עוגיות» — reopens the preferences. For footers and the privacy page. */
export function CookieSettingsButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT))}
      className={className}
      style={style}
    >
      הגדרות עוגיות
    </button>
  );
}
