/* Fatora service worker: app-shell cache so the app works offline after first load. */
const CACHE = 'fatora-v4';
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/core.js',
  'js/i18n.js',
  'js/store.js',
  'js/app.js',
  'vendor/html2canvas.min.js',
  'vendor/jspdf.umd.min.js',
  'fonts/Inter-latin-400.woff2',
  'fonts/Inter-latin-600.woff2',
  'fonts/Inter-latin-700.woff2',
  'fonts/Tajawal-arabic-400.woff2',
  'fonts/Tajawal-arabic-500.woff2',
  'fonts/Tajawal-arabic-700.woff2',
  'fonts/Tajawal-arabic-800.woff2',
  'fonts/Tajawal-latin-400.woff2',
  'fonts/Tajawal-latin-500.woff2',
  'fonts/Tajawal-latin-700.woff2',
  'fonts/Tajawal-latin-800.woff2',
  'fonts/fonts.css',
  'assets/logo.svg',
  'manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fatora-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
