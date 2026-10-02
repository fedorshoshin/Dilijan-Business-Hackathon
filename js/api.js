/* Havak — the one place that talks to the server.

   BACKEND.md §1 promised the wire would be snake_case and that the client would
   map it "in one place". This is that place. Nothing above this file should ever
   see a snake_case key, an ISO date string, or a flat lat/lng pair: views read
   `report.loc.label`, `report.desc` and `report.createdAt` as a number, exactly
   as they did when the data came from localStorage.

   Field names and shapes here were read off the running server, not off the
   contract — where the two disagreed, the server won and BACKEND.md is the thing
   that needs correcting.

   Errors all come out as ApiError, which carries the same { code, message } the
   old StoreError did, so screens written against the local store keep working:
   they switch on `err.code` and print `err.message`. */

window.Havak = window.Havak || {};

Havak.api = (function () {
  'use strict';

  /* The deployed API. Its hostname embeds the server's IP address (nip.io), so
     if that IP ever changes this string, the nginx server_name and the server's
     ALLOWED_ORIGINS all have to change together — see server/deploy/README.md. */
  var BASE = 'https://130.51.22.253.nip.io:8443';

  /* The session token. localStorage rather than a cookie because the API is on
     a different origin and authenticates with a Bearer header (the server sets
     allow_credentials=False deliberately), so a cookie would never be sent. */
  var TOKEN_KEY = 'havak-token-v1';

  /* ---------- errors ----------
     One shape for everything, matching BACKEND.md §7. A failed fetch (no signal,
     DNS gone, server down) is not an HTTP status, so it gets a code of its own
     rather than being reported as some invented status number. */
  function ApiError(code, message, status) {
    this.code = code;
    this.message = message;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.name = 'ApiError';

  var OFFLINE_MESSAGE = 'Cannot reach the server. Check your connection.';

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function setToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
      return true;
    } catch (e) {
      /* Private mode, or a full quota. The session still works for this run —
         it just will not survive a relaunch. Not worth failing the login over. */
      return false;
    }
  }

  /* ---------- the request ----------
     Every call in this file funnels through here, so retry, auth and error
     translation exist once. */
  function request(method, path, opts) {
    opts = opts || {};

    var headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    var t = token();
    if (t && opts.auth !== false) headers.Authorization = 'Bearer ' + t;

    return fetch(BASE + path, {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        if (text) {
          try { payload = JSON.parse(text); } catch (e) { payload = null; }
        }

        if (res.ok) return payload;

        /* The token is gone, expired, or was signed with a different secret.
           Drop it: keeping it means every later call fails the same way and the
           user is stuck on a screen that cannot recover. */
        if (res.status === 401) setToken(null);

        var err = payload && payload.error;
        throw new ApiError(
          (err && err.code) || httpCode(res.status),
          (err && err.message) || genericMessage(res.status),
          res.status
        );
      });
    }, function () {
      /* fetch only rejects for network-level failures, never for a 4xx/5xx */
      throw new ApiError('offline', OFFLINE_MESSAGE, 0);
    });
  }

  /* A status with no error body still has to produce one of the codes the
     screens know how to handle (BACKEND.md §7). */
  function httpCode(status) {
    if (status === 401 || status === 403) return 'not_authorised';
    if (status === 404) return 'not_found';
    if (status === 409) return 'already_claimed';
    if (status === 422) return 'validation_failed';
    if (status === 429) return 'rate_limited';
    return 'server_error';
  }

  function genericMessage(status) {
    if (status === 401 || status === 403) return 'Please sign in again.';
    if (status === 404) return 'That is no longer there.';
    if (status === 429) return 'Too many tries. Wait a minute and try again.';
    if (status >= 500) return 'The server had a problem. Try again shortly.';
    return 'That did not work.';
  }

  /* ---------- mapping ----------
     Server sends ISO 8601; the app has always held epoch milliseconds, and
     sorts and formats on that. Null stays null: a report that is not cleaned
     has no cleanedAt, and 0 would render as 1970. */
  function ms(iso) {
    if (!iso) return null;
    var at = Date.parse(iso);
    return isNaN(at) ? null : at;
  }

  function userFromWire(w) {
    if (!w) return null;
    return {
      id: w.id,
      name: w.name,
      email: w.email,           /* absent on other people's profiles, by design */
      roles: w.roles || [],
      place: w.place || '',
      avatarKey: w.avatar_key || null,
      /* Signed, and good for six hours. Fine for a session; a stale one just
         fails to load and ui.avatar falls back to the initials underneath. */
      avatarUrl: w.avatar_url || null,
      joinedAt: ms(w.joined_at),

      /* A boolean for the screens plus the date for anything that wants it.
         Absent on other people's profiles — whether somebody else has confirmed
         their address is none of your business — so undefined must not read as
         "unverified" and put a nag banner on their profile. Hence the `in`
         check rather than a truthiness test. */
      emailVerified: 'email_verified_at' in w ? !!w.email_verified_at : null,
      emailVerifiedAt: ms(w.email_verified_at)
    };
  }

  function claimFromWire(w, reportId) {
    if (!w) return null;
    return {
      id: w.id,
      reportId: w.report_id || reportId || null,
      cleanerId: w.cleaner_id,
      cleaner: w.cleaner ? userFromWire(w.cleaner) : null,
      status: w.status || 'active',
      claimedAt: ms(w.claimed_at),
      cleanedAt: ms(w.cleaned_at)
    };
  }

  /* The shape every screen already expects: lat/lng/x/y/label gathered back
     into `loc`, `description` renamed to `desc`. */
  function reportFromWire(w) {
    if (!w) return null;
    return {
      id: w.id,
      reporterId: w.reporter_id,
      reporter: w.reporter ? userFromWire(w.reporter) : null,
      title: w.title,
      desc: w.description,
      loc: {
        lat: w.lat,
        lng: w.lng,
        x: w.loc_x,
        y: w.loc_y,
        label: w.loc_label
      },
      level: w.level,
      hazardous: !!w.hazardous,
      estMinutes: w.est_minutes,
      payout: w.payout,
      status: w.status,
      rating: w.rating == null ? null : w.rating,
      disputed: !!w.disputed,
      /* The full set of photos is a separate call (GET /reports/{id}/media),
         because the URLs are signed and expire. A list only needs the first
         "before" photo for its card, and a count. */
      media: [],
      coverUrl: w.cover_url || null,
      mediaCount: w.media_count || 0,
      claim: claimFromWire(w.claim, w.id),
      createdAt: ms(w.created_at),
      cleanedAt: ms(w.cleaned_at),
      confirmedAt: ms(w.confirmed_at)
    };
  }

  function reportToWire(rec) {
    var loc = rec.loc || {};
    return {
      title: rec.title,
      description: rec.desc,
      lat: loc.lat,
      lng: loc.lng,
      loc_x: loc.x,
      loc_y: loc.y,
      loc_label: loc.label,
      level: rec.level,
      hazardous: !!rec.hazardous,
      est_minutes: rec.estMinutes,
      /* No payout: the server prices every spot itself from the two fields
         above. The form's figure is a preview of the same formula. */
      client_id: rec.clientId || uuid()
    };
  }

  function donationFromWire(w) {
    return {
      id: w.id,
      amount: w.amount,
      target: w.target,
      allocated: w.allocated || 0,
      remaining: w.remaining == null ? w.amount : w.remaining,
      /* what this money actually paid for — the honest donor dashboard */
      bought: (w.bought || []).map(function (b) {
        return {
          reportId: b.report_id,
          title: b.title,
          amount: b.amount,
          rating: b.rating,
          locLabel: b.loc_label,
          cleaner: b.cleaner ? { id: b.cleaner.id, name: b.cleaner.name } : null,
          confirmedAt: ms(b.confirmed_at)
        };
      }),
      createdAt: ms(w.created_at)
    };
  }

  /* Two callers, two shapes. GET /reports/{id}/allocations names the donation
     the money came from; GET /me/earnings names the spot it was earned on. Both
     are carried, and the one the caller did not ask for is simply null. */
  function allocFromWire(w) {
    return {
      id: w.id,
      donationId: w.donation_id || null,
      reportId: w.report_id || null,
      cleanerId: w.cleaner_id || null,
      amount: w.amount,
      title: w.title || null,
      locLabel: w.loc_label || null,
      rating: w.rating == null ? null : w.rating,
      createdAt: ms(w.at)
    };
  }

  /* Idempotency key for inserts (BACKEND.md §8): if a reply is lost and the
     write is retried, the server returns the original row instead of making a
     second one. randomUUID needs a secure context, which the app always has —
     the fallback is only so this cannot throw on an old browser. */
  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (ch) {
      var r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function mediaFromWire(w) {
    return {
      id: w.id,
      ownerId: w.owner_id,
      kind: w.kind,
      mime: w.mime,
      url: w.url,
      createdAt: ms(w.created_at)
    };
  }

  /* The second half of every upload: straight to the bucket, not to our API.
     No Authorization header — the signature is in the URL — and the file's own
     type, so R2 stores it with the one the <img> or <video> will need. */
  function putBlob(url, blob, mime) {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: blob
    }).then(function (res) {
      if (res.ok) return true;
      throw new ApiError('storage_failed',
        res.status === 403
          ? 'The upload link was refused. Try again.'
          : 'The file did not upload. Try again.',
        res.status);
    }, function () {
      throw new ApiError('offline', OFFLINE_MESSAGE, 0);
    });
  }

  /* ---------- auth ---------- */
  function signUp(input) {
    return request('POST', '/auth/signup', {
      auth: false,
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        roles: input.roles,
        place: input.place || null
      }
    }).then(adoptSession);
  }

  function logIn(email, password) {
    return request('POST', '/auth/login', {
      auth: false,
      body: { email: email, password: password }
    }).then(adoptSession);
  }

  function adoptSession(res) {
    setToken(res.token);
    return { token: res.token, user: userFromWire(res.user) };
  }

  /* The token is stateless, so logging out is a local act. The call is still
     made so the server can log it, but its failure must not strand a user on a
     screen they asked to leave — hence the swallowed rejection. */
  function logOut() {
    if (!token()) return Promise.resolve(true);
    /* Tell the server first, while the token is still attached — clearing it
       beforehand makes the call arrive unauthenticated and 401, which is a
       misleading line in the server log for what is a normal sign-out. Only
       then drop it locally, and drop it whether or not the call succeeded: a
       user who asked to sign out must end up signed out regardless. */
    return request('POST', '/auth/logout').then(done, done);

    function done() { setToken(null); return true; }
  }

  /* ---------- email confirmation and password reset ----------
     All four are deliberately plain. The interesting decisions are server-side:
     /auth/forgot answers the same way whether or not the address has an account,
     and /auth/reset signs every other device out. */

  function forgotPassword(email) {
    return request('POST', '/auth/forgot', {
      auth: false,
      body: { email: email }
    }).then(function () { return true; });
  }

  function resetPassword(resetToken, password) {
    return request('POST', '/auth/reset', {
      auth: false,
      body: { token: resetToken, password: password }
    }).then(function () { return true; });
  }

  /* No auth: the link arrives by email and is often opened on a different phone,
     or in a browser that has never signed in. Requiring a session would strand
     exactly the people this is for. */
  function verifyEmail(verifyToken) {
    return request('POST', '/auth/verify', {
      auth: false,
      body: { token: verifyToken }
    }).then(userFromWire);
  }

  function resendVerification() {
    return request('POST', '/auth/verify/resend').then(function (res) {
      return {
        sent: !!(res && res.sent),
        throttled: !!(res && res.throttled),
        alreadyVerified: !!(res && res.alreadyVerified)
      };
    });
  }

  return {
    BASE: BASE,
    ApiError: ApiError,
    uuid: uuid,

    token: token,
    setToken: setToken,
    signedIn: function () { return !!token(); },

    signUp: signUp,
    logIn: logIn,
    logOut: logOut,

    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    verifyEmail: verifyEmail,
    resendVerification: resendVerification,

    me: function () { return request('GET', '/me').then(userFromWire); },
    patchMe: function (patch) {
      var body = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.place !== undefined) body.place = patch.place;
      if (patch.roles !== undefined) body.roles = patch.roles;
      if (patch.avatarKey !== undefined) body.avatar_key = patch.avatarKey;
      return request('PATCH', '/me', { body: body }).then(userFromWire);
    },
    user: function (userId) {
      return request('GET', '/users/' + encodeURIComponent(userId)).then(userFromWire);
    },

    reports: function (params) {
      var query = [];
      if (params && params.status) query.push('status=' + encodeURIComponent(params.status));
      if (params && params.reporterId) query.push('reporter_id=' + encodeURIComponent(params.reporterId));
      var path = '/reports' + (query.length ? '?' + query.join('&') : '');
      return request('GET', path).then(function (list) {
        return (list || []).map(reportFromWire);
      });
    },
    report: function (reportId) {
      return request('GET', '/reports/' + encodeURIComponent(reportId)).then(reportFromWire);
    },
    createReport: function (rec) {
      return request('POST', '/reports', { body: reportToWire(rec) }).then(reportFromWire);
    },
    deleteReport: function (reportId) {
      return request('DELETE', '/reports/' + encodeURIComponent(reportId)).then(function () { return true; });
    },

    /* ---------- photos, video, avatars ----------
       Two steps each: ask our API for a signed URL, then PUT the bytes to R2. */
    uploadMedia: function (reportId, kind, blob, mime, clientId) {
      return request('POST', '/media/upload-url', {
        body: { report_id: reportId, kind: kind, mime: mime, client_id: clientId || uuid() }
      }).then(function (res) {
        return putBlob(res.upload_url, blob, mime).then(function () { return res.media_id; });
      });
    },
    reportMedia: function (reportId) {
      return request('GET', '/reports/' + encodeURIComponent(reportId) + '/media')
        .then(function (list) { return (list || []).map(mediaFromWire); });
    },
    deleteMedia: function (mediaId) {
      return request('DELETE', '/media/' + encodeURIComponent(mediaId)).then(function () { return true; });
    },
    uploadAvatar: function (blob, mime) {
      return request('POST', '/me/avatar/upload-url', { body: { mime: mime } }).then(function (res) {
        return putBlob(res.upload_url, blob, mime).then(function () {
          return request('PATCH', '/me', { body: { avatar_key: res.bucket_key } });
        });
      }).then(userFromWire);
    },
    deleteAvatar: function () {
      return request('DELETE', '/me/avatar').then(function () { return true; });
    },

    /* The three state changes the client may never make for itself
       (BACKEND.md §4). All three answer with the whole updated report, so the
       screen that asked can repaint from the server's version of events rather
       than guessing what the new state must be. */
    claim: function (reportId) {
      return request('POST', '/reports/' + encodeURIComponent(reportId) + '/claim')
        .then(reportFromWire);
    },
    release: function (reportId) {
      return request('POST', '/reports/' + encodeURIComponent(reportId) + '/release')
        .then(reportFromWire);
    },
    markCleaned: function (reportId) {
      return request('POST', '/reports/' + encodeURIComponent(reportId) + '/cleaned')
        .then(reportFromWire);
    },
    confirm: function (reportId, rating) {
      return request('POST', '/reports/' + encodeURIComponent(reportId) + '/confirm', {
        body: { rating: rating }
      }).then(function (res) {
        res = res || {};
        return {
          report: reportFromWire(res.report),
          /* 1-2 stars: sent back to the cleaner, nothing paid */
          disputed: !!res.disputed,
          /* > 0 when the pot ran short; owed, and paid as donations arrive */
          shortfall: res.shortfall || 0,
          allocations: (res.allocations || []).map(allocFromWire)
        };
      });
    },
    /* The cleaner's own work. Each row is a *report* with the caller's own claim
       on it — which is not the same as `report.claim`: that one is the active
       claim and is null once the job is done, while this one survives. */
    claimsMine: function () {
      return request('GET', '/claims/mine').then(function (list) {
        return (list || []).map(function (w) {
          var report = reportFromWire(w);
          report.myClaim = claimFromWire(w.my_claim, w.id);
          return report;
        });
      });
    },

    donate: function (amount, target) {
      return request('POST', '/donations', {
        body: { amount: amount, target: target || 'general', client_id: uuid() }
      }).then(donationFromWire);
    },
    donationsMine: function () {
      return request('GET', '/donations/mine').then(function (list) {
        return (list || []).map(donationFromWire);
      });
    },
    pot: function () {
      return request('GET', '/pot').then(function (p) {
        p = p || {};
        return {
          donated: p.donated || 0,
          allocated: p.allocated || 0,
          available: p.available || 0,
          cleanups: p.cleanups || 0,
          openSpots: p.open_spots || 0
        };
      });
    },
    allocations: function (reportId) {
      return request('GET', '/reports/' + encodeURIComponent(reportId) + '/allocations')
        .then(function (list) { return (list || []).map(allocFromWire); });
    },
    earnings: function () {
      return request('GET', '/me/earnings').then(function (e) {
        e = e || {};
        return {
          total: e.total || 0,
          /* confirmed work the pot could not yet cover */
          owed: e.owed || 0,
          payments: (e.payments || []).map(allocFromWire)
        };
      });
    }
  };
})();
