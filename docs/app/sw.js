/* sw.js — offline app-shell cache for Driftly Web.
 * JS/CSS/HTML are network-first (falling back to cache): this is a no-build site, so a
 * cache-first policy would pin old code on returning users until the version bumps —
 * price changes and bug fixes would silently never arrive. Static assets (icons,
 * manifest) are cache-first. Bump CACHE on breaking asset renames only. */
const CACHE = 'driftly-web-v2';
const SHELL = [
  './',
  './index.html',
  './web.css',
  './web.js',
  './web-account.js',
  './shared/entitlement.js',
  './shared/license.js',
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API and third parties: straight to network

  const isCode = /\.(?:js|css|html)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isCode) {
    // Network-first: always try to get fresh code; the cache is the offline fallback.
    e.respondWith(fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))));
  } else {
    // Static assets: cache-first is fine (they change with new names/versions).
    e.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))));
  }
});
