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
  if(user.emp_dept_managed_flag)return departmentDetails({managed:true,source:user.emp_dept_source,
    approved:{code:user.emp_dept_approved_code,name:user.emp_dept_approved_name,namespace:user.emp_dept_approved_namespace},
    current:{code:user.emp_dept_observed_code,name:user.emp_dept_observed_name,namespace:user.emp_dept_namespace}})+
    (user.emp_dept_warning?note(esc(user.emp_dept_warning),'warn'):'')+
    `<details><summary>Retained LDAP observations</summary><p class="small muted">These observations are retained separately. The effective department check uses the primary employee API or a valid mapped LDAP fallback.</p>${departmentDetails({approved:{code:user.department_code,division:user.ldap_division,info:user.ldap_info},current:{code:user.ldap_last_seen_department_code,division:user.ldap_last_seen_division,info:user.ldap_last_seen_info}})}</details>`;
  return departmentDetails({
    approved:{code:user.department_code,division:user.ldap_division,info:user.ldap_info},
    current:{code:user.ldap_last_seen_department_code,division:user.ldap_last_seen_division,info:user.ldap_last_seen_info},
  });
}

export function departmentDetails(data) {
  if(data.managed)return `<div class="form-grid ldap-department-comparison"><section class="card"><h3>Approved employee department</h3>${detailFields([
    ['Department code',esc(data.approved.code||'Not yet approved')],['Department name',esc(data.approved.name||'NA')],['Code source',esc(data.approved.namespace||'Not yet approved')]])}</section>
    <section class="card"><h3>Observed employee department</h3>${detailFields([['Department code',esc(data.current.code||'Not available')],['Department name',esc(data.current.name||'NA')],['Code source',esc(data.current.namespace||'Not available')],['Verified using',esc(data.source==='EMPLOYEE_API'?'Employee API':data.source==='LDAP_FALLBACK'?'Authenticated LDAP fallback':data.source||'Not available')]])}</section></div>`;
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
    ${data.managed?'':departmentStatusBadge({ldap_department_status:data.status,department_code:data.approved.code,ldap_last_seen_department_code:data.current.code,
      ldap_division:data.approved.division,ldap_last_seen_division:data.current.division,
      ldap_info:data.approved.info,ldap_last_seen_info:data.current.info})}
    ${note(esc(data.message), 'warn')}
    ${departmentDetails(data)}
    <p><strong>Home organisation:</strong> ${esc(data.home_organisation || 'Not selected')}</p>
    <p>Department approval does not change your Home organisation, roles or organisation scope.</p>
    <p class="small muted">${data.managed?'The employee API is checked first; authenticated LDAP is the fallback. Changes are submitted automatically. Sign in again after approval.':'LDAP is checked when you sign in. Sign out and sign in again to refresh directory details.'}</p>
    ${data.warning?note(esc(data.warning),'warn'):''}
    ${pending ? note('Your request is pending administrator approval. Reference: ' + esc(pending.id)) : ''}
    ${latest && !pending ? `<div class="mb16">${note('Latest request: <strong>' + esc(latest.status) + '</strong>' +
      (latest.decision_reason ? '<br>Administrator decision: ' + esc(latest.decision_reason) : ''))}</div>` : ''}
    ${data.can_request && !pending ? `<form id="ldap-department-request">
      ${field(data.resubmission_explanation_required ? 'New explanation for reconsideration' : 'Explanation (optional)',
        '<textarea name="reason" maxlength="1000" rows="3"' + (data.resubmission_explanation_required ? ' required minlength="3"' : '') + '></textarea>',
        data.managed?'Verified department details cannot be edited here.':'Department code, division and info come from LDAP and cannot be edited here.')}
      <p class="inline-error" id="form-error" role="alert"></p>
      <button class="btn primary" type="submit">${data.resubmission_explanation_required ? 'Request reconsideration' : data.approved.code ? 'Request department update' : 'Request department verification'}</button>
    </form>` : ''}
    <div class="row gap8 mt24">${button('reload', 'Check request status')}${button('logout', 'Sign out')}</div>
  </section>`;
}
