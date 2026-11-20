import {esc,field,button} from '../ui/components.ts';
import {note,table} from '../ui/widgets.ts';
import {ldapDepartmentState} from '../core/ldap-readiness.ts';
export const employeeFieldLabels={ldap_department_code:'LDAP department code',employee_name:'Employee name',designation:'Designation',department_code:'API department code',department_name:'API department name',branch_code:'Registered branch code',branch_name:'Registered branch name',current_branch_code:'Current branch code',zone_code:'Zone code',zone_name:'Zone name',employee_status:'Employee status'};
export function departmentStatusBadge(user){const state=ldapDepartmentState(user);return `<span class="tag ${state.tone}" data-department-status="${state.key}">${esc(state.label)}</span>`;}
export function departmentStatusNotice(user){const state=ldapDepartmentState(user);return note(esc(state.detail),state.blocked?'warn':'info');}
export function userDepartmentDetails(user){return departmentDetails({approved:user.employee_approved||{},current:user.employee_observed||{}});}
export function departmentDetails(data){
 return table(['Employee field','Approved value','Latest observed value'],Object.entries(employeeFieldLabels).map(([key,label])=>[esc(label),esc(data.approved?.[key]||'Not approved'),esc(data.current?.[key]||'NA')]),{summary:false})+`<p class="small muted">LDAP and API department codes are separate baselines. Registered branch name describes registered branch code; current branch code remains separate.</p>`;
}
export function departmentGate(data){
 const pending=data.requests?.find(r=>r.status==='PENDING');
 return `<section class="card ldap-department-gate">${note(esc(data.message),'warn')}${data.warning?note(esc(data.warning),'warn'):''}${departmentDetails(data)}
 <p><strong>Home organisation:</strong> ${esc(data.home_organisation||'Not selected')}</p><p>Changes are submitted automatically for independent administrator review. Approval does not change Home organisation, roles or scope. Sign in again after approval.</p>
 ${pending?note('Your employee profile is pending administrator approval. Reference: '+esc(pending.id)):''}
 ${data.can_request&&!pending?`<form id="employee-profile-request">${field('New explanation','<textarea name="reason" required minlength="3" maxlength="1000"></textarea>')}<p class="inline-error" id="form-error" role="alert"></p><button class="btn primary" type="submit">Request reconsideration</button></form>`:''}
 <div class="actions">${button('reload','Check review status')}${button('logout','Sign out')}</div></section>`;
}
