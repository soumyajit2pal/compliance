import { assetUrl } from '../core/assets.ts';
import { state } from '../core/state.ts';
import { root } from '../core/dom.ts';
import { api, signIn } from '../core/api.ts';
import { esc, button, field, input, message } from '../ui/components.ts';
import { close } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { shell, heading } from '../ui/layout.ts';
import { departmentGate } from './ldap-department.ts';
import { workProfilePage } from './work-profile.ts';
import { loadingMarkup } from '../ui/loading.ts';

let demoUsers = [];
let loginRevision = 0;

export function loginView() {
  // The React bridge records markup before committing it to the DOM. Startup,
  // expiry and route callbacks can all request login during that interval.
  if (root.innerHTML.includes('<form id="login">')) return;
  const revision = ++loginRevision;
  demoUsers = [];
  document.title = 'Sign in · Compliance by Design';
  document.body.classList.add('portal-mode');
  root.innerHTML = /* HTML */ `
    <div class="auth-page">
      <header class="auth-masthead">
        <img class="auth-bank-logo" src="${assetUrl('assets/bank-of-maharashtra-wordmark.png')}" alt="Bank of Maharashtra" />
        <div class="auth-brand">
          <span class="auth-brand-icon">${icon('shield')}</span>
          <span class="auth-brand-name">Compliance <span>by Design</span></span>
        </div>
      </header>
      <main class="auth-shell" aria-label="Compliance by Design sign in">
        <section class="auth-card" aria-labelledby="sign-in-title">
          <div class="auth-form-inner">
            <div class="auth-card-heading">
              <div class="auth-kicker"><span></span> Your compliance workspace</div>
              <h1 id="sign-in-title">Welcome back</h1>
              <p>Sign in with your Standard or LDAP account.</p>
            </div>
            <form id="login">
              <div class="auth-credentials">
                <div class="field"><label for="login-username">Username</label>
                  <div class="auth-input-wrap">${icon('users')}
                    <input id="login-username" name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" autofocus>
                  </div>
                </div>
                <div class="field"><label for="login-password">Password</label>
                  <div class="auth-input-wrap">${icon('lock')}
                    <input id="login-password" name="password" type="password" required autocomplete="current-password">
                    <button class="auth-password-toggle" type="button" data-action="toggle-login-password" aria-label="Show password" aria-pressed="false" aria-controls="login-password">${icon('eye')}</button>
                  </div>
                </div>
              </div>
              <p class="inline-error" id="login-error" role="alert"></p>
              <button class="btn primary auth-submit" type="submit"><span>Sign in</span>${icon('arrow')}</button>
              <div id="demo-sign-in" aria-busy="true">${demoLoading()}</div>
            </form>
            <div class="auth-footer">
              <span>${icon('lock')} Secure access</span>
              <a href="${assetUrl('guides/week-1-3-navigation.html')}" target="_blank" rel="noopener">
                User guide ${icon('external')}
              </a>
            </div>
          </div>
        </section>
        <aside class="auth-story" aria-label="About Compliance by Design">
          <div class="auth-story-topline"><span>Compliance, connected.</span><span class="auth-story-symbol" aria-hidden="true">${icon('sparkle')}</span></div>
          <div class="auth-copy">
            <h2>Every requirement.<br>A clear way <em>forward.</em></h2>
            <p class="auth-description">Bring regulatory sources, considered decisions and clear responsibilities into one connected view.</p>
          </div>
          <div class="auth-pathway" role="img" aria-label="A continuous line connects regulatory sources, interpretation and accountable action.">
            <svg viewBox="0 0 500 240" fill="none" aria-hidden="true">
              <path class="auth-thread-muted" d="M-20 190H75Q105 190 105 160V75Q105 45 135 45H220Q250 45 250 75V165Q250 195 280 195H365Q395 195 395 165V80Q395 50 425 50H525" />
              <path class="auth-thread" d="M-20 190H75Q105 190 105 160V75Q105 45 135 45H220Q250 45 250 75V165Q250 195 280 195H365Q395 195 395 165V80Q395 50 425 50H525" />
              <g class="auth-document-motion auth-document-motion-first">
                <g class="auth-page-drawing" transform="translate(48 62) rotate(-9 50 60)">
                <rect width="104" height="126" rx="5" /><path d="M22 29H65M22 42H82M22 68H82M22 81H70M22 94H58" />
                <circle cx="80" cy="104" r="5" />
                </g>
              </g>
              <g class="auth-document-motion auth-document-motion-middle">
                <g class="auth-page-drawing auth-page-drawing-middle" transform="translate(197 71) rotate(7 50 60)">
                <rect width="104" height="126" rx="5" /><path d="M22 29H64M22 42H82M22 69H82M22 82H65M22 95H76" />
                <path class="auth-document-mark" d="M14 61H87" />
                </g>
              </g>
              <g class="auth-document-motion auth-document-motion-last">
                <g class="auth-page-drawing auth-page-drawing-last" transform="translate(344 40) rotate(-7 50 60)">
                <rect width="104" height="126" rx="5" /><path d="M22 29H65M22 42H82M22 70H82M22 83H67M22 96H75" />
                <path class="auth-document-mark" d="M75 102l7 7 15-18" />
                </g>
              </g>
              <circle class="auth-thread-dot" cx="250" cy="219" r="4" />
              <path class="auth-thread-tick" d="M250 223V240" />
            </svg>
          </div>
          <ol class="auth-principles" aria-label="A connected approach">
            <li><span>01</span> Source</li><li><span>02</span> Interpretation</li><li><span>03</span> Action</li>
          </ol>
          <footer class="auth-story-footer"><span>Clarity at the source.<br>Accountability at every step.</span>${icon('arrow')}</footer>
        </aside>
      </main>
      <footer class="auth-page-footer"><span>Compliance by Design</span><span>Clarity <i></i> Accountability <i></i> Traceability</span></footer>
    </div>
  `;
  loadDemoOptions(revision);
}

