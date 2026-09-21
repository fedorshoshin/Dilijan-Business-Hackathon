/* Havak — hash router.

   Hash routes (#/jobs) rather than paths, for two reasons: a static host has no
   rewrite rules, so /jobs would 404 on refresh; and the same hash routes work
   unchanged inside a Capacitor shell later.

   The router also owns the guard. Screens never check "am I signed in?" — by
   the time a view runs, that is already true. */

window.Havak = window.Havak || {};

Havak.router = (function () {
  'use strict';

  var routes = {};
  var notFound = null;
  var mount = null;
  var afterEach = null;
  var returnTo = null;     // where to go back to once login succeeds
  var currentPath = null;

  function define(path, config) {
    routes[path] = config;
  }

  function parse() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw || raw === '/') return { path: '/feed', param: null };

    var parts = raw.split('/').filter(Boolean);
    var path = '/' + (parts[0] || 'feed');
    return { path: path, param: parts[1] || null };
  }

  function go(path, replace) {
    var target = '#' + path;
    if (window.location.hash === target) { render(); return; }
    if (replace) window.location.replace(target);
    else window.location.hash = target;
  }

  /* where a signed-in user should land: their first available tab */
  function home() {
    return '/feed';
  }

  function render() {
    var at = parse();
    var route = routes[at.path] || notFound;
    if (!route) return;

    var user = Havak.auth.current();

    /* guard: signed out and the route needs an account */
    if (route.auth && !user) {
      returnTo = at.path;
      go('/login', true);
      return;
    }

    /* already signed in — no reason to sit on the login screen */
    if (route.guestOnly && user) {
      go(home(), true);
      return;
    }

    /* role-gated: the tab is not shown, and typing the route does not help */
    if (route.role && user && !Havak.auth.hasRole(route.role, user)) {
      go('/me', true);
      return;
    }

    var forward = currentPath !== null && currentPath !== at.path;
    currentPath = at.path;

    var screen = document.createElement('div');
    screen.className = 'screen' + (forward ? ' screen-in' : '');
    screen.setAttribute('data-route', at.path);

    route.view(screen, at.param);

    mount.innerHTML = '';
    mount.appendChild(screen);
    mount.scrollTop = 0;

    if (afterEach) afterEach(at.path, user);
  }

  /* after a successful login, continue to whatever was being asked for */
  function resume() {
    var target = returnTo;
    returnTo = null;
    go(target || home(), true);
  }

  function start(config) {
    mount = config.mount;
    notFound = config.notFound || null;
    afterEach = config.afterEach || null;
    window.addEventListener('hashchange', render);
    render();
  }

  return {
    define: define,
    start: start,
    go: go,
    render: render,
    resume: resume,
    home: home,
    path: function () { return currentPath; }
  };
})();
