/* Havak — the Give tab (Phase 6): give, and see what the money bought.

     #/give            give to the general pot
     #/give/<spot id>  give to one spot, from its page (task 6.2)
     #/give/mine       what my money paid for (tasks 6.4, 6.5)

   No card is charged in the pilot (DESIGN.md §10). The ledger is real: a gift
   is recorded and drawn down by real cleanups exactly as money would be, and
   the screen says so plainly before anyone taps Give (task 6.3). */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var store = Havak.store;

  var PRESETS = [1000, 2000, 5000, 10000];
  var MIN = 100;            // the same bounds as NewDonation in server/models.py
  var MAX = 1000000;

  function day(ts) {
    return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- the two tabs ---------- */
  function tabs(at) {
    return el('div.segmented.subtabs', { role: 'tablist' }, [
      el('a.seg' + (at === 'give' ? '.is-on' : ''), {
        href: '#/give', role: 'tab', text: 'Give',
        'aria-selected': at === 'give' ? 'true' : 'false'
      }),
      el('a.seg' + (at === 'mine' ? '.is-on' : ''), {
        href: '#/give/mine', role: 'tab', text: 'Your impact',
        'aria-selected': at === 'mine' ? 'true' : 'false'
      })
    ]);
  }

  /* ---------- give (tasks 6.1-6.3) ---------- */
  function give(screen, reportId) {
    return Promise.all([
      Havak.api.pot(),
      reportId ? store.find('reports', reportId) : Promise.resolve(null)
    ]).then(function (r) {
      var pot = r[0];
      var spot = r[1];
      /* A paid spot cannot take more (the server refuses it): say why, and
         offer the pot rather than a button that will fail. */
      var closed = spot && spot.status === 'confirmed';
      var target = spot && !closed ? spot : null;
      var amount = 2000;

      var errBox = el('p.err', { hidden: true, role: 'alert' });

      var custom = el('input', {
        type: 'number', inputmode: 'numeric', min: String(MIN), max: String(MAX), step: '100',
        placeholder: 'Other amount',
        'aria-label': 'Other amount in AMD',
        oninput: function () {
          var n = Number(custom.value);
          if (custom.value) choose(n, true);
        }
      });

      var chips = el('div.chips', { role: 'radiogroup', 'aria-label': 'How much?' },
        PRESETS.map(function (n) {
          return el('button.chip', {
            type: 'button', role: 'radio', text: ui.amd(n),
            onclick: function () { custom.value = ''; choose(n); }
          });
        }));

      var go = el('button.btn.btn-primary.btn-block.btn-lg', { type: 'button' });

      function choose(n, typed) {
        amount = n;
        errBox.hidden = true;
        Array.prototype.forEach.call(chips.children, function (b, i) {
          var on = !typed && PRESETS[i] === n;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        var ok = Number.isInteger(n) && n >= MIN && n <= MAX;
        go.textContent = ok ? 'Give ' + ui.amd(n) : 'Give';
      }
      choose(amount);

      go.addEventListener('click', function () {
        if (!Number.isInteger(amount) || amount < MIN || amount > MAX) {
          errBox.textContent = 'Choose an amount between ' + ui.amd(MIN) + ' and ' + ui.amd(MAX) + '.';
          errBox.hidden = false;
          custom.focus();
          return;
        }
        var was = go.textContent;
        go.disabled = true;
        go.textContent = 'Giving…';
        store.add('donations', {
          amount: amount,
          target: target ? target.id : 'general'
        }).then(function () {
          ui.toast('Thank you. ' + ui.amd(amount) +
                   (target ? ' given to “' + target.title + '”.' : ' added to the pot.'));
          Havak.router.go('/give/mine');
        }, function (err) {
          go.disabled = false;
          go.textContent = was;
          errBox.textContent = err.message || 'That did not go through. Try again.';
          errBox.hidden = false;
        });
      });

      var forSpot = target ? el('section.panel', null, [
        el('p.field-label', { text: 'Giving to this spot' }),
        el('h2.give-spot', { text: target.title }),
        el('p.rcard-where', { text: target.loc.label }),
        el('p.rcard-meta', {
          text: 'Pays ' + ui.amd(target.payout) + ' · ' + ui.amd(target.earmarked) + ' given to it so far'
        }),
        el('p.rcard-meta', {
          text: 'Pays this cleanup first. Anything beyond its price goes to the general pot.'
        }),
        el('a.give-switch', { href: '#/give', text: 'Give to the general pot instead' })
      ]) : null;

      screen.appendChild(el('div.wrap.pad', null, [
        el('div.panel-head', null, [
          el('h1', { text: 'Fund the work' }),
          el('p.sub', { text: 'Every dram pays a cleaner for a confirmed cleanup.' })
        ]),
        tabs('give'),

        el('div.earned', null, [
          el('p.earned-label', { text: 'In the pot now' }),
          el('p.earned-sum', { text: ui.amd(pot.available) }),
          el('p.earned-note', {
            text: ui.amd(pot.allocated) + ' paid for ' + pot.cleanups +
                  (pot.cleanups === 1 ? ' cleanup' : ' cleanups') + ' · ' +
                  pot.openSpots + (pot.openSpots === 1 ? ' spot' : ' spots') + ' waiting'
          })
        ]),

        closed ? el('div.notice', {
          text: '“' + spot.title + '” is already cleaned and paid, so this gift goes to the general pot.'
        }) : null,

        forSpot,

        el('section.panel', null, [
          el('div.panel-head', null, [ el('h2', { text: 'How much?' }) ]),
          chips,
          el('label.field', null, [ el('span', { text: 'Or type an amount (AMD)' }), custom ])
        ]),

        el('div.notice.give-pilot', null, [
          el('strong', { text: 'Pilot: no real payment is taken.' }),
          el('span', {
            text: ' No card is charged. Your gift is recorded and paid out to ' +
                  'cleaners in the app exactly as real money would be.'
          })
        ]),

        errBox,
        go
      ]));
    });
  }

  /* ---------- what my money bought (tasks 6.4, 6.5) ----------
     Read straight from the ledger: each gift, the alloc rows that drew on it,
     and the cleanups those paid — so given = spent + not yet spent, always,
     because both halves are sums of the same rows. */
  function bought(item) {
    function pic(url, label) {
      if (!url) return el('span.bought-pic.bought-none', { text: label });
      var img = el('img.bought-pic', { src: url, alt: label + ' photo', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', function () { img.replaceWith(el('span.bought-pic.bought-none', { text: label })); });
      return img;
    }
    var by = item.cleaner ? ' by ' + item.cleaner.name.split(' ')[0] : '';
    return el('li', null, [
      el('a.bought', { href: '#/spot/' + item.reportId }, [
        el('div.bought-pics', null, [pic(item.beforeUrl, 'Before'), pic(item.afterUrl, 'After')]),
        el('div.bought-text', null, [
          el('p.bought-title', { text: item.title }),
          el('p.rcard-meta', {
            text: (item.confirmedAt ? 'Cleaned ' + day(item.confirmedAt) : 'Cleaned') + by +
                  (item.rating ? ' · rated ' + item.rating + '/5' : '')
          }),
          el('p.job-pay', { text: 'Your ' + ui.amd(item.amount) })
        ])
      ])
    ]);
  }

  function giftCard(d) {
    var where = d.target === 'general'
      ? 'General pot'
      : (d.targetTitle ? 'For “' + d.targetTitle + '”' : 'For a withdrawn spot · now in the pot');
    var split = d.remaining > 0
      ? (d.allocated ? ui.amd(d.allocated) + ' spent · ' : '') +
        ui.amd(d.remaining) + ' not yet spent — it pays the next confirmed cleanup.'
      : 'All of it spent.';

    return el('li.rcard', null, [
      el('div.rcard-top', null, [ el('span.tag.tag-done', { text: where }) ]),
      el('h2.rcard-title', { text: ui.amd(d.amount) + ' · ' + day(d.createdAt) }),
      el('p.rcard-meta', { text: split }),
      d.bought.length
        ? el('ul.bought-list', { 'aria-label': 'Cleanups this paid for' }, d.bought.map(bought))
        : null
    ]);
  }

  function mine(screen) {
    /* From the server rather than the store's cache: what a gift has bought
       changes whenever a reporter confirms, on someone else's phone. */
    return Havak.api.donationsMine().then(function (gifts) {
      var given = 0, spent = 0, waiting = 0, paidFor = {};
      gifts.forEach(function (d) {
        given += d.amount;
        spent += d.allocated;
        waiting += d.remaining;
        d.bought.forEach(function (b) { paidFor[b.reportId] = true; });
      });
      var cleanups = Object.keys(paidFor).length;

      screen.appendChild(el('div.wrap.pad', null, [
        el('div.panel-head', null, [
          el('h1', { text: 'Your impact' }),
          el('p.sub', { text: 'Every gift, and the cleanups it paid for.' })
        ]),
        tabs('mine'),

        gifts.length ? el('div.earned', null, [
          el('p.earned-label', { text: 'You have given' }),
          el('p.earned-sum', { text: ui.amd(given) }),
          el('p.earned-note', {
            text: ui.amd(spent) + ' paid for ' + cleanups + (cleanups === 1 ? ' cleanup' : ' cleanups')
          }),
          el('p.earned-note', {
            text: waiting ? ui.amd(waiting) + ' not yet spent' : 'All of it spent'
          })
        ]) : null,

        gifts.length
          ? el('ul.rlist.rlist-top', null, gifts.map(giftCard))
          : el('div', null, [
              ui.empty('Nothing given yet',
                'Give any amount, and this page shows exactly which cleanups it paid for.'),
              el('a.btn.btn-primary.btn-block', { href: '#/give', text: 'Give now' })
            ])
      ]));
    });
  }

  Havak.views.give = function (screen, param) {
    return param === 'mine' ? mine(screen) : give(screen, param);
  };
})();
