/* Havak — honest placeholders for the tabs whose phase has not been built yet.

   Deliberately not fake screens. A placeholder that says which phase builds it
   is useful; a mocked-up dashboard that does nothing is a lie we would have to
   unpick later. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;

  var PLANNED = {
    jobs: {
      title: 'Jobs board',
      phase: 'Phase 4',
      lines: [
        'Every reported spot nobody has claimed yet.',
        'Filter by area, by how long it takes, and hide hazardous waste.',
        'Claim one and it disappears from everyone else\'s board.',
        'Mark it cleaned with an after-photo, and get paid.'
      ]
    },
    give: {
      title: 'Fund the work',
      phase: 'Phase 6',
      lines: [
        'Give to the general pot, or to one specific cleanup.',
        'Then see exactly which cleanups your money paid for —',
        'named, dated, with the before and after photos.'
      ]
    }
  };

  Havak.views.soon = function (key) {
    return function (screen) {
      var plan = PLANNED[key];
      screen.appendChild(el('div.wrap.pad', null, [
        el('div.soon', null, [
          el('span.soon-badge', { text: plan.phase }),
          el('h1.soon-title', { text: plan.title }),
          el('p.soon-lead', { text: 'Not built yet. Here is what lands here:' }),
          el('ul.soon-list', null, plan.lines.map(function (line) {
            return el('li', { text: line });
          }))
        ])
      ]));
    };
  };
})();
