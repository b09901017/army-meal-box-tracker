/* Service Worker：讓網頁在營區沒訊號時也能開。
   策略：network-first（有網路一定拿最新版），沒網路才用快取。 */
var CACHE = 'amb-tracker-v1';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/units.js',
  './js/parser.js',
  './js/state.js',
  './js/effects.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
