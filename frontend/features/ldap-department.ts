import { esc, button, field } from '../ui/components.ts';
import { note, detailFields } from '../ui/widgets.ts';
import { ldapDepartmentState } from '../core/ldap-readiness.ts';

export function departmentStatusBadge(user) {
  const status = ldapDepartmentState(user);
  return `<span class="tag ${status.tone} ldap-department-status" data-department-status="${status.key}">${esc(status.label)}</span>`;
}

export function departmentStatusNotice(user) {
  const status = ldapDepartmentState(user);
  return note('<strong>' + esc(status.label) + '</strong><br>' + esc(status.detail), status.blocked ? 'warn' : 'info');
}

export function userDepartmentDetails(user) {
  return departmentDetails({
    approved:{code:user.department_code,division:user.ldap_division,info:user.ldap_info},
    current:{code:user.ldap_last_seen_department_code,division:user.ldap_last_seen_division,info:user.ldap_last_seen_info},
  });
}

export function departmentDetails(data) {
  return `<div class="form-grid ldap-department-comparison">
    <section class="card"><h3>Previously approved LDAP department details</h3>${detailFields([
      ['Department code', esc(data.approved.code || 'Not yet approved')],
      ['Division', esc(data.approved.division || 'Not recorded')],
      ['Info', esc(data.approved.info || 'Not recorded'), true],
    ])}</section>
    <section class="card"><h3>Current department details returned by LDAP</h3>${detailFields([
      ['Department code', esc(data.current.code || 'Not returned')],
      ['Division', esc(data.current.division || 'Not returned')],
      ['Info', esc(data.current.info || 'Not returned'), true],
    ])}</section>
  </div>`;
}

export function departmentGate(data) {
  const pending = data.requests.find((r) => r.status === 'PENDING');
  const latest = data.requests[0];
  return `<section class="card ldap-department-gate">
    ${departmentStatusBadge({ldap_department_status:data.status,department_code:data.approved.code,ldap_last_seen_department_code:data.current.code,
      ldap_division:data.approved.division,ldap_last_seen_division:data.current.division,
      ldap_info:data.approved.info,ldap_last_seen_info:data.current.info})}
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
        'Department code, division and info come from LDAP and cannot be edited here.')}
      <p class="inline-error" id="form-error" role="alert"></p>
      <button class="btn primary" type="submit">${data.resubmission_explanation_required ? 'Request reconsideration' : data.approved.code ? 'Request department update' : 'Request department verification'}</button>
    </form>` : ''}
    <div class="row gap8 mt24">${button('reload', 'Check request status')}${button('logout', 'Sign out')}</div>
  </section>`;
}
