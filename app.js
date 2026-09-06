/* Clean Dilijan — demo app.
   All state lives in this device's localStorage. No server, no accounts. */

(function () {
  'use strict';

  var KEY = 'clean-dilijan-v1';
  var ME = 'You';
  var CERT_GOAL = 3;          // cleanups needed for the certificate
  var PTS_REPORT = 5;
  var PTS_JOIN = 5;
  var PTS_CLEAN = 20;

  /* ---------- seed data: plausible spots around Dilijan ---------- */
  function seed() {
    return {
      points: 0,
      spots: [
        {
          id: 's1',
          title: 'Riverbank dump, Sharambeyan St',
          desc: 'Plastic bottles and torn construction bags tipped down the bank straight into the Aghstev.',
          kind: 'cleanup',
          status: 'crew',
          x: 24, y: 62,
          reporter: 'Ani M.',
          when: '2 days ago',
          crew: ['Ani M.', 'Davit S.'],
          replies: [
            { who: 'Davit S.', text: 'I pass here every morning, it has been growing for weeks. Count me in.' },
            { who: 'Ani M.', text: 'Bringing gloves and 20 bags. Saturday 10:00 by the bridge?' }
          ]
        },
        {
          id: 's2',
          title: 'Roadside litter, M4 toward Ijevan',
          desc: 'Long strip of bottles and food packaging thrown from cars along the verge.',
          kind: 'cleanup',
          status: 'open',
          x: 74, y: 40,
          reporter: 'Narek H.',
          when: '5 days ago',
          crew: [],
          replies: [
            { who: 'Lilit A.', text: 'This one needs a bigger group, it is at least 300 metres.' }
          ]
        },
        {
          id: 's3',
          title: 'Illegal dump, park entrance',
          desc: 'Household waste left at the forest edge just inside the national park boundary.',
          kind: 'cleanup',
          status: 'open',
          x: 60, y: 78,
          reporter: 'Eco-Patrol',
          when: '1 week ago',
          crew: [],
          replies: []
        },
        {
          id: 's4',
          title: 'Bus station surroundings',
          desc: 'Litter scattered around the benches and the back wall of the station.',
          kind: 'cleanup',
          status: 'done',
          x: 41, y: 47,
          reporter: 'Mariam G.',
          when: '3 weeks ago',
          crew: ['Mariam G.', 'Tigran V.', 'Sona B.', 'Aram K.'],
          replies: [
            { who: 'Tigran V.', text: 'Done — 14 bags collected, municipality truck took them same day.' }
          ]
        },
        {
          id: 's5',
          title: 'Tourist litter, Parz Lake trail',
          desc: 'Cans and picnic waste along the last kilometre of the trail up to the lake.',
          kind: 'cleanup',
          status: 'crew',
          x: 86, y: 17,
          reporter: 'Sona B.',
          when: '4 days ago',
          crew: ['Sona B.'],
          replies: [
            { who: 'Sona B.', text: 'Worst right after weekends. Best to go Monday morning.' }
          ]
        },
        {
          id: 's6',
          title: 'Sewage outflow into the Aghstev',
          desc: 'Grey water running into the river below the town. Volunteers cannot fix this — it needs the treatment plant upgraded.',
          kind: 'official',
          status: 'open',
          x: 50, y: 65,
          reporter: 'Eco-Patrol',
          when: '2 weeks ago',
          crew: [],
          replies: [
            { who: 'Lusine T.', text: 'Same spot my father reported years ago. Adding a photo so it is on record.' },
            { who: 'Narek H.', text: 'Tavush has one treatment plant and it is mechanical only. This is a budget problem.' }
          ]
        },
        {
          id: 's7',
          title: 'Fresh cut stumps, north slope',
          desc: 'Around a dozen freshly cut stumps inside the park boundary. Logged for evidence.',
          kind: 'official',
          status: 'open',
          x: 16, y: 24,
          reporter: 'Eco-Patrol',
          when: '6 days ago',
          crew: [],
          replies: [
            { who: 'Eco-Patrol', text: 'GPS noted and passed to the inspection body. Case number pending.' }
          ]
        }
      ]
    };
  }

  /* ---------- state ---------- */
  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.spots)) return parsed;
      }
    } catch (e) { /* corrupt or blocked storage — fall through to seed */ }
    return seed();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* private mode: app still works for this session */ }
  }

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function statusOf(spot) {
    if (spot.kind === 'official') return { cls: 'official', tag: 'tag-official', label: 'Needs official fix' };
    if (spot.status === 'done')   return { cls: 'done',     tag: 'tag-done',     label: 'Cleaned' };
    if (spot.status === 'crew')   return { cls: 'crew',     tag: 'tag-crew',     label: 'Crew forming' };
    return { cls: 'open', tag: 'tag-open', label: 'Reported' };
  }

  function joined(spot) { return spot.crew.indexOf(ME) !== -1; }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 300);
    }, 2600);
  }

  function addPoints(n) {
    state.points += n;
    var chip = $('pointsChip');
    chip.classList.remove('bump');
    void chip.offsetWidth;               // restart the animation
    chip.classList.add('bump');
  }

  /* ---------- rendering ---------- */
  var newestId = null;

  function render() {
    renderPins();
    renderCards();
    renderStats();
    $('pointsValue').textContent = state.points;
    save();
  }

  function renderPins() {
    var box = $('pins');
    box.innerHTML = '';
    state.spots.forEach(function (spot) {
      var st = statusOf(spot);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin is-' + st.cls + (spot.id === newestId ? ' is-new' : '');
      b.style.left = spot.x + '%';
      b.style.top = spot.y + '%';
      b.setAttribute('aria-label', spot.title + ' — ' + st.label);
      b.innerHTML = '<i></i>';
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openSpot(spot.id);
      });
      box.appendChild(b);
    });
  }

  function renderCards() {
    var list = $('cards');
    list.innerHTML = '';

    var order = { open: 0, crew: 1, done: 2 };
    var sorted = state.spots.slice().sort(function (a, b) {
      return (order[a.status] || 0) - (order[b.status] || 0);
    });

    sorted.forEach(function (spot) {
      var st = statusOf(spot);
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card' + (spot.status === 'done' ? ' done' : '');

      var meta = spot.kind === 'official'
        ? plural(spot.replies.length, 'reply', 'replies') + ' · evidence only'
        : (spot.status === 'done'
            ? 'Cleaned by ' + plural(spot.crew.length, 'person', 'people')
            : spot.crew.length + ' joined · ' + plural(spot.replies.length, 'reply', 'replies'));

      btn.innerHTML =
        '<span class="dot dot-' + st.cls + '"></span>' +
        '<span class="card-main">' +
          '<span class="card-title">' + escapeHtml(spot.title) + '</span>' +
          '<span class="card-meta">' + meta + ' · ' + escapeHtml(spot.when) + '</span>' +
        '</span>' +
        '<span class="tag ' + st.tag + '">' + st.label + '</span>';

      btn.addEventListener('click', function () { openSpot(spot.id); });
      li.appendChild(btn);
      list.appendChild(li);
    });

    var openCount = state.spots.filter(function (s) { return s.status !== 'done'; }).length;
    var doneCount = state.spots.length - openCount;
    $('listSub').textContent = openCount + ' still open · ' + doneCount + ' cleaned';
  }

  function renderStats() {
    var joinedN = state.spots.filter(function (s) { return joined(s) && s.status !== 'done'; }).length;
    var cleanedN = state.spots.filter(function (s) { return joined(s) && s.status === 'done'; }).length;
    var reportedN = state.spots.filter(function (s) { return s.reporter === ME; }).length;

    $('statJoined').textContent = joinedN;
    $('statCleaned').textContent = cleanedN;
    $('statReported').textContent = reportedN;

    var pct = Math.min(100, Math.round((cleanedN / CERT_GOAL) * 100));
    $('certFill').style.width = pct + '%';
    $('certBar').setAttribute('aria-valuenow', String(Math.min(cleanedN, CERT_GOAL)));

    var cert = $('cert');
    if (cleanedN >= CERT_GOAL) {
      cert.classList.add('earned');
      $('certState').textContent = 'earned';
      $('certNote').textContent = 'Certificate earned — ' + cleanedN + ' cleanups in Dilijan. Ready to be signed by the municipality.';
    } else {
      cert.classList.remove('earned');
      $('certState').textContent = 'locked';
      $('certNote').textContent = 'Finish ' + (CERT_GOAL - cleanedN) + ' more cleanup' +
        (CERT_GOAL - cleanedN === 1 ? '' : 's') + ' to earn your certificate.';
    }
  }

  /* ---------- spot detail sheet ---------- */
  var currentId = null;

  function openSpot(id) {
    currentId = id;
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot) return;

    var st = statusOf(spot);
    var html = '';

    html += '<span class="tag ' + st.tag + '">' + st.label + '</span>';
    html += '<h2 id="sheetTitle" style="margin-top:8px">' + escapeHtml(spot.title) + '</h2>';
    html += '<p class="sheet-sub">Reported by ' + escapeHtml(spot.reporter) + ' · ' + escapeHtml(spot.when) + '</p>';
    html += '<p class="sheet-desc">' + escapeHtml(spot.desc) + '</p>';

    if (spot.status === 'done') {
      html += '<div class="photo-pair">' +
                '<div class="photo">Before</div>' +
                '<div class="photo after">After</div>' +
              '</div>';
    } else {
      html += '<div class="photo">Photo from the report</div>';
    }

    if (spot.kind === 'official') {
      html += '<div class="notice"><strong>Volunteers cannot fix this one.</strong> ' +
              'Replies here build the evidence file — the more reports on the same spot, ' +
              'the harder it is for the municipality to ignore.</div>';
    } else {
      html += '<div class="crew"><h3>Crew (' + spot.crew.length + ')</h3>';
      if (spot.crew.length) {
        html += '<ul class="avatars">';
        spot.crew.forEach(function (m) {
          html += '<li class="av' + (m === ME ? ' me' : '') + '"><b>' + escapeHtml(initials(m)) + '</b>' + escapeHtml(m) + '</li>';
        });
        html += '</ul>';
      } else {
        html += '<p class="empty">Nobody yet. Be the first to join.</p>';
      }
      html += '</div>';
    }

    html += '<div class="replies"><h3>' + plural(spot.replies.length, 'Reply', 'Replies') + '</h3>';
    if (spot.replies.length) {
      spot.replies.forEach(function (r) {
        html += '<div class="reply"><div class="reply-who"><b>' + escapeHtml(r.who) + '</b></div>' +
                '<div>' + escapeHtml(r.text) + '</div></div>';
      });
    } else {
      html += '<p class="empty">No replies yet.</p>';
    }
    html += '<div class="replybox">' +
              '<input id="replyInput" type="text" maxlength="200" placeholder="Write a reply…" aria-label="Write a reply">' +
              '<button class="btn btn-ghost" id="replySend" type="button">Send</button>' +
            '</div></div>';

    html += '<div class="sheet-actions">';
    if (spot.kind === 'cleanup') {
      if (spot.status === 'done') {
        html += '<button class="btn btn-done btn-block" type="button" disabled>Cleaned — nice work</button>';
      } else if (joined(spot)) {
        html += '<button class="btn btn-ghost btn-block" type="button" disabled>You are in this crew</button>';
        html += '<button class="btn btn-primary btn-block" id="doneBtn" type="button">Mark as cleaned</button>';
      } else {
        html += '<button class="btn btn-primary btn-block" id="joinBtn" type="button">I\'ll join this cleanup</button>';
      }
    }
    html += '</div>';

    $('sheetBody').innerHTML = html;

    var joinBtn = $('joinBtn');
    if (joinBtn) joinBtn.addEventListener('click', function () { joinCrew(spot.id); });

    var doneBtn = $('doneBtn');
    if (doneBtn) doneBtn.addEventListener('click', function () { markCleaned(spot.id); });

    $('replySend').addEventListener('click', function () { sendReply(spot.id); });
    $('replyInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendReply(spot.id); }
    });

    show($('sheetBack'));
  }

  function joinCrew(id) {
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot || joined(spot)) return;
    spot.crew.push(ME);
    if (spot.status === 'open') spot.status = 'crew';
    addPoints(PTS_JOIN);
    render();
    openSpot(id);
    toast('You joined the crew · +' + PTS_JOIN + ' pts');
  }

  function sendReply(id) {
    var input = $('replyInput');
    var text = input.value.trim();
    if (!text) { input.focus(); return; }
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot) return;
    spot.replies.push({ who: ME, text: text });
    render();
    openSpot(id);
    toast('Reply posted');
  }

  function markCleaned(id) {
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot || spot.status === 'done') return;
    spot.status = 'done';
    spot.when = 'just now';
    addPoints(PTS_CLEAN);
    render();
    openSpot(id);
    toast('Spot marked clean · +' + PTS_CLEAN + ' pts');
  }

  /* ---------- report flow ---------- */
  var placing = false;
  var pending = null;

  function startPlacing() {
    placing = true;
    $('map').classList.add('placing');
    $('mapHint').hidden = false;
    $('reportBtn').hidden = true;
    $('cancelReportBtn').hidden = false;
    $('mapSub').textContent = 'Tap the spot on the map where you found the pollution.';
    $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function stopPlacing() {
    placing = false;
    $('map').classList.remove('placing');
    $('mapHint').hidden = true;
    $('reportBtn').hidden = false;
    $('cancelReportBtn').hidden = true;
    $('mapSub').textContent = 'Tap a marker to see the spot, join a crew, or reply.';
  }

  $('map').addEventListener('click', function (ev) {
    if (!placing) return;
    var r = this.getBoundingClientRect();
    pending = {
      x: Math.round(((ev.clientX - r.left) / r.width) * 1000) / 10,
      y: Math.round(((ev.clientY - r.top) / r.height) * 1000) / 10
    };
    stopPlacing();
    $('reportForm').reset();
    $('formErr').hidden = true;
    show($('formBack'));
    setTimeout(function () { $('fTitle').focus(); }, 60);
  });

  $('reportBtn').addEventListener('click', startPlacing);
  $('cancelReportBtn').addEventListener('click', stopPlacing);

  $('reportForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var title = $('fTitle').value.trim();
    var desc = $('fDesc').value.trim();
    if (!title || !desc) {
      var err = $('formErr');
      err.textContent = 'Please fill in both the place and what you found.';
      err.hidden = false;
      return;
    }
    var kind = document.querySelector('input[name="kind"]:checked').value;
    var id = 'u' + Date.now();

    state.spots.unshift({
      id: id,
      title: title,
      desc: desc,
      kind: kind,
      status: 'open',
      x: pending ? pending.x : 50,
      y: pending ? pending.y : 50,
      reporter: ME,
      when: 'just now',
      crew: [],
      replies: []
    });

    newestId = id;
    addPoints(PTS_REPORT);
    hide($('formBack'));
    render();
    toast('Report posted · +' + PTS_REPORT + ' pts');
    setTimeout(function () { newestId = null; renderPins(); }, 2200);
  });

  /* ---------- sheet open/close ---------- */
  function show(el) {
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function hide(el) {
    el.hidden = true;
    document.body.style.overflow = '';
  }

  $('sheetClose').addEventListener('click', function () { hide($('sheetBack')); });
  $('formClose').addEventListener('click', function () { hide($('formBack')); });

  [['sheetBack'], ['formBack']].forEach(function (pair) {
    var el = $(pair[0]);
    el.addEventListener('click', function (ev) { if (ev.target === el) hide(el); });
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (!$('sheetBack').hidden) hide($('sheetBack'));
    else if (!$('formBack').hidden) hide($('formBack'));
    else if (placing) stopPlacing();
  });

  $('resetBtn').addEventListener('click', function () {
    state = seed();
    newestId = null;
    render();
    toast('Demo reset');
  });

  render();
})();
