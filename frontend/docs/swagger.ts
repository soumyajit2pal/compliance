import { encryptedSignIn } from '../core/login-encryption.ts';
import { ldapDepartmentState } from '../core/ldap-readiness.ts';
import { createSwaggerRequestGuard, swaggerOptions } from '../core/swagger-request.ts';

const section = document.getElementById('docs-session')!;
const form = document.getElementById('docs-login') as HTMLFormElement;
const fields = document.getElementById('docs-login-fields') as HTMLFieldSetElement;
const username = document.getElementById('docs-username') as HTMLInputElement;
const password = document.getElementById('docs-password') as HTMLInputElement;
const submit = document.getElementById('docs-sign-in') as HTMLButtonElement;
const account = document.getElementById('docs-account')!;
const accountName = document.getElementById('docs-account-name')!;
const accountRoles = document.getElementById('docs-account-roles')!;
const signOut = document.getElementById('docs-sign-out') as HTMLButtonElement;
const refresh = document.getElementById('docs-session-refresh') as HTMLButtonElement;
const status = document.getElementById('docs-auth-status')!;
const error = document.getElementById('docs-auth-error')!;
const action = document.getElementById('docs-setup-link')!;
let identity: any = null;
let busy = false;

function signedOut(message = 'Sign in to test protected APIs.') {
  identity = null;
  form.hidden = false; account.hidden = true; action.hidden = true;
  accountName.textContent = ''; accountRoles.textContent = ''; password.value = '';
  status.textContent = message; section.dataset.access = 'signed-out';
}
const prepare = createSwaggerRequestGuard(location.origin, fetch.bind(window), () => signedOut('Your session has ended. Sign in again.'));

async function request(path: string, method = 'GET', body?: unknown) {
  const prepared = await prepare({ url: '/api' + path, method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await fetch(prepared.url, { method, headers: prepared.headers, body: prepared.body, credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') signedOut();
    throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail : 'The request could not be completed.'), { status: response.status });
  }
  return data;
}

function showIdentity(data: any) {
  // Keep display fields only; CSRF values are fetched afresh per write, never persisted.
  identity = { user: data.user, roles: data.roles || [] };
  const user = identity.user, requirements: string[] = [];
  if (user.must_change_password_flag) requirements.push('Change your temporary password.');
  if (user.needs_email_confirmation_flag || user.needs_department_selection_flag) requirements.push('Confirm your work email and Home organisation.');
  if (user.login_type === 'LDAP') {
    const department = ldapDepartmentState(user);
    if (department.blocked) {
      requirements.push(department.label + '.');
      if (user.department_code || user.ldap_last_seen_department_code) requirements.push('Approved LDAP code: ' + (user.department_code || 'Not approved') + '; current LDAP code: ' + (user.ldap_last_seen_department_code || 'Unavailable') + '.');
    }
  }
  if (!identity.roles.length) requirements.push('Administrator-approved roles and scope are required.');
  form.hidden = true; account.hidden = false; password.value = '';
  accountName.textContent = (user.full_name || user.username) + ' · ' + user.username;
  accountRoles.textContent = 'Roles: ' + (identity.roles.join(', ') || 'None assigned');
  action.hidden = !requirements.length;
  status.textContent = requirements.length ? 'Signed in — access restricted. ' + requirements.join(' ') : 'Signed in. Try it out uses your current roles and scope.';
  section.dataset.access = requirements.length ? 'restricted' : 'ready';
}

async function session() {
  status.textContent = 'Checking session…';
  try { showIdentity(await request('/auth/me')); }
  catch (caught: any) {
    if (caught.status === 401) signedOut();
    else { status.textContent = 'Session details could not be checked. Refresh session to try again.'; throw caught; }
  }
}
function setBusy(value: boolean) {
  busy = value; section.setAttribute('aria-busy', String(value));
  fields.disabled = value; signOut.disabled = value; refresh.disabled = value;
  submit.textContent = value ? 'Signing in…' : 'Sign in';
}
function showError(caught: any) {
  error.textContent = caught.message || 'Sign-in could not be completed.'; error.hidden = false;
}
async function run(task: () => Promise<void>) {
  if (busy) return;
  setBusy(true); error.hidden = true; error.textContent = '';
  try { await task(); } catch (caught) { showError(caught); } finally { setBusy(false); }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  const loginName = username.value.trim(), secret = password.value;
  password.value = '';
  void run(async () => {
    status.textContent = 'Signing in…';
    try { await encryptedSignIn(request, loginName, secret); }
    catch (caught) { signedOut('Sign-in was not completed. Try again.'); throw caught; }
    await session();
  });
});
signOut.addEventListener('click', () => void run(async () => {
  status.textContent = 'Signing out…';
  await request('/auth/logout', 'POST', {}); signedOut('Signed out.'); username.focus();
}));
refresh.addEventListener('click', () => void run(session));
window.addEventListener('focus', () => { if (!busy) void run(session); });

const swagger = (window as any).SwaggerUIBundle;
(window as any).ui = swagger({
  ...swaggerOptions(prepare, (response: any) => {
    if (response.status === 401) signedOut('Your session has ended. Sign in again.');
    return response;
  }),
  presets: [swagger.presets.apis], layout: 'BaseLayout',
});
void run(session);
