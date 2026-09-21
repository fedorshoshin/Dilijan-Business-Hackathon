/* Havak — accounts and session.

   Honest about what this is today: passwords are stored in plain text on this
   device because there is no server to check them against. Hashing here would
   look like security without being any, since the check also happens on this
   device. The sign-up screen says so plainly rather than pretending.

   This goes away at Phase 3.5, when passwords move to the server and are
   hashed properly. The shape below is already the shape that needs — signUp
   and logIn are async and return a session. */

window.Havak = window.Havak || {};

Havak.auth = (function () {
  'use strict';

  var store = Havak.store;

  var ROLES = [
    { key: 'reporter', label: 'Report polluted spots', hint: 'You find them and photograph them' },
    { key: 'cleaner',  label: 'Clean them up',         hint: 'You claim jobs and get paid for them' },
    { key: 'donor',    label: 'Fund the work',         hint: 'You pay for cleanups and see where it went' }
  ];

  /* The signed-in user, cached in memory. Kept synchronous on purpose: the
     route guard and the tab bar read it on every single render, and awaiting
     a promise there would flash the wrong UI on each navigation. */
  var me = null;

  function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function byEmail(email) {
    var wanted = normaliseEmail(email);
    return store.where('users', function (u) {
      return normaliseEmail(u.email) === wanted;
    }).then(function (found) { return found.length ? found[0] : null; });
  }

  /* called once at boot, before the first render */
  function init() {
    return store.ready().then(function () {
      var s = store.session();
      me = s && s.userId ? store.userSync(s.userId) : null;
      return me;
    });
  }

  function current() { return me; }
  function signedIn() { return me !== null; }

  /* ---------- sign up ----------
     Resolves to { ok: true, user } or { ok: false, field, message } so the form
     can highlight the field that is actually wrong. */
  function signUp(input) {
    var name = String(input.name || '').trim();
    var email = normaliseEmail(input.email);
    var pass = String(input.pass || '');
    var roles = (input.roles || []).filter(function (r) {
      return ROLES.some(function (def) { return def.key === r; });
    });

    if (name.length < 2) {
      return Promise.resolve({ ok: false, field: 'name', message: 'Please enter your name.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Promise.resolve({ ok: false, field: 'email', message: 'That does not look like an email address.' });
    }
    if (pass.length < 8) {
      return Promise.resolve({ ok: false, field: 'pass', message: 'Use at least 8 characters.' });
    }
    if (!roles.length) {
      return Promise.resolve({ ok: false, field: 'roles', message: 'Pick at least one thing you want to do.' });
    }

    return byEmail(email).then(function (existing) {
      if (existing) {
        return { ok: false, field: 'email', message: 'An account already uses that email. Try logging in.' };
      }
      return store.add('users', {
        id: store.newId('u'),
        name: name,
        email: email,
        pass: pass,
        roles: roles,
        place: String(input.place || '').trim() || 'Dilijan, Tavush',
        joinedAt: Date.now()
      }).then(function (user) {
        startSession(user);
        return { ok: true, user: user };
      });
    }).catch(function (err) {
      return { ok: false, field: 'pass', message: err.message || 'That did not save. Try again.' };
    });
  }

  /* ---------- log in ----------
     One message for both a wrong email and a wrong password: naming which half
     failed tells an attacker which emails have accounts. */
  function logIn(email, pass) {
    return byEmail(email).then(function (user) {
      if (!user || user.pass !== String(pass || '')) {
        return { ok: false, field: 'pass', message: 'Email or password is wrong.' };
      }
      startSession(user);
      return { ok: true, user: user };
    });
  }

  function logInAs(userId) {
    return store.find('users', userId).then(function (user) {
      if (!user) return { ok: false, message: 'That demo account is missing.' };
      startSession(user);
      return { ok: true, user: user };
    });
  }

  function startSession(user) {
    me = user;
    store.setSession({ userId: user.id, since: Date.now() });
  }

  function logOut() {
    me = null;
    store.setSession(null);
    return Promise.resolve(true);
  }

  /* ---------- roles ---------- */
  function hasRole(role, user) {
    var u = user || me;
    return !!u && (u.roles || []).indexOf(role) !== -1;
  }

  /* Resolves false when it would remove the last role — an account with no
     roles has no tabs and nowhere to land, so the profile screen blocks it. */
  function setRole(role, on) {
    if (!me) return Promise.resolve(false);
    var roles = (me.roles || []).slice();
    var at = roles.indexOf(role);

    if (on && at === -1) roles.push(role);
    if (!on && at !== -1) {
      if (roles.length === 1) return Promise.resolve(false);
      roles.splice(at, 1);
    }
    return store.update('users', me.id, { roles: roles }).then(function (user) {
      me = user;
      return true;
    });
  }

  /* the seeded accounts offered as one-tap logins on the sign-in screen */
  function demoAccounts() {
    var wanted = [
      { userId: 'u-narek',  caption: 'all three roles' },
      { userId: 'u-ani',    caption: 'reporter' },
      { userId: 'u-davit',  caption: 'cleaner' },
      { userId: 'u-lusine', caption: 'donor' }
    ];
    return Promise.all(wanted.map(function (d) {
      return store.find('users', d.userId).then(function (u) {
        return u ? { user: u, caption: d.caption } : null;
      });
    })).then(function (list) { return list.filter(Boolean); });
  }

  return {
    ROLES: ROLES,
    init: init,
    current: current,
    signedIn: signedIn,
    signUp: signUp,
    logIn: logIn,
    logInAs: logInAs,
    logOut: logOut,
    hasRole: hasRole,
    setRole: setRole,
    demoAccounts: demoAccounts
  };
})();
