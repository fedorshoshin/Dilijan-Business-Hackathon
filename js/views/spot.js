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
  var media = Havak.media;

  var LEVEL_WORD = ['', 'A few items', 'A bagful', 'Several bags', 'A big pile', 'A dumping ground'];

  function fact(label, value) {
    return el('div.fact', null, [
      el('dt', { text: label }),
      el('dd', { text: value })
    ]);
  }

  /* Before and after, each a swipeable strip. The reporter can add to
     "before", the cleaner working the spot to "after" — the same rule the
     server enforces; this only decides which buttons to show. */
  function photos(report, me, mine, iAmCleaner) {
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

      photos(report, me, mine, iAmCleaner),

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
        text: 'Claiming lands in Phase 4, confirming in Phase 5, funding this ' +
              'spot in Phase 6.'
      })
    ]);

    screen.appendChild(body);
  }
})();
