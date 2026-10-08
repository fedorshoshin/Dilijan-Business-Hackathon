/* Havak — what a cleanup pays.

   The reporter sets the price. This formula is the suggestion the form starts
   from, with its parts shown so the number is explained, not asserted. The
   server has the same formula (`price` in server/payout.py) for older copies of
   the app that send no price, and the same MIN/MAX bounds (server/models.py).
   Change them in both places at once.

   The reporter may change the price only while the spot is open. Once a
   cleaner claims it for 5 800 AMD, they get 5 800 AMD. (BACKEND.md §3.7.)

   DESIGN.md open decision #3: these numbers are a first pass, to be tuned with
   real Dilijan rates. */

window.Havak = window.Havak || {};

Havak.money = (function () {
  'use strict';

  var BASE = 1000;          // AMD, for turning up at all
  var PER_MINUTE = 40;      // AMD per estimated minute
  var HAZARD_EXTRA = 0.5;   // +50% for protective gear and careful handling
  var ROUND_TO = 100;       // nobody quotes 5 847 AMD
  var MIN = 500;            // the lowest price a reporter may set
  var MAX = 100000;         // the highest — one typo must not empty the pot

  function payoutFor(input) {
    var minutes = Math.max(0, Number(input.estMinutes) || 0);
    var raw = BASE + minutes * PER_MINUTE;
    if (input.hazardous) raw = raw * (1 + HAZARD_EXTRA);
    return Math.round(raw / ROUND_TO) * ROUND_TO;
  }

  /* the parts, so the form can explain the number instead of just asserting it */
  function breakdown(input) {
    var minutes = Math.max(0, Number(input.estMinutes) || 0);
    var rows = [
      { label: 'Turning up', amount: BASE },
      { label: minutes + ' min of work', amount: minutes * PER_MINUTE }
    ];
    if (input.hazardous) {
      rows.push({
        label: 'Hazardous handling',
        amount: Math.round((BASE + minutes * PER_MINUTE) * HAZARD_EXTRA)
      });
    }
    return rows;
  }

  return {
    BASE: BASE,
    PER_MINUTE: PER_MINUTE,
    HAZARD_EXTRA: HAZARD_EXTRA,
    MIN: MIN,
    MAX: MAX,
    payoutFor: payoutFor,
    breakdown: breakdown
  };
})();
