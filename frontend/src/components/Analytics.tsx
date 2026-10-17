'use client';

import { useEffect } from 'react';
import { CONSENT_EVENT, ConsentState, readConsent } from '@/lib/consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

/**
 * Google Analytics 4 — loaded ONLY after the visitor turned analytics on.
 *
 * The first version loaded gtag.js on every page and relied on Consent Mode to hold the
 * cookies back. That still sent requests to Google (cookieless pings with the visitor's
 * IP and page) before any choice, which is exactly what "no non-essential tracking before
 * consent" rules out. Now the script tag does not exist until consent, and withdrawing it
 * switches the tag off for the rest of the visit and clears its cookies.
 */
export function Analytics({ gaId }: { gaId: string }) {
  useEffect(() => {
    if (!gaId) return;
    const apply = (c: ConsentState | null) => {
      if (c?.analytics) enableGa(gaId);
      else disableGa(gaId);
    };
    apply(readConsent());
    const onChange = (e: Event) => apply((e as CustomEvent<ConsentState>).detail);
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, [gaId]);
  return null;
}

function enableGa(id: string) {
  window[`ga-disable-${id}`] = false;
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    // eslint-disable-next-line prefer-rest-params
    window.gtag = function gtag() { window.dataLayer!.push(arguments); };
  }
  if (!document.getElementById('nx-gtag')) {
    window.gtag('consent', 'default', {
      analytics_storage: 'granted',
      // Advertising stays denied: the visitor agreed to analytics, not to ads.
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    const s = document.createElement('script');
    s.id = 'nx-gtag';
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', id, { allow_google_signals: false, allow_ad_personalization_signals: false });
  } else {
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
  }
}

function disableGa(id: string) {
  // Google's documented opt-out switch: the tag stops sending for this page's lifetime.
  window[`ga-disable-${id}`] = true;
  if (typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'denied' });
  clearGaCookies();
}

/** _ga and _ga_<container> on this host and its parent domains. Best effort. */
function clearGaCookies() {
  const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid');
  if (!names.length) return;
  const parts = location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join('.')}`);
  for (const n of names) for (const d of domains) {
    document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`;
  }
}
