/* Tide service worker.
 *
 * Goal: make Tide installable (start_url must respond 200 offline) WITHOUT ever
 * serving a stale Tide Score. Live data comes from Supabase at runtime, so the
 * worker deliberately never touches those requests.
 *
 * Strategy:
 *   - Navigations (HTML)       -> network-first, fall back to a cached shell only
 *                                 when offline. Online users always get fresh HTML.
 *   - Supabase / live data     -> not intercepted at all (never cached).
 *   - Static same-origin assets-> stale-while-revalidate.
 *   - Cross-origin CDN / fonts -> not intercepted (browser HTTP cache handles it).
 *
 * Update flow avoids the "stale shell" trap: no skipWaiting() on install; a new
 * worker only activates when told (SKIP_WAITING) and the page reloads once on
 * controllerchange. sw.js itself is served max-age=0 so updates are picked up.
 */
const CACHE_VERSION = 'tide-v1';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const ASSET_CACHE = CACHE_VERSION + '-assets';
const SHELL_URL = '/index.html';
const PRECACHE = [
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/favicon.png'
];

self.addEventListener('install', (event) => {
  // Precache the offline shell + core assets. No skipWaiting() — see update flow.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE).catch(() => {}) // a missing asset must not abort install
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 1. Never intercept cross-origin (CDN, fonts, analytics) or live data hosts.
  if (url.origin !== self.location.origin) return;
  // Belt-and-braces: never touch anything that looks like an API / live feed.
  if (url.hostname.endsWith('supabase.co') || url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/api/')) return;

  // 2. Navigations -> network-first, cache fallback to the offline shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put(SHELL_URL, fresh.clone()); // refresh the offline shell copy
        return fresh;
      } catch (e) {
        const cached = await caches.match(SHELL_URL);
        return cached || Response.error();
      }
    })());
    return;
  }

  // 3. Static same-origin assets -> stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => cached);
    return cached || network;
  })());
});
