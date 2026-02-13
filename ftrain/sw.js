// FACT/Train Service Worker
// Caches app shell + CDN deps for offline-first PWA experience

const CACHE_NAME = 'ftrain-v1';
const APP_SHELL = [
  '/ftrain/',
  '/ftrain/index.html',
  '/ftrain/manifest.json',
  '/ftrain/icon-192.png',
  '/ftrain/icon-512.png',
];
const CDN_DEPS = [
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.tailwindcss.com',
];

// Install: cache app shell + CDN dependencies
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([...APP_SHELL, ...CDN_DEPS]);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for HTML, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // YouTube thumbnails: cache with expiry
  if (url.hostname === 'img.youtube.com') {
    event.respondWith(
      caches.open('ftrain-thumbs').then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
        });
      })
    );
    return;
  }

  // App HTML: network-first (always get latest)
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/ftrain/') {
    event.respondWith(
      fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => {
        return caches.match(request) || caches.match('/ftrain/index.html');
      })
    );
    return;
  }

  // CDN & static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
