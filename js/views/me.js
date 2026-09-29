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
    return Promise.all([
      store.where('reports',   function (r) { return r.reporterId === user.id; }),
      store.where('claims',    function (c) { return c.cleanerId === user.id; }),
      store.where('alloc',     function (a) { return a.cleanerId === user.id; }),
      store.where('donations', function (d) { return d.donorId === user.id; })
    ]).then(function (r) {
      var sum = function (rows, key) {
        return rows.reduce(function (n, row) { return n + row[key]; }, 0);
      };
      return {
        reported: r[0].length,
        cleaned: r[1].length,
        earned: sum(r[2], 'amount'),
        given: sum(r[3], 'amount')
      };
    });
  }

  /* Shown only when the server has explicitly told us the address is not
     confirmed. auth.verified() returns true when we were not told, so this never
     appears on a profile where the answer is simply unknown.

     A banner and not a wall: nothing in Havak is blocked on a confirmed address
     yet, and locking a pilot user out of reporting because our mail relay had a
     bad afternoon would be the wrong trade. The place to start requiring it is
     payouts, where the address becomes a money question. */
  function unverifiedBanner() {
    if (auth.verified()) return null;

    var line = el('span', {
      text: 'Confirm your email so we can reach you about your reports.'
    });

    var resend = el('button.btn.btn-sm', {
      type: 'button',
      text: 'Resend',
      onclick: function () {
        resend.disabled = true;
        resend.textContent = 'Sending…';
        auth.resendVerification().then(function (result) {
          ui.toast(result.message);
          /* Left disabled on success: the server throttles a second request for
             a minute anyway, and a button that can be hammered invites it. */
          if (result.ok) {
            resend.textContent = 'Sent';
          } else {
            resend.disabled = false;
            resend.textContent = 'Resend';
          }
        });
      }
    });

    return el('div.notice.notice-act', null, [line, resend]);
  }

  Havak.views.me = function (screen) {
    var user = auth.current();
    return tally(user).then(function (t) {

    /* --- identity --- */
    var head = el('div.me-head', null, [
      ui.avatar(user, 'lg'),
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
          var wanted = box.checked;
          box.disabled = true;
          auth.setRole(role.key, wanted).then(function (ok) {
            box.disabled = false;
            if (!ok) {
              box.checked = true;
              ui.toast('Keep at least one role — an account needs something to do.');
              return;
            }
            Havak.shell.syncTabs();
            ui.toast(wanted ? role.label + ' turned on' : role.label + ' turned off');
            Havak.router.render();
          });
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
          auth.logOut().then(function () {
            Havak.shell.syncTabs();
            ui.toast('Logged out');
            Havak.router.go('/login', true);
          });
        }
      }),
      /* "Reset the demo data" is gone. It re-seeded this phone's own
         localStorage, which was harmless when that was all there was. The same
         button against a shared database would destroy other people's reports,
         and no single phone should be able to do that. */
      el('p.notice.notice-plain', {
        text: 'Your reports and donations are saved on the Havak server, so they ' +
              'follow you to any phone you sign in on. Other people using Havak ' +
              'can see your name and what you report.'
      })
    ]);

    screen.appendChild(el('div.wrap.pad', null, [
      head,
      unverifiedBanner(),
      cells.length ? stats : null,
      roles,
      actions
    ]));
    });
  };
})();
