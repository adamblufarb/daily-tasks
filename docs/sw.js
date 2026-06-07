const V = '1748580057';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.destination === 'document' || e.request.url.endsWith('.html') || e.request.url.endsWith('.js')) {
    e.respondWith(fetch(e.request, { cache: 'no-store' }));
  } else {
    e.respondWith(fetch(e.request));
  }
});
