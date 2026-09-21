/* Havak — the Map tab.

   Phase 1 shows the reports as a read-only list, straight out of the store, so
   the data layer is visible and the app has a spine. The map itself, the detail
   screen and the report flow are Phase 2. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;

  var ORDER = { open: 0, claimed: 1, cleaned: 2, confirmed: 3 };

  function card(report) {
    var bits = [ui.minutes(report.estMinutes), 'level ' + report.level];

    return el('li.rcard', null, [
      el('div.rcard-top', null, [
        ui.statusTag(report.status),
        report.hazardous ? el('span.tag.tag-hazard', { text: 'Hazardous' }) : null
      ]),
      el('h3.rcard-title', { text: report.title }),
      el('p.rcard-where', { text: report.loc.label }),
      el('p.rcard-meta', { text: bits.join(' · ') + ' · ' + ui.ago(report.createdAt) })
    ]);
  }

  Havak.views.feed = function (screen) {
    return store.all('reports').then(function (list) {
      var reports = list.sort(function (a, b) {
        var d = (ORDER[a.status] || 0) - (ORDER[b.status] || 0);
        return d !== 0 ? d : b.createdAt - a.createdAt;
      });

      var open = reports.filter(function (r) { return r.status === 'open'; }).length;
      var done = reports.filter(function (r) { return r.status === 'confirmed'; }).length;

      screen.appendChild(el('div.wrap.pad', null, [
        el('div.panel-head', null, [
          el('h1', { text: 'Dilijan right now' }),
          el('p.sub', { text: open + ' spots waiting · ' + done + ' cleaned and confirmed' })
        ]),
        reports.length
          ? el('ul.rlist', null, reports.map(card))
          : ui.empty('No spots reported yet', 'When someone reports one, it shows up here.'),
        el('p.phase-note', {
          text: 'The map, the photos and the full detail screen arrive in Phase 2.'
        })
      ]));
    });
  };
})();
