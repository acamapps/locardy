// Service worker: lets Locardy open instantly, even with poor or no signal.
// Only the page itself and its icons are saved here. Your photos live in IndexedDB, not here.
// If you change index.html, bump the version number below so phones pick up the new page.
const CACHE = 'quick-photos-v10';
const PAGE = './index.html';
const MUST_HAVE = ['./', PAGE];
const NICE_TO_HAVE = ['./apple-touch-icon.png', './icon-192.png', './icon-512.png', './manifest.json'];

const NETWORK_TIMEOUT = 4000;      // with no saved copy, wait this long for the network, then give up
const BACKGROUND_TIMEOUT = 10000;  // quiet background refreshes give up after this long

// A fetch that gives up after a set time instead of hanging on a bad connection
function fetchWithTimeout(request, ms, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The page itself must be saved, or this install is abandoned and the old version keeps running
    await cache.addAll(MUST_HAVE);
    // Icons are a bonus: a failure here should not stop the install
    await Promise.all(NICE_TO_HAVE.map((url) => cache.add(url).catch(() => {})));
  })());
  self.skipWaiting();
});

// Only ever delete this app's own old caches, never another app's on the same site
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('quick-photos-') && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Quietly fetch a fresh copy for next time. The user never waits for this.
async function refresh(url) {
  try {
    const res = await fetchWithTimeout(url, BACKGROUND_TIMEOUT, { cache: 'no-cache' });
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(url, res.clone());
      if (url === PAGE) await cache.put('./', res.clone());
    }
  } catch (err) {
    // No signal: keep using the saved copy
  }
}

const OFFLINE_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<title>Locardy</title></head>' +
  '<body style="margin:0;background:#0b0b0c;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
  'text-align:center;padding:30vh 24px 0">' +
  '<h2 style="margin:0 0 8px">Locardy</h2>' +
  '<p style="color:#8e8e93;margin:0 0 24px">Can\u2019t load right now. Check your signal and try again.</p>' +
  '<button onclick="location.reload()" style="font-size:1rem;font-weight:600;padding:14px 28px;border:0;' +
  'border-radius:22px;background:#0a84ff;color:#fff">Try again</button></body></html>';

async function handleNavigation(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(PAGE);

  if (saved) {
    event.waitUntil(refresh(PAGE));   // update quietly for next time
    return saved;                     // and open straight away
  }

  // No saved copy (first visit, or it was cleared): try the network, but never wait forever
  try {
    const res = await fetchWithTimeout(PAGE, NETWORK_TIMEOUT);
    if (res && res.ok) {
      event.waitUntil(cache.put(PAGE, res.clone()));
      return res;
    }
  } catch (err) {}

  return new Response(OFFLINE_PAGE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleAsset(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(event.request, { ignoreSearch: true });

  if (saved) {
    event.waitUntil(refresh(event.request.url));
    return saved;
  }

  try {
    const res = await fetchWithTimeout(event.request, NETWORK_TIMEOUT);
    if (res && res.ok) event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(req.mode === 'navigate' ? handleNavigation(event) : handleAsset(event));
});

// The page asks us to check the saved copy is still there; if it was cleared, save it again
self.addEventListener('message', (event) => {
  if (event.data !== 'ensure-cache') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if (!(await cache.match(PAGE))) await refresh(PAGE);
  })());
});
