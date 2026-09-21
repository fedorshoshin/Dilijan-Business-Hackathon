/* Havak — accounts and session.

   Honest about what this is: passwords are stored in plain text on this device
   because there is no server to check them against. Hashing them here would
   look like security without being any, since the check also happens on this
   device. The sign-up screen says so plainly rather than pretending.

   A real backend is what makes accounts actually private. */

window.Havak = window.Havak || {};

Havak.auth = (function () {
  'use strict';

  var store = Havak.store;

  var ROLES = [
    { key: 'reporter', label: 'Report polluted spots', hint: 'You find them and photograph them' },
    { key: 'cleaner',  label: 'Clean them up',         hint: 'You claim jobs and get paid for them' },
    { key: 'donor',    label: 'Fund the work',         hint: 'You pay for cleanups and see where it went' }
  ];

  function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function byEmail(email) {
    var wanted = normaliseEmail(email);
    var found = store.where('users', function (u) {
      return normaliseEmail(u.email) === wanted;
    });
    return found.length ? found[0] : null;
  }

  function current() {
    var s = store.get().session;
    if (!s || !s.userId) return null;
    return store.find('users', s.userId);
  }

  function signedIn() {
    return current() !== null;
  }

  /* ---------- sign up ----------
     Returns { ok: true, user } or { ok: false, field, message } so the form can
     highlight the field that is actually wrong. */
  function signUp(input) {
    var name = String(input.name || '').trim();
    var email = normaliseEmail(input.email);
    var pass = String(input.pass || '');
    var roles = (input.roles || []).filter(function (r) {
      return ROLES.some(function (def) { return def.key === r; });
    });

    if (name.length < 2) {
      return { ok: false, field: 'name', message: 'Please enter your name.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, field: 'email', message: 'That does not look like an email address.' };
    }
    if (byEmail(email)) {
      return { ok: false, field: 'email', message: 'An account already uses that email. Try logging in.' };
    }
    if (pass.length < 8) {
      return { ok: false, field: 'pass', message: 'Use at least 8 characters.' };
    }
    if (!roles.length) {
      return { ok: false, field: 'roles', message: 'Pick at least one thing you want to do.' };
    }

    var user = store.add('users', {
      id: store.newId('u'),
      name: name,
      email: email,
      pass: pass,
      roles: roles,
      place: String(input.place || '').trim() || 'Dilijan, Tavush',
      joinedAt: Date.now()
    });

    if (!store.saveOk()) {
      return { ok: false, field: 'pass', message: 'This device would not save the account. Storage may be full.' };
    }

    startSession(user.id);
    return { ok: true, user: user };
  }

  /* ---------- log in ----------
     One message for both a wrong email and a wrong password: naming which half
     failed tells an attacker which emails have accounts. */
  function logIn(email, pass) {
    var user = byEmail(email);
    if (!user || user.pass !== String(pass || '')) {
      return { ok: false, field: 'pass', message: 'Email or password is wrong.' };
    }
    startSession(user.id);
    return { ok: true, user: user };
  }

  function logInAs(userId) {
    var user = store.find('users', userId);
    if (!user) return { ok: false, message: 'That demo account is missing.' };
    startSession(user.id);
    return { ok: true, user: user };
  }

  function startSession(userId) {
    store.get().session = { userId: userId, since: Date.now() };
    store.save();
  }

  function logOut() {
    store.get().session = null;
    store.save();
  }

  /* ---------- roles ---------- */
  function hasRole(role, user) {
    var u = user || current();
    return !!u && (u.roles || []).indexOf(role) !== -1;
  }

  /* Returns false when it would remove the last role — an account with no roles
     has no tabs and nowhere to land, so the profile screen blocks it. */
  function setRole(role, on) {
    var user = current();
    if (!user) return false;
    var roles = (user.roles || []).slice();
    var at = roles.indexOf(role);

    if (on && at === -1) roles.push(role);
    if (!on && at !== -1) {
      if (roles.length === 1) return false;
      roles.splice(at, 1);
    }
    store.update('users', user.id, { roles: roles });
    return true;
  }

  /* the seeded accounts offered as one-tap logins on the sign-in screen */
  function demoAccounts() {
    return [
      { userId: 'u-narek',  caption: 'all three roles' },
      { userId: 'u-ani',    caption: 'reporter' },
      { userId: 'u-davit',  caption: 'cleaner' },
      { userId: 'u-lusine', caption: 'donor' }
    ].map(function (d) {
      var u = store.find('users', d.userId);
      return u ? { user: u, caption: d.caption } : null;
    }).filter(Boolean);
  }

  return {
    ROLES: ROLES,
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
