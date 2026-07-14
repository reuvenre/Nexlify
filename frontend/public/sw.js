/* Nexlify service worker.
 *
 * Its ONLY job is installability: Chrome ships a real standalone app (a WebAPK) only for
 * sites that register a service worker with a fetch handler. Without one, "Add to home
 * screen" on Android degrades to a plain shortcut that reopens a browser tab — which is
 * exactly the thing we're trying to avoid.
 *
 * Deliberately NO caching. Nexlify is entirely data-driven (live prices, queue state,
 * post status) and its Next.js chunks are content-hashed per deploy, so a cache here would
 * mostly serve stale JS after a release and show wrong numbers. Network is the source of
 * truth; the offline win isn't worth the staleness bug.
 */

self.addEventListener('install', () => {
  // Take over immediately instead of waiting for every old tab to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentionally empty: not calling respondWith() lets the browser handle the request
  // normally. The handler's presence is what satisfies the installability check.
});
