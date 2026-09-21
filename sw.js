/* Havak — service worker.

   Two jobs: make the app open with no signal, and keep it current.

   Strategy is stale-while-revalidate: serve the cached copy immediately (so a
   cleaner standing in a forest with no bars still gets the app), and refresh
   the cache from the network in the background for next time. Bump CACHE when
   the shell changes — the old cache is dropped on activate. */

var CACHE = 'havak-shell-v2';

var SHELL = [
  'app.html',
  'style.css',
  'manifest.webmanifest',
  'js/geo.js',
  'js/store.js',
  'js/money.js',
  'js/map.js',
  'js/auth.js',
  'js/ui.js',
  'js/router.js',
  'js/views/auth.js',
  'js/views/feed.js',
  'js/views/newreport.js',
  'js/views/myreports.js',
  'js/views/spot.js',
  'js/views/me.js',
  'js/views/soon.js',
  'js/main.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;

  /* only GETs, and only our own origin — never cache someone else's response */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  ev.respondWith(
    caches.match(req).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        /* offline: the cached copy below is the answer, if we have one */
        return cached;
      });

      return cached || fresh;
    })
  );
});
