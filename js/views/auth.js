/* Havak — log in and sign up screens. */

window.Havak = window.Havak || {};
Havak.views = Havak.views || {};

(function () {
  'use strict';

  var el = Havak.ui.el;
  var auth = Havak.auth;

  function brand(tagline) {
    return Havak.ui.el('div.auth-brand', null, [
      el('span.brand-mark', { 'aria-hidden': 'true' }),
      el('h1.auth-title', { text: 'Havak' }),
      el('p.auth-am', { text: 'Հավաք · Դիլիջան' }),
      el('p.auth-lead', { text: tagline })
    ]);
  }

  function field(labelText, inputAttrs, hint) {
    var input = el('input', inputAttrs);
    var wrap = el('label.field', null, [
      el('span', { text: labelText }),
      input,
      hint ? el('small.field-hint', { text: hint }) : null
    ]);
    return { wrap: wrap, input: input };
  }

  function showError(errBox, inputs, result) {
    errBox.textContent = result.message;
    errBox.hidden = false;
    Object.keys(inputs).forEach(function (k) {
      inputs[k].classList.toggle('is-wrong', k === result.field);
    });
    if (inputs[result.field]) inputs[result.field].focus();
  }

  /* ---------- log in ---------- */
  Havak.views.login = function (screen) {
    var errBox = el('p.err', { hidden: true, role: 'alert' });

    var email = field('Email', { type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.am' });
    var pass = field('Password', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
    var inputs = { email: email.input, pass: pass.input };

    var form = el('form.auth-form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        var result = auth.logIn(email.input.value, pass.input.value);
        if (!result.ok) { showError(errBox, inputs, result); return; }
        Havak.ui.toast('Welcome back, ' + result.user.name.split(' ')[0]);
        Havak.router.resume();
      }
    }, [
      email.wrap,
      pass.wrap,
      errBox,
      el('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Log in' })
    ]);

    var demos = el('div.demo-row', null, auth.demoAccounts().map(function (d) {
      return el('button.demo-chip', {
        type: 'button',
        onclick: function () {
          auth.logInAs(d.user.id);
          Havak.ui.toast('Signed in as ' + d.user.name);
          Havak.router.resume();
        }
      }, [
        el('strong', { text: d.user.name.split(' ')[0] }),
        el('small', { text: d.caption })
      ]);
    }));

    screen.appendChild(el('div.auth-wrap', null, [
      brand('Report it, clean it, fund it — for Dilijan.'),
      form,
      el('p.auth-swap', null, [
        'New here? ',
        el('button.linkbtn', {
          type: 'button',
          text: 'Create an account',
          onclick: function () { Havak.router.go('/signup'); }
        })
      ]),
      el('div.demo-box', null, [
        el('p.demo-head', { text: 'Or try a demo account' }),
        demos
      ])
    ]));
  };

  /* ---------- sign up ---------- */
  Havak.views.signup = function (screen) {
    var errBox = el('p.err', { hidden: true, role: 'alert' });

    var name = field('Your name', { type: 'text', autocomplete: 'name', maxlength: '60', placeholder: 'Ani Melkonyan' });
    var email = field('Email', { type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.am' });
    var pass = field('Password', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
    var place = field('Where you are', { type: 'text', maxlength: '40', value: 'Dilijan, Tavush' });

    var boxes = {};
    var roleList = el('div.choices', null, auth.ROLES.map(function (role) {
      var box = el('input', { type: 'checkbox', name: 'role', value: role.key });
      boxes[role.key] = box;
      return el('label.choice', null, [
        box,
        el('span', null, [
          el('strong', { text: role.label }),
          el('small', { text: role.hint })
        ])
      ]);
    }));

    var roleField = el('fieldset.field', null, [
      el('legend', { text: 'What do you want to do?' }),
      el('p.field-hint', { text: 'Pick as many as you like — you can change this later.' }),
      roleList
    ]);

    var inputs = { name: name.input, email: email.input, pass: pass.input, roles: roleList };

    var form = el('form.auth-form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        var roles = Object.keys(boxes).filter(function (k) { return boxes[k].checked; });
        var result = auth.signUp({
          name: name.input.value,
          email: email.input.value,
          pass: pass.input.value,
          place: place.input.value,
          roles: roles
        });
        if (!result.ok) { showError(errBox, inputs, result); return; }
        Havak.ui.toast('Welcome to Havak, ' + result.user.name.split(' ')[0]);
        Havak.router.resume();
      }
    }, [
      name.wrap,
      email.wrap,
      pass.wrap,
      place.wrap,
      roleField,
      errBox,
      el('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Create account' }),
      el('p.notice.notice-plain', {
        text: 'Demo build: your account is stored only on this phone, and the ' +
              'password is not protected. Do not reuse a real password.'
      })
    ]);

    screen.appendChild(el('div.auth-wrap', null, [
      brand('One account. Report, clean, or fund — or all three.'),
      form,
      el('p.auth-swap', null, [
        'Already have an account? ',
        el('button.linkbtn', {
          type: 'button',
          text: 'Log in',
          onclick: function () { Havak.router.go('/login'); }
        })
      ])
    ]));
  };
})();
