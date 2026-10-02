/* Havak — what a cleanup pays.

   The form uses this to show a reporter what their spot will pay, and to
   explain the number. It does not decide it: the server prices every spot
   itself, with the same formula (`price` in server/payout.py), and ignores any
   figure the phone sends — the app's code is public, so a phone's number could
   be anything. Change the rates in both places at once, or the form will quote
   a price the server does not store.

   The payout is fixed when the report is created and never recalculated —
   a cleaner who claims a job for 5 800 AMD gets 5 800 AMD, even if the formula
   changes next month. (BACKEND.md §3.7.)

   DESIGN.md open decision #3: these numbers are a first pass, to be tuned with
   real Dilijan rates. */

window.Havak = window.Havak || {};

Havak.money = (function () {
  'use strict';

  var BASE = 1000;          // AMD, for turning up at all
  var PER_MINUTE = 40;      // AMD per estimated minute
  var HAZARD_EXTRA = 0.5;   // +50% for protective gear and careful handling
  var ROUND_TO = 100;       // nobody quotes 5 847 AMD

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
    payoutFor: payoutFor,
    breakdown: breakdown
  };
})();
