/* Havak — accounts and session.

   Passwords are now checked on the server and stored there as bcrypt hashes
   (sql/002_server.sql). This file no longer sees a password after it has been
   posted, and no password is ever written to the device. The sign-up screen's
   notice about plain text came off when this landed, because it stopped being
   true — BACKEND.md §5.

   The session is a bearer token in localStorage, held by api.js. What survives
   an app relaunch is that token, not the account: on boot the token is exchanged
   for the current profile via GET /me, so a role changed on another device shows
   up here, and a revoked session lands on the login screen instead of a stale
   view of someone who is no longer signed in.

   The interface below is unchanged from the localStorage build, deliberately —
   the views call exactly what they called before. */

window.Havak = window.Havak || {};

Havak.auth = (function () {
  'use strict';

  var store = Havak.store;
  var api = Havak.api;

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

  /* called once at boot, before the first render */
  function init() {
    return store.ready().then(function (signed) {
      var s = signed ? store.session() : null;
      me = s && s.userId ? store.userSync(s.userId) : null;
      return me;
    }, function (err) {
      /* The server is unreachable. Boot must still finish, or the app shows
         nothing at all; the login screen will report the real reason when the
         user tries to sign in. */
      me = null;
      if (Havak.ui && err && err.code === 'offline') Havak.ui.toast(err.message);
      return null;
    });
  }

  function current() { return me; }
  function signedIn() { return me !== null; }

  /* ---------- sign up ----------
     Resolves to { ok: true, user } or { ok: false, field, message } so the form
     can highlight the field that is actually wrong. The checks here are for fast
     feedback only — the server validates everything again, and it is the server
     that decides. */
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

    return api.signUp({
      name: name,
      email: email,
      password: pass,
      roles: roles,
      place: String(input.place || '').trim() || 'Dilijan, Tavush'
    }).then(function (session) {
      me = store.adopt(session.user);
      return { ok: true, user: me };
    }, function (err) {
      return { ok: false, field: fieldFor(err), message: err.message };
    });
  }

  /* An email already in use is the one server-side failure a form can point at
     a specific input. Everything else belongs against the password field, which
     is where the form shows its general error. */
  function fieldFor(err) {
    return /email/i.test(err.message || '') ? 'email' : 'pass';
  }

  /* ---------- log in ----------
     One message for both a wrong email and a wrong password: naming which half
     failed tells an attacker which emails have accounts. The server returns a
     single message for the same reason. */
  function logIn(email, pass) {
    return api.logIn(normaliseEmail(email), String(pass || '')).then(function (session) {
      me = store.adopt(session.user);
      return { ok: true, user: me };
    }, function (err) {
      var message = err.code === 'not_authorised'
        ? 'Email or password is wrong.'
        : err.message;
      return { ok: false, field: 'pass', message: message };
    });
  }

  function logOut() {
    me = null;
    return store.reset();
  }

  /* ---------- email confirmation and password reset ----------
     These resolve to the same { ok, field, message } shape the login and sign-up
     forms already know how to display, so the new screens are the same shape as
     the old ones and showError() is reused unchanged. */

  function verified() {
    /* null means "not told" (somebody else's profile), which is not the same as
       false and must not show a nag. Only an explicit false does. */
    return !me || me.emailVerified !== false;
  }

  function resendVerification() {
    if (!me) return Promise.resolve({ ok: false, message: 'Sign in first.' });
    return api.resendVerification().then(function (res) {
      if (res.alreadyVerified) {
        me.emailVerified = true;
        return { ok: true, message: 'That address is already confirmed.' };
      }
      if (res.throttled) {
        return { ok: true, message: 'We just sent one — check your inbox, and your spam folder.' };
      }
      return { ok: true, message: 'Sent. Check your inbox for the link.' };
    }, function (err) {
      return { ok: false, message: err.message };
    });
  }

  /* Resolves ok for an unknown address too. The server cannot tell us whether it
     existed without publishing its user list, so the screen says "if that address
     has an account, a link is on its way" and means it. */
  function forgotPassword(email) {
    var address = normaliseEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return Promise.resolve({ ok: false, field: 'email', message: 'That does not look like an email address.' });
    }
    return api.forgotPassword(address).then(function () {
      return { ok: true };
    }, function (err) {
      return { ok: false, field: 'email', message: err.message };
    });
  }

  function resetPassword(resetToken, pass) {
    if (String(pass || '').length < 8) {
      return Promise.resolve({ ok: false, field: 'pass', message: 'Use at least 8 characters.' });
    }
    return api.resetPassword(resetToken, String(pass)).then(function () {
      /* The server invalidated every token for this account, including the one
         this device may still be holding. Drop it rather than keep a token we
         know is now dead, so the login screen is reached cleanly. */
      api.setToken(null);
      me = null;
      return { ok: true };
    }, function (err) {
      /* Every failure here belongs against the password field: it is the only
         input on the screen. An expired link is reported there too, because that
         is where the user is looking. */
      return { ok: false, field: 'pass', message: err.message };
    });
  }

  function confirmEmail(verifyToken) {
    return api.verifyEmail(verifyToken).then(function (user) {
      /* If this is the signed-in account, keep the cached profile honest so the
         banner disappears without needing a reload. */
      if (me && user && me.id === user.id) me = store.adopt(user);
      return { ok: true, user: user };
    }, function (err) {
      return { ok: false, message: err.message };
    });
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
    }, function () {
      return false;
    });
  }

  return {
    ROLES: ROLES,
    init: init,
    current: current,
    signedIn: signedIn,
    signUp: signUp,
    logIn: logIn,
    logOut: logOut,

    verified: verified,
    resendVerification: resendVerification,
    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    confirmEmail: confirmEmail,

    hasRole: hasRole,
    setRole: setRole
  };
})();
