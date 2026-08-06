/**
 * PWA Service Worker
 * Offline Caching and Supabase Network Bypass
 * HostelInfo-S (V2)
 */

const CACHE_NAME = 'hostels-supabase-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './admin.html',
  './style.css',
  './script.js',
  './config.js',
  './utils.js',
  './auth.js',
  './student.js',
  './admin.js',
  './manifest.json',
  './offline.html',
  './images/placeholder.jpg',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/icon-512-maskable.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn(`[ServiceWorker] Skip pre-cache file: ${url}`, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[ServiceWorker] Wiping old cache container:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Interceptor
self.addEventListener('fetch', (event) => {
  // CRITICAL BYPASS: Let Supabase dynamic database/storage calls execute unhindered
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  const requestUrl = new URL(event.request.url);

  // Check if this is a request for a core web asset (HTML, CSS, JS modules, manifest)
  const isCoreAsset = requestUrl.pathname.endsWith('/') ||
                      requestUrl.pathname.endsWith('index.html') ||
                      requestUrl.pathname.endsWith('admin.html') ||
                      requestUrl.pathname.endsWith('.js') || 
                      requestUrl.pathname.endsWith('style.css') ||
                      requestUrl.pathname.endsWith('manifest.json');

  if (isCoreAsset) {
    // Network First strategy (Dynamic updates when online, offline support otherwise)
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseCopy);
            });
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('./offline.html');
          }
          return caches.match(event.request);
        })
    );
    return;
  }

  // Cache First strategy for static files (Icons, fonts, CDN scripts, local brand assets)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseCopy);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Fallback for missing brand images
        if (event.request.destination === 'image') {
          return caches.match('./images/placeholder.jpg');
        }
        throw err;
      });
    })
  );
});
