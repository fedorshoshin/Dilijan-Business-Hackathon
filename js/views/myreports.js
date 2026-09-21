/* Havak — the Report tab: what I have reported and where each one stands
   (task 2.4), plus the way in to a new report. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;
  var auth = Havak.auth;

  /* what the reporter is waiting on, in their words rather than a status code */
  var NEXT = {
    open:      'Waiting for a cleaner to take it.',
    claimed:   'A cleaner is on it.',
    cleaned:   'Cleaned — your check is needed.',
    confirmed: 'Done and confirmed.'
  };

  function card(report) {
    var needsMe = report.status === 'cleaned';

    return el('li', null, [
      el('button.rcard.rcard-tap' + (needsMe ? '.needs-you' : ''), {
        type: 'button',
        onclick: function () { Havak.router.go('/spot/' + report.id); }
      }, [
        el('div.rcard-top', null, [
          ui.statusTag(report.status),
          report.hazardous ? el('span.tag.tag-hazard', { text: 'Hazardous' }) : null,
          needsMe ? el('span.tag.tag-you', { text: 'Needs you' }) : null
        ]),
        el('h3.rcard-title', { text: report.title }),
        el('p.rcard-where', { text: report.loc.label }),
        el('p.rcard-meta', { text: NEXT[report.status] + ' · ' + ui.ago(report.createdAt) }),
        report.status === 'confirmed' && report.rating
          ? el('p.rcard-meta', { text: 'You rated it ' + report.rating + '/5' })
          : null
      ])
    ]);
  }

  Havak.views.myReports = function (screen) {
    var me = auth.current();

    return store.where('reports', function (r) {
      return r.reporterId === me.id;
    }).then(function (mine) {
      /* the ones needing this reporter's confirmation come first — that is the
         only thing on this screen that is actually waiting on them */
      mine.sort(function (a, b) {
        if ((a.status === 'cleaned') !== (b.status === 'cleaned')) {
          return a.status === 'cleaned' ? -1 : 1;
        }
        return b.createdAt - a.createdAt;
      });

      var waiting = mine.filter(function (r) { return r.status === 'cleaned'; }).length;

      screen.appendChild(el('div.wrap.pad', null, [
        el('div.panel-head', null, [
          el('h1', { text: 'Your reports' }),
          el('p.sub', {
            text: mine.length
              ? mine.length + (mine.length === 1 ? ' spot reported' : ' spots reported') +
                (waiting ? ' · ' + waiting + ' waiting for your check' : '')
              : 'Nothing reported yet.'
          })
        ]),

        el('button.btn.btn-primary.btn-block.btn-lg', {
          type: 'button',
          text: 'Report a spot',
          onclick: function () { Havak.router.go('/report/new'); }
        }),

        mine.length
          ? el('ul.rlist.rlist-top', null, mine.map(card))
          : ui.empty('No reports yet',
              'Found rubbish somewhere in Dilijan? Report it and a cleaner can take it on.')
      ]));
    });
  };
})();
