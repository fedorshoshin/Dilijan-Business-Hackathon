/* Havak — real coordinates, and where they land on the stylised map.

   The map in this app is drawn artwork, not a tile map, so a spot has two
   positions: where it really is (lat/lng, which is what a cleaner needs to
   actually find it) and where to draw it (x/y as a percentage of the artwork).

   Real coordinates are the truth; x/y is derived for display. Storing only x/y
   — as the hackathon build did — is fine for a demo and useless to someone
   standing in a forest looking for a dump. */

window.Havak = window.Havak || {};

Havak.geo = (function () {
  'use strict';

  /* the box the artwork covers: Dilijan town, the Aghstev valley, Parz Lake */
  var LAT_S = 40.700, LAT_N = 40.800;
  var LNG_W = 44.800, LNG_E = 44.980;

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* real position -> percentage across the artwork */
  function toXY(lat, lng) {
    return {
      x: clamp(((lng - LNG_W) / (LNG_E - LNG_W)) * 100, 0, 100),
      y: clamp(((LAT_N - lat) / (LAT_N - LAT_S)) * 100, 0, 100)
    };
  }

  /* percentage across the artwork -> real position */
  function toLatLng(x, y) {
    return {
      lat: LAT_N - (y / 100) * (LAT_N - LAT_S),
      lng: LNG_W + (x / 100) * (LNG_E - LNG_W)
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
    toLatLng: toLatLng,
    inArea: inArea,
    format: format,
    metresBetween: metresBetween,
    locate: locate
  };
})();
