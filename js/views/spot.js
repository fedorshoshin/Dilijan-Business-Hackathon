/* Havak — one report, seen by anybody (task 2.5).

   The same screen for all three roles. What differs is the action offered at
   the bottom, which is decided by who you are and what state the report is in.
   The actions themselves land in Phases 4, 5 and 6; this screen is where they
   will hang. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;
  var auth = Havak.auth;
  var geo = Havak.geo;

  var LEVEL_WORD = ['', 'A few items', 'A bagful', 'Several bags', 'A big pile', 'A dumping ground'];

  function fact(label, value) {
    return el('div.fact', null, [
      el('dt', { text: label }),
      el('dd', { text: value })
    ]);
  }

  Havak.views.spot = function (screen, reportId) {
    var me = auth.current();

    return store.find('reports', reportId).then(function (report) {
      if (!report) {
        screen.appendChild(el('div.wrap.pad', null, [
          ui.empty('That report is gone', 'It may have been removed.')
        ]));
        return;
      }

      return Promise.all([
        store.find('users', report.reporterId),
        store.where('claims', function (c) {
          return c.reportId === report.id && c.status !== 'released';
        })
      ]).then(function (r) {
        var reporter = r[0];
        var claim = r[1].length ? r[1][0] : null;

        return (claim
          ? store.find('users', claim.cleanerId)
          : Promise.resolve(null)
        ).then(function (cleaner) {
          paint(screen, report, reporter, cleaner, me);
        });
      });
    });
  };

  function paint(screen, report, reporter, cleaner, me) {
    var mine = reporter && me && reporter.id === me.id;
    var iAmCleaner = cleaner && me && cleaner.id === me.id;

    /* what happens next, said plainly, tailored to who is reading */
    var next;
    if (report.status === 'open') {
      next = mine
        ? 'Waiting for a cleaner to take it on.'
        : 'Nobody has taken this on yet.';
    } else if (report.status === 'claimed') {
      next = iAmCleaner
        ? 'You have taken this on. Mark it cleaned when you are done.'
        : (cleaner ? cleaner.name.split(' ')[0] + ' has taken this on.' : 'A cleaner has taken this on.');
    } else if (report.status === 'cleaned') {
      next = mine
        ? 'Cleaned — check the photos and confirm it is really done.'
        : 'Cleaned, waiting for the reporter to confirm.';
    } else {
      next = report.rating
        ? 'Confirmed clean, rated ' + report.rating + '/5.'
        : 'Confirmed clean.';
    }

    var body = el('div.wrap.pad', null, [
      el('div.spot-head', null, [
        el('div.rcard-top', null, [
          ui.statusTag(report.status),
          report.hazardous ? el('span.tag.tag-hazard', { text: 'Hazardous' }) : null
        ]),
        el('h1.spot-title', { text: report.title }),
        el('p.sub', {
          text: 'Reported by ' + (reporter ? reporter.name : 'someone') +
                ' · ' + ui.ago(report.createdAt)
        })
      ]),

      report.hazardous
        ? el('div.notice.notice-danger', null, [
            el('strong', { text: 'Hazardous waste — do not handle it yourself.' }),
            el('span', { text: ' This spot is flagged for trained collection.' })
          ])
        : null,

      el('p.spot-desc', { text: report.desc }),

      Havak.map.render({ reports: [report] }),

      el('p.spot-where', { text: report.loc.label }),
      el('p.spot-coords', { text: geo.format(report.loc.lat, report.loc.lng) }),

      el('dl.facts', null, [
        fact('How bad', report.level + '/5 — ' + LEVEL_WORD[report.level]),
        fact('Time to clear', ui.minutes(report.estMinutes)),
        fact('Pays', ui.amd(report.payout)),
        fact('Status', (ui.STATUS[report.status] || {}).label || report.status)
      ]),

      el('div.next-up', null, [
        el('p.next-text', { text: next })
      ]),

      el('p.phase-note', {
        text: 'Photos arrive in Phase 3. Claiming lands in Phase 4, confirming ' +
              'in Phase 5, funding this spot in Phase 6.'
      })
    ]);

    screen.appendChild(body);
  }
})();
