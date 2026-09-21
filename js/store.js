/* Havak — the data layer.

   Everything the app knows lives in ONE localStorage key, written as a single
   blob. One key, not five, because localStorage writes are whole-value and
   synchronous: a single write can never leave a claim pointing at a report that
   did not get saved.

   No view touches localStorage directly. This is the only file that does, so
   there is one place to fix a bug, one place to handle a full quota, and one
   file to swap if this ever grows a real backend. */

window.Havak = window.Havak || {};

Havak.store = (function () {
  'use strict';

  var KEY = 'havak-mvp-v1';
  var VERSION = 1;

  /* ---------- ids ----------
     Date.now() + a counter: unique on one device, which is all we have. */
  var seq = 0;
  function id(prefix) {
    seq += 1;
    return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36);
  }

  /* ---------- seed ----------
     A believable Dilijan: six people, reports at every stage of the lifecycle,
     and a donation history that already has money allocated to finished work.
     Without this the app opens empty and demos badly. */
  function seed() {
    var now = Date.now();
    var day = 86400000;

    var users = [
      { id: 'u-ani',    name: 'Ani Melkonyan',   email: 'ani@havak.am',    pass: 'demo1234', roles: ['reporter'],                        place: 'Dilijan, Tavush', joinedAt: now - 120 * day },
      { id: 'u-davit',  name: 'Davit Sargsyan',  email: 'davit@havak.am',  pass: 'demo1234', roles: ['cleaner'],                         place: 'Dilijan, Tavush', joinedAt: now - 90 * day },
      { id: 'u-lusine', name: 'Lusine Tadevosyan', email: 'lusine@havak.am', pass: 'demo1234', roles: ['donor'],                         place: 'Yerevan',         joinedAt: now - 60 * day },
      { id: 'u-narek',  name: 'Narek Avetisyan', email: 'narek@havak.am',  pass: 'demo1234', roles: ['reporter', 'cleaner', 'donor'],    place: 'Dilijan, Tavush', joinedAt: now - 200 * day },
      { id: 'u-sona',   name: 'Sona Baghdasaryan', email: 'sona@havak.am', pass: 'demo1234', roles: ['reporter', 'cleaner'],             place: 'Dilijan, Tavush', joinedAt: now - 45 * day },
      { id: 'u-tigran', name: 'Tigran Vardanyan', email: 'tigran@havak.am', pass: 'demo1234', roles: ['cleaner'],                        place: 'Ijevan',          joinedAt: now - 30 * day }
    ];

    var reports = [
      {
        id: 'r-1', reporterId: 'u-ani',
        title: 'Riverbank dump, Sharambeyan St',
        desc: 'Plastic bottles and torn construction bags tipped down the bank straight into the Aghstev.',
        loc: { x: 24, y: 62, label: 'Sharambeyan St, by the footbridge' },
        level: 4, hazardous: false, estMinutes: 120,
        media: [], status: 'open', createdAt: now - 2 * day, payout: 5800
      },
      {
        id: 'r-2', reporterId: 'u-narek',
        title: 'Roadside litter, M4 toward Ijevan',
        desc: 'Long strip of bottles and food packaging thrown from cars along the verge.',
        loc: { x: 74, y: 40, label: 'M4, 3km north of town' },
        level: 3, hazardous: false, estMinutes: 180,
        media: [], status: 'open', createdAt: now - 5 * day, payout: 8200
      },
      {
        id: 'r-3', reporterId: 'u-sona',
        title: 'Illegal dump, park entrance',
        desc: 'Household waste left at the forest edge just inside the national park boundary.',
        loc: { x: 60, y: 78, label: 'National park, east gate' },
        level: 5, hazardous: false, estMinutes: 240,
        media: [], status: 'open', createdAt: now - 7 * day, payout: 10600
      },
      {
        id: 'r-4', reporterId: 'u-ani',
        title: 'Paint tins dumped behind the garages',
        desc: 'About fifteen open tins of paint and solvent. Some have leaked into the soil.',
        loc: { x: 37, y: 54, label: 'Garage row, Kamo St' },
        level: 4, hazardous: true, estMinutes: 90,
        media: [], status: 'open', createdAt: now - 3 * day, payout: 7200
      },
      {
        id: 'r-5', reporterId: 'u-sona',
        title: 'Tourist litter, Parz Lake trail',
        desc: 'Cans and picnic waste along the last kilometre of the trail up to the lake.',
        loc: { x: 86, y: 17, label: 'Parz Lake trail, final km' },
        level: 2, hazardous: false, estMinutes: 60,
        media: [], status: 'claimed', createdAt: now - 9 * day, payout: 3400
      },
      {
        id: 'r-6', reporterId: 'u-narek',
        title: 'Bus station surroundings',
        desc: 'Litter scattered around the benches and the back wall of the station.',
        loc: { x: 41, y: 47, label: 'Bus station, Myasnikyan St' },
        level: 2, hazardous: false, estMinutes: 75,
        media: [], status: 'cleaned', createdAt: now - 14 * day, payout: 4000,
        cleanedAt: now - 1 * day
      },
      {
        id: 'r-7', reporterId: 'u-ani',
        title: 'Glass and cans, school playing field',
        desc: 'Broken bottles across the running track. Children play here every afternoon.',
        loc: { x: 30, y: 38, label: 'School no. 3, playing field' },
        level: 3, hazardous: false, estMinutes: 45,
        media: [], status: 'confirmed', createdAt: now - 21 * day, payout: 2800,
        cleanedAt: now - 18 * day, confirmedAt: now - 17 * day, rating: 5
      },
      {
        id: 'r-8', reporterId: 'u-sona',
        title: 'Fly-tipping at the old quarry track',
        desc: 'Two loads of building rubble and a sofa pushed off the track edge.',
        loc: { x: 18, y: 70, label: 'Old quarry track' },
        level: 4, hazardous: false, estMinutes: 150,
        media: [], status: 'confirmed', createdAt: now - 30 * day, payout: 7000,
        cleanedAt: now - 26 * day, confirmedAt: now - 25 * day, rating: 4
      },
      {
        id: 'r-9', reporterId: 'u-narek',
        title: 'Picnic waste, forest glade north slope',
        desc: 'Bags left behind after weekend barbecues, scattered by animals.',
        loc: { x: 52, y: 22, label: 'North slope glade' },
        level: 2, hazardous: false, estMinutes: 60,
        media: [], status: 'confirmed', createdAt: now - 40 * day, payout: 3400,
        cleanedAt: now - 36 * day, confirmedAt: now - 35 * day, rating: 5
      },
      {
        id: 'r-10', reporterId: 'u-ani',
        title: 'Car batteries by the stream',
        desc: 'Four lead-acid batteries left in the shallows. Acid casing cracked on two.',
        loc: { x: 66, y: 60, label: 'Stream below the water tower' },
        level: 5, hazardous: true, estMinutes: 60,
        media: [], status: 'open', createdAt: now - 1 * day, payout: 5100
      }
    ];

    var claims = [
      { id: 'c-1', reportId: 'r-5', cleanerId: 'u-davit',  claimedAt: now - 1 * day,  cleanedAt: null,          proofMedia: [], status: 'active' },
      { id: 'c-2', reportId: 'r-6', cleanerId: 'u-tigran', claimedAt: now - 3 * day,  cleanedAt: now - 1 * day, proofMedia: [], status: 'done' },
      { id: 'c-3', reportId: 'r-7', cleanerId: 'u-davit',  claimedAt: now - 19 * day, cleanedAt: now - 18 * day, proofMedia: [], status: 'done' },
      { id: 'c-4', reportId: 'r-8', cleanerId: 'u-narek',  claimedAt: now - 28 * day, cleanedAt: now - 26 * day, proofMedia: [], status: 'done' },
      { id: 'c-5', reportId: 'r-9', cleanerId: 'u-davit',  claimedAt: now - 38 * day, cleanedAt: now - 36 * day, proofMedia: [], status: 'done' }
    ];

    var donations = [
      { id: 'd-1', donorId: 'u-lusine', amount: 20000, target: 'general', createdAt: now - 50 * day, spent: 13200 },
      { id: 'd-2', donorId: 'u-narek',  amount: 10000, target: 'general', createdAt: now - 32 * day, spent: 0 },
      { id: 'd-3', donorId: 'u-lusine', amount: 5000,  target: 'r-8',     createdAt: now - 29 * day, spent: 5000 }
    ];

    /* every allocation row points at the donation it drew from and the cleanup
       it paid for — this is what the donor dashboard reads back */
    var alloc = [
      { id: 'a-1', donationId: 'd-1', reportId: 'r-9', cleanerId: 'u-davit', amount: 3400, at: now - 35 * day },
      { id: 'a-2', donationId: 'd-3', reportId: 'r-8', cleanerId: 'u-narek', amount: 5000, at: now - 25 * day },
      { id: 'a-3', donationId: 'd-1', reportId: 'r-8', cleanerId: 'u-narek', amount: 2000, at: now - 25 * day },
      { id: 'a-4', donationId: 'd-1', reportId: 'r-7', cleanerId: 'u-davit', amount: 2800, at: now - 17 * day }
    ];

    /* the seeds carry map positions; fill in the real coordinates they stand
       for, so seeded and user-made reports have the same shape */
    reports.forEach(function (r) {
      var real = Havak.geo.toLatLng(r.loc.x, r.loc.y);
      r.loc.lat = real.lat;
      r.loc.lng = real.lng;
    });

    return {
      version: VERSION,
      session: null,
      users: users,
      reports: reports,
      claims: claims,
      donations: donations,
      alloc: alloc
    };
  }

  /* ---------- migrations ----------
     A phone that already has Havak installed holds LAST version's shape. Each
     step upgrades one version forward, so old installs walk up to current
     instead of breaking. Add a step here whenever the shape changes; never
     edit an old one. */
  var MIGRATIONS = {
    // 1: function (data) { data.newField = []; return data; }
  };

  function migrate(data) {
    var v = typeof data.version === 'number' ? data.version : 0;
    while (v < VERSION) {
      var step = MIGRATIONS[v];
      if (!step) { v = VERSION; break; }   // no path defined: accept as current
      data = step(data);
      v += 1;
    }
    data.version = VERSION;
    return data;
  }

  /* every collection the app expects, so a partial save can never crash a view */
  var COLLECTIONS = ['users', 'reports', 'claims', 'donations', 'alloc'];

  function repair(data) {
    COLLECTIONS.forEach(function (name) {
      if (!Array.isArray(data[name])) data[name] = [];
    });
    if (typeof data.session === 'undefined') data.session = null;
    return data;
  }

  /* ---------- load ----------
     Corrupt JSON, a half-written blob, or storage blocked in private mode all
     land in the same place: fall back to seed rather than throw. A crash here
     kills the whole app, so this must never rethrow. */
  var state;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return repair(migrate(parsed));
        }
      }
    } catch (e) {
      /* fall through to seed */
    }
    return seed();
  }

  state = load();

  /* ---------- save ----------
     Returns false when the write fails — a full 5MB quota, or private mode.
     Callers MUST surface that. A save that silently fails is the worst bug we
     could ship: the user sees a confirmation and loses the work tomorrow. */
  var lastSaveOk = true;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastSaveOk = true;
      return true;
    } catch (e) {
      lastSaveOk = false;
      return false;
    }
  }

  function reset() {
    state = seed();
    save();
    return state;
  }

  /* ---------- record helpers (synchronous guts) ---------- */
  function allSync(kind) {
    return (state[kind] || []).slice();
  }

  function findSync(kind, recordId) {
    var list = state[kind] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === recordId) return list[i];
    }
    return null;
  }

  function whereSync(kind, test) {
    return (state[kind] || []).filter(test);
  }

  function addSync(kind, record) {
    if (!Array.isArray(state[kind])) state[kind] = [];
    if (!record.id) record.id = id(kind.charAt(0));
    if (!record.createdAt) record.createdAt = Date.now();
    /* the server uses this to ignore a replayed write after a lost reply
       (BACKEND.md §8) — generated here so it survives the offline queue */
    if (!record.clientId) record.clientId = id('c');
    state[kind].push(record);
    if (!save()) throw new StoreError('storage_quota', 'This device would not save that. Storage may be full.');
    return record;
  }

  function updateSync(kind, recordId, patch) {
    var rec = findSync(kind, recordId);
    if (!rec) throw new StoreError('not_found', 'That item no longer exists.');
    Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });
    if (!save()) throw new StoreError('storage_quota', 'This device would not save that. Storage may be full.');
    return rec;
  }

  function removeSync(kind, recordId) {
    var list = state[kind] || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === recordId) {
        list.splice(i, 1);
        save();
        return true;
      }
    }
    return false;
  }

  /* One error shape, matching what the server will send (BACKEND.md §7), so
     screens written now keep working once the calls go over the network. */
  function StoreError(code, message) {
    this.code = code;
    this.message = message;
  }
  StoreError.prototype = Object.create(Error.prototype);
  StoreError.prototype.name = 'StoreError';

  /* ---------- the async face ----------
     The guts above are synchronous because the data is local today. Every
     method the app calls returns a Promise anyway, so that when this is swapped
     for the real backend (DESIGN.md 3.5) the change stops at this file instead
     of reaching every screen. Retrofitting this later would mean rewriting
     every view; doing it now costs almost nothing. */
  function async(fn) {
    return function () {
      var args = arguments;
      return new Promise(function (resolve) {
        resolve(fn.apply(null, args));
      });
    };
  }

  return {
    KEY: KEY,
    VERSION: VERSION,
    StoreError: StoreError,

    /* resolves once the data is usable; the real one will fetch */
    ready: function () { return Promise.resolve(true); },

    /* async — everything the views use */
    all: async(allSync),
    find: async(findSync),
    where: async(whereSync),
    add: async(addSync),
    update: async(updateSync),
    remove: async(removeSync),
    reset: async(reset),

    /* synchronous, and deliberately so: session state is read on every render
       and every guard. It stays cached in memory on both sides of the swap. */
    session: function () { return state.session; },
    setSession: function (s) { state.session = s; return save(); },
    userSync: function (userId) { return findSync('users', userId); },

    saveOk: function () { return lastSaveOk; },
    newId: id
  };
})();
