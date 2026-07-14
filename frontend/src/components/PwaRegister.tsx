'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker so the app is installable to a phone's home screen.
 * Silent by design — a registration failure must never surface to the user, since the
 * app works fine without it (they just lose the standalone launch on Android).
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Register after load so it never competes with the app's first paint.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
