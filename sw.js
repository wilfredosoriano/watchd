// Watchd service worker: app shell offline, posters cached, API always live.
const SHELL = 'watchd-shell-v1', IMG = 'watchd-img-v1';
const FILES = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, IMG].includes(k)).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/') || u.pathname.startsWith('/__/')) return;
  if (u.hostname === 'image.tmdb.org') {
    e.respondWith(caches.open(IMG).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r;
    }));
    return;
  }
  if (u.hostname.includes('fonts.g')) {
    e.respondWith(caches.open(SHELL).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (u.origin === location.origin) {
    // Network first for the app itself, cache as fallback for offline.
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
  }
});
