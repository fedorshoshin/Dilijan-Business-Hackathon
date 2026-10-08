/* Havak — the data layer, backed by the server.

   store.js kept everything in one localStorage blob and said in its own header
   that it was "one file to swap if this ever grows a real backend". This is that
   swap. It presents the identical interface — ready, all, where, find, add,
   update, remove, session, userSync — so not one view had to change.

   The awkward part, and the reason this file exists at all: views call
   `where('reports', function (r) { ... })`, passing a JavaScript predicate. A
   predicate cannot be sent to a server. So each collection is fetched once into
   a cache and the predicate runs over that, locally, exactly as it used to. That
   is honest for a pilot's data volumes — a few hundred reports — and is the
   thing to revisit first if Dilijan outgrows it, by pushing the common filters
   into query parameters the API already accepts.

   What is cached, and where it comes from:

     reports    GET /reports
     users      whoever we have met — /me, a report's reporter, a claim's cleaner
     claims     GET /claims/mine, plus the claim embedded in each loaded report
     donations  GET /donations/mine
     alloc      GET /me/earnings

   There is no "list all users" endpoint and there should not be: a pilot holds
   real people's names and emails. So `where('users', ...)` can only ever see the
   people this session has legitimately encountered. Nothing needs more. */

window.Havak = window.Havak || {};

