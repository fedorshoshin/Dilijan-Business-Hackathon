/* Havak — photos and video (Phase 3).

   Three jobs, in the order a photo meets them:

   1. prepare  — a photo is decoded and re-encoded as a JPEG no longer than
                 1600 px on its long edge. A 12-megapixel phone photo drops from
                 ~4 MB to ~300 KB, which is the difference between an upload
                 that finishes on a Dilijan hillside and one that does not. The
                 re-encode also strips EXIF, GPS included — the spot's location
                 is already on the report, deliberately, and nothing else is.
                 Video is not re-encoded (a browser cannot, cheaply); it is only
                 capped at 50 MB.

   2. outbox   — every file goes into IndexedDB *before* any upload starts, so
                 a photo taken with no signal, or an app closed mid-upload, is
                 not lost: the next launch (or the next time the phone comes
                 back online) finishes the job. The outbox id doubles as the
                 server's client_id, so a retry after a lost reply cannot create
                 a second copy.

   3. upload   — ask our API for a signed URL, PUT the bytes straight to R2.
                 The bytes never pass through our server.

   And two pieces of UI every photo screen shares: the pick buttons and the
   swipeable strip. */

window.Havak = window.Havak || {};

Havak.media = (function () {
  'use strict';

  var api = Havak.api;
  var el = Havak.ui.el;

  var MAX_EDGE = 1600;
  var AVATAR_EDGE = 256;
  var JPEG_QUALITY = 0.82;
  var MAX_VIDEO_BYTES = 50 * 1024 * 1024;
  var MAX_FILES = 12;       /* per spot and kind; the server enforces the same */

  var VIDEO_TYPES = { 'video/mp4': 1, 'video/quicktime': 1, 'video/webm': 1 };

  function MediaError(message) { this.code = 'media'; this.message = message; }

  /* ---------- 1. prepare ---------- */

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      /* Modern browsers apply the EXIF rotation when decoding into an <img>,
         so a portrait photo is drawn portrait without us parsing EXIF. */
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new MediaError('That photo could not be opened. Try a different one.'));
      };
      img.src = url;
    });
  }

  function toJpeg(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new MediaError('That photo could not be prepared. Try again.'));
      }, 'image/jpeg', JPEG_QUALITY);
    });
  }

  function shrinkPhoto(file) {
    return loadImage(file).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return toJpeg(canvas);
    }).then(function (blob) {
      return { blob: blob, mime: 'image/jpeg' };
    });
  }

  /* Some Android pickers hand over a video with an empty type. */
  function videoType(file) {
    if (VIDEO_TYPES[file.type]) return file.type;
    var name = (file.name || '').toLowerCase();
    if (/\.mov$/.test(name)) return 'video/quicktime';
    if (/\.webm$/.test(name)) return 'video/webm';
    if (/\.(mp4|m4v)$/.test(name)) return 'video/mp4';
    return null;
  }

  function prepare(file) {
    if (/^image\//.test(file.type)) return shrinkPhoto(file);

    var mime = videoType(file);
    if (mime) {
      if (file.size > MAX_VIDEO_BYTES) {
        return Promise.reject(new MediaError(
          'That video is ' + Math.round(file.size / 1048576) + ' MB. Keep it under 50 MB — ' +
          'about 30 seconds on most phones.'));
      }
      return Promise.resolve({ blob: file, mime: mime });
    }
    return Promise.reject(new MediaError('Only photos and videos can be added here.'));
  }

  /* Centre-cropped square, 256 px: an avatar is shown at 64 px at most, and
     at 3× pixel density that is 192. */
  function prepareAvatar(file) {
    if (!/^image\//.test(file.type)) {
      return Promise.reject(new MediaError('Pick a photo for your picture.'));
    }
    return loadImage(file).then(function (img) {
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      var sx = (img.naturalWidth - side) / 2;
      var sy = (img.naturalHeight - side) / 2;
      var out = Math.min(AVATAR_EDGE, side);
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = out;
      canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, out, out);
      return toJpeg(canvas);
    });
  }

  /* ---------- 2. the outbox ---------- */

  var DB_NAME = 'havak-media';
  var STORE = 'outbox';
  var dbp = null;

  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new MediaError('This browser cannot store photos.')); return; }
      var open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = function () {
        var store = open.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('reportId', 'reportId');
      };
      open.onsuccess = function () { resolve(open.result); };
      open.onerror = function () { reject(new MediaError('Photo storage is unavailable.')); };
    });
    dbp.catch(function () { dbp = null; });   /* let a later call try again */
    return dbp;
  }

  function tx(mode, work) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode);
        var result;
        t.oncomplete = function () { resolve(result); };
        t.onabort = t.onerror = function () {
          var e = t.error;
          reject(new MediaError(e && e.name === 'QuotaExceededError'
            ? 'Your phone is out of space for photos. Free some space and try again.'
            : 'The photo could not be saved on this phone.'));
        };
        work(t.objectStore(STORE), function (r) { result = r; });
      });
    });
  }

  function put(record) {
    return tx('readwrite', function (s) { s.put(record); }).then(function () { return record; });
  }

  function drop(id) {
    return tx('readwrite', function (s) { s.delete(id); });
  }

  function all() {
    return tx('readonly', function (s, done) {
      var req = s.getAll();
      req.onsuccess = function () { done(req.result || []); };
    });
  }

  function waiting(reportId) {
    return all().then(function (list) {
      return list.filter(function (r) { return r.reportId === reportId; })
        .sort(function (a, b) { return a.createdAt - b.createdAt; });
    }, function () { return []; });
  }

  /* ---------- 3. upload ---------- */

  /* Worth another try later: no signal, our server hiccuped, R2 hiccuped.
     Anything else (the spot was withdrawn, the cap was hit, you are not the
     cleaner any more) will fail identically forever, so it is dropped and said. */
  var RETRYABLE = { offline: 1, server_error: 1, storage_failed: 1, rate_limited: 1 };

  var running = null;          /* one upload loop at a time */
  var failures = [];           /* messages for permanent failures, reported once */

  function uploadOne(rec) {
    return api.uploadMedia(rec.reportId, rec.kind, rec.blob, rec.mime, rec.id).then(function () {
      return drop(rec.id);
    }, function (err) {
      if (RETRYABLE[err.code]) throw err;          /* stop the loop; retry later */
      failures.push(err.message || 'A photo could not be added.');
      return drop(rec.id);
    });
  }

  /* Upload everything waiting, oldest first, one at a time — a phone on one
     bar of signal does better with one upload than with six fighting. */
  function flush() {
    if (running) return running;
    if (!api.signedIn()) return Promise.resolve(false);

    running = all().then(function (list) {
      list.sort(function (a, b) { return a.createdAt - b.createdAt; });
      return list.reduce(function (p, rec) {
        return p.then(function () { return uploadOne(rec); });
      }, Promise.resolve());
    }).then(function () {
      return true;
    }, function () {
      return false;                                /* left in the outbox */
    }).then(function (ok) {
      running = null;
      var said = failures.splice(0);
      if (said.length) Havak.ui.toast(said[0]);
      return ok;
    });
    return running;
  }

  /* Save first, then upload. Resolves once the files are safe on the phone —
     not when they reach the server — so the caller can move on at once. */
  function queue(reportId, kind, prepared) {
    var now = Date.now();
    return prepared.reduce(function (p, item, i) {
      return p.then(function () {
        return put({
          id: api.uuid(),
          reportId: reportId,
          kind: kind,
          mime: item.mime,
          blob: item.blob,
          createdAt: now + i
        });
      });
    }, Promise.resolve()).then(function () {
      flush();
      return true;
    });
  }

  /* Resolves when the current upload loop (if any) ends. */
  function idle() { return running || Promise.resolve(true); }

  /* What a spot's gallery shows: what the server has, plus what is still on
     this phone waiting to go — so a photo appears the moment it is taken. */
  function forReport(reportId) {
    return Promise.all([
      api.reportMedia(reportId).catch(function () { return null; }),
      waiting(reportId)
    ]).then(function (r) {
      return {
        failed: r[0] === null,
        uploaded: r[0] || [],
        pending: r[1].map(function (rec) {
          return {
            id: rec.id,
            kind: rec.kind,
            mime: rec.mime,
            url: URL.createObjectURL(rec.blob),
            pending: true
          };
        })
      };
    });
  }

  /* ---------- UI: pick ---------- */

  /* Two buttons, because they are two different intentions: "I am standing in
     front of it" opens the camera directly; "I took it earlier" opens the
     library (where phones also offer to record a video). */
  function pickButtons(opts) {
    function input(camera) {
      var attrs = {
        type: 'file',
        hidden: true,
        accept: opts.accept || (camera ? 'image/*' : 'image/*,video/*'),
        onchange: function () {
          var files = Array.prototype.slice.call(field.files || []);
          field.value = '';                  /* picking the same file twice still fires */
          if (files.length) opts.onFiles(files);
        }
      };
      if (camera) attrs.capture = opts.capture || 'environment';
      if (!camera && opts.multiple !== false) attrs.multiple = true;
      var field = el('input', attrs);
      return field;
    }

    var cam = input(true), lib = input(false);

    return el('div.shot-actions', null, [
      cam, lib,
      el('button.btn.btn-ghost', {
        type: 'button',
        text: opts.cameraLabel || 'Take a photo',
        onclick: function () { cam.click(); }
      }),
      el('button.btn.btn-ghost', {
        type: 'button',
        text: opts.libraryLabel || 'From phone',
        onclick: function () { lib.click(); }
      })
    ]);
  }

  /* Prepare a batch, keeping the ones that worked and reporting the first
     problem, rather than failing six photos because one was a PDF. */
  function prepareAll(files, room) {
    var over = files.length > room;
    var take = files.slice(0, Math.max(0, room));
    var problems = [];
    if (over) problems.push('Up to ' + MAX_FILES + ' files per spot — the rest were left out.');

    return take.reduce(function (p, f) {
      return p.then(function (done) {
        return prepare(f).then(function (item) {
          done.push(item);
          return done;
        }, function (err) {
          problems.push(err.message);
          return done;
        });
      });
    }, Promise.resolve([])).then(function (items) {
      return { items: items, problem: problems[0] || null };
    });
  }

  /* ---------- UI: the strip ---------- */

  /* `#t=0.1` asks for the first frame to be painted as a still, which is the
     only poster iOS Safari will show for a video it has not played — and costs
     us no extra upload. */
  function shot(item, onRemove) {
    var isVideo = /^video\//.test(item.mime);
    var media = isVideo
      ? el('video', { src: item.url + '#t=0.1', controls: true, playsinline: true, preload: 'metadata' })
      : el('img', { src: item.url, alt: '', loading: 'lazy', decoding: 'async' });

    /* An upload that never finished leaves a row with no file behind it. Say
       so, instead of showing a broken-image icon. */
    media.addEventListener('error', function () {
      fig.classList.add('is-missing');
      media.remove();
      fig.insertBefore(el('span.shot-missing', { text: 'Not uploaded' }), fig.firstChild);
    });

    var fig = el('figure.shot', null, [
      media,
      item.pending
        ? el('span.shot-badge', { text: typeof item.pending === 'string' ? item.pending : 'Uploading…' })
        : null,
      onRemove
        ? el('button.shot-remove', {
            type: 'button',
            'aria-label': 'Remove this ' + (isVideo ? 'video' : 'photo'),
            text: '✕',
            onclick: function () { onRemove(item, fig); }
          })
        : null
    ]);
    return fig;
  }

  /* A row that snaps one picture at a time under a thumb, with "2 / 5" beneath
     so it is obvious there is more to swipe to. */
  function strip(items, opts) {
    opts = opts || {};
    var count = el('p.shot-count', { 'aria-hidden': 'true' });
    var row = el('div.shots' + (opts.small ? '.shots-sm' : ''), {
      role: 'list',
      'aria-label': opts.label || 'Photos'
    }, items.map(function (item) {
      var s = shot(item, opts.canRemove && opts.canRemove(item) ? opts.onRemove : null);
      s.setAttribute('role', 'listitem');
      return s;
    }));

    function tally() {
      var n = row.children.length;
      if (n < 2 || opts.small) { count.textContent = ''; count.hidden = true; return; }
      var first = row.children[0];
      var step = first.getBoundingClientRect().width + 8;
      var at = Math.min(n, Math.round(row.scrollLeft / step) + 1);
      count.hidden = false;
      count.textContent = at + ' / ' + n;
    }
    row.addEventListener('scroll', tally, { passive: true });
    setTimeout(tally, 0);

    return el('div', null, [row, count]);
  }

  /* Start any leftover uploads now, and again whenever signal returns. */
  window.addEventListener('online', function () { flush(); });

  return {
    MAX_FILES: MAX_FILES,
    prepare: prepare,
    prepareAll: prepareAll,
    prepareAvatar: prepareAvatar,
    queue: queue,
    flush: flush,
    idle: idle,
    forReport: forReport,
    pickButtons: pickButtons,
    strip: strip
  };
})();
