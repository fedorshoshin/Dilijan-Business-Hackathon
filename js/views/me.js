/* Havak — the Me tab: profile, roles, sign out. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var ui = Havak.ui;
  var auth = Havak.auth;
  var store = Havak.store;

  /* counts that are true today — the real dashboards land in later phases */
  function tally(user) {
    var mine = store.where('reports', function (r) { return r.reporterId === user.id; });
    var myClaims = store.where('claims', function (c) { return c.cleanerId === user.id; });
    var earned = store.where('alloc', function (a) { return a.cleanerId === user.id; })
      .reduce(function (sum, a) { return sum + a.amount; }, 0);
    var given = store.where('donations', function (d) { return d.donorId === user.id; })
      .reduce(function (sum, d) { return sum + d.amount; }, 0);

    return { reported: mine.length, cleaned: myClaims.length, earned: earned, given: given };
  }

  Havak.views.me = function (screen) {
    var user = auth.current();
    var t = tally(user);

    /* --- identity --- */
    var head = el('div.me-head', null, [
      el('span.avatar.avatar-lg', { 'aria-hidden': 'true', text: ui.initials(user.name) }),
      el('div.me-id', null, [
        el('h1.me-name', { text: user.name }),
        el('p.me-meta', { text: user.place + ' · joined ' + ui.since(user.joinedAt) }),
        el('p.me-meta', { text: user.email })
      ])
    ]);

    /* --- numbers, only the ones that apply to this account --- */
    var cells = [];
    if (auth.hasRole('reporter', user)) cells.push(['Spots reported', String(t.reported)]);
    if (auth.hasRole('cleaner', user)) cells.push(['Jobs taken', String(t.cleaned)]);
    if (auth.hasRole('cleaner', user)) cells.push(['Earned', ui.amd(t.earned)]);
    if (auth.hasRole('donor', user)) cells.push(['Donated', ui.amd(t.given)]);

    var stats = el('div.stats', null, cells.map(function (c) {
      return el('div.stat', null, [
        el('strong', { text: c[1] }),
        el('span', { text: c[0] })
      ]);
    }));

    /* --- role toggles: these add and remove tabs live --- */
    var roleRows = auth.ROLES.map(function (role) {
      var on = auth.hasRole(role.key, user);
      var box = el('input', {
        type: 'checkbox',
        checked: on ? true : null,
        onchange: function () {
          var ok = auth.setRole(role.key, box.checked);
          if (!ok) {
            box.checked = true;
            ui.toast('Keep at least one role — an account needs something to do.');
            return;
          }
          Havak.shell.syncTabs();
          ui.toast(box.checked ? role.label + ' turned on' : role.label + ' turned off');
          Havak.router.render();
        }
      });
      return el('label.choice', null, [
        box,
        el('span', null, [
          el('strong', { text: role.label }),
          el('small', { text: role.hint })
        ])
      ]);
    });

    var roles = el('section.panel', null, [
      el('div.panel-head', null, [
        el('h2', { text: 'What you do' }),
        el('p.sub', { text: 'Turn these on and off any time. Your tabs follow them.' })
      ]),
      el('div.choices', null, roleRows)
    ]);

    /* --- account actions --- */
    var actions = el('section.panel', null, [
      el('div.panel-head', null, [ el('h2', { text: 'Account' }) ]),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button',
        text: 'Log out',
        onclick: function () {
          auth.logOut();
          Havak.shell.syncTabs();
          ui.toast('Logged out');
          Havak.router.go('/login', true);
        }
      }),
      el('button.linkbtn.linkbtn-danger', {
        type: 'button',
        text: 'Reset the demo data',
        onclick: function () {
          if (!window.confirm('Reset every account, report and donation back to the starting data?')) return;
          store.reset();
          Havak.shell.syncTabs();
          Havak.router.go('/login', true);
          ui.toast('Demo reset');
        }
      }),
      el('p.notice.notice-plain', {
        text: 'Everything here is saved on this phone only. Nobody else can see ' +
              'it, and clearing your browser data clears it.'
      })
    ]);

    screen.appendChild(el('div.wrap.pad', null, [
      head,
      cells.length ? stats : null,
      roles,
      actions
    ]));
  };
})();
