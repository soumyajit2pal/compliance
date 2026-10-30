import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { has } from '../core/access.ts';
import { esc, badge, button, field, input, message } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { modal, close } from '../ui/dialog.ts';
import { heading } from '../ui/layout.ts';
import { panel, note } from '../ui/widgets.ts';
/** LDAP settings follow QA Portal's connection, trust, profile and test sections. */
export async function ldapPage() {
  const request = state.routeNumber, data = await api('/admin/ldap');
  if (request !== state.routeNumber || !state.identity) return '';
  state.view.ldap = data;
  const certificateDetails = (data.ca_certificates || []).map((c) =>
    `<p><strong>${esc(c.subject)}</strong><br>Issuer: ${esc(c.issuer)}<br>Valid: ${esc(c.not_valid_before)} – ${esc(c.not_valid_after)}<br><span class="small ldap-cert-fingerprint">SHA-256: ${esc(c.fingerprint_sha256)}</span></p>`).join('');
  const demo = data.demo?.enabled
    ? note(`UAT demo LDAP is enabled for usernames beginning with ${esc(data.demo.prefix)}, for example ${esc(data.demo.prefix)}01. Use the configured demo LDAP password. Each new username confirms email and department, then waits for administrator-approved roles. Demo authentication is separate from the real directory connection test.`)
    : '';
  return heading('LDAP / Active Directory settings', 'Manage the directory connection, certificate trust and account lookup.') +
    `<div class="mb24">${note(data.source === 'database' ? 'Saved database configuration is active and applies immediately.' : 'Environment bootstrap configuration is active. Save this form to make database settings authoritative.')}</div>` +
    (data.bind_password_unavailable ? `<div class="mb24">${note('The deployment secret changed. Enter the bind password again and save before directory sign-ins can succeed.')}</div>` : '') +
    `<form id="ldap">${panel('Directory connection', `
      <label class="check-label"><input type="checkbox" name="enabled" ${data.enabled ? 'checked' : ''}> Enable LDAP authentication</label>
      <p class="small muted">Standard accounts continue to use their portal passwords.</p>
      <div class="form-grid">
        ${field('Directory server', input('server_uri', data.server_uri, 'text', 'placeholder="ldaps://directory.bank:636"'), 'An explicit ldap:// or ldaps:// scheme takes priority over TLS / SSL.')}
        ${field('TLS / SSL for a hostname', `<select name="use_ssl"><option value="true" ${data.use_ssl ? 'selected' : ''}>True</option><option value="false" ${!data.use_ssl ? 'selected' : ''}>False</option></select>`)}
        ${field('Base DN', input('base_dn', data.base_dn))}
        ${field('Read-only bind DN', input('bind_dn', data.bind_dn, 'text', 'autocomplete="off"'))}
        ${field('Bind password', input('bind_password', '', 'password', 'autocomplete="new-password"'), data.has_bind_password ? 'A password is saved. Leave blank to retain it.' : 'Required for service-account search.')}
        ${field('User search filter', input('user_search_filter', data.user_search_filter))}
        ${field('Or: direct user DN template', input('user_dn_template', data.user_dn_template), 'Use {username} exactly once. Service-account search takes priority when both Base DN and Bind DN are set.', 'full')}
      </div>
      <label class="check-label"><input type="checkbox" name="start_tls" ${data.start_tls ? 'checked' : ''}> Upgrade ldap:// connections with StartTLS</label>
      <p class="small muted">LDAPS and StartTLS verify the certificate chain and directory hostname.</p>
      <p id="ldap-transport-warning" class="inline-error" role="alert" ${directoryUsesTls(data) || !data.enabled ? 'hidden' : ''}>This LDAP connection is not encrypted. Directory credentials may travel without transport encryption. Use LDAPS or StartTLS where supported.</p>
    `)}
    <div class="mt24">${panel('LDAP TLS CA certificate', `
      <p>${esc(data.ca_certificate_source === 'uploaded' ? 'Uploaded CA certificate active: ' + data.ca_certificate_name : data.ca_certificate_source === 'server_file' ? 'Server-managed CA certificate active: ' + data.ca_certificate_name : 'System trust store active')}</p>
      <p class="small muted">Upload the issuing CA from this device. The certificate contents are saved; your local file path is never used. A CA upload does not correct a directory hostname mismatch.</p>
      <div class="form-grid">
        ${field('CA certificate action', `<select name="ca_certificate_action"><option value="keep">Keep current trust source</option><option value="replace">Replace with selected certificate</option><option value="remove">Remove custom CA and use system trust</option></select>`)}
        ${field('Choose CA certificate', '<input type="file" name="ca_upload" accept=".cer,.crt,.pem" aria-label="Choose LDAP CA certificate">', 'PEM bundle or DER certificate; up to 1 MiB. Private keys are rejected.')}
      </div>
      ${certificateDetails ? `<details><summary>View certificate details (${data.ca_certificate_count})</summary>${certificateDetails}</details>` : ''}
    `)}</div>
    <div class="mt24">${panel('Directory profile attributes', `<div class="form-grid">
      ${field('Full name attribute', input('attr_full_name', data.attr_full_name))}
      ${field('Email attribute', input('attr_email', data.attr_email))}
      <input type="hidden" name="attr_department" value="${esc(data.attr_department)}">
      ${field('Department code attribute', input('attr_department_code', data.attr_department_code || ''), 'Use the bank-confirmed code attribute. Blank or missing values restrict LDAP workspace access.')}
      ${field('Department name attribute', input('attr_department_name', data.attr_department_name || data.attr_department), 'Directory name only. Home organisation remains a separate portal assignment.')}
    </div>`)}</div>
    <div class="mt24">${panel('Test before saving', `
      <p class="small muted">Test the values currently shown, including unsaved certificate changes. Test credentials are used once. Testing does not create an account or save the configuration.</p>
      <div class="form-grid">
        ${field('Test username', input('test_username', '', 'text', 'autocomplete="off"'))}
        ${field('Test user password', input('test_password', '', 'password', 'autocomplete="new-password"'))}
      </div>
      <button class="btn" type="button" data-action="ldap-test">Test connection</button>
      <p id="ldap-test-result" role="status"></p>
    `)}</div>
    ${demo ? `<div class="mt24">${demo}</div>` : ''}
    <div class="mt24">${note('New LDAP users confirm their work profile and wait for administrator-approved roles and scope. Directory passwords are never stored locally. Keep a Standard administrator account available for recovery.')}</div>
    <p class="inline-error" id="form-error" role="alert"></p>
    <div class="wizard-footer"><span class="small muted">Bind secrets remain encrypted.</span><button class="btn primary" type="submit">Save LDAP configuration</button></div></form>`;
}

