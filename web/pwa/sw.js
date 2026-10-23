// Cloud's CAD service worker: lets the app open with no internet after the first visit. VERSION changes on each build so updates arrive.
const VERSION = '__VERSION__';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // newest page when online, saved copy when not
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && new URL(e.request.url).origin === location.origin) { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
