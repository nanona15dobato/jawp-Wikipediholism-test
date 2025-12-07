const CACHE_NAME = "jawpctest2.0.0-q2-a2";
var URLS_TO_CACHE = [
  "./",
  "./index.html",
  "./shusei.html",
  "./kaito.html",
  "./questions/2.json",
  "./answers/2.json",
  "./offline.html",
  "../favicon.ico",
  "../menu.js",
  "../logo.png"
];


self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  const requestURL = new URL(event.request.url);

  // Handle JSON data with validation
  if (requestURL.pathname.endsWith('.json')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const networkFetch = fetch(event.request).then(networkResponse => {
            // Clone response to read body for validation
            const responseClone = networkResponse.clone();
            return responseClone.json().then(data => {
              // Basic validation: check if it's an array (for questions/answers)
              if (Array.isArray(data) && data.length > 0) {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
              } else {
                console.warn('Invalid JSON data received, using cache if available.');
                return cachedResponse || networkResponse; // Fallback to network if no cache, even if invalid? Or error?
                // If invalid, better to return cached if exists. If not, return network (which might be the error page or bad data)
              }
            }).catch(err => {
              console.error('JSON validation failed:', err);
              return cachedResponse || networkResponse;
            });
          }).catch(() => {
            return cachedResponse;
          });

          return cachedResponse || networkFetch;
        });
      })
    );
    return;
  }

  // Handle HTML pages (Network First, then Cache, then Offline)
  if (event.request.mode === 'navigate' || (event.request.method === 'GET' && event.request.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cachedResponse => {
              return cachedResponse || caches.match('./offline.html');
            });
        })
    );
    return;
  }

  // Stale-While-Revalidate for other assets
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        const networkFetch = fetch(event.request).then(networkResponse => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        }).catch(console.error);

        return cachedResponse || networkFetch;
      });
    })
  );
});