function directoryUsesTls(values) {
  const uri = values.server_uri.trim().toLowerCase();
  return uri.startsWith('ldaps://') || (uri.startsWith('ldap://') ? values.start_tls : values.use_ssl || values.start_tls);
}

export function syncLdapForm(event) {
  const form = event.target.closest?.('#ldap') as HTMLFormElement | null;
  if (!form) return;
  const fields = form.elements as any;
  if (event.target.name === 'ca_upload' && fields.ca_upload.files.length)
    fields.ca_certificate_action.value = 'replace';
  const warning = form.querySelector<HTMLElement>('#ldap-transport-warning');
  if (warning) warning.hidden = !fields.enabled.checked || directoryUsesTls({
    server_uri: fields.server_uri.value, use_ssl: fields.use_ssl.value === 'true', start_tls: fields.start_tls.checked,
  });
}

async function ldapPayload(form: HTMLFormElement) {
  const fields = form.elements as any;
  const values = Object.fromEntries(new FormData(form)) as any;
  delete values.ca_upload;
  delete values.test_username;
  delete values.test_password;
  values.enabled = fields.enabled.checked;
  values.use_ssl = fields.use_ssl.value === 'true';
  values.start_tls = fields.start_tls.checked;
  if (values.ca_certificate_action === 'replace') {
    const file = fields.ca_upload.files[0];
    if (!file || !file.size || file.size > 1024 * 1024)
      throw new Error('Choose a non-empty CA certificate file up to 1 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    values.ca_certificate_data = btoa(binary);
    values.ca_certificate_name = file.name;
  }
  return values;
}
export async function applicationsPage() {
  const request = state.routeNumber,
    rows = await api('/applications');
  if (request !== state.routeNumber || !state.identity) return '';
  state.view.links = rows;
  return (
    heading(
      'Connected applications',
      'Retain existing compliance capabilities, with a clear path from this portal.',
    ) +
    `<div class="grid-3">${rows.map((r, i) => `<section class="connection-card"><div class="row between"><span class="connection-icon">${icon(['shield', 'checkSquare', 'layers'][i] || 'external')}</span>${badge(r.active_flag && r.url ? 'AVAILABLE' : 'CONFIGURATION_PENDING')}</div><h3>${esc(r.name)}</h3><p>${esc(r.description)}</p><div class="small muted">${r.active_flag && r.url ? 'Bank-approved link available.' : 'Approved bank URL has not been configured.'}</div><div class="actions">${r.active_flag && r.url ? `<a class="btn primary" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}Open application</a>` : ''}${has('ADMIN') ? button('application', 'Configure link', `data-id="${r.id}"`) : ''}</div></section>`).join('')}</div><div class="mt24">${note('Retained applications remain separate. This portal provides governed links; it does not recreate their workflows.')}</div>`
  );
}
export function settingsHandlers({ render }) {
  return {
    actions: {
      'ldap-test': async (_data, target) => {
        const form = target.closest('form') as HTMLFormElement;
        const fields = form.elements as any;
        const result = form.querySelector<HTMLElement>('#ldap-test-result');
        target.disabled = true;
        try {
          result.textContent = 'Testing directory connection…';
          const values = await ldapPayload(form);
          if (!fields.test_username.value.trim() || !fields.test_password.value)
            throw new Error('Enter a test username and test user password.');
          const response = await api('/admin/ldap/test', 'POST', { ...values,
            test_username: fields.test_username.value, test_password: fields.test_password.value });
          result.textContent = response.message;
        } catch (error) {
          result.textContent = error.message;
        } finally {
          fields.test_password.value = '';
          target.disabled = false;
        }
      },
      application: ({ id }) => {
        state.view.link = id;
        const row = state.view.links.find((r) => r.id === id);
        modal(
          'Configure ' + row.name,
          `<div class="form-grid">${field('Bank-approved HTTPS address', input('url', row.url || '', 'url', 'required'), 'Use the approved address for this retained application.', 'full')}<label class="check-label full"><input type="checkbox" name="active_flag" ${row.active_flag ? 'checked' : ''}> Make link available</label></div>`,
          'application',
          'Save link',
          'The external application keeps its own access controls.',
        );
      },
    },
    forms: {
      ldap: async (form) => {
        await api('/admin/ldap', 'PUT', await ldapPayload(form));
        message('LDAP configuration saved. Directory credentials remain encrypted.');
        await render();
      },
      application: async (form) => {
        await api('/applications/' + state.view.link, 'PATCH', {
          url: form.elements.url.value,
          active_flag: form.elements.active_flag.checked,
        });
        close();
        message('Approved application link saved.');
        await render();
      },
    },
  };
}
