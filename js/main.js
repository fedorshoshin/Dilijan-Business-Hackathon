/* Havak — app shell: tab bar, routes, service worker.

   The tab bar is driven by the signed-in account's roles. Ticking a role in the
   profile adds its tab immediately; that is task 1.4's check. */

window.Havak = window.Havak || {};

Havak.shell = (function () {
  'use strict';

  var el = Havak.ui.el;
  var auth = Havak.auth;

  /* single-path icons, drawn at 24px on a 24-box */
  var ICONS = {
    map: 'M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5A2.5 2.5 0 1 0 12 11a2.5 2.5 0 0 0 0-5z',
    report: 'M4 7h3l2-2h6l2 2h3v12H4zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    jobs: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1.2 12H7.2zm3.4 2 .5 8h1.2l-.4-8zm5.2 0-.5 8h-1.2l.4-8z',
    give: 'M12 21s-8-5-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 11c0 5-8 10-8 10z',
    me: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4 0-7.5 2.2-7.5 5V21h15v-2c0-2.8-3.5-5-7.5-5z'
  };

  var TABS = [
    { path: '/feed',   label: 'Map',    icon: 'map' },
    { path: '/report', label: 'Report', icon: 'report', role: 'reporter' },
    { path: '/jobs',   label: 'Jobs',   icon: 'jobs',   role: 'cleaner' },
    { path: '/give',   label: 'Give',   icon: 'give',   role: 'donor' },
    { path: '/me',     label: 'Me',     icon: 'me' }
  ];

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function syncTabs() {
    var bar = document.getElementById('tabbar');
    var user = auth.current();

    if (!user) { bar.hidden = true; bar.innerHTML = ''; return; }

    var mine = TABS.filter(function (t) {
      return !t.role || auth.hasRole(t.role, user);
    });

    bar.innerHTML = '';
    bar.hidden = false;
    mine.forEach(function (t) {
      bar.appendChild(el('a.tab', {
        href: '#' + t.path,
        'data-tab': t.path,
        'aria-label': t.label
      }, [
        icon(t.icon),
        el('span.tab-label', { text: t.label })
      ]));
    });
    markActive(Havak.router.path());
  }

  function markActive(path) {
    var tabs = document.querySelectorAll('#tabbar .tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      var on = tab.getAttribute('data-tab') === path;
      tab.classList.toggle('is-on', on);
      if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  }

  /* ---------- install prompt ----------
     Chrome hands us the event to fire later. iOS gives nothing, so we detect
     Safari-on-iOS and show the Share -> Add to Home Screen instruction instead.
     Without this, iPhone users never discover the install at all. */
  function installer() {
    var bar = document.getElementById('installbar');
    if (!bar) return;

    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;
    if (standalone) return;

    if (sessionStorage.getItem('havak-install-hidden') === '1') return;

    var deferred = null;

    function show(children) {
      bar.innerHTML = '';
      bar.hidden = false;
      bar.appendChild(el('div.install-in', null, children.concat([
        el('button.install-x', {
          type: 'button',
          'aria-label': 'Hide',
          text: '×',
          onclick: function () {
            bar.hidden = true;
            sessionStorage.setItem('havak-install-hidden', '1');
          }
        })
      ])));
    }

    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      deferred = ev;
      show([
        el('p.install-text', { text: 'Add Havak to your home screen' }),
        el('button.btn.btn-primary.btn-sm', {
          type: 'button',
          text: 'Install',
          onclick: function () {
            bar.hidden = true;
            deferred.prompt();
            deferred = null;
          }
        })
      ]);
    });

    var ua = window.navigator.userAgent;
    var isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIOS && isSafari) {
      show([
        el('p.install-text', {
          text: 'Install Havak: tap Share, then “Add to Home Screen”.'
        })
      ]);
    }
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {
        /* offline support is a bonus; the app works without it */
      });
    });
  }

  function start() {
    var r = Havak.router;

    r.define('/login',  { view: Havak.views.login,  guestOnly: true });
    r.define('/signup', { view: Havak.views.signup, guestOnly: true });
    r.define('/feed',   { view: Havak.views.feed,   auth: true });
    r.define('/report', { view: Havak.views.soon('report'), auth: true, role: 'reporter' });
    r.define('/jobs',   { view: Havak.views.soon('jobs'),   auth: true, role: 'cleaner' });
    r.define('/give',   { view: Havak.views.soon('give'),   auth: true, role: 'donor' });
    r.define('/me',     { view: Havak.views.me,     auth: true });

    r.start({
      mount: document.getElementById('screen'),
      notFound: { view: Havak.views.feed, auth: true },
      afterEach: function (path) {
        syncTabs();
        markActive(path);
      }
    });

    installer();
    registerWorker();
  }

  return { start: start, syncTabs: syncTabs };
})();

document.addEventListener('DOMContentLoaded', Havak.shell.start);
