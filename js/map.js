/* Havak — the Dilijan map.

   Drawn artwork, not a tile map: no tiles to download, so it works offline in
   a forest, which is exactly where it gets used. Positions are percentages
   across the artwork, derived from real coordinates by geo.js.

   One component, used three ways: read-only with pins (the Map tab), tappable
   to place a spot (the report form), and single-pin (a report's detail). */

window.Havak = window.Havak || {};

Havak.map = (function () {
  'use strict';

  var el = Havak.ui.el;

  /* the artwork — static, so innerHTML is safe here and nowhere else */
  var ART =
    '<svg viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Map of the Dilijan valley">' +
      '<rect x="0" y="0" width="1000" height="700" fill="#EFEDE6"/>' +
      '<path fill="#D6E3D0" d="M0,0 H1000 V150 C900,192 820,120 700,162 C560,208 470,130 350,176 C230,218 120,150 0,192 Z"/>' +
      '<path fill="#D6E3D0" d="M0,700 H1000 V556 C880,516 800,600 690,564 C570,524 480,612 360,570 C240,528 120,602 0,564 Z"/>' +
      '<path fill="#C7D9C0" opacity=".7" d="M0,0 H1000 V78 C880,112 760,60 640,92 C520,124 420,70 300,100 C190,128 100,86 0,108 Z"/>' +
      '<ellipse cx="866" cy="96" rx="52" ry="30" fill="#9CC4DE"/>' +
      '<ellipse cx="866" cy="96" rx="52" ry="30" fill="none" stroke="#7FB0CE" stroke-width="3"/>' +
      '<path d="M-10,432 C120,402 200,472 320,442 C450,410 520,482 650,452 C770,424 860,482 1010,456" fill="none" stroke="#8FBBD9" stroke-width="14" stroke-linecap="round"/>' +
      '<path d="M-10,432 C120,402 200,472 320,442 C450,410 520,482 650,452 C770,424 860,482 1010,456" fill="none" stroke="#A8CCE4" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M-10,300 C140,332 210,264 340,296 C470,326 540,254 670,286 C800,316 880,248 1010,280" fill="none" stroke="#D9D2C3" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M-10,300 C140,332 210,264 340,296 C470,326 540,254 670,286 C800,316 880,248 1010,280" fill="none" stroke="#F3EFE6" stroke-width="3" stroke-dasharray="14 12"/>' +
      '<g fill="#E4DED1" stroke="#D2CABA" stroke-width="2">' +
        '<rect x="196" y="332" width="70" height="46" rx="6"/><rect x="278" y="344" width="54" height="40" rx="6"/>' +
        '<rect x="344" y="330" width="62" height="44" rx="6"/><rect x="214" y="390" width="58" height="36" rx="6"/>' +
        '<rect x="286" y="396" width="76" height="34" rx="6"/><rect x="430" y="336" width="66" height="42" rx="6"/>' +
        '<rect x="510" y="352" width="48" height="38" rx="6"/><rect x="392" y="392" width="52" height="32" rx="6"/>' +
        '<rect x="606" y="330" width="58" height="40" rx="6"/><rect x="676" y="346" width="46" height="34" rx="6"/>' +
      '</g>' +
      '<g class="map-label" fill="#3E5545"><text x="40" y="52">Dilijan National Park</text>' +
      '<text x="806" y="152">Parz Lake</text><text x="40" y="662">National Park · south slope</text></g>' +
      '<g class="map-label map-label-sm" fill="#4C6B84"><text x="150" y="424">Aghstev river</text></g>' +
      '<g class="map-label map-label-sm" fill="#6B6355"><text x="214" y="316">Old Dilijan</text>' +
      '<text x="828" y="266">M4 → Ijevan</text></g>' +
    '</svg>';

  var STATUS_CLASS = {
    open: 'open', claimed: 'crew', cleaned: 'check', confirmed: 'done'
  };

  /* opts: { reports, pin, selectable, onPick, onPinClick, hint } */
  function render(opts) {
    opts = opts || {};

    var art = el('div.map');
    art.innerHTML = ART;

    var pins = el('div.pins');
    art.appendChild(pins);

    (opts.reports || []).forEach(function (report) {
      var cls = STATUS_CLASS[report.status] || 'open';
      var pin = el('button.pin.is-' + cls + (report.hazardous ? ' is-hazard' : ''), {
        type: 'button',
        style: 'left:' + report.loc.x + '%;top:' + report.loc.y + '%',
        'aria-label': report.title + ' — ' + (Havak.ui.STATUS[report.status] || {}).label,
        onclick: function (ev) {
          ev.stopPropagation();
          if (opts.onPinClick) opts.onPinClick(report.id);
        }
      }, [el('i', { 'aria-hidden': 'true' })]);
      pins.appendChild(pin);
    });

    /* the spot being placed right now */
    var placed = null;
    function showPlaced(x, y) {
      if (!placed) {
        placed = el('span.pin.is-new.is-placing', { 'aria-hidden': 'true' }, [el('i')]);
        pins.appendChild(placed);
      }
      placed.style.left = x + '%';
      placed.style.top = y + '%';
    }
    if (opts.pin) showPlaced(opts.pin.x, opts.pin.y);

    if (opts.selectable) {
      art.classList.add('is-selectable');

      var pick = function (clientX, clientY) {
        var box = art.getBoundingClientRect();
        var x = ((clientX - box.left) / box.width) * 100;
        var y = ((clientY - box.top) / box.height) * 100;
        x = Math.max(0, Math.min(100, x));
        y = Math.max(0, Math.min(100, y));
        showPlaced(x, y);
        if (opts.onPick) opts.onPick(x, y);
      };

      art.addEventListener('click', function (ev) { pick(ev.clientX, ev.clientY); });

      /* keyboard: the map is focusable and arrow keys nudge the marker, so
         placing a spot does not require a pointing device */
      art.tabIndex = 0;
      art.setAttribute('role', 'application');
      art.setAttribute('aria-label', 'Map of Dilijan. Tap to place your marker, or use the arrow keys.');
      art.addEventListener('keydown', function (ev) {
        var step = ev.shiftKey ? 5 : 1;
        var cur = opts.pin || { x: 50, y: 50 };
        var moved = true;
        if (ev.key === 'ArrowLeft') cur.x -= step;
        else if (ev.key === 'ArrowRight') cur.x += step;
        else if (ev.key === 'ArrowUp') cur.y -= step;
        else if (ev.key === 'ArrowDown') cur.y += step;
        else moved = false;
        if (!moved) return;
        ev.preventDefault();
        cur.x = Math.max(0, Math.min(100, cur.x));
        cur.y = Math.max(0, Math.min(100, cur.y));
        showPlaced(cur.x, cur.y);
        if (opts.onPick) opts.onPick(cur.x, cur.y);
      });
    }

    var shell = el('div.map-shell', null, [art]);
    if (opts.hint) shell.appendChild(el('p.map-hint-line', { text: opts.hint }));
    return shell;
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
