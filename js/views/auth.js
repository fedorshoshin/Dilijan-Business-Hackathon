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
      el('h1.auth-title', { text: 'Cleaner Armenia' }),
      el('p.auth-am', { text: 'Դիլիջան' }),
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
        var btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        auth.logIn(email.input.value, pass.input.value).then(function (result) {
          btn.disabled = false;
          if (!result.ok) { showError(errBox, inputs, result); return; }
          Havak.ui.toast('Welcome back, ' + result.user.name.split(' ')[0]);
          Havak.router.resume();
        });
      }
    }, [
      email.wrap,
      pass.wrap,
      errBox,
      el('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Log in' })
    ]);

    /* The one-tap demo accounts are gone. They logged you in as a seeded person
       with no password, which was fine when the data lived on your own phone and
       is not fine now that these are real rows other people share. The seeded
       accounts still exist; they are logged into with a password like any other. */

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
      el('p.auth-swap', null, [
        el('button.linkbtn', {
          type: 'button',
          text: 'Forgot your password?',
          onclick: function () { Havak.router.go('/forgot'); }
        })
      ])
    ]));
  };

  /* ---------- forgot password ----------
     One field, and a confirmation that says the same thing whether or not the
     address has an account. The server cannot tell us which it was without
     handing out its user list, so the screen does not pretend to know. */
  Havak.views.forgot = function (screen) {
    var errBox = el('p.err', { hidden: true, role: 'alert' });
    var email = field('Email', {
      type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.am'
    }, 'The address you signed up with.');
    var inputs = { email: email.input };

    var wrap = el('div.auth-wrap');

    function sent(address) {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', null, [
        brand('Check your inbox.'),
        el('p.notice', {
          text: 'If ' + address + ' has a Cleaner Armenia account, a link to set a new ' +
                'password is on its way. It works once and expires in an hour.'
        }),
        el('p.notice.notice-plain', {
          text: 'Nothing arrived? Look in your spam folder, and check the ' +
                'address above for typos. You can ask again in a minute.'
        }),
        el('button.btn.btn-primary.btn-block', {
          type: 'button',
          text: 'Back to log in',
          onclick: function () { Havak.router.go('/login'); }
        })
      ]));
    }

    var form = el('form.auth-form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        var btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        var address = email.input.value.trim();
        auth.forgotPassword(address).then(function (result) {
          btn.disabled = false;
          if (!result.ok) { showError(errBox, inputs, result); return; }
          sent(address);
        });
      }
    }, [
      email.wrap,
      errBox,
      el('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Send me a link' })
    ]);

    wrap.appendChild(brand('Forgotten your password? We will email you a link.'));
    wrap.appendChild(form);
    wrap.appendChild(el('p.auth-swap', null, [
      el('button.linkbtn', {
        type: 'button',
        text: 'Back to log in',
        onclick: function () { Havak.router.go('/login'); }
      })
    ]));
    screen.appendChild(wrap);
  };

  /* ---------- set a new password ----------
     Reached only from the emailed link: #/reset/<token>. The token is the route
     parameter, so there is nothing to paste and nothing to type wrong. */
  Havak.views.reset = function (screen, resetToken) {
    var wrap = el('div.auth-wrap');
    screen.appendChild(wrap);

    if (!resetToken) {
      wrap.appendChild(brand('That link is incomplete.'));
      wrap.appendChild(el('p.notice', {
        text: 'Open the link in the email again, or ask for a new one. Some mail ' +
              'apps cut long links in half.'
      }));
      wrap.appendChild(el('button.btn.btn-primary.btn-block', {
        type: 'button',
        text: 'Ask for a new link',
        onclick: function () { Havak.router.go('/forgot'); }
      }));
      return;
    }

    var errBox = el('p.err', { hidden: true, role: 'alert' });
    var pass = field('New password', {
      type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters'
    });
    var again = field('Type it again', {
      type: 'password', autocomplete: 'new-password', placeholder: 'The same password'
    });
    var inputs = { pass: pass.input, again: again.input };

    var form = el('form.auth-form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        /* Checked here and not on the server: a server has no idea what you
           typed twice, and this is a typo guard, not a security rule. */
        if (pass.input.value !== again.input.value) {
          showError(errBox, inputs, { field: 'again', message: 'Those two do not match.' });
          return;
        }
        var btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        auth.resetPassword(resetToken, pass.input.value).then(function (result) {
          btn.disabled = false;
          if (!result.ok) { showError(errBox, inputs, result); return; }
          Havak.ui.toast('Password changed. Log in with the new one.');
          Havak.router.go('/login');
        });
      }
    }, [
      pass.wrap,
      again.wrap,
      errBox,
      el('button.btn.btn-primary.btn-block', { type: 'submit', text: 'Set new password' }),
      el('p.notice.notice-plain', {
        text: 'Setting a new password signs you out on every other device, so ' +
              'anyone who should not be in your account is locked out.'
      })
    ]);

    wrap.appendChild(brand('Choose a new password.'));
    wrap.appendChild(form);
  };

  /* ---------- confirm an email address ----------
     Reached from #/verify/<token>, and it spends the token on arrival: there is
     nothing for the user to do here but read the outcome. Works signed out,
     because this link is often opened on a different phone from the one that
     signed up. */
  Havak.views.verify = function (screen, verifyToken) {
    var wrap = el('div.auth-wrap');
    screen.appendChild(wrap);

    function done(title, body, tone) {
      wrap.innerHTML = '';
      wrap.appendChild(brand(title));
      wrap.appendChild(el(tone === 'bad' ? 'p.notice.notice-plain' : 'p.notice', { text: body }));
      wrap.appendChild(el('button.btn.btn-primary.btn-block', {
        type: 'button',
        text: auth.signedIn() ? 'Continue' : 'Log in',
        onclick: function () { Havak.router.go(auth.signedIn() ? Havak.router.home() : '/login'); }
      }));
    }

    if (!verifyToken) {
      done('That link is incomplete.',
           'Open the link in the email again. Some mail apps cut long links in half.',
           'bad');
      return;
    }

    wrap.appendChild(brand('Confirming your email…'));
    wrap.appendChild(Havak.ui.loading('One moment'));

    return auth.confirmEmail(verifyToken).then(function (result) {
      if (result.ok) {
        done('Email confirmed.',
             'Thank you — we know we can reach you now. You can close this and ' +
             'carry on using Cleaner Armenia.');
      } else {
        done('That link did not work.', result.message, 'bad');
      }
    });
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
        var btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        var roles = Object.keys(boxes).filter(function (k) { return boxes[k].checked; });
        auth.signUp({
          name: name.input.value,
          email: email.input.value,
          pass: pass.input.value,
          place: place.input.value,
          roles: roles
        }).then(function (result) {
          btn.disabled = false;
          if (!result.ok) { showError(errBox, inputs, result); return; }
          Havak.ui.toast('Welcome to Havak, ' + result.user.name.split(' ')[0]);
          Havak.router.resume();
        });
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
        text: 'Your password is hashed on our server and never stored on this ' +
              'phone. Your name and reports are visible to other Cleaner Armenia users.'
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
