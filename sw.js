/* ============================================================
   Smart Assistant — Service Worker
   Caches the app shell so core screens (customers, inventory,
   dashboard, reports, backup) work offline once visited. All
   real data lives in IndexedDB, which is inherently available
   offline with no service worker needed.
   Import parsing libraries are loaded from CDN; if the CDN
   response was cached on a prior online visit, import keeps
   working offline. On a first-ever offline visit (nothing
   cached yet) import will not work until you go online once.
   ============================================================ */

const CACHE_NAME = 'smart-assistant-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/import.js',
  './js/modules.js',
  './js/reports-backup.js',
  './js/assistant.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        // opportunistically cache same-origin + known CDN assets for future offline use
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
