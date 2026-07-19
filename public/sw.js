/* Sitely service worker — makes the app installable (PWA) and gives an offline shell.
 *
 * Strategy: NETWORK-FIRST for everything, fall back to cache only when offline. This means
 * online users always get fresh code and data (identical to no service worker), while offline
 * users still get the last-seen app shell. API and MCP calls are never cached — data stays live.
 */
const CACHE = 'sitely-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only handle our own GETs. Anything else (POST/PUT, cross-origin) goes straight to the network.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache live data — the app's whole job is fresh jobs/schedules/board.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/mcp')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') { const shell = await caches.match('/'); if (shell) return shell; }
      throw err;
    }
  })());
});
