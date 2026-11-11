const CACHE_NAME = 'pustakakita-v12';
const APP_FILES = [
  './index.htm',
  './about.html',
  './style.css',
  './manifest.json',
  './images/icon.svg',
  './APP.js',
  './API.js',
  './book-agent.js',
  './home.js',
  './search.js',
  './detail.js',
  './list.js',
  './reader.js',
  './library.js'
];
const APP_ASSET_PATHS = new Set(
  APP_FILES.map(file => new URL(file, self.registration.scope).pathname)
);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('pustakakita-') && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() =>
      caches.match(event.request).then(response => response || caches.match('./index.htm'))
    ));
    return;
  }

  if (!APP_ASSET_PATHS.has(requestUrl.pathname)) return;

  event.respondWith(fetch(event.request).then(response => {
    if (!response.ok) return response;

    return caches.open(CACHE_NAME)
      .then(cache => cache.put(event.request, response.clone()))
      .then(() => response, error => {
        console.error('Gagal memperbarui cache asset.', error);
        return response;
      });
  }, networkError => caches.match(event.request).then(response => {
    if (response) return response;
    throw networkError;
  })));
});
