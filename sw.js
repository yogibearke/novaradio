const CACHE_NAME = 'novaradio-v3.15';
const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/stubru.svg',
  './icons/radio2.svg',
  './icons/radio1.svg',
  './icons/mnm.svg',
  './icons/qmusic.svg',
  './icons/joe.svg',
  './icons/classic21.svg',
  './js/app.js',
  './js/radio-api.js',
  './js/player.js',
  './js/cast.js',
  './js/favorites.js',
  './js/visualizer.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Niet cachen: audio streams en radio-browser live API calls
  if (
    event.request.destination === 'audio' ||
    url.hostname.includes('radio-browser.info') ||
    url.hostname.includes('gstatic.com') ||
    url.protocol.startsWith('chrome-extension')
  ) {
    return;
  }

  // Network-first strategie voor scripts en HTML zodat updates direct doorkomen
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
