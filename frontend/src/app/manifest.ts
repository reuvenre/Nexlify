import type { MetadataRoute } from 'next';

/**
 * PWA manifest — lets the site be saved to a phone's home screen and launched like a
 * native app. `display: standalone` is what drops the browser address bar; without it
 * the shortcut would just reopen a normal tab.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nexlify — אוטומציית שיווק שותפים',
    short_name: 'Nexlify', // what fits under the home-screen icon
    description: 'ניהול ופרסום אוטומטי של פוסטים שיווקיים — AliExpress ו-FLYLINK, טלגרם ופייסבוק.',
    lang: 'he',
    dir: 'rtl',
    start_url: '/dashboard',
    // Launching straight into the app shell; the dashboard is what you actually open.
    scope: '/',
    display: 'standalone',
    // No orientation lock: data tables (products, posts) are genuinely easier to read in
    // landscape, and pinning 'portrait' stopped the installed app from rotating at all.
    background_color: '#0b0f1a', // splash screen while the app boots
    theme_color: '#3B82F6',      // Android status-bar tint
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android masks icons to a circle/squircle — the maskable one carries a safe-zone
      // inset so the "N" is never clipped.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'פוסט מהיר', short_name: 'פוסט מהיר', url: '/quick-post' },
      { name: 'תור הפוסטים', short_name: 'תור', url: '/posts' },
      { name: 'ספקים', short_name: 'ספקים', url: '/suppliers' },
    ],
  };
}
