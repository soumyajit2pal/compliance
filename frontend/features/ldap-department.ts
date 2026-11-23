import {esc,field,button} from '../ui/components.ts';
import {icon} from '../ui/icons.ts';
import {note,table} from '../ui/widgets.ts';
import {ldapDepartmentState} from '../core/ldap-readiness.ts';
export const employeeFieldLabels={ldap_department_code:'LDAP department code',employee_name:'Employee name',designation:'Designation',department_code:'API department code',department_name:'API department name',branch_code:'Registered branch code',branch_name:'Registered branch name',current_branch_code:'Current branch code',zone_code:'Zone code',zone_name:'Zone name',employee_status:'Employee status'};
export function departmentStatusBadge(user){const state=ldapDepartmentState(user);return `<span class="tag ${state.tone}" data-department-status="${state.key}">${esc(state.label)}</span>`;}
export function departmentStatusNotice(user){const state=ldapDepartmentState(user);return note(esc(state.detail),state.blocked?'warn':'info');}
export function userDepartmentDetails(user){return departmentDetails({approved:user.employee_approved||{},current:user.employee_observed||{}});}
export function departmentDetails(data){
 return table(['Employee field','Approved value','Latest observed value'],Object.entries(employeeFieldLabels).map(([key,label])=>[esc(label),esc(data.approved?.[key]||'Not approved'),esc(data.current?.[key]||'NA')]),{summary:false})+`<p class="small muted">LDAP and API department codes are separate baselines. Registered branch name describes registered branch code; current branch code remains separate.</p>`;
}
function hasApprovedProfile(data) {
  return Boolean(data.previous_version_id || data.approved_version_id || Object.values(data.approved || {}).some(Boolean));
}

export function reviewSummary(data) {
  if (!hasApprovedProfile(data)) return 'First profile approval';
  const count = (data.changes || []).length;
  return count === 1 ? '1 field changed' : count + ' fields changed';
}

export function reviewValues(data) {
  const fields = Object.entries(employeeFieldLabels);
  const currentValues = '<dl class="review-values">' + fields.map(([key, label]) =>
    `<div><dt>${esc(label)}</dt><dd>${esc(data.current?.[key] || 'Unavailable')}</dd></div>`).join('') + '</dl>';
  if (!hasApprovedProfile(data)) return currentValues;
  const changed = fields.filter(([key]) => data.approved?.[key] !== data.current?.[key]);
  return (changed.length ? table(['Field', 'Approved', 'Submitted for review'], changed.map(([key,label]) =>
    [esc(label), esc(data.approved?.[key] || 'Unavailable'), esc(data.current?.[key] || 'Unavailable')]),
    {summary:false}) : '<p>The submitted fields match the approved profile.</p>') +
    `<details class="review-disclosure"><summary>All submitted fields</summary>${currentValues}</details>`;
}

export function reviewTime(value) {
  if (!value) return 'Unavailable';
  const utc = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value + 'Z';
  const instant = new Date(utc);
  if (Number.isNaN(instant.getTime())) return esc(value);
  return esc(new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(instant)) + ' UTC';
}

export function departmentGate(data, refresh = null) {
  const rejected = data.status === 'REJECTED';
  const recheck = data.status === 'RECHECK_REQUIRED';
  const currentRequest = data.requests?.find(r => r.status === data.status);
  const contactAdmin = refresh && (!refresh.retry_enabled || !refresh.pf_no);
  const states = {
    PENDING: ['Waiting for administrator approval', 'Your profile was submitted automatically. An independent administrator will review it. You can sign out while you wait.', 'clock'],
    REJECTED: ['Your profile review was rejected', data.can_request ? 'Read the decision reason and explain what the administrator should reconsider.' : 'Contact your administrator about the rejected details.', 'message'],
    RECHECK_REQUIRED: ['Profile approved', 'Sign out and sign in again so the portal can check your approved details and open your assigned workspace.', 'checkSquare'],
    UNAVAILABLE: ['Your directory department is missing', 'Ask your administrator to check your LDAP department code, then sign in again.', 'org'],
    UNVERIFIED: ['Waiting for employee details', contactAdmin ? 'Contact your administrator to restore the employee lookup before your profile can be reviewed.' : 'Your profile can be sent for review once the employee service supplies the missing details. Check back for an update.', 'clock'],
  };
  const [headline, instruction, symbol] = states[data.status] || ['Employee profile review', data.message, 'file'];
  const explanation = rejected && currentRequest?.decision_reason
    ? `<p class="review-reason"><strong>Decision reason</strong>${esc(currentRequest.decision_reason)}</p>` : '';
  const reconsider = rejected && data.can_request ? `<form id="employee-profile-request">
    ${field('New explanation','<textarea name="reason" required minlength="3" maxlength="1000" rows="3"></textarea>')}
    <p class="inline-error" id="form-error" role="alert"></p><button class="btn primary" type="submit">Request reconsideration</button></form>` : '';
  return `<section class="ldap-department-gate review-page" aria-labelledby="employee-review-title">
    <header class="review-status"><span class="review-status-icon" aria-hidden="true">${icon(symbol)}</span><div>
      <p class="review-context">Employee profile</p><h1 id="employee-review-title">${esc(headline)}</h1><p>${esc(instruction)}</p>
      ${data.warning ? note(esc(data.warning),'warn') : ''}${explanation}${reconsider}<div class="actions">${recheck ? button('logout','Sign out to sign in again','','primary') :
        button('reload', 'Check review status','', rejected && data.can_request ? '' : 'primary') + button('logout', 'Sign out')}</div>
    </div></header>
    <details class="review-disclosure review-record"><summary>View employee details</summary>
      ${data.home_organisation ? `<p><strong>Home organisation</strong> · ${esc(data.home_organisation)}</p>` : ''}
      ${reviewValues(data)}
      ${currentRequest?.id ? `<p class="small muted">Review reference · ${esc(currentRequest.id)}</p>` : ''}
    </details>
    ${data.status === 'PENDING' ? '<p class="review-followup">After approval, sign in again. An administrator assigns workspace roles separately.</p>' : ''}
  </section>`;
}
