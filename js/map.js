/* Havak — the map.

   A real tile map (Leaflet + OpenStreetMap), vendored in `vendor/leaflet` so it
   is served from our own origin and the service worker can cache it. Up to
   2026-10-01 this was drawn SVG artwork; the artwork needed no network, which
   suited a forest, but it could not be zoomed, showed no real paths or street
   names, and a pin on it told a cleaner roughly nothing about how to get there.
   A spot you cannot find is a spot nobody cleans, so the trade is worth it.

   What the trade costs, stated plainly: tiles come over the network. The app
   shell still works offline, and so do the pins, the list and the coordinates —
   but the ground underneath them is blank until tiles have been fetched once.
   sw.js keeps a capped cache of the tiles you have already seen, so the area you
   actually work in survives losing signal.

   One component, used four ways: read-only with pins (Map tab, the board),
   single-pin (a report's page), and tappable to place a spot (the report form).

   Positions are real lat/lng throughout. `loc.x`/`loc.y` — percentages across
   the old artwork — are still computed on write because the server column is NOT
   NULL, but nothing draws from them any more. */

window.Havak = window.Havak || {};

Havak.map = (function () {
  'use strict';

  var el = Havak.ui.el;
  var geo = Havak.geo;

  var TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  /* Attribution is not decoration: using OSM's tiles obliges us to show it. */
  var ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" ' +
               'target="_blank" rel="noopener">OpenStreetMap</a>';

  var STATUS_CLASS = {
    open: 'open', claimed: 'crew', cleaned: 'check', confirmed: 'done'
  };

  var B = geo.BOUNDS;

  /* Leaflet keeps window-level listeners per map, so a map whose screen has been
     replaced by the router has to be told to let go. Views build their DOM and
     hand it back, and nothing tells us when it is discarded — so each new render
     sweeps for maps whose container has left the document. */
  var live = [];
  function sweep() {
    live = live.filter(function (entry) {
      if (entry.node.isConnected) return true;
      /* Order matters: stop the observer before tearing the map down. A resize
         callback arriving after remove() reaches into a container Leaflet has
         already let go of, which throws on `_leaflet_pos`. */
      if (entry.ro) entry.ro.disconnect();
      entry.map.remove();
      return false;
    });
  }

  /* Leaflet measures its container on init, so it cannot be set up until the
     node is in the document and has a width. Views append after we return, so
     wait for that rather than forcing every caller to change shape. */
  function whenSized(node, fn) {
    var tries = 0;
    (function look() {
      if (node.isConnected && node.clientWidth > 0) { fn(); return; }
      if (++tries > 120) return;          /* ~2s: the node was never shown */
      requestAnimationFrame(look);
    })();
  }

  function pinIcon(report) {
    var cls = STATUS_CLASS[report.status] || 'open';
    return L.divIcon({
      className: 'pin is-' + cls + (report.hazardous ? ' is-hazard' : ''),
      html: '<i></i>',
      iconSize: [44, 44],               /* the tap target, not the dot */
      iconAnchor: [22, 22]
    });
  }

  function label(report) {
    var status = (Havak.ui.STATUS[report.status] || {}).label || report.status;
    return report.title + ' — ' + status;
  }

  /* opts: { reports, pin, selectable, onPick, onPinClick, hint } */
  function render(opts) {
    opts = opts || {};
    sweep();

    var canvas = el('div.map');
    var shell = el('div.map-shell', null, [canvas]);
    var note = el('p.map-hint-line', { hidden: true });
    shell.appendChild(note);
    if (opts.hint) { note.hidden = false; note.textContent = opts.hint; }

    /* The report form's "use my location" button drives the marker from outside.
       It is a no-op until Leaflet has initialised, which is why the caller is
       told whether it took — pressing it in the first moments of the screen must
       not look like it silently did nothing. */
    shell.place = function (lat, lng) {
      if (!canvas.havakPlace) return false;
      canvas.havakPlace(lat, lng);
      return true;
    };

    /* Leaflet missing is not a crash: the file is vendored and cached, but a
       half-installed service worker could still serve one file and not another.
       The screens around this map carry the address and the coordinates, so
       saying so is better than taking the page down. */
    if (typeof L === 'undefined') {
      canvas.appendChild(el('p.map-fallback', {
        text: 'The map could not load. The written location and coordinates below still apply.'
      }));
      return shell;
    }

    var reports = (opts.reports || []).filter(function (r) {
      return r && r.loc && typeof r.loc.lat === 'number' && typeof r.loc.lng === 'number';
    });

    whenSized(canvas, function () {
      var map = L.map(canvas, {
        /* The page scrolls; the wheel belongs to the page, not the map. Touch
           dragging stays on, because a map you cannot pan with a thumb is not a
           map. */
        scrollWheelZoom: false,
        zoomControl: true,
        attributionControl: true
      });

      /* Leaflet 1.9's default prefix carries a Ukraine flag emoji. The credit
         stays — the flag does not: this is a council-facing app about litter in
         Armenia, and it is not the place to carry anybody's flag by accident. */
      map.attributionControl.setPrefix(
        '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

      L.tileLayer(TILE_URL, {
        attribution: ATTRIB,
        maxZoom: 19,
        minZoom: 9,
        /* No detectRetina: it doubles every tile request, and these are somebody
           else's servers being used for free. No crossOrigin either — we never
           read tile pixels back, and asking for CORS would make the whole map
           depend on a header we do not control. The service worker caches the
           opaque responses perfectly well. */
      }).addTo(map).on('tileerror', function () {
        if (opts.hint) return;            /* a real instruction outranks this */
        note.hidden = false;
        note.textContent = 'Map images need a connection. The pins and coordinates are correct regardless.';
      });

      /* Where to look first: the spots if there are any, otherwise Dilijan. */
      if (reports.length === 1) {
        map.setView([reports[0].loc.lat, reports[0].loc.lng], 16);
      } else if (reports.length > 1) {
        map.fitBounds(L.latLngBounds(reports.map(function (r) {
          return [r.loc.lat, r.loc.lng];
        })).pad(0.2));
      } else if (opts.pin) {
        map.setView([opts.pin.lat, opts.pin.lng], 16);
      } else {
        map.fitBounds([[B.LAT_S, B.LNG_W], [B.LAT_N, B.LNG_E]]);
      }

      reports.forEach(function (report) {
        var marker = L.marker([report.loc.lat, report.loc.lng], {
          icon: pinIcon(report),
          title: label(report),
          riseOnHover: true
        }).addTo(map);

        var node = marker.getElement();
        if (node) {
          node.setAttribute('aria-label', label(report));
          if (opts.onPinClick) node.setAttribute('role', 'button');
        }
        if (opts.onPinClick) {
          marker.on('click keypress', function (ev) {
            if (ev.originalEvent && ev.originalEvent.type === 'keypress' &&
                ev.originalEvent.key !== 'Enter' && ev.originalEvent.key !== ' ') return;
            opts.onPinClick(report.id);
          });
        }
      });

      if (opts.selectable) placing(map, canvas, note, opts);

      /* The map can be built while its panel is still settling, or the phone can
         be turned sideways. Either way Leaflet needs telling — but only while the
         map is still on screen. A detached container has no position to measure,
         and asking for one throws. */
      var ro = null;
      if (window.ResizeObserver) {
        ro = new ResizeObserver(function () {
          if (!canvas.isConnected) return;
          map.invalidateSize();
        });
        ro.observe(canvas);
      }

      live.push({ map: map, node: canvas, ro: ro });
    });

    return shell;
  }

  /* ---------- placing a spot ----------
     The marker is draggable, so a rough tap can be corrected without starting
     again. Keyboard users pan with the arrow keys (Leaflet's own handling) and
     press Enter to drop the marker in the middle — which needs no pointer and no
     dragging. */
  function placing(map, canvas, note, opts) {
    canvas.classList.add('is-selectable');
    canvas.setAttribute('aria-label',
      'Map of Dilijan. Tap to place your marker, or move the map with the arrow keys and press Enter to place it in the centre.');

    var marker = null;

    function say(lat, lng) {
      note.hidden = false;
      note.textContent = 'Marker placed · ' + geo.format(lat, lng);
    }

    function put(lat, lng, quiet) {
      if (!marker) {
        marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'pin is-new is-placing', html: '<i></i>',
            iconSize: [44, 44], iconAnchor: [22, 22]
          }),
          draggable: true,
          keyboard: false     /* Enter on the map places; Enter on the pin must not re-fire */
        }).addTo(map);
        marker.on('dragend', function () {
          var p = marker.getLatLng();
          say(p.lat, p.lng);
          if (opts.onPick) opts.onPick(p.lat, p.lng);
        });
        var node = marker.getElement();
        if (node) node.setAttribute('aria-label', 'The spot you are reporting. Drag to adjust.');
      } else {
        marker.setLatLng([lat, lng]);
      }
      if (!quiet) say(lat, lng);
      if (opts.onPick && !quiet) opts.onPick(lat, lng);
    }

    if (opts.pin) put(opts.pin.lat, opts.pin.lng, true);

    map.on('click', function (ev) { put(ev.latlng.lat, ev.latlng.lng); });

    canvas.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      /* Leaflet's own controls are buttons inside this container; Enter on one
         of those is theirs, not ours. */
      if (ev.target !== canvas) return;
      ev.preventDefault();
      var c = map.getCenter();
      put(c.lat, c.lng);
    });

    /* Expose the one thing the form needs to drive from outside: the GPS button
       moves both the view and the marker. */
    canvas.havakPlace = function (lat, lng) {
      map.setView([lat, lng], 17);
      put(lat, lng);
    };
  }

  function legend() {
    return el('ul.legend', null, [
      el('li', null, [el('span.dot.dot-open'), 'Reported']),
      el('li', null, [el('span.dot.dot-crew'), 'Crew on it']),
      el('li', null, [el('span.dot.dot-check'), 'Awaiting check']),
      el('li', null, [el('span.dot.dot-done'), 'Cleaned'])
    ]);
  }

  return { render: render, legend: legend };
})();