Havak.remote = (function () {
  'use strict';

  var api = Havak.api;

  /* Same error type the whole app already switches on. Not a second shape. */
  var StoreError = api.ApiError;

  var cache = { reports: [], users: [], claims: [], myjobs: [], donations: [], alloc: [] };
  var loaded = {};      /* kind -> Promise, so a collection is fetched once */
  var me = null;

  function remember(user) {
    if (!user || !user.id) return user;
    for (var i = 0; i < cache.users.length; i++) {
      if (cache.users[i].id === user.id) {
        /* Merge rather than replace: /me carries an email, an embedded reporter
           does not, and clobbering the fuller record with the thinner one would
           make the profile screen lose the signed-in user's own email. */
        cache.users[i] = mergeUser(cache.users[i], user);
        return cache.users[i];
      }
    }
    cache.users.push(user);
    return user;
  }

  function mergeUser(existing, incoming) {
    var out = {};
    Object.keys(existing).forEach(function (k) { out[k] = existing[k]; });
    Object.keys(incoming).forEach(function (k) {
      if (incoming[k] !== null && incoming[k] !== undefined) out[k] = incoming[k];
    });
    return out;
  }

  /* Reports arrive with their reporter and any active claim nested inside. Pull
     those out into the collections the views expect to find them in, so a claim
     is visible through where('claims', ...) without a second round trip. */
  function absorbReport(report) {
    if (!report) return report;
    if (report.reporter) remember(report.reporter);
    if (report.claim) {
      report.claim.reportId = report.claim.reportId || report.id;
      if (report.claim.cleaner) remember(report.claim.cleaner);
      upsert(cache.claims, report.claim);
    }
    return report;
  }

  function upsert(list, record) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === record.id) { list[i] = record; return record; }
    }
    list.push(record);
    return record;
  }

  /* ---------- loading ----------
     One promise per collection, kept so a screen that asks twice waits once.
     A write invalidates the collections it could have changed. */
  function ensure(kind) {
    if (loaded[kind]) return loaded[kind];

    var job;
    if (kind === 'reports') {
      job = api.reports().then(function (list) {
        cache.reports = list.map(absorbReport);
        return cache.reports;
      });
    } else if (kind === 'claims' || kind === 'myjobs') {
      /* One call answers two questions, so it backs both collections: 'myjobs'
         is the cleaner's own work as whole reports, 'claims' the bare claim
         records the profile tally counts. Claims on *other* people's reports
         arrive embedded in those reports and are absorbed above. */
      job = api.claimsMine().then(function (list) {
        cache.myjobs = list.map(function (report) {
          absorbReport(report);
          upsert(cache.reports, report);
          if (report.myClaim) upsert(cache.claims, report.myClaim);
          return report;
        });
        return kind === 'claims' ? cache.claims : cache.myjobs;
      });
    } else if (kind === 'donations') {
      job = api.donationsMine().then(function (list) {
        cache.donations = list.map(function (d) {
          /* /donations/mine is by definition mine; the wire omits the donor */
          if (!d.donorId && me) d.donorId = me.id;
          return d;
        });
        return cache.donations;
      });
    } else if (kind === 'alloc') {
      job = api.earnings().then(function (e) {
        cache.alloc = e.payments.map(function (a) {
          if (!a.cleanerId && me) a.cleanerId = me.id;
          return a;
        });
        return cache.alloc;
      });
    } else if (kind === 'users') {
      /* nothing to fetch: see the header. Whatever we have met is what there is. */
      job = Promise.resolve(cache.users);
    } else {
      job = Promise.resolve([]);
    }

    /* A failed load must not be remembered as done, or a screen that failed
       once while offline would stay empty for the rest of the session. */
    loaded[kind] = job.catch(function (err) {
      delete loaded[kind];
      throw err;
    });
    return loaded[kind];
  }

  function invalidate() {
    for (var i = 0; i < arguments.length; i++) delete loaded[arguments[i]];
  }

  /* A write has handed us the server's own new version of a report. Put it
     straight into the cache instead of dropping the list and fetching it again:
     re-reading the list costs a round trip to a database on another continent
     (Chicago to Mumbai, ~0.5s per query), and we already know the answer. The
     rest of the list is no more stale than it was a moment ago. */
  function adoptReport(report) {
    if (!report || !report.id) return report;
    absorbReport(report);
    upsert(cache.reports, report);
    return report;
  }

  /* ---------- the store interface ---------- */

  /* Called once at boot, before the first render. Resolves even when signed
     out — the login screen must still be reachable with no server at all. */
  function ready() {
    if (!api.signedIn()) { me = null; return Promise.resolve(false); }
    return api.me().then(function (user) {
      me = remember(user);
      return true;
    }, function (err) {
      /* A dead or rejected token means "signed out", not "app broken". Any
         other failure (offline) is rethrown so boot can say so honestly. */
      if (err.code === 'not_authorised') { me = null; api.setToken(null); return false; }
      throw err;
    });
  }

  function all(kind) {
    return ensure(kind).then(function (list) { return list.slice(); });
  }

  function where(kind, test) {
    return ensure(kind).then(function (list) { return list.filter(test); });
  }

  /* A single report is fetched directly rather than picked out of the list: the
     spot screen is where someone decides whether to claim a job, and a stale
     status there is the one that costs a wasted trip. */
  function find(kind, recordId) {
    if (!recordId) return Promise.resolve(null);

    if (kind === 'reports') {
      return api.report(recordId).then(function (report) {
        absorbReport(report);
        upsert(cache.reports, report);
        return report;
      }, notFoundAsNull);
    }

    if (kind === 'users') {
      var known = pick(cache.users, recordId);
      if (known) return Promise.resolve(known);
      return api.user(recordId).then(remember, notFoundAsNull);
    }

    return ensure(kind).then(function (list) { return pick(list, recordId); });
  }

  function notFoundAsNull(err) {
    if (err.code === 'not_found') return null;
    throw err;
  }

  function pick(list, recordId) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === recordId) return list[i];
    }
    return null;
  }

  function add(kind, record) {
    if (kind === 'reports') {
      return api.createReport(record).then(function (report) {
        absorbReport(report);
        upsert(cache.reports, report);
        invalidate('reports');
        return report;
      });
    }

    if (kind === 'donations') {
      return api.donate(record.amount, record.target).then(function (donation) {
        if (!donation.donorId && me) donation.donorId = me.id;
        upsert(cache.donations, donation);
        invalidate('donations', 'alloc');
        return donation;
      });
    }

    /* Accounts are created by POST /auth/signup, which also returns a session.
       Routing that through a generic add() would hide the token. Havak.auth
       calls the endpoint directly. */
    return Promise.reject(new StoreError(
      'validation_failed',
      'Cannot create a ' + kind + ' directly; use the matching action.'
    ));
  }

  function update(kind, recordId, patch) {
    if (kind === 'users') {
      if (!me || recordId !== me.id) {
        return Promise.reject(new StoreError('not_authorised', 'You can only change your own profile.'));
      }
      return api.patchMe(patch).then(function (user) {
        me = remember(user);
        return me;
      });
    }
    if (kind === 'reports') {
      /* The reporter's edit; the server allows it only while the spot is open. */
      return api.editReport(recordId, patch).then(function (report) {
        report = absorbReport(report);
        upsert(cache.reports, report);
        invalidate('reports');
        return report;
      });
    }
    return Promise.reject(new StoreError(
      'validation_failed',
      'A ' + kind + ' cannot be edited directly; use the matching action.'
    ));
  }

  function remove(kind, recordId) {
    if (kind === 'reports') {
      return api.deleteReport(recordId).then(function () {
        cache.reports = cache.reports.filter(function (r) { return r.id !== recordId; });
        invalidate('reports');
        return true;
      });
    }
    return Promise.reject(new StoreError('not_authorised', 'That cannot be deleted.'));
  }

  /* "Reset" used to mean "throw away this device's data and re-seed". Against a
     real server the only honest equivalent is signing out: the data belongs to
     everyone now, and no single phone gets to wipe it. */
  function reset() {
    return api.logOut().then(function () {
      me = null;
      cache = { reports: [], users: [], claims: [], myjobs: [], donations: [], alloc: [] };
      loaded = {};
      return true;
    });
  }

  return {
    KEY: 'havak-token-v1',
    VERSION: 2,
    StoreError: StoreError,

    ready: ready,
    all: all,
    where: where,

    /* Claiming, releasing and marking cleaned go through Havak.work, not
       through add/update — each is its own endpoint with its own rule about who
       may call it. They say here which caches they have made stale. */
    invalidate: invalidate,
    adoptReport: adoptReport,

    /* True when this collection is already in memory, so a screen can tell
       "painted from the cache, worth re-checking" from "just fetched". */
    isLoaded: function (kind) { return !!loaded[kind]; },

    find: find,
    add: add,
    update: update,
    remove: remove,
    reset: reset,

    /* Synchronous, as before: the route guard and tab bar read the session on
       every render, and awaiting there would flash the wrong UI. */
    session: function () {
      return me ? { userId: me.id, since: null } : null;
    },
    setSession: function (s) {
      if (!s) { me = null; api.setToken(null); }
      return true;
    },
    userSync: function (userId) { return pick(cache.users, userId); },

    /* Adopt the user returned by signup/login without a second /me round trip. */
    adopt: function (user) { me = remember(user); return me; },

    /* Writes go straight to Postgres now; there is no local quota to fail. */
    saveOk: function () { return true; },
    newId: function () { return api.uuid(); }
  };
})();

/* The swap itself. Everything downstream does `var store = Havak.store` at load
   time, so this must run before those files — see the script order in app.html. */
Havak.store = Havak.remote;
