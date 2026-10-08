/* Havak — one report, seen by anybody (task 2.5).

   The same screen for all three roles. What differs is the action offered at
   the bottom, which is decided by who you are and what state the report is in:
   a cleaner takes it on (Havak.work), a donor funds it, the reporter edits or
   withdraws it while nobody has, and the reporter checks and rates the work once it is cleaned. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;
  var auth = Havak.auth;
  var geo = Havak.geo;
  var media = Havak.media;

  var LEVEL_WORD = ['', 'A few items', 'A bagful', 'Several bags', 'A big pile', 'A dumping ground'];

  /* How clean the reporter finds it. 1 and 2 send the job back (see confirm()),
     so their words say "not done" rather than merely "not great". */
  var RATING_WORD = ['', 'Not cleaned', 'Barely started', 'Mostly clean', 'Clean', 'Spotless'];

  function fact(label, value) {
    return el('div.fact', null, [
      el('dt', { text: label }),
      el('dd', { text: value })
    ]);
  }

  /* Before and after, each a swipeable strip. The reporter can add to
     "before", the cleaner working the spot to "after" — the same rule the
     server enforces; this only decides which buttons to show. */
  function photos(report, me, mine, iAmCleaner, onLoaded) {
    var box = el('section.spot-photos', { 'aria-label': 'Photos' });
    var urls = [];
    var painted = false;

    function load(state) {
      return media.forReport(report.id).then(function (got) {
        if (painted && !box.isConnected) return;        /* left the screen */
        painted = true;
        urls.forEach(function (u) { URL.revokeObjectURL(u); });
        urls = got.pending.map(function (p) { return p.url; });
        got.pending.forEach(function (p) { p.pending = state || 'Uploading…'; });

        if (onLoaded) onLoaded(got);
        box.textContent = '';
        if (got.failed) {
          box.appendChild(el('p.field-hint', { text: 'Photos could not be loaded right now.' }));
        }
        group(box, got, 'before', 'Before', mine);
        group(box, got, 'after', 'After', iAmCleaner);

        /* Something still on the phone: push it, then show the result. If it
           cannot go yet, say so rather than spin — the outbox tries again on
           the next launch and whenever the phone comes back online. */
        if (got.pending.length && !state) {
          media.flush().then(function (ok) {
            if (box.isConnected) load(ok ? null : 'Waiting to upload');
          });
        }
      });
    }

    function group(into, got, kind, heading, canAdd) {
      var items = got.uploaded.concat(got.pending).filter(function (m) { return m.kind === kind; });
      if (!items.length && !canAdd) return;

      var note = el('p.field-hint', {
        text: items.length ? '' : (kind === 'before'
          ? 'Add a photo so cleaners can see what they are taking on.'
          : 'Add a photo of the cleaned spot — the reporter confirms from it.')
      });
      if (!note.textContent) note.hidden = true;

      into.appendChild(el('div.shot-group', null, [
        el('h2.shot-head', { text: heading }),
        note,
        items.length
          ? media.strip(items, {
              label: heading + ' photos',
              canRemove: function (m) { return !m.pending && me && m.ownerId === me.id; },
              onRemove: remove
            })
          : null,
        canAdd
          ? media.pickButtons({
              onFiles: function (files) {
                var room = media.MAX_FILES - items.length;
                note.hidden = false;
                note.textContent = 'Preparing…';
                media.prepareAll(files, room).then(function (res) {
                  if (res.problem) ui.toast(res.problem);
                  if (!res.items.length) { note.textContent = res.problem || ''; return null; }
                  return media.queue(report.id, kind, res.items).then(function () { return load(); });
                }).catch(function (err) {
                  note.textContent = err.message || 'Those could not be added.';
                });
              }
            })
          : null
      ]));
    }

    function remove(item, fig) {
      if (!window.confirm('Remove this ' + (/^video/.test(item.mime) ? 'video' : 'photo') + '?')) return;
      fig.classList.add('is-busy');
      Havak.api.deleteMedia(item.id).then(function () {
        ui.toast('Removed.');
        load();
      }, function (err) {
        fig.classList.remove('is-busy');
        ui.toast(err.message || 'That could not be removed.');
      });
    }

    box.appendChild(ui.loading('Loading photos…'));
    load();
    return box;
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

  /* ---------- the reporter's check (tasks 5.2-5.4) ----------
     The first photo of each side by side, a 1-5 rating, and one button whose
     words say what that rating will do — pay, or send the job back — before it
     is pressed. The money is not the reporter's, so the button says whose it
     is: the pot's. */
  function confirmPanel(report, cleaner, onDone) {
    var who = cleaner ? cleaner.name.split(' ')[0] : 'the cleaner';
    var rating = 0;

    var compare = el('div.compare', { hidden: true });

    function side(label, item) {
      return el('figure.compare-side', null, [
        item
          ? el('img', { src: item.url, alt: label + ' photo', loading: 'lazy', decoding: 'async' })
          : el('span.compare-missing', { text: 'No photo' }),
        el('figcaption', { text: label })
      ]);
    }

    /* Called by the photo section once it has loaded, so the pictures are
       fetched once for the whole screen. Video is skipped: a still beside a
       still is the comparison, and every after must include a photo anyway. */
    function fill(got) {
      var shots = got.uploaded.filter(function (m) { return /^image\//.test(m.mime); });
      var first = function (kind) {
        for (var i = 0; i < shots.length; i++) if (shots[i].kind === kind) return shots[i];
        return null;
      };
      compare.textContent = '';
      compare.appendChild(side('Before', first('before')));
      compare.appendChild(side('After', first('after')));
      compare.hidden = false;
    }

    var word = el('p.field-hint', { text: 'Tap a number.' });
    var effect = el('p.confirm-effect', { hidden: true });
    var go = el('button.btn.btn-primary.btn-block.btn-lg', {
      type: 'button', text: 'Rate the work first', disabled: true
    });

    var row = el('div.segmented', { role: 'radiogroup', 'aria-label': 'How clean is it now?' },
      [1, 2, 3, 4, 5].map(function (n) {
        return el('button.seg', {
          type: 'button',
          role: 'radio',
          'aria-checked': 'false',
          'aria-label': n + ' — ' + RATING_WORD[n],
          text: String(n),
          onclick: function () { pick(n); }
        });
      }));

    function pick(n) {
      rating = n;
      Array.prototype.forEach.call(row.children, function (b, i) {
        var on = i + 1 === n;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      word.textContent = n + ' — ' + RATING_WORD[n];
      var sendBack = n <= 2;
      effect.hidden = false;
      effect.classList.toggle('is-back', sendBack);
      effect.textContent = sendBack
        ? 'Sends it back to ' + who + ' to finish. Nobody is paid until you confirm it clean.'
        : 'Confirms the cleanup and pays ' + who + ' ' + ui.amd(report.payout) + ' from the pot.';
      go.disabled = false;
      go.textContent = sendBack ? 'Send it back' : 'Confirm and pay';
    }

    go.addEventListener('click', function () {
      if (!rating) return;
      var was = go.textContent;
      go.disabled = true;
      go.textContent = 'Saving…';
      Havak.api.confirm(report.id, rating).then(function (res) {
        store.adoptReport(res.report);
        store.invalidate('alloc');
        if (res.disputed) {
          ui.toast('Sent back to ' + who + '.');
        } else if (res.shortfall > 0) {
          /* The pot ran short. Said as it is: the rest is owed, not lost. */
          ui.toast(ui.amd(report.payout - res.shortfall) + ' paid now, ' +
                   ui.amd(res.shortfall) + ' as donations arrive.');
        } else {
          ui.toast('Confirmed. ' + who + ' has been paid ' + ui.amd(report.payout) + '.');
        }
        onDone();
      }, function (err) {
        go.disabled = false;
        go.textContent = was;
        ui.toast(err.message || 'That did not save. Try again.');
      });
    });

    return {
      fill: fill,
      node: el('section.panel.confirm', null, [
        el('div.panel-head', null, [
          el('h2', { text: report.disputed ? 'Is it finished now?' : 'Is it really clean?' }),
          el('p.sub', { text: 'Compare the photos, then rate how clean the spot is now.' })
        ]),
        compare,
        el('div.field', null, [
          el('span.field-label', { text: 'How clean is it now?' }),
          row,
          word
        ]),
        effect,
        go
      ])
    };
  }

  /* What a confirmed cleanup actually paid — read off the ledger, not the
     quoted price, because the two differ whenever the pot was short. */
  function paidLine(report) {
    var line = el('p.next-paid', { hidden: true });
    Havak.api.allocations(report.id).then(function (rows) {
      var paid = rows.reduce(function (n, a) { return n + a.amount; }, 0);
      line.hidden = false;
      line.textContent = paid >= report.payout
        ? 'The cleaner was paid ' + ui.amd(paid) + ' from the pot.'
        : ui.amd(paid) + ' of ' + ui.amd(report.payout) +
          ' paid so far. The rest follows as donations arrive.';
    }, function () { /* the status above still says what matters */ });
    return line;
  }

  /* The reporter may change or take back a spot only while nobody is working
     on it — the server's rule; this decides only whether to show the buttons. */
  function ownerButtons(report) {
    var change = el('a.btn.btn-primary.btn-block', {
      href: '#/edit/' + report.id,
      text: 'Edit this report'
    });
    var node = el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      text: 'Withdraw this report',
      onclick: function () {
        if (!window.confirm('Withdraw this report? It disappears from the map and the jobs board, with its photos.')) return;
        node.disabled = true;
        node.textContent = 'Withdrawing…';
        store.remove('reports', report.id).then(function () {
          ui.toast('Withdrawn.');
          Havak.router.go('/report', true);
        }, function (err) {
          node.disabled = false;
          node.textContent = 'Withdraw this report';
          ui.toast(err.message || 'That could not be withdrawn.');
          /* Most likely a cleaner took it a moment ago: show them. */
          Havak.router.render();
        });
      }
    });
    return el('div.work-actions', null, [change, node]);
  }

  function paint(screen, report, reporter, cleaner, me) {
    var mine = reporter && me && reporter.id === me.id;
    var iAmCleaner = cleaner && me && cleaner.id === me.id;
    var first = cleaner ? cleaner.name.split(' ')[0] : null;
    var sentBack = report.status === 'claimed' && report.disputed;

    /* what happens next, said plainly, tailored to who is reading */
    var next;
    if (report.status === 'open') {
      next = mine
        ? 'Waiting for a cleaner to take it on.'
        : 'Nobody has taken this on yet.';
    } else if (sentBack) {
      next = iAmCleaner
        ? 'Sent back: the reporter rated it ' + report.rating + '/5. Finish the job, add a photo, ' +
          'and mark it cleaned again — or give it back.'
        : mine
          ? 'You sent this back with ' + report.rating + '/5. ' + (first || 'The cleaner') +
            ' can finish it or give it back.'
          : 'Sent back to the cleaner to finish.';
    } else if (report.status === 'claimed') {
      next = iAmCleaner
        ? 'You have taken this on. Mark it cleaned when you are done.'
        : (first ? first + ' has taken this on.' : 'A cleaner has taken this on.');
    } else if (report.status === 'cleaned') {
      next = mine
        ? (report.disputed
            ? 'Cleaned again after you sent it back. Check the new photos below.'
            : 'Cleaned. Check the photos and rate the work below.')
        : 'Cleaned, waiting for the reporter to confirm.';
    } else {
      next = report.rating
        ? 'Confirmed clean, rated ' + report.rating + '/5.'
        : 'Confirmed clean.';
    }

    var repaint = function () { Havak.router.render(); };
    var check = report.status === 'cleaned' && mine ? confirmPanel(report, cleaner, repaint) : null;

    var body = el('div.wrap.pad', null, [
      el('div.spot-head', null, [
        el('div.rcard-top', null, [
          ui.statusTag(report.status),
          report.hazardous ? el('span.tag.tag-hazard', { text: 'Hazardous' }) : null,
          sentBack ? el('span.tag.tag-open', { text: 'Sent back' }) : null
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

      photos(report, me, mine, iAmCleaner, check ? check.fill : null),

      Havak.map.render({ reports: [report] }),

      el('p.spot-where', { text: report.loc.label }),
      el('p.spot-coords', { text: geo.format(report.loc.lat, report.loc.lng) }),

      el('dl.facts', null, [
        fact('How bad', report.level + '/5 — ' + LEVEL_WORD[report.level]),
        fact('Time to clear', ui.minutes(report.estMinutes)),
        fact('Pays', ui.amd(report.payout)),
        report.earmarked ? fact('Given for it', ui.amd(report.earmarked)) : null,
        fact('Status', (ui.STATUS[report.status] || {}).label || report.status)
      ]),

      el('div.next-up', null, [
        el('p.next-text', { text: next }),
        report.status === 'confirmed' ? paidLine(report) : null
      ]),

      check ? check.node : null,

      /* The state changed under everyone, not just here — so repaint from the
         server rather than patching this screen's copy of the report. */
      Havak.work.actions(report, me, repaint),

      report.status === 'open' && mine ? ownerButtons(report) : null,

      /* Task 6.2. Not once it is confirmed: it is paid, and the server would
         refuse money earmarked for it. */
      report.status !== 'confirmed' && auth.hasRole('donor', me)
        ? el('div.work-actions', null, [
            el('a.btn.btn-ghost.btn-block', { href: '#/give/' + report.id, text: 'Fund this cleanup' })
          ])
        : null
    ]);

    screen.appendChild(body);
  }
})();
