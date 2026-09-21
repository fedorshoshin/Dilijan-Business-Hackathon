/* Havak — small shared UI helpers.

   Deliberately tiny: building DOM with createElement rather than innerHTML
   strings, so user-entered text can never become markup. */

window.Havak = window.Havak || {};

Havak.ui = (function () {
  'use strict';

  /* el('div.card', { onclick: fn }, [children | 'text']) */
  function el(spec, attrs, kids) {
    var parts = String(spec).split('.');
    var tag = parts.shift() || 'div';
    var node = document.createElement(tag);
    if (parts.length) node.className = parts.join(' ');

    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === false || typeof v === 'undefined') return;
        if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else if (k === 'text') {
          node.textContent = v;
        } else if (k === 'html') {
          node.innerHTML = v;
        } else if (k === 'value') {
          node.value = v;
        } else if (v === true) {
          node.setAttribute(k, '');
        } else {
          node.setAttribute(k, v);
        }
      });
    }

    if (typeof kids === 'string') {
      node.textContent = kids;
    } else if (Array.isArray(kids)) {
      kids.filter(Boolean).forEach(function (kid) {
        node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
      });
    }
    return node;
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map(function (w) {
      return w.charAt(0);
    }).join('').toUpperCase();
  }

  /* money, grouped in threes: 5800 -> "5 800 AMD" */
  function amd(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' AMD';
  }

  function minutes(n) {
    if (n < 60) return n + ' min';
    var h = Math.floor(n / 60);
    var m = n % 60;
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }

  function ago(ts) {
    var d = Math.floor((Date.now() - ts) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 14) return d + ' days ago';
    if (d < 60) return Math.floor(d / 7) + ' weeks ago';
    return Math.floor(d / 30) + ' months ago';
  }

  function since(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  var toastTimer;
  function toast(message) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 300);
    }, 2800);
  }

  function avatar(user, size) {
    return el('span.avatar' + (size === 'sm' ? '.avatar-sm' : ''), {
      'aria-hidden': 'true',
      text: initials(user.name)
    });
  }

  function empty(title, line) {
    return el('div.empty', null, [
      el('p.empty-title', { text: title }),
      line ? el('p.empty-line', { text: line }) : null
    ]);
  }

  var STATUS = {
    open:      { label: 'Reported',   cls: 'open' },
    claimed:   { label: 'Crew on it', cls: 'crew' },
    cleaned:   { label: 'Awaiting check', cls: 'check' },
    confirmed: { label: 'Cleaned',    cls: 'done' }
  };

  function statusTag(status) {
    var s = STATUS[status] || STATUS.open;
    return el('span.tag.tag-' + s.cls, { text: s.label });
  }

  return {
    el: el,
    initials: initials,
    amd: amd,
    minutes: minutes,
    ago: ago,
    since: since,
    toast: toast,
    avatar: avatar,
    empty: empty,
    statusTag: statusTag,
    STATUS: STATUS
  };
})();
