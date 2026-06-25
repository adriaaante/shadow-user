/* sw.js — minimal offline app-shell cache for Driftly Web. */
const CACHE = 'driftly-web-v1';
const SHELL = [
  './',
  './index.html',
  './web.css',
  './web.js',
  './assets/theme.css',
  './assets/chart.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // Cache-first for same-origin shell; network for the rest.
  if (new URL(request.url).origin === self.location.origin) {
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))));
  }
});
