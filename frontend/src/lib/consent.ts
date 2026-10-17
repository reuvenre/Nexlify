/**
 * The visitor's cookie choices — one record, read by the banner and by every tracker.
 *
 * Categories:
 *  - essential  — what the site needs to work (sign-in session, theme, the choice itself).
 *                 Always on; never asked.
 *  - analytics  — Google Analytics 4. Off until the visitor turns it on.
 *  - marketing  — advertising pixels (Meta, TikTok, Pinterest tag…). The site loads none
 *                 today; the category exists so adding one later cannot skip the question.
 *
 * Nothing non-essential is loaded before a choice: the GA script itself is injected only
 * after analytics is granted (components/Analytics.tsx), not merely told to hold its
 * cookies.
 */

export type ConsentCategory = 'analytics' | 'marketing';

export interface ConsentState {
  v: 2;
  analytics: boolean;
  marketing: boolean;
  /** When the choice was made (ISO). */
  at: string;
}

const KEY = 'nx_consent_v2';
/** The first banner's key: 'granted' | 'denied' (analytics only). */
const LEGACY_KEY = 'nx_cookie_consent';

export const CONSENT_EVENT = 'nx-consent-change';
export const OPEN_PREFERENCES_EVENT = 'nx-open-cookie-preferences';

/** The stored choice, or null when the visitor has not chosen yet. Never throws. */
export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && v.v === 2) return { v: 2, analytics: !!v.analytics, marketing: !!v.marketing, at: String(v.at || '') };
    }
    // The first banner asked about analytics only. Carry that answer over and nothing
    // more: "granted" there never covered advertising.
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'granted' || legacy === 'denied') {
      return { v: 2, analytics: legacy === 'granted', marketing: false, at: '' };
    }
  } catch { /* storage blocked — treat as no choice */ }
  return null;
}

/** Save a choice and tell every listener (trackers, the banner). */
export function saveConsent(choice: { analytics: boolean; marketing: boolean }): ConsentState {
  const state: ConsentState = { v: 2, analytics: !!choice.analytics, marketing: !!choice.marketing, at: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* storage blocked — the choice still applies to this page view */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  return state;
}

/** Reopen the preferences — from a footer link, the privacy page, settings. */
export function openCookiePreferences(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_PREFERENCES_EVENT));
}
