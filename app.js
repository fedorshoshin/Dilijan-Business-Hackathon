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
      pledges: [],
      projects: [],
      donated: 0,
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

  /* ---------- things that need money ----------
     Fixed list: these are needs, not user content. Pledges are stored per device. */
  var FUND = [
    {
      id: 'f1', title: 'Gloves, bags and a first-aid kit',
      cost: 60000, raised: 45000, backers: 7,
      what: 'Enough protective gear for a 20-person crew to work a full Saturday on a riverbank without cutting their hands on glass.',
      who: 'Bought by the municipality, stored at the community centre and lent to any crew.'
    },
    {
      id: 'f2', title: 'Truck hire for one river clear-out',
      cost: 120000, raised: 120000, backers: 14,
      what: 'A day of truck and driver to haul away what a crew collects. Without it, full bags sit on the bank and end up back in the water.',
      who: 'Dilijan municipal sanitation service, one working day.'
    },
    {
      id: 'f3', title: 'Litter pickers and wheelbarrows',
      cost: 180000, raised: 60000, backers: 5,
      what: 'Twenty grabbers and four wheelbarrows, so steep banks and thorny ground can be cleared safely.',
      who: 'Shared equipment library, managed by volunteers.'
    },
    {
      id: 'f4', title: 'Five more recycling bins',
      cost: 350000, raised: 90000, backers: 9,
      what: 'Dilijan had no public plastic recycling bins until students installed five in March 2025. Five more would cover the centre and the bus station.',
      who: 'Installed by the municipality, emptied on the existing collection round.'
    },
    {
      id: 'f5', title: 'Water testing kit for the Aghstev',
      cost: 450000, raised: 0, backers: 0,
      what: 'Field kit to measure what is actually in the river month by month. Numbers are what turn a complaint into evidence.',
      who: 'Operated by a school science club with an NGO supervising.'
    },
    {
      id: 'f6', title: 'Camera traps for logging evidence',
      cost: 700000, raised: 210000, backers: 11,
      what: 'Around Dilijan at least 2,000 trees are cut illegally each year, but only about one in eleven reported cases ends in a conviction. Cameras turn "we saw stumps" into proof.',
      who: 'Eco-Patrol volunteers, handing footage to the inspection body.'
    },
    {
      id: 'f7', title: 'Fenced waste point at the park entrance',
      cost: 1200000, raised: 300000, backers: 6,
      what: 'A proper enclosed collection point where the illegal dump keeps reappearing at the forest edge, so waste stops being tipped inside the national park.',
      who: 'Municipality build, national park administration maintains it.'
    },
    {
      id: 'f8', title: 'Biological stage for the treatment plant',
      cost: 900000000, raised: 12000000, backers: 3,
      what: 'Tavush has one wastewater plant and it serves Dilijan, but it is mechanical only — it strains out solids and lets the rest through. A biological stage is what actually stops the river being polluted. No number of volunteers can do this one.',
      who: 'State and international donor funding, via the Water Committee.'
    },
    {
      id: 'f9', title: 'Eco-club starter packs for 3 schools',
      cost: 90000, raised: 30000, backers: 4,
      what: 'Sorting bins, posters and a simple lesson kit so each school can run its own waste club instead of waiting for the town to act.',
      who: 'School teachers, with a one-day training from an NGO.'
    },
    {
      id: 'f10', title: '"Take it home" signs for the trails',
      cost: 140000, raised: 140000, backers: 12,
      what: 'Twelve weatherproof signs at trailheads and picnic spots. Tourist litter on the Parz Lake trail is worst right after weekends.',
      who: 'National park administration installs and maintains them.'
    },
    {
      id: 'f11', title: 'Compost bins for the market',
      cost: 240000, raised: 55000, backers: 6,
      what: 'Food waste is the heaviest, smelliest part of what goes to landfill. Composting it at the market cuts the load and makes soil for the parks.',
      who: 'Market traders association, with municipal collection.'
    },
    {
      id: 'f12', title: 'Drone survey of the forest edge',
      cost: 550000, raised: 180000, backers: 8,
      what: 'Two flights a year over the park boundary, so new clearings and new dumps are spotted early instead of a year later.',
      who: 'Contracted surveyor; imagery shared with the park administration.'
    },
    {
      id: 'f13', title: 'Sorting station for collected plastic',
      cost: 3500000, raised: 400000, backers: 5,
      what: 'A covered place to sort and bale plastic before it goes to recyclers. Without one, sorted plastic gets mixed back into ordinary rubbish.',
      who: 'Municipality, on the existing sanitation service yard.'
    },
    {
      id: 'f14', title: 'Sewer connection for 40 riverside houses',
      cost: 45000000, raised: 2100000, backers: 9,
      what: 'Houses along the bank with no sewer connection discharge straight into the Aghstev. Connecting them is the cheapest real cut in river pollution available today.',
      who: 'Water Committee and Veolia Jur, with municipal co-funding.'
    }
  ];

  /* ---------- state ---------- */
  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.spots)) {
          // fill in anything added after this device last saved
          if (!Array.isArray(parsed.pledges)) parsed.pledges = [];
          if (!Array.isArray(parsed.projects)) parsed.projects = [];
          if (typeof parsed.donated !== 'number') parsed.donated = 0;
          return parsed;
        }
      }
    } catch (e) { /* corrupt or blocked storage — fall through to seed */ }
    return seed();
  }

  /* false means the write failed — usually the 5MB store is full, or private mode */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
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
    renderFund();
    $('pointsValue').textContent = state.points;
    save();
  }

  /* money, grouped in threes: 1200000 -> "1 200 000 AMD"
     (spelled out, not the ֏ sign, which falls back to a mismatched font) */
  function amd(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' AMD';
  }

  /* button size band — bigger bill, bigger button */
  function tierOf(cost) {
    if (cost >= 5000000) return 5;
    if (cost >= 800000) return 4;
    if (cost >= 300000) return 3;
    if (cost >= 100000) return 2;
    return 1;
  }

  function pledged(id) { return state.pledges.indexOf(id) !== -1; }

  /* the fixed list plus anything proposed on this device */
  function allFund() { return FUND.concat(state.projects); }

  function renderFund() {
    var cloud = $('fundCloud');
    if (!cloud) return;
    cloud.innerHTML = '';

    var total = $('fundTotal');
    if (state.donated > 0) {
      total.textContent = 'You have pledged ' + amd(state.donated) + ' so far. Thank you.';
      total.hidden = false;
    } else {
      total.hidden = true;
    }

    allFund().forEach(function (item) {
      var done = item.raised >= item.cost;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bub t' + tierOf(item.cost) + (done ? ' funded' : '') + (item.mine ? ' mine' : '');
      b.setAttribute('aria-label', item.title + ' — ' + amd(item.cost) + (done ? ', fully funded' : ''));
      b.innerHTML =
        '<span class="bub-title">' + escapeHtml(item.title) + '</span>' +
        '<span class="bub-cost">' + (done ? 'Funded ✓' : amd(item.cost)) + '</span>';
      b.addEventListener('click', function () { openFund(item.id); });
      cloud.appendChild(b);
    });
  }

  function openFund(id) {
    var item = allFund().find(function (f) { return f.id === id; });
    if (!item) return;

    var mine = pledged(id);
    var raised = item.raised;
    var backers = item.backers + (mine ? 1 : 0);
    var pct = Math.min(100, Math.round((raised / item.cost) * 100));
    var done = raised >= item.cost;

    var html = '';
    html += '<span class="tag ' + (done ? 'tag-done' : 'tag-official') + '">' +
            (done ? 'Fully funded' : 'Needs funding') + '</span>';
    if (item.mine) html += ' <span class="tag tag-crew">Proposed by you</span>';
    html += '<h2 id="sheetTitle" style="margin-top:8px">' + escapeHtml(item.title) + '</h2>';
    html += '<p class="sheet-sub">' + amd(item.cost) + ' · ' + plural(backers, 'backer', 'backers') + '</p>';
    html += '<p class="sheet-desc">' + escapeHtml(item.what) + '</p>';

    html += '<div class="fund-bar-wrap">' +
              '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
              '<p class="cert-note">' + amd(raised) + ' raised of ' + amd(item.cost) + ' (' + pct + '%)</p>' +
            '</div>';

    html += '<div class="crew"><h3>Who would do the work</h3><p>' + escapeHtml(item.who) + '</p></div>';

    html += '<div class="notice"><strong>Your money would not pass through this app.</strong> ' +
            'Pledging here tells the municipality someone is willing to pay, and they ' +
            'invoice you directly. We only track what was needed and what got delivered.</div>';

    html += '<div class="sheet-actions">';
    if (mine) {
      html += '<button class="btn btn-done btn-block" type="button" disabled>You pledged support ✓</button>';
    } else {
      html += '<button class="btn btn-primary btn-block" id="pledgeBtn" type="button">Pledge to fund this</button>';
    }
    html += '</div>';

    $('sheetBody').innerHTML = html;

    var pb = $('pledgeBtn');
    if (pb) pb.addEventListener('click', function () { pledge(id); });

    show($('sheetBack'));
  }

  function pledge(id) {
    if (pledged(id)) return;
    state.pledges.push(id);
    render();
    openFund(id);
    toast('Pledge registered — the municipality will be in touch');
  }

  /* ---------- donate ---------- */
  var DONATE_STEPS = [5000, 10000, 25000, 100000];

  function openDonate() {
    var html = '';
    html += '<h2 id="sheetTitle">Donate to Clean Dilijan</h2>';
    html += '<p class="sheet-sub">Not tied to one project — spent on whatever is closest to being finished.</p>';

    html += '<div class="amounts">';
    DONATE_STEPS.forEach(function (n) {
      html += '<button class="amount" type="button" data-amount="' + n + '">' + amd(n) + '</button>';
    });
    html += '</div>';

    html += '<label class="field"><span>Or another amount (AMD)</span>' +
            '<input id="customAmount" type="number" min="100" step="100" inputmode="numeric" placeholder="e.g. 15000"></label>';
    html += '<p class="err" id="donateErr" hidden></p>';

    html += '<div class="notice"><strong>No money moves through this app.</strong> ' +
            'This records that you intend to give. The municipality or partner NGO ' +
            'contacts you and takes the payment directly, so it stays traceable.</div>';

    html += '<div class="sheet-actions">' +
            '<button class="btn btn-primary btn-block" id="donateConfirm" type="button">Register my pledge</button>' +
            '</div>';

    $('sheetBody').innerHTML = html;

    var chosen = null;
    var buttons = $('sheetBody').querySelectorAll('.amount');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(buttons, function (o) { o.classList.remove('on'); });
        btn.classList.add('on');
        chosen = Number(btn.getAttribute('data-amount'));
        $('customAmount').value = '';
        $('donateErr').hidden = true;
      });
    });
    $('customAmount').addEventListener('input', function () {
      Array.prototype.forEach.call(buttons, function (o) { o.classList.remove('on'); });
      chosen = null;
      $('donateErr').hidden = true;
    });

    $('donateConfirm').addEventListener('click', function () {
      var custom = Number($('customAmount').value);
      var amount = chosen || (custom > 0 ? Math.round(custom) : 0);
      if (!amount || amount < 100) {
        var err = $('donateErr');
        err.textContent = 'Pick an amount, or type at least 100 AMD.';
        err.hidden = false;
        return;
      }
      state.donated += amount;
      hide($('sheetBack'));
      render();
      toast('Pledged ' + amd(amount) + ' — thank you');
    });

    show($('sheetBack'));
  }

  /* ---------- propose a project ---------- */
  function openNewProject() {
    var html = '';
    html += '<h2 id="sheetTitle">Propose a project</h2>';
    html += '<p class="sheet-sub">Something Dilijan needs that money would fix. It joins the cloud, sized by its cost.</p>';

    html += '<form id="projForm" novalidate>';
    html += '<label class="field"><span>What is it called?</span>' +
            '<input id="pTitle" type="text" maxlength="60" required placeholder="e.g. Bins for the school street"></label>';
    html += '<label class="field"><span>What would the money buy?</span>' +
            '<textarea id="pWhat" rows="3" maxlength="240" required placeholder="e.g. Six covered bins so the street stops filling with bags on collection day."></textarea></label>';
    html += '<label class="field"><span>Roughly how much? (AMD)</span>' +
            '<input id="pCost" type="number" min="1000" step="1000" inputmode="numeric" required placeholder="e.g. 250000"></label>';
    html += '<label class="field"><span>Who would do the work?</span>' +
            '<input id="pWho" type="text" maxlength="80" required placeholder="e.g. Municipality, on the existing collection round"></label>';
    html += '<p class="err" id="projErr" hidden></p>';
    html += '<button class="btn btn-primary btn-block" type="submit">Add to the cloud</button>';
    html += '</form>';

    $('sheetBody').innerHTML = html;

    $('projForm').addEventListener('input', function () { $('projErr').hidden = true; });

    $('projForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var title = $('pTitle').value.trim();
      var what = $('pWhat').value.trim();
      var who = $('pWho').value.trim();
      var cost = Math.round(Number($('pCost').value));
      var err = $('projErr');

      if (!title || !what || !who) {
        err.textContent = 'Please fill in every field.';
        err.hidden = false;
        return;
      }
      if (!cost || cost < 1000) {
        err.textContent = 'Give a rough cost of at least 1 000 AMD.';
        err.hidden = false;
        return;
      }

      state.projects.push({
        id: 'p' + Date.now(),
        title: title, what: what, who: who,
        cost: cost, raised: 0, backers: 0,
        mine: true
      });

      hide($('sheetBack'));
      render();
      toast('Project added to the cloud');
      $('fundCloud').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    show($('sheetBack'));
    setTimeout(function () { $('pTitle').focus(); }, 60);
  }

  $('donateBtn').addEventListener('click', openDonate);
  $('newProjectBtn').addEventListener('click', openNewProject);

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

    function shotOf(src, placeholder, alt, afterStyle) {
      return isPhoto(src)
        ? '<img class="photo" src="' + src + '" alt="' + escapeHtml(alt) + '">'
        : '<div class="photo' + (afterStyle ? ' after' : '') + '">' + placeholder + '</div>';
    }

    if (spot.status === 'done') {
      html += '<div class="photo-pair">' +
                '<figure>' + shotOf(spot.photo, 'No photo', 'Before cleaning: ' + spot.title, false) +
                  '<figcaption>Before</figcaption></figure>' +
                '<figure>' + shotOf(spot.after, 'No photo', 'After cleaning: ' + spot.title, true) +
                  '<figcaption>After</figcaption></figure>' +
              '</div>';
    } else {
      html += shotOf(spot.photo, 'No photo on this report', 'Photo of ' + spot.title, false);
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
    if (doneBtn) doneBtn.addEventListener('click', function () { openFinish(spot.id); });

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

  /* Step between "we finished" and the spot turning green: ask for proof. */
  function openFinish(id) {
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot) return;

    var html = '';
    html += '<h2 id="sheetTitle">Mark as cleaned</h2>';
    html += '<p class="sheet-sub">' + escapeHtml(spot.title) + '</p>';
    html += '<p class="sheet-desc">Add an "after" photo. A picture of the clean spot ' +
            'is what turns your word into proof — and it is what makes the certificate ' +
            'worth showing to a school or an employer.</p>';

    if (isPhoto(spot.photo)) {
      html += '<div class="crew"><h3>The photo from the report</h3>' +
              '<img class="photo" src="' + spot.photo + '" alt="Photo from the original report"></div>';
    }

    html += '<label class="field"><span>After photo <small class="opt">(optional)</small></span>' +
            '<input id="aPhoto" type="file" accept="image/*" capture="environment"></label>';
    html += '<div class="shot-preview" id="afterPreview" hidden>' +
              '<img id="afterImg" alt="The after photo you chose">' +
              '<div class="shot-row"><span class="shot-info" id="afterInfo"></span>' +
              '<button class="linkbtn" id="afterClear" type="button">Remove photo</button></div>' +
            '</div>';
    html += '<p class="err" id="afterErr" hidden></p>';

    html += '<div class="sheet-actions">' +
              '<button class="btn btn-primary btn-block" id="finishConfirm" type="button">Confirm cleanup</button>' +
              '<button class="btn btn-ghost btn-block" id="finishCancel" type="button">Cancel</button>' +
            '</div>';

    $('sheetBody').innerHTML = html;

    var afterPhoto = null;
    photoPicker({
      input: 'aPhoto', preview: 'afterPreview', img: 'afterImg',
      info: 'afterInfo', err: 'afterErr', clear: 'afterClear'
    }, function (dataUrl) { afterPhoto = dataUrl; });

    $('finishCancel').addEventListener('click', function () { openSpot(id); });
    $('finishConfirm').addEventListener('click', function () { markCleaned(id, afterPhoto); });

    show($('sheetBack'));
  }

  function markCleaned(id, afterPhoto) {
    var spot = state.spots.find(function (s) { return s.id === id; });
    if (!spot || spot.status === 'done') return;
    spot.status = 'done';
    spot.when = 'just now';
    spot.after = afterPhoto || null;

    var stored = save();
    var dropped = false;
    if (!stored && spot.after) {
      spot.after = null;
      stored = save();
      dropped = stored;
    }

    addPoints(PTS_CLEAN);
    render();
    openSpot(id);

    var msg;
    if (!stored) msg = 'This device is full — the change may vanish on refresh';
    else if (dropped) msg = 'Marked clean, but this device is full — after photo not kept';
    else msg = 'Spot marked clean · +' + PTS_CLEAN + ' pts';
    toast(msg);
  }

  /* ---------- photos ----------
     A phone photo is far too big for localStorage (~5MB for everything), so we
     redraw it smaller on a canvas and keep a compressed JPEG instead. */
  var PHOTO_MAX_W = 900;
  var PHOTO_QUALITY = 0.7;

  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That file is not an image we can open.')); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { reject(new Error('That image looks empty.')); return; }
          if (w > PHOTO_MAX_W) { h = Math.round(h * PHOTO_MAX_W / w); w = PHOTO_MAX_W; }

          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
          } catch (e) {
            reject(new Error('Could not process that image.'));
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function isPhoto(v) { return typeof v === 'string' && v.indexOf('data:image/') === 0; }

  function kb(dataUrl) { return Math.round(dataUrl.length * 0.75 / 1024); }

  /* Wires up one file input + preview. Used by both the report form and the
     "mark as cleaned" sheet. Returns a function that resets it. */
  function photoPicker(ids, onReady) {
    var input = $(ids.input), preview = $(ids.preview),
        img = $(ids.img), info = $(ids.info), err = $(ids.err);

    function clear() {
      onReady(null);
      input.value = '';
      preview.hidden = true;
      img.removeAttribute('src');
      info.textContent = '';
    }

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { clear(); return; }

      if (file.type && file.type.indexOf('image/') !== 0) {
        err.textContent = 'That file is not a photo. Pick an image.';
        err.hidden = false;
        clear();
        return;
      }

      info.textContent = 'Shrinking…';
      preview.hidden = false;

      shrinkPhoto(file).then(function (dataUrl) {
        onReady(dataUrl);
        img.src = dataUrl;
        info.textContent = 'Ready · about ' + kb(dataUrl) + ' KB';
        err.hidden = true;
      }).catch(function (e) {
        err.textContent = e.message;
        err.hidden = false;
        clear();
      });
    });

    $(ids.clear).addEventListener('click', clear);
    return clear;
  }

  /* ---------- report flow ---------- */
  var placing = false;
  var pending = null;
  var pendingPhoto = null;

  var clearPhoto = photoPicker({
    input: 'fPhoto', preview: 'photoPreview', img: 'photoImg',
    info: 'photoInfo', err: 'formErr', clear: 'photoClear'
  }, function (dataUrl) { pendingPhoto = dataUrl; });

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
    clearPhoto();
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

    var spot = {
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
      replies: [],
      photo: pendingPhoto
    };
    state.spots.unshift(spot);

    // photos are the one thing big enough to overflow this device's store
    var stored = save();
    var dropped = false;
    if (!stored && spot.photo) {
      spot.photo = null;
      stored = save();
      dropped = stored;
    }

    newestId = id;
    addPoints(PTS_REPORT);
    clearPhoto();
    hide($('formBack'));
    render();

    var msg;
    if (!stored) msg = 'This device is full — the report may vanish on refresh';
    else if (dropped) msg = 'Report saved, but this device is full — photo not kept';
    else msg = 'Report posted · +' + PTS_REPORT + ' pts';
    toast(msg);
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

  /* ---------- wheel of finished challenges ---------- */
  (function () {
    var wheel = $('wheel');
    if (!wheel) return;
    function step(dir) {
      var card = wheel.querySelector('.wcard');
      var by = card ? card.getBoundingClientRect().width + 12 : wheel.clientWidth * 0.8;
      wheel.scrollBy({ left: dir * by, behavior: 'smooth' });
    }
    $('wheelPrev').addEventListener('click', function () { step(-1); });
    $('wheelNext').addEventListener('click', function () { step(1); });
  })();

  $('resetBtn').addEventListener('click', function () {
    state = seed();
    newestId = null;
    render();
    toast('Demo reset');
  });

  render();
})();
