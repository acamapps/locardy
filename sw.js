// Service worker: lets the page open offline.
// Only the page itself (and its icon) is cached. Photos live in IndexedDB, not here.
// If you change index.html, bump the version number below so phones pick up the new page.
const CACHE = 'quick-photos-v6';
const PAGE = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', PAGE, './apple-touch-icon.png', './manifest.json']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Open from cache instantly, and refresh the cached copy in the background when online.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match(PAGE) : null);

      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || new Response('Offline', { status: 503 });
    })
  );
});
