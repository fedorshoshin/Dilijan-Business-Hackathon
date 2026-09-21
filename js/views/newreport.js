/* Havak — the report form (tasks 2.1, 2.2, 2.3).

   Everything a cleaner needs to decide whether to take the job, asked in the
   order a person standing in front of a rubbish pile would answer it: where,
   what, how bad, how long, is it dangerous. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;
  var auth = Havak.auth;
  var geo = Havak.geo;
  var money = Havak.money;

  var LEVELS = [
    { n: 1, label: 'A few items' },
    { n: 2, label: 'A bagful' },
    { n: 3, label: 'Several bags' },
    { n: 4, label: 'A big pile' },
    { n: 5, label: 'A dumping ground' }
  ];

  var TIMES = [30, 60, 90, 120, 180, 240];

  Havak.views.newReport = function (screen) {
    var draft = {
      loc: null,               // { x, y, lat, lng } — set by map tap or GPS
      level: 3,
      hazardous: false,
      estMinutes: 60
    };

    var errBox = el('p.err', { hidden: true, role: 'alert' });

    /* ---------- where ---------- */
    var whereNote = el('p.field-hint', { text: 'Tap the map, or use your location.' });

    var mapBox = Havak.map.render({
      selectable: true,
      onPick: function (x, y) {
        var real = geo.toLatLng(x, y);
        draft.loc = { x: x, y: y, lat: real.lat, lng: real.lng };
        whereNote.textContent = 'Marker placed · ' + geo.format(real.lat, real.lng);
        clearError();
      }
    });

    var gpsBtn = el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      text: 'Use my current location',
      onclick: function () {
        gpsBtn.disabled = true;
        gpsBtn.textContent = 'Finding you…';
        geo.locate().then(function (fix) {
          gpsBtn.disabled = false;
          gpsBtn.textContent = 'Use my current location';

          if (!fix.ok) {
            whereNote.textContent = fix.reason === 'denied'
              ? 'Location permission refused — tap the map instead.'
              : 'Could not get a location — tap the map instead.';
            return;
          }
          if (!geo.inArea(fix.lat, fix.lng)) {
            whereNote.textContent = 'You are outside the Dilijan area this map ' +
              'covers. Tap the map to place the spot by hand.';
            return;
          }
          var at = geo.toXY(fix.lat, fix.lng);
          draft.loc = { x: at.x, y: at.y, lat: fix.lat, lng: fix.lng };
          mapBox.replaceWith(mapBox = rebuildMap());
          whereNote.textContent = 'Your location · accurate to about ' + fix.accuracy + ' m';
          clearError();
        });
      }
    });

    function rebuildMap() {
      return Havak.map.render({
        selectable: true,
        pin: draft.loc,
        onPick: function (x, y) {
          var real = geo.toLatLng(x, y);
          draft.loc = { x: x, y: y, lat: real.lat, lng: real.lng };
          whereNote.textContent = 'Marker placed · ' + geo.format(real.lat, real.lng);
          clearError();
        }
      });
    }

    var label = el('input', {
      type: 'text', maxlength: '60', required: true,
      placeholder: 'e.g. Riverbank behind the market',
      oninput: clearError
    });

    /* ---------- what ---------- */
    var title = el('input', {
      type: 'text', maxlength: '60', required: true,
      placeholder: 'e.g. Riverbank dump',
      oninput: clearError
    });
    var desc = el('textarea', {
      rows: '3', maxlength: '300', required: true,
      placeholder: 'What is there? Bottles, building waste, something worse?',
      oninput: clearError
    });

    /* ---------- how bad ---------- */
    var levelOut = el('p.field-hint');
    var levelRow = el('div.segmented', { role: 'radiogroup', 'aria-label': 'How bad is it?' },
      LEVELS.map(function (lv) {
        return el('button.seg' + (lv.n === draft.level ? '.is-on' : ''), {
          type: 'button',
          role: 'radio',
          'aria-checked': lv.n === draft.level ? 'true' : 'false',
          text: String(lv.n),
          onclick: function () {
            draft.level = lv.n;
            Array.prototype.forEach.call(levelRow.children, function (b, i) {
              var on = LEVELS[i].n === lv.n;
              b.classList.toggle('is-on', on);
              b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            levelOut.textContent = lv.n + ' — ' + lv.label;
          }
        });
      }));
    levelOut.textContent = draft.level + ' — ' + LEVELS[draft.level - 1].label;

    /* ---------- how long ---------- */
    var timeRow = el('div.chips', { role: 'radiogroup', 'aria-label': 'How long will it take?' },
      TIMES.map(function (mins) {
        return el('button.chip' + (mins === draft.estMinutes ? '.is-on' : ''), {
          type: 'button',
          role: 'radio',
          'aria-checked': mins === draft.estMinutes ? 'true' : 'false',
          text: ui.minutes(mins),
          onclick: function () {
            draft.estMinutes = mins;
            Array.prototype.forEach.call(timeRow.children, function (b, i) {
              var on = TIMES[i] === mins;
              b.classList.toggle('is-on', on);
              b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            refreshPayout();
          }
        });
      }));

    /* ---------- hazardous ---------- */
    var hazardWarning = el('div.notice.notice-danger', { hidden: true }, [
      el('strong', { text: 'Do not touch it yourself.' }),
      el('span', { text: ' Chemicals, asbestos, syringes, car batteries and ' +
        'gas canisters need trained handling. We will flag this spot so ' +
        'volunteers are warned and it is routed for official collection.' })
    ]);

    var hazardBox = el('input', {
      type: 'checkbox',
      onchange: function () {
        draft.hazardous = hazardBox.checked;
        hazardWarning.hidden = !draft.hazardous;
        refreshPayout();
      }
    });

    var hazardField = el('fieldset.field', null, [
      el('legend', { text: 'Is any of it hazardous?' }),
      el('div.choices', null, [
        el('label.choice.choice-danger', null, [
          hazardBox,
          el('span', null, [
            el('strong', { text: 'Yes — hazardous waste' }),
            el('small', { text: 'Chemicals, asbestos, syringes, batteries, canisters' })
          ])
        ])
      ]),
      hazardWarning
    ]);

    /* ---------- what it will pay ---------- */
    var payoutValue = el('strong.payout-value');
    var payoutParts = el('p.payout-parts');

    function refreshPayout() {
      var amount = money.payoutFor(draft);
      payoutValue.textContent = ui.amd(amount);
      payoutParts.textContent = money.breakdown(draft).map(function (row) {
        return row.label + ' ' + ui.amd(row.amount);
      }).join('  ·  ');
    }
    refreshPayout();

    var payoutBox = el('div.payout', null, [
      el('p.payout-head', { text: 'This cleanup will pay' }),
      payoutValue,
      payoutParts,
      el('p.payout-note', {
        text: 'Paid to whoever cleans it, out of donations, once you confirm it is done.'
      })
    ]);

    /* ---------- submit ---------- */
    function clearError() { errBox.hidden = true; }

    function fail(message, focus) {
      errBox.textContent = message;
      errBox.hidden = false;
      if (focus) focus.focus();
      errBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return false;
    }

    var submit = el('button.btn.btn-primary.btn-block.btn-lg', {
      type: 'submit', text: 'Post this report'
    });

    var form = el('form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();

        if (!draft.loc) return fail('Place the spot on the map first, or use your location.');
        if (title.value.trim().length < 3) return fail('Give the spot a short name.', title);
        if (label.value.trim().length < 3) return fail('Say where it is in words, so a cleaner can find it.', label);
        if (desc.value.trim().length < 10) return fail('Describe what is there, in a sentence or two.', desc);

        submit.disabled = true;
        submit.textContent = 'Posting…';

        store.add('reports', {
          reporterId: auth.current().id,
          title: title.value.trim(),
          desc: desc.value.trim(),
          loc: {
            x: draft.loc.x, y: draft.loc.y,
            lat: draft.loc.lat, lng: draft.loc.lng,
            label: label.value.trim()
          },
          level: draft.level,
          hazardous: draft.hazardous,
          estMinutes: draft.estMinutes,
          payout: money.payoutFor(draft),
          media: [],
          status: 'open'
        }).then(function (report) {
          ui.toast('Reported. Cleaners can see it now.');
          Havak.router.go('/spot/' + report.id, true);
        }).catch(function (err) {
          submit.disabled = false;
          submit.textContent = 'Post this report';
          fail(err.message || 'That did not save. Try again.');
        });
      }
    }, [
      el('section.panel', null, [
        el('div.panel-head', null, [
          el('h2', { text: 'Where is it?' }),
          whereNote
        ]),
        mapBox,
        gpsBtn,
        el('label.field', null, [
          el('span', { text: 'Describe the place' }),
          label,
          el('small.field-hint', { text: 'A cleaner reads this to find it. Street, landmark, which side.' })
        ])
      ]),

      el('section.panel', null, [
        el('div.panel-head', null, [ el('h2', { text: 'What is there?' }) ]),
        el('label.field', null, [ el('span', { text: 'Short name' }), title ]),
        el('label.field', null, [ el('span', { text: 'Description' }), desc ])
      ]),

      el('section.panel', null, [
        el('div.panel-head', null, [ el('h2', { text: 'How bad is it?' }) ]),
        el('div.field', null, [ levelRow, levelOut ]),
        el('div.field', null, [
          el('span.field-label', { text: 'How long to clear it?' }),
          timeRow
        ])
      ]),

      el('section.panel', null, [ hazardField ]),

      payoutBox,
      errBox,
      submit,
      el('p.phase-note', { text: 'Photos and video attach here in Phase 3.' })
    ]);

    screen.appendChild(el('div.wrap.pad', null, [
      el('div.panel-head', null, [
        el('h1', { text: 'Report a spot' }),
        el('p.sub', { text: 'Five things, then it is on the map for everyone.' })
      ]),
      form
    ]));
  };
})();
