import { state } from '../core/state.ts';
import { root } from '../core/dom.ts';
import { api, signIn } from '../core/api.ts';
import { esc, button, field, input, select, message } from '../ui/components.ts';
import { close } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { shell, heading } from '../ui/layout.ts';
import { departmentDetails, departmentGate } from './ldap-department.ts';

let demoUsers = [];
let loginRevision = 0;

export function loginView() {
  const revision = ++loginRevision;
  demoUsers = [];
  document.title = 'Sign in · Compliance by Design';
  document.body.classList.add('portal-mode');
  root.innerHTML = /* HTML */ `
    <div class="auth-page">
      <main class="auth-shell" aria-label="Compliance by Design sign in">
        <aside class="auth-story" aria-label="About Compliance by Design">
          <header class="auth-story-header">
            <div class="auth-brand">
              <span class="auth-brand-icon">${icon('shield')}</span>
              <span class="auth-brand-name">Compliance <span>by Design</span></span>
            </div>
            <img
              class="auth-bank-logo"
              src="/assets/assets/bank-of-maharashtra-wordmark.png"
              alt="Bank of Maharashtra"
            />
          </header>
          <div class="auth-copy">
            <p class="auth-eyebrow">Embedded in every decision.</p>
            <h2>Clarity in every requirement. <span>Confidence in every action.</span></h2>
            <p class="auth-description">
              One connected view of regulatory sources, clear interpretations and independently approved decisions.
            </p>
          </div>
          <div class="auth-capabilities">
            <div class="auth-capability">${icon('book')}<div><strong>Clarity at the source</strong><p>Original wording, editions and clauses, together.</p></div></div>
            <div class="auth-capability">${icon('shield')}<div><strong>Independent decisions</strong><p>Clear responsibilities at every review and approval.</p></div></div>
            <div class="auth-capability">${icon('clock')}<div><strong>A history you can follow</strong><p>Source changes and recorded decisions stay traceable.</p></div></div>
          </div>
          <footer class="auth-story-footer"><span>${icon('shield')} Controlled access</span><span>Compliance by Design</span></footer>
          <div class="auth-emblem" aria-hidden="true">${icon('shield')}</div>
        </aside>
        <section class="auth-card" aria-labelledby="sign-in-title">
          <div class="auth-mobile-brand">
            <div class="auth-brand">
              <span class="auth-brand-icon">${icon('shield')}</span>
              <span class="auth-brand-name">Compliance <span>by Design</span></span>
            </div>
            <img
              class="auth-bank-logo"
              src="/assets/assets/bank-of-maharashtra-wordmark.png"
              alt="Bank of Maharashtra"
            />
          </div>
          <div class="auth-card-heading">
            <span class="auth-security-mark">${icon('lock')}</span>
            <div class="auth-kicker">Secure portal access</div>
            <h1 id="sign-in-title">Welcome back</h1>
          </div>
          <form id="login">
            <div id="demo-sign-in" hidden></div>
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
          </form>
          <div class="auth-footer">
            <a href="/assets/guides/week-1-3-navigation.html" target="_blank" rel="noopener">
              User guide ${icon('external')}
            </a>
          </div>
        </section>
      </main>
    </div>
  `;
  loadDemoOptions(revision);
}

async function loadDemoOptions(revision) {
  try {
    const data = await api('/auth/demo-users');
    const container = document.querySelector<HTMLDivElement>('#demo-sign-in');
    if (revision !== loginRevision || !container) return;
    demoUsers = data.users;
    container.hidden = false;
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
  } catch {
    // Prod and disabled UAT deployments return 404. Manual sign-in stays available.
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
      const title = department.status === 'MISMATCH' ? 'Your LDAP department code has changed'
        : department.status === 'UNAVAILABLE' ? 'Your LDAP department could not be verified'
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
    shell(
      heading(
        'Confirm your work profile',
        'Confirm your work email and Home organisation. LDAP department and portal access need administrator approval.',
      ) +
        /* HTML */ `<section class="card">
          <form id="onboard">
            ${department ? departmentDetails(department) : ''}
            ${field(
              'Work email',
              input('email', state.identity.user.email || '', 'email', 'required'),
            )}${field(
              'Home organisation',
              select('org_unit_id', units, state.identity.user.org_unit_id, 'name', 'required'),
            )}
            <p class="inline-error" id="form-error" role="alert"></p>
            <button class="primary">Confirm and request verification</button>
          </form>
        </section>`,
      '',
    );
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
