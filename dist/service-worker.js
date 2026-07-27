// LotChance — minimal service worker
// Strategy:
//   - Precache the static app shell so the app opens offline.
//   - Network-first for /api/* (live data preferred, ignore stale cache).
//   - Cache-first for everything else, with background revalidate.

const VERSION = 'lotchance-v10';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './data.js',
  './config.js',
  './scraper.js',
  './i18n.js',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept cross-origin tile/geocode/font traffic
  if (url.origin !== self.location.origin) return;

  // Live data (Texas Lottery proxy): network-only — never cache live scrapes
  if (url.pathname.startsWith('/proxy/')) {
    event.respondWith(fetch(req));
    return;
  }

  // Static shell: cache-first with background refresh
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
