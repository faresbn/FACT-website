/**
 * FACT/Flow Service Worker
 * Enables offline support and caching for the PWA
 */

const CACHE_NAME = 'fact-flow-v8';
const STATIC_ASSETS = [
  '/flow/',
  '/flow/flow.html',
  '/flow/manifest.json',
  '/flow/icon-512.png',
  '/FACTLogo2026.png'
];

// CDN assets removed — all dependencies are now bundled via Vite
const CDN_ASSETS = [];

// Install: Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      // Cache static assets first
      return cache.addAll(STATIC_ASSETS).then(() => {
        // Try to cache CDN assets, but don't fail if they don't work
        return Promise.allSettled(
          CDN_ASSETS.map(url =>
            fetch(url, { mode: 'cors' })
              .then(response => {
                if (response.ok) {
                  return cache.put(url, response);
                }
              })
              .catch(err => console.log('[SW] CDN cache failed for:', url))
          )
        );
      });
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // NEVER cache or intercept auth-related requests
  // Supabase auth endpoints, OAuth callbacks with ?code=, hash tokens
  if (url.hostname.includes('supabase.co') ||
      url.searchParams.has('code') ||
      url.searchParams.has('error_description') ||
      (url.hash && url.hash.includes('access_token'))) {
    return;
  }

  // HTML navigation: Network-first (always get latest), cache fallback for offline
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/flow/flow.html'))
    );
    return;
  }

  // Static assets and CDN: Cache-first, network fallback (with background update)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version, but update in background
        event.waitUntil(
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, networkResponse);
                });
              }
            })
            .catch(() => {})
        );
        return cachedResponse;
      }

      // Not in cache: fetch from network
      return fetch(request)
        .then((networkResponse) => {
          // Cache successful responses (skip google fonts analytics etc)
          if (networkResponse.ok && !url.hostname.includes('google')) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// Background sync for offline transactions (future feature)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions());
  }
});

async function syncTransactions() {
  // Future: Sync offline categorizations when back online
  console.log('[SW] Background sync triggered');
}