function demoLoading() {
  return '<div class="demo-loading"><strong>Demo users</strong>' + loadingMarkup('Loading demo users…') + '</div>';
}

async function loadDemoOptions(revision) {
  try {
    const data = await api('/auth/demo-users');
    const container = document.querySelector<HTMLDivElement>('#demo-sign-in');
    if (revision !== loginRevision || !container) return;
    demoUsers = data.users;
    container.hidden = false;
    container.setAttribute('aria-busy', 'false');
    container.innerHTML = /* HTML */ `
      <div class="demo-picker">
        <label for="demo-user">Demo user <span class="demo-tag">UAT</span></label>
        <select
          id="demo-user"
          aria-describedby="demo-description"
          ${demoUsers.length ? '' : 'disabled'}
        >
          <option value="">
            ${demoUsers.length ? 'Choose a demo user…' : 'No active demo users available'}
          </option>
          ${demoUsers
            .map(
              (user) =>
                /* HTML */ `<option value="${esc(user.username)}">
                  ${esc(user.full_name)} · ${esc(user.roles.join(' / '))}
                </option>`,
            )
            .join('')}
        </select>
        <p id="demo-description" class="compact" aria-live="polite"></p>
      </div>
    `;
  } catch (error) {
    const container = document.querySelector<HTMLDivElement>('#demo-sign-in');
    if (revision !== loginRevision || !container) return;
    container.setAttribute('aria-busy', 'false');
    // Prod and disabled UAT deployments return 404. Other failures can be retried
    // explicitly; no automatic requests and no interruption of manual sign-in.
    container.hidden = error.status === 404;
    container.innerHTML = error.status === 404 ? '' :
      '<div class="demo-load-error"><p>Demo users could not be loaded. You can still sign in manually.</p>' +
      button('retry-demo-users', 'Retry', '', 'small') + '</div>';
  }
}

export function selectDemoUser(event) {
  const target = event.target as HTMLSelectElement;
  if (target.id !== 'demo-user') return;
  const user = demoUsers.find((user) => user.username === target.value);
  const form = document.querySelector<HTMLFormElement>('#login');
  if (!form) return;
  (form.elements.namedItem('username') as HTMLInputElement).value = user?.username || '';
  (form.elements.namedItem('password') as HTMLInputElement).value = user?.password || '';
  document.querySelector('#login-error').textContent = '';
  document.querySelector('#demo-description').textContent = user
    ? [!user.password_autofill_available ? 'Enter this account’s current password.' : '',
      user.must_change_password ? 'Set a personal password after sign-in.' : ''].filter(Boolean).join(' ')
    : '';
}

