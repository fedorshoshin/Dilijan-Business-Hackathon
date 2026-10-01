/* Havak — the cleaning actions: claim, release, mark cleaned.

   These live here rather than in a view because two screens offer them — the
   jobs board and a spot's own page — and a button that appears in one place but
   not the other, or that applies a slightly different rule, reads to a user as a
   bug. There is one answer to "what can this person do with this report right
   now", and it is `offers()`.

   The server owns every one of these rules; this file decides what to *show*.
   Where the two could disagree, the server's refusal is shown verbatim rather
   than swallowed — see `run()`. */

window.Havak = window.Havak || {};

Havak.work = (function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var api = Havak.api;
  var store = Havak.store;
  var auth = Havak.auth;

  /* Every one of these changes a report's status, which changes the board, the
     cleaner's own list and the profile tally. Drop all three rather than try to
     patch them in place: a wrong cached status here costs somebody a wasted
     walk across town. */
  function run(call, reportId) {
    return call(reportId).then(function (report) {
      store.invalidate('reports', 'claims', 'myjobs');
      return { ok: true, report: report };
    }, function (err) {
      return { ok: false, code: err.code, message: err.message || 'That did not work.' };
    });
  }

  function claim(reportId) { return run(api.claim, reportId); }
  function release(reportId) { return run(api.release, reportId); }
  function markCleaned(reportId) { return run(api.markCleaned, reportId); }

  /* ---------- what this person may do ----------
     One list, consulted by both screens. `me` may be null while a render is
     still settling, which is why every branch checks it. */
  function offers(report, me) {
    var out = [];
    if (!report || !me) return out;

    var isCleaner = auth.hasRole('cleaner', me);
    var mine = report.reporterId === me.id;
    var claim = report.claim || report.myClaim;
    var iAmOnIt = !!(claim && claim.cleanerId === me.id && claim.status === 'active');

    if (report.status === 'open' && isCleaner && !mine && !report.hazardous) {
      out.push({ key: 'claim', label: 'Take this on', primary: true });
    }
    if (report.status === 'claimed' && iAmOnIt) {
      out.push({ key: 'cleaned', label: 'I have cleaned it', primary: true });
      out.push({ key: 'release', label: 'Give it back' });
    }
    return out;
  }

  /* ---------- the buttons ----------
     `onDone(report)` is called only after the server has agreed. Releasing asks
     first: it is the one action here that takes something away from the person
     tapping, and a mis-tap on a phone in a pocket should not lose a job. */
  var ASK = {
    release: 'Give this spot back so another cleaner can take it?'
  };

  var BUSY = {
    claim: 'Taking it…',
    cleaned: 'Saving…',
    release: 'Giving it back…'
  };

  var SAID = {
    claim: 'Yours. It has left everyone else\'s board.',
    cleaned: 'Marked cleaned. The reporter checks the photos next.',
    release: 'Given back. It is on the board again.'
  };

  var ACTIONS = { claim: claim, cleaned: markCleaned, release: release };

  function button(offer, report, onDone) {
    var node = el('button.btn.btn-block' + (offer.primary ? '.btn-primary' : '.btn-ghost'), {
      type: 'button',
      text: offer.label,
      onclick: function () {
        if (ASK[offer.key] && !window.confirm(ASK[offer.key])) return;

        var was = node.textContent;
        node.disabled = true;
        node.textContent = BUSY[offer.key];

        ACTIONS[offer.key](report.id).then(function (res) {
          if (!res.ok) {
            node.disabled = false;
            node.textContent = was;
            ui.toast(res.message);
            return;
          }
          ui.toast(SAID[offer.key]);
          if (onDone) onDone(res.report);
        });
      }
    });
    return node;
  }

  /* The whole action area for one report, or null when there is nothing this
     person can do — in which case the screen says what it is waiting on
     instead, which is more use than a greyed-out button. */
  function actions(report, me, onDone) {
    var list = offers(report, me);
    if (!list.length) return null;
    return el('div.work-actions', null, list.map(function (offer) {
      return button(offer, report, onDone);
    }));
  }

  return {
    claim: claim,
    release: release,
    markCleaned: markCleaned,
    offers: offers,
    actions: actions
  };
})();
