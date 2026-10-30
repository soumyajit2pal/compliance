import { esc, button, field } from '../ui/components.ts';
import { note, detailFields } from '../ui/widgets.ts';

export function departmentDetails(data) {
  return `<div class="form-grid ldap-department-comparison">
    <section class="card"><h3>Previously approved LDAP department code</h3>${detailFields([
      ['Department code', esc(data.approved.code || 'Not yet approved')],
    ])}</section>
    <section class="card"><h3>Current department code returned by LDAP</h3>${detailFields([
      ['Department code', esc(data.current.code || 'Not returned')],
    ])}</section>
  </div>`;
}

export function departmentGate(data) {
  const pending = data.requests.find((r) => r.status === 'PENDING');
  const latest = data.requests[0];
  return `<section class="card ldap-department-gate">
    ${note(esc(data.message), 'warn')}
    ${departmentDetails(data)}
    <p><strong>Home organisation:</strong> ${esc(data.home_organisation || 'Not selected')}</p>
    <p>LDAP department approval does not change your Home organisation, roles or organisation scope.</p>
    <p class="small muted">LDAP is checked when you sign in. Sign out and sign in again to refresh directory details.</p>
    ${pending ? note('Your request is pending administrator approval. Reference: ' + esc(pending.id)) : ''}
    ${latest && !pending ? `<div class="mb16">${note('Latest request: <strong>' + esc(latest.status) + '</strong>' +
      (latest.decision_reason ? '<br>Administrator decision: ' + esc(latest.decision_reason) : ''))}</div>` : ''}
    ${data.can_request && !pending ? `<form id="ldap-department-request">
      ${field(data.resubmission_explanation_required ? 'New explanation for reconsideration' : 'Explanation (optional)',
        '<textarea name="reason" maxlength="1000" rows="3"' + (data.resubmission_explanation_required ? ' required minlength="3"' : '') + '></textarea>',
        'The code comes from LDAP and cannot be edited here.')}
      <p class="inline-error" id="form-error" role="alert"></p>
      <button class="btn primary" type="submit">${data.resubmission_explanation_required ? 'Request reconsideration' : data.approved.code ? 'Request department update' : 'Request department verification'}</button>
    </form>` : ''}
    <div class="row gap8 mt24">${button('reload', 'Check request status')}${button('logout', 'Sign out')}</div>
  </section>`;
}