export function clearDemoSelection(event) {
  // Entering the selected account's current password keeps that choice visible.
  const target = event.target as HTMLInputElement;
  if (!target.matches('#login input[name="username"]')) return;
  const picker = document.querySelector<HTMLSelectElement>('#demo-user');
  if (picker) {
    picker.value = '';
    document.querySelector('#demo-description').textContent = '';
  }
}
export async function loadIdentity() {
  state.ready = false;
  state.identity = await api('/auth/me');
  let department = null;
  if (state.identity.user.login_type === 'LDAP') {
    department = await api('/auth/department');
    const initialProfile = department.status === 'UNVERIFIED' && !department.approved.code &&
      (state.identity.user.needs_email_confirmation_flag || state.identity.user.needs_department_selection_flag);
    if (department.blocked && !initialProfile) {
      state.masters = null; state.record = null; state.batch = null;
      state.work = []; state.notifications = [];
      const title = department.status === 'MISMATCH' ? 'Your LDAP department details have changed'
        : department.status === 'UNAVAILABLE' ? 'Your LDAP department details could not be verified'
        : department.status === 'RECHECK_REQUIRED' ? 'Sign in again to verify your department'
        : 'Verify your LDAP department';
      shell(heading(title, 'Review your directory department details before opening the workspace.') + departmentGate(department), '');
      return false;
    }
  }
  if (state.identity.user.must_change_password_flag) {
    shell(
      heading(
        'Set your own password',
        'Change the temporary Standard account password before opening your workspace.',
      ) +
        /* HTML */ `<section class="card">
          <form id="password">
            <div class="grid">
              ${field(
                'Current password',
                input(
                  'current_password',
                  '',
                  'password',
                  'required autocomplete="current-password"',
                ),
              )}${field(
                'New password',
                input('new_password', '', 'password', 'required autocomplete="new-password"'),
                'Use 12–72 UTF-8 bytes, upper/lowercase letters, a number and a symbol.',
              )}
            </div>
            <p class="inline-error" id="form-error" role="alert"></p>
            <button class="btn primary" type="submit">Change password</button>
          </form>
        </section>`,
      '',
    );
    return false;
  }
  if (
    state.identity.user.needs_email_confirmation_flag ||
    state.identity.user.needs_department_selection_flag
  ) {
    const units = await api('/auth/departments');
    document.title = 'Confirm your work profile · Compliance by Design';
    shell(workProfilePage(state.identity.user, department, units, state.identity.roles), '');
    return false;
  }
  if (!state.identity.roles.length) {
    shell(
      heading(
        'Your access request is pending',
        'An administrator must assign your roles and department scope before you can open regulatory records.',
      ) +
        /* HTML */ `<section class="card">
          <p>Profile: ${esc(state.identity.user.full_name)} · ${esc(state.identity.user.email)}</p>
          <p>
            Contact the portal administrator. Signing in again will use the latest approved access.
          </p>
          ${button('reload', 'Check access again')}
        </section>`,
      '',
    );
    return false;
  }
  state.masters = await api('/masters');
  state.ready = true;
  return true;
}
export function authHandlers({ render, loadIdentity, loginView }) {
  return {
    actions: {
      'retry-demo-users': async () => {
        const container = document.querySelector<HTMLDivElement>('#demo-sign-in');
        if (!container || container.getAttribute('aria-busy') === 'true') return;
        container.setAttribute('aria-busy', 'true'); container.innerHTML = demoLoading();
        await loadDemoOptions(loginRevision);
      },
      'toggle-login-password': (_data, trigger) => {
        const password = document.querySelector<HTMLInputElement>('#login-password');
        if (!password) return;
        const reveal = password.type === 'password';
        password.type = reveal ? 'text' : 'password';
        trigger.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        trigger.setAttribute('aria-pressed', String(reveal));
        trigger.innerHTML = icon(reveal ? 'eyeOff' : 'eye');
      },
      logout: async () => {
        await api('/auth/logout', 'POST', {});
        state.identity = null;
        state.masters = null;
        state.ready = false;
        state.view = {};
        state.work = [];
        state.notifications = [];
        close();
        loginView();
      },
      reload: async () => {
        if (await loadIdentity()) await render();
      },
    },
    forms: {
      'ldap-department-request': async (form) => {
        const result = await api('/auth/department/request', 'POST', Object.fromEntries(new FormData(form)));
        message(result.message);
        if (await loadIdentity()) await render();
      },
      login: async (form) => {
        const values = new FormData(form);
        await signIn(String(values.get('username') || ''), String(values.get('password') || ''));
        demoUsers = [];
        loginRevision++;
        if (await loadIdentity()) {
          await render();
          window.scrollTo(0, 0);
        }
      },
      password: async (form) => {
        await api('/auth/password', 'POST', Object.fromEntries(new FormData(form)));
        message('Password changed. Other sessions have ended.');
        if (await loadIdentity()) await render();
      },
      onboard: async (form) => {
        await api('/auth/onboarding', 'POST', Object.fromEntries(new FormData(form)));
        if (await loadIdentity()) await render();
      },
    },
  };
}
