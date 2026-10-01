/* Havak — the Jobs tab (Phase 4): the board, and the cleaner's own work.

   Two screens behind one tab, the same way /report holds the list and the form:

     #/jobs        the board — every spot a cleaner could take on
     #/jobs/mine   what I have taken on, and what I have earned

   The board's filters persist (task 4.2). They are saved on every change rather
   than on leaving, because the way out of this screen is usually tapping a spot,
   and a filter set that forgot itself on the way back would be worse than none. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;
  var auth = Havak.auth;
  var geo = Havak.geo;
  var work = Havak.work;

  /* ---------- the filters ----------
     localStorage, not sessionStorage: a cleaner works the same patch of Dilijan
     every week, so last week's settings are a better starting point than ours. */
  var KEY = 'havak-jobs-filter-v1';

  var DEFAULTS = {
    /* Hazardous spots are handled by trained collection, and the server refuses
       to let a volunteer claim one — so hiding them is the honest default, not a
       preference. The toggle exists so a cleaner can still see what is out
       there. */
    hideHazard: true,
    unclaimedOnly: true,
    maxMinutes: 0,       /* 0 = any */
    within: 0            /* metres; 0 = anywhere */
  };

  function loadFilters() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = typeof saved[k] === typeof DEFAULTS[k] ? saved[k] : DEFAULTS[k];
    });
    return out;
  }

  function saveFilters(f) {
    try { localStorage.setItem(KEY, JSON.stringify(f)); } catch (e) { /* private mode */ }
  }

  /* Where the phone is, remembered for the session so switching tabs does not
     re-prompt. Null means never asked; false means asked and refused. */
  var here = null;

  function apply(reports, f) {
    return reports.filter(function (r) {
      if (r.status !== 'open' && r.status !== 'claimed') return false;
      if (f.unclaimedOnly && r.status !== 'open') return false;
      if (f.hideHazard && r.hazardous) return false;
      if (f.maxMinutes && r.estMinutes > f.maxMinutes) return false;
      if (f.within && here) {
        if (distance(r) === null || distance(r) > f.within) return false;
      }
      return true;
    });
  }

  function distance(report) {
    if (!here || report.loc.lat == null) return null;
    return geo.metresBetween(here, { lat: report.loc.lat, lng: report.loc.lng });
  }

  function away(metres) {
    if (metres === null) return null;
    return metres < 950 ? metres + ' m away' : (metres / 1000).toFixed(1) + ' km away';
  }

  /* ---------- one job on the board ----------
     Card and claim button read as one object: the card tops it, a foot carries
     the money and the action. A full-width button between every card turned the
     list into stripes you had to read past. */
  function jobCard(report, me, repaint) {
    var far = away(distance(report));
    var bits = [ui.minutes(report.estMinutes), 'level ' + report.level];
    if (far) bits.unshift(far);

    /* The board is scanned, so claiming is one tap from here as well as from
       the spot itself. Same rule, same code — see Havak.work.offers. */
    var offer = work.offers(report, me)[0];

    var open = el('button.rcard.rcard-tap' + (offer ? '.rcard-joined' : ''), {
      type: 'button',
      onclick: function () { Havak.router.go('/spot/' + report.id); }
    }, [
      ui.thumb(report),
      el('div.rcard-top', null, [
        ui.statusTag(report.status),
        report.hazardous ? el('span.tag.tag-hazard', { text: 'Hazardous' }) : null
      ]),
      el('h3.rcard-title', { text: report.title }),
      el('p.rcard-where', { text: report.loc.label }),
      el('p.rcard-meta', { text: bits.join(' · ') }),
      offer ? null : el('p.job-pay', { text: ui.amd(report.payout) })
    ]);

    if (!offer) return el('li', null, [open]);

    return el('li', null, [
      open,
      el('div.job-foot', null, [
        el('span.job-pay', { text: ui.amd(report.payout) }),
        work.button(offer, report, function () { repaint(); }, 'btn-sm')
      ])
    ]);
  }

  /* ---------- the filter panel ----------
     Folded shut to begin with. A cleaner opens this tab to see jobs, and an
     open panel pushed every one of them below the fold. `note` is filled in by
     draw() so the shut panel still says what it is keeping back. */
  function filterPanel(f, note, onChange) {
    function toggle(label, key) {
      var input = el('input', {
        type: 'checkbox',
        checked: f[key] ? true : null,
        onchange: function () { f[key] = input.checked; onChange(); }
      });
      return el('label.choice', null, [input, el('span', { text: label })]);
    }

    /* The panel is built once and the list redraws under it, so a chip has to
       restyle itself — marking the new choice is this row's own job, not the
       redraw's. `after` lets a row do something slow first (asking for the
       phone's location) and only commit if it worked. */
    function chipRow(label, key, options, after) {
      var row = el('div.chips', { role: 'group', 'aria-label': label });
      var chips = [];

      function mark() {
        chips.forEach(function (c) {
          var on = f[key] === c.value;
          c.node.classList.toggle('is-on', on);
          c.node.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }

      options.forEach(function (opt) {
        var node = el('button.chip', {
          type: 'button',
          text: opt.label,
          onclick: function () {
            function commit() { f[key] = opt.value; mark(); onChange(); }
            if (after) after(opt.value, commit);
            else commit();
          }
        });
        chips.push({ node: node, value: opt.value });
        row.appendChild(node);
      });

      mark();
      return el('div.filter-row', null, [
        el('span.field-label', { text: label }),
        row
      ]);
    }

    /* Asking for the location only when a distance is actually chosen: a
       permission prompt on simply opening a tab is the kind of thing that makes
       people say no to everything. */
    function needLocation(value, commit) {
      if (!value || here) { commit(); return; }
      ui.toast('Finding where you are…');
      geo.locate().then(function (res) {
        if (!res.ok) {
          here = false;
          ui.toast(res.reason === 'denied'
            ? 'Location is off, so distance cannot be used.'
            : 'Could not work out where you are.');
          return;
        }
        here = { lat: res.lat, lng: res.lng };
        commit();
      });
    }

    return el('details.filters', null, [
      el('summary.filters-head', null, [
        el('span.filters-title', { text: 'Filters' }),
        note
      ]),
      el('div.filters-body', null, [
        chipRow('How long', 'maxMinutes', [
          { value: 0, label: 'Any' },
          { value: 30, label: 'Up to 30 min' },
          { value: 60, label: 'Up to 1h' },
          { value: 120, label: 'Up to 2h' }
        ]),
        chipRow('Near me', 'within', [
          { value: 0, label: 'Anywhere' },
          { value: 1000, label: 'Within 1 km' },
          { value: 3000, label: 'Within 3 km' }
        ], needLocation),
        el('div.filter-row', null, [
          toggle('Hide hazardous waste', 'hideHazard'),
          toggle('Only spots nobody has taken', 'unclaimedOnly')
        ])
      ])
    ]);
  }

  /* ---------- the board ---------- */
  function board(screen) {
    var me = auth.current();
    var f = loadFilters();
    var latest = [];            /* the last list from the server */
    var listBox = el('div');
    var note = el('span.filters-note');

    /* Filters are applied to the list we already have — no round trip, so the
       board reacts the instant a chip is tapped. */
    function draw() {
      var shown = apply(latest, f);

      shown.sort(function (a, b) {
        if (here) {
          var da = distance(a), db = distance(b);
          if (da !== null && db !== null && da !== db) return da - db;
        }
        return b.createdAt - a.createdAt;
      });

      var pot = shown.reduce(function (n, r) { return n + r.payout; }, 0);
      var takeable = latest.filter(function (r) {
        return r.status === 'open' || r.status === 'claimed';
      }).length;
      var hidden = takeable - shown.length;

      note.textContent = hidden
        ? hidden + (hidden === 1 ? ' spot hidden' : ' spots hidden')
        : 'showing everything';

      listBox.textContent = '';
      /* The hidden count lives on the filter panel, not here — saying it twice
         on one screen just makes both harder to read. */
      listBox.appendChild(el('p.sub', {
        text: shown.length
          ? shown.length + (shown.length === 1 ? ' job' : ' jobs') +
            ' · ' + ui.amd(pot) + ' on offer'
          : (hidden ? 'Nothing matches these filters.' : 'No open spots right now.')
      }));

      if (shown.length) {
        listBox.appendChild(Havak.map.render({
          reports: shown,
          onPinClick: function (id) { Havak.router.go('/spot/' + id); }
        }));
        listBox.appendChild(el('ul.rlist.rlist-top', null, shown.map(function (r) {
          return jobCard(r, me, refresh);
        })));
      } else {
        listBox.appendChild(ui.empty(
          hidden ? 'Nothing matches' : 'Nothing to clean yet',
          hidden
            ? 'Widen the filters above to see the ' + hidden +
              (hidden === 1 ? ' spot' : ' spots') + ' they are hiding.'
            : 'When somebody reports a spot in Dilijan, it lands here.'
        ));
      }
    }

    /* Draw from whatever the store already holds — instant after a claim, since
       the claim's own reply has been put in the cache. */
    function refresh() {
      return store.all('reports').then(function (fresh) {
        latest = fresh;
        draw();
      });
    }

    /* And separately, ask the server again, because somebody else may have taken
       a spot since this list was fetched. Deliberately not awaited by the
       buttons: a tap must not sit there for a second and a half waiting on a
       database in Mumbai. If the answer changes anything, the board redraws when
       it arrives — and claiming a spot that has gone is safe either way, because
       the server settles that race and says so. */
    function recheck() {
      store.invalidate('reports');
      return refresh();
    }

    screen.appendChild(el('div.wrap.pad', null, [
      el('div.panel-head', null, [
        el('h1', { text: 'Jobs' }),
        el('p.sub', { text: 'Pick a spot, clean it, get paid from the pot.' })
      ]),
      tabs('board'),
      filterPanel(f, note, function () { saveFilters(f); draw(); }),
      listBox
    ]));

    /* Painted from the cache, so it may be a few minutes old — check behind it.
       On a first visit there is nothing cached and refresh() has just been to
       the server, so a second trip would be pure waste. */
    var cached = store.isLoaded('reports');
    return refresh().then(function () { if (cached) recheck(); });
  }

  /* ---------- my work ---------- */
  var MINE_NEXT = {
    claimed:   'Yours to clean. Add an after photo, then mark it cleaned.',
    cleaned:   'Waiting for the reporter to check your photos.',
    confirmed: 'Confirmed and paid.',
    open:      'You gave this one back.'
  };

  function mineCard(report, earnedFor) {
    var paid = earnedFor[report.id];
    var meta = [ui.minutes(report.estMinutes), ui.amd(report.payout)];

    return el('li', null, [
      el('button.rcard.rcard-tap' + (report.status === 'claimed' ? '.needs-you' : ''), {
        type: 'button',
        onclick: function () { Havak.router.go('/spot/' + report.id); }
      }, [
        ui.thumb(report),
        el('div.rcard-top', null, [
          ui.statusTag(report.status),
          report.status === 'claimed' ? el('span.tag.tag-you', { text: 'To do' }) : null,
          report.disputed ? el('span.tag.tag-hazard', { text: 'Disputed' }) : null
        ]),
        el('h3.rcard-title', { text: report.title }),
        el('p.rcard-where', { text: report.loc.label }),
        el('p.rcard-meta', { text: meta.join(' · ') }),
        el('p.rcard-meta', { text: MINE_NEXT[report.status] || '' }),
        paid ? el('p.job-pay', { text: ui.amd(paid) + ' paid' }) : null
      ])
    ]);
  }

  function mine(screen) {
    return Promise.all([
      store.all('myjobs'),
      store.all('alloc')
    ]).then(function (r) {
      var jobs = r[0];
      var payments = r[1];

      /* Earnings are the sum of this cleaner's alloc rows — the same number the
         ledger would give, not a count of jobs times their quoted payout. Those
         two differ whenever the pot was short (BACKEND.md §3.4), and the one
         that matters is what was actually paid. */
      var earned = payments.reduce(function (n, p) { return n + p.amount; }, 0);
      var earnedFor = {};
      payments.forEach(function (p) {
        if (p.reportId) earnedFor[p.reportId] = (earnedFor[p.reportId] || 0) + p.amount;
      });

      var ORDER = { claimed: 0, cleaned: 1, confirmed: 2, open: 3 };
      jobs.sort(function (a, b) {
        var d = (ORDER[a.status] || 9) - (ORDER[b.status] || 9);
        return d !== 0 ? d : (b.myClaim && b.myClaim.claimedAt) - (a.myClaim && a.myClaim.claimedAt);
      });

      var todo = jobs.filter(function (j) { return j.status === 'claimed'; }).length;
      var waiting = jobs.filter(function (j) { return j.status === 'cleaned'; }).length;
      var done = jobs.filter(function (j) { return j.status === 'confirmed'; }).length;

      screen.appendChild(el('div.wrap.pad', null, [
        el('div.panel-head', null, [
          el('h1', { text: 'Your work' }),
          el('p.sub', { text: 'Everything you have taken on, and what it earned.' })
        ]),
        tabs('mine'),

        el('div.earned', null, [
          el('p.earned-label', { text: 'Earned so far' }),
          el('p.earned-sum', { text: ui.amd(earned) }),
          el('p.earned-note', {
            text: done
              ? done + (done === 1 ? ' cleanup' : ' cleanups') + ' confirmed and paid'
              : 'Paid when a reporter confirms your work.'
          })
        ]),

        el('div.stats', null, [
          el('div.stat', null, [
            el('strong', { text: String(todo) }), el('span', { text: 'To do' })
          ]),
          el('div.stat', null, [
            el('strong', { text: String(waiting) }), el('span', { text: 'Awaiting check' })
          ]),
          el('div.stat', null, [
            el('strong', { text: String(done) }), el('span', { text: 'Confirmed' })
          ])
        ]),

        jobs.length
          ? el('ul.rlist.rlist-top', null, jobs.map(function (j) {
              return mineCard(j, earnedFor);
            }))
          : ui.empty('Nothing taken on yet',
              'Open the board and pick a spot — it is yours once you tap “Take this on”.')
      ]));
    });
  }

  /* ---------- the two tabs ---------- */
  function tabs(at) {
    return el('div.segmented.subtabs', { role: 'tablist' }, [
      el('a.seg' + (at === 'board' ? '.is-on' : ''), {
        href: '#/jobs', role: 'tab', text: 'Board',
        'aria-selected': at === 'board' ? 'true' : 'false'
      }),
      el('a.seg' + (at === 'mine' ? '.is-on' : ''), {
        href: '#/jobs/mine', role: 'tab', text: 'Your work',
        'aria-selected': at === 'mine' ? 'true' : 'false'
      })
    ]);
  }

  Havak.views.jobs = function (screen, param) {
    return param === 'mine' ? mine(screen) : board(screen);
  };
})();
