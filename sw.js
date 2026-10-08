/* Havak — service worker.

   Two jobs: make the app open with no signal, and keep it current.

   Strategy is stale-while-revalidate: serve the cached copy immediately (so a
   cleaner standing in a forest with no bars still gets the app), and refresh
   the cache from the network in the background for next time. Bump CACHE when
   the shell changes — the old cache is dropped on activate. */

/* v7: the map became real tiles (Leaflet, vendored), so the shell gained
   vendor/leaflet/* and lost nothing — but an install still holding v6 would run
   the new map.js against no Leaflet at all, which is exactly the half-installed
   case map.js guards against. Bumping is what stops that being anyone's normal.
   v4: email confirmation and password reset landed. No new files, but the reset
   link lands on a cold install straight from an email, so serving yesterday's
   JavaScript there would mean the link opens a screen that does not exist yet.
   v3: the data layer moved from localStorage to the server, so store.js is gone
   and api.js + remote.js take its place. This MUST be bumped whenever the file
   list changes — the strategy below serves the cache first, so an install that
   still held v2 would keep running the old offline-only app forever. Dropping
   the old cache on activate is what makes returning phones pick this up. */
var CACHE = 'havak-shell-v11';

/* Map tiles, kept apart from the shell on purpose. They are somebody else's
   bytes, they are cross-origin, and there are potentially thousands of them, so
   they get their own cache with a ceiling rather than being allowed to grow
   inside the one the app depends on. Clearing this never breaks the app; it just
   means the ground goes blank until there is signal again. */
var TILE_CACHE = 'havak-tiles-v1';
var TILE_HOST = 'tile.openstreetmap.org';
var TILE_MAX = 400;              /* ~6 MB at these zooms: a generous Dilijan */

var SHELL = [
  'app.html',
  'style.css',
  'manifest.webmanifest',
  'js/geo.js',
  /* Leaflet, vendored. The map is useless without it and it must be present
     offline, so it belongs in the shell rather than being fetched on demand. */
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  /* every name here must exist: addAll rejects as a whole on a single 404,
     which would silently leave the app with no offline shell at all */
  'js/api.js',
  'js/remote.js',
  'js/money.js',
  'js/map.js',
  'js/media.js',
  'js/work.js',
  'js/auth.js',
  'js/ui.js',
  'js/router.js',
  'js/views/auth.js',
  'js/views/feed.js',
  'js/views/newreport.js',
  'js/views/myreports.js',
  'js/views/spot.js',
  'js/views/jobs.js',
  'js/views/me.js',
  'js/views/give.js',
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
        if (k === CACHE || k === TILE_CACHE) return null;
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Oldest-first eviction. Cache.keys() answers in insertion order, so the front
   of the list is the least recently added. */
function trimTiles(cache) {
  cache.keys().then(function (keys) {
    var over = keys.length - TILE_MAX;
    if (over > 0) keys.slice(0, over).forEach(function (k) { cache.delete(k); });
  });
}

/* Tiles: cache first, and keep what we fetch. They are effectively immutable —
   a given z/x/y is the same picture next week — so serving the stored copy
   straight away is both correct and the whole offline story. The response is
   opaque (no CORS asked for), which reads as status 0; that is normal for a
   cross-origin image and works fine as an <img> source. */
function tiles(ev) {
  ev.respondWith(
    caches.open(TILE_CACHE).then(function (cache) {
      return cache.match(ev.request).then(function (hit) {
        if (hit) return hit;
        return fetch(ev.request).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) {
            cache.put(ev.request, res.clone()).then(function () { trimTiles(cache); });
          }
          return res;
        });
      });
    })
  );
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;

  if (req.method !== 'GET') return;

  /* The one deliberate exception to "our own origin only" below: map tiles. They
     are the single cross-origin thing this app cannot do without in a forest. */
  var url = new URL(req.url);
  if (url.hostname === TILE_HOST) { tiles(ev); return; }

  /* everything else: our own origin only — never cache someone else's response */
  if (url.origin !== self.location.origin) return;

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
