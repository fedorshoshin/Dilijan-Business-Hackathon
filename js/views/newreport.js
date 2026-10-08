/* Havak — the report form (tasks 2.1, 2.2, 2.3), and the same form again for
   editing a report the reporter already posted.

   Everything a cleaner needs to decide whether to take the job, asked in the
   order a person standing in front of a rubbish pile would answer it: where,
   what, how bad, how long, is it dangerous, what it pays.

   Photos are prepared (shrunk, stripped of EXIF) as soon as they are picked,
   held in memory while the form is filled in, and handed to the outbox the
   moment the report exists — they need its id before they can upload. When
   editing, photos already posted are removed only once the edit is saved. */

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
  var media = Havak.media;

  var LEVELS = [
    { n: 1, label: 'A few items' },
    { n: 2, label: 'A bagful' },
    { n: 3, label: 'Several bags' },
    { n: 4, label: 'A big pile' },
    { n: 5, label: 'A dumping ground' }
  ];

  var TIMES = [30, 60, 90, 120, 180, 240];

  /* With a report id this edits that report; the server allows it only for
     its reporter and only while nobody has taken the job on. */
  Havak.views.newReport = function (screen, reportId) {
    if (!reportId) { form(screen, null); return; }

    return store.find('reports', reportId).then(function (report) {
      var me = auth.current();
      if (!report || !me || report.reporterId !== me.id) {
        screen.appendChild(el('div.wrap.pad', null, [
          ui.empty('That report is not yours to edit', 'Only the person who reported a spot can change it.')
        ]));
        return;
      }
      if (report.status !== 'open') {
        screen.appendChild(el('div.wrap.pad', null, [
          ui.empty('This report can no longer be edited',
                   'A cleaner has taken it on, so the place, the job and the price stay as they saw them.'),
          el('a.btn.btn-ghost.btn-block', { href: '#/spot/' + report.id, text: 'Back to the report' })
        ]));
        return;
      }
      return media.forReport(report.id).then(function (got) {
        form(screen, report, got);
      });
    });
  };

  function form(screen, report, got) {
    var editing = !!report;
    var draft = editing ? {
      loc: { x: report.loc.x, y: report.loc.y, lat: report.loc.lat, lng: report.loc.lng },
      level: report.level,
      hazardous: report.hazardous,
      estMinutes: report.estMinutes
    } : {
      loc: null,               // { x, y, lat, lng } — set by map tap or GPS
      level: 3,
      hazardous: false,
      estMinutes: 60
    };

    var errBox = el('p.err', { hidden: true, role: 'alert' });

    /* ---------- where ---------- */
    var whereNote = el('p.field-hint', {
      text: editing ? 'Tap the map to move the marker, or use your location.' : 'Tap the map, or use your location.'
    });

    /* The map reports real coordinates now. x/y is still derived and sent
       because the server column is NOT NULL, but nothing draws from it. */
    function placed(lat, lng) {
      var at = geo.toXY(lat, lng);
      draft.loc = { x: at.x, y: at.y, lat: lat, lng: lng };
      clearError();
    }

    var mapBox = Havak.map.render({
      selectable: true,
      pin: draft.loc,
      onPick: placed
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
          /* A real map can show anywhere, so being outside Dilijan is no longer
             a refusal — it just moves the view. The old drawn map had to say no,
             because it had no ground to put the pin on. */
          if (!mapBox.place(fix.lat, fix.lng)) {
            whereNote.textContent = 'The map is still loading — try that again in a moment.';
            return;
          }
          /* place() drives the marker, which fires onPick -> placed(), so the
             draft is already updated by the time we get here. */
          whereNote.textContent = 'Your location · accurate to about ' + fix.accuracy + ' m' +
            (geo.inArea(fix.lat, fix.lng) ? '' : ' · outside the Dilijan pilot area');
        });
      }
    });

    var label = el('input', {
      type: 'text', maxlength: '60', required: true,
      value: editing ? report.loc.label : '',
      placeholder: 'e.g. Riverbank behind the market',
      oninput: clearError
    });

    /* ---------- what ---------- */
    var title = el('input', {
      type: 'text', maxlength: '60', required: true,
      value: editing ? report.title : '',
      placeholder: 'e.g. Riverbank dump',
      oninput: clearError
    });
    var desc = el('textarea', {
      rows: '3', maxlength: '300', required: true,
      placeholder: 'What is there? Bottles, building waste, something worse?',
      oninput: clearError
    });
    if (editing) desc.value = report.desc;

    /* ---------- photos ----------
       `kept` is what is already posted (and anything still uploading from this
       phone); `shots` is what was picked on this screen. */
    var me = auth.current();
    var kept = editing
      ? got.uploaded.concat(got.pending).filter(function (m) { return m.kind === 'before'; })
      : [];
    var removed = [];                            /* ids of posted files to delete on save */
    var shots = [];                              /* { blob, mime, url } */
    var shotsBox = el('div');
    var shotsNote = el('p.field-hint', {
      text: 'Optional, but a cleaner decides faster with a picture. Videos up to 50 MB.'
    });

    function drawShots() {
      shotsBox.textContent = '';
      var all = kept.concat(shots);
      if (!all.length) return;
      shotsBox.appendChild(media.strip(all, {
        small: true,
        label: editing ? 'Photos' : 'Photos to post',
        canRemove: function (item) {
          return kept.indexOf(item) < 0 || (!item.pending && item.ownerId === me.id);
        },
        onRemove: function (item) {
          if (kept.indexOf(item) >= 0) {
            removed.push(item.id);
            kept.splice(kept.indexOf(item), 1);
          } else {
            URL.revokeObjectURL(item.url);
            shots.splice(shots.indexOf(item), 1);
          }
          drawShots();
        }
      }));
    }
    drawShots();

    var picker = media.pickButtons({
      onFiles: function (files) {
        shotsNote.textContent = 'Preparing…';
        media.prepareAll(files, media.MAX_FILES - kept.length - shots.length).then(function (res) {
          res.items.forEach(function (item) {
            item.url = URL.createObjectURL(item.blob);
            shots.push(item);
          });
          shotsNote.textContent = res.problem ||
            (shots.length + (shots.length === 1 ? ' file' : ' files') + ' ready to post.');
          drawShots();
        });
      }
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
    var hazardWarning = el('div.notice.notice-danger', { hidden: !draft.hazardous }, [
      el('strong', { text: 'Do not touch it yourself.' }),
      el('span', { text: ' Chemicals, asbestos, syringes, car batteries and ' +
        'gas canisters need trained handling. We will flag this spot so ' +
        'volunteers are warned and it is routed for official collection.' })
    ]);

    var hazardBox = el('input', {
      type: 'checkbox',
      checked: draft.hazardous,
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

    /* ---------- what it will pay ----------
       The reporter sets the price. The formula is offered as a suggestion, and
       the field follows it until the reporter types their own number. */
    var priceSet = editing;
    var price = el('input.payout-input', {
      id: 'payout-price',
      type: 'number', inputmode: 'numeric', step: '100', required: true,
      min: String(money.MIN), max: String(money.MAX),
      'aria-label': 'Price in AMD',
      value: editing ? String(report.payout) : '',
      oninput: function () {
        priceSet = true;
        clearError();
        refreshPayout();
      }
    });
    var payoutParts = el('p.payout-parts');
    var useSuggested = el('button.btn.btn-ghost', {
      type: 'button',
      text: 'Use the suggested price',
      onclick: function () {
        priceSet = false;
        clearError();
        refreshPayout();
      }
    });

    function refreshPayout() {
      var suggested = money.payoutFor(draft);
      if (!priceSet) price.value = String(suggested);
      payoutParts.textContent = 'Suggested ' + ui.amd(suggested) + ': ' +
        money.breakdown(draft).map(function (row) {
          return row.label + ' ' + ui.amd(row.amount);
        }).join('  ·  ');
      useSuggested.hidden = Number(price.value) === suggested;
    }
    refreshPayout();

    var payoutBox = el('div.payout', null, [
      el('label.payout-head', { 'for': 'payout-price', text: 'This cleanup will pay' }),
      el('div.payout-row', null, [price, el('span.payout-unit', { text: 'AMD' })]),
      payoutParts,
      useSuggested,
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

    var submitText = editing ? 'Save changes' : 'Post this report';
    var submit = el('button.btn.btn-primary.btn-block.btn-lg', {
      type: 'submit', text: submitText
    });

    var formNode = el('form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();

        if (!draft.loc) return fail('Place the spot on the map first, or use your location.');
        if (title.value.trim().length < 3) return fail('Give the spot a short name.', title);
        if (label.value.trim().length < 3) return fail('Say where it is in words, so a cleaner can find it.', label);
        if (desc.value.trim().length < 10) return fail('Describe what is there, in a sentence or two.', desc);
        var amount = Number(price.value);
        if (!Number.isInteger(amount) || amount < money.MIN || amount > money.MAX) {
          return fail('Set a price between ' + ui.amd(money.MIN) + ' and ' + ui.amd(money.MAX) + '.', price);
        }

        submit.disabled = true;
        submit.textContent = editing ? 'Saving…' : 'Posting…';

        var record = {
          reporterId: me.id,
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
          payout: amount,
          media: [],
          status: 'open'
        };

        (editing ? saveEdit(record) : store.add('reports', record)).then(function (report) {
          if (editing) {
            /* Saved. New photos go the same way as on a new report. */
            return (shots.length ? media.queue(report.id, 'before', shots) : Promise.resolve())
              .then(function () { ui.toast('Changes saved.'); },
                    function (err) { ui.toast(err.message || 'Saved, but the new photos could not be added.'); })
              .then(function () { Havak.router.go('/spot/' + report.id, true); });
          }
          if (!shots.length) {
            ui.toast('Reported. Cleaners can see it now.');
            Havak.router.go('/spot/' + report.id, true);
            return;
          }
          /* The report is saved; photos going wrong now must not look like
             the report failed. They are on the phone and will keep trying. */
          return media.queue(report.id, 'before', shots).then(function () {
            ui.toast('Reported. Your photos are uploading.');
          }, function (err) {
            ui.toast(err.message || 'Reported, but the photos could not be saved.');
          }).then(function () {
            Havak.router.go('/spot/' + report.id, true);
          });
        }).catch(function (err) {
          submit.disabled = false;
          submit.textContent = submitText;
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
        el('label.field', null, [ el('span', { text: 'Description' }), desc ]),
        el('div.field', null, [
          el('span.field-label', { text: 'Photos' }),
          shotsNote,
          shotsBox,
          picker
        ])
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
      submit
    ]);

    /* The report first, then the photos taken out — so a refused edit (a
       cleaner claimed it a moment ago) leaves the photos where they were. */
    function saveEdit(record) {
      return store.update('reports', report.id, record).then(function (saved) {
        return removed.reduce(function (p, mediaId) {
          return p.then(function () { return Havak.api.deleteMedia(mediaId); });
        }, Promise.resolve()).then(function () { return saved; }, function () {
          ui.toast('Saved, but a photo could not be removed.');
          return saved;
        });
      });
    }

    screen.appendChild(el('div.wrap.pad', null, [
      el('div.panel-head', null, [
        el('h1', { text: editing ? 'Edit report' : 'Report a spot' }),
        el('p.sub', {
          text: editing
            ? 'You can change anything until a cleaner takes it on.'
            : 'Six things, then it is on the map for everyone.'
        })
      ]),
      formNode
    ]));
  }
})();
