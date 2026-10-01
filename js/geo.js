/* Havak — real coordinates, and the area the pilot covers.

   lat/lng is the truth about where a spot is, and since 2026-10-01 it is also
   what gets drawn: the map is real tiles (js/map.js), not the drawn artwork it
   started as. Storing only a position on a picture — as the hackathon build did
   — is fine for a demo and useless to someone standing in a forest looking for
   a dump.

   `toXY` is the one piece of the artwork era still in use. It survives because
   the server's loc_x/loc_y columns are NOT NULL, so every report still carries a
   position-on-the-old-picture that nothing reads. Dropping it properly means a
   migration; until then this keeps the writes honest rather than sending zeroes.
   The inverse (x/y back to lat/lng) is gone — nothing can need it now that
   lat/lng is captured directly. */

window.Havak = window.Havak || {};

Havak.geo = (function () {
  'use strict';

  /* The pilot area: Dilijan town, the Aghstev valley, Parz Lake. The map opens
     on this box, and it is what `inArea` answers about — but it is no longer a
     fence. A real map can show anywhere, so a report outside it is allowed and
     merely noted. */
  var LAT_S = 40.700, LAT_N = 40.800;
  var LNG_W = 44.800, LNG_E = 44.980;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* real position -> percentage across the old artwork. Write-only: see header.
     Clamped, so a spot outside the pilot area still satisfies the server's
     0..100 check instead of being rejected. */
  function toXY(lat, lng) {
    return {
      x: clamp(((lng - LNG_W) / (LNG_E - LNG_W)) * 100, 0, 100),
      y: clamp(((LAT_N - lat) / (LAT_N - LAT_S)) * 100, 0, 100)
    };
  }

  /* true when a real reading falls inside the area the map covers */
  function inArea(lat, lng) {
    return lat >= LAT_S && lat <= LAT_N && lng >= LNG_W && lng <= LNG_E;
  }

  function format(lat, lng) {
    return lat.toFixed(5) + ', ' + lng.toFixed(5);
  }

  /* metres between two points — used to sort the cleaner's board by distance */
  function metresBetween(a, b) {
    var R = 6371000;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var lat1 = a.lat * Math.PI / 180;
    var lat2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  /* browser location, wrapped so a refusal is a normal answer rather than a
     thrown error — plenty of people decline, and the form must still work */
  function locate() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ ok: false, reason: 'unsupported' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({ ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude,
                    accuracy: Math.round(pos.coords.accuracy) });
        },
        function (err) {
          resolve({ ok: false, reason: err.code === 1 ? 'denied' : 'unavailable' });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    });
  }

  return {
    BOUNDS: { LAT_S: LAT_S, LAT_N: LAT_N, LNG_W: LNG_W, LNG_E: LNG_E },
    toXY: toXY,
    inArea: inArea,
    format: format,
    metresBetween: metresBetween,
    locate: locate
  };
})();
