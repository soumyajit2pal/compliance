import {workflowButton, workflowSubmit} from '../ui/workflow-actions.ts';
import { state } from '../core/state.ts';
import { dialog } from '../core/dom.ts';
import { api } from '../core/api.ts';

import {
  esc,
  title,
  ref,
  badge,
  button,
  field,
  input,
  select,
  fixedSelect,
  localDate,
  message,
} from '../ui/components.ts';
import { modal, close } from '../ui/dialog.ts';
import { heading } from '../ui/layout.ts';
import { table, tablePanel, person, searchForm, note, tabs } from '../ui/widgets.ts';
import { reviewSummary, reviewTime, reviewValues, userDepartmentDetails, departmentStatusNotice } from './ldap-department.ts';
import { ldapDepartmentState, matchesDepartmentFilter } from '../core/ldap-readiness.ts';
import { ldapAccounts, showLdapAccount } from './ldap-accounts.ts';

function accessBadge(user) {
  const color = user.admin_action_required || ['PROFILE_PENDING', 'PASSWORD_CHANGE_REQUIRED'].includes(user.access_status)
    ? 'amber' : user.access_status === 'ACCESS_READY' ? 'green' : 'neutral';
  const label = user.access_status?.startsWith('DEPARTMENT_') ? ({
    REJECTED:'Profile review rejected', UNVERIFIED:'Waiting for employee details', PENDING:'Profile review pending',
  }[user.employee_profile_status] || user.access_status_label) : user.access_status_label;
  return `<span class="tag ${color}">${esc(label)}</span>`;
}

function reviewWait(user) {
  if (!user || !user.active_flag) return 'The account must be active before review.';
  if (user.id === state.identity.user.id) return 'Another administrator must review your profile.';
  if (user.needs_email_confirmation_flag || user.needs_department_selection_flag) return 'Waiting for the employee to confirm work email and Home organisation.';
  if (user.employee_profile_status && user.employee_profile_status !== 'PENDING') return 'Waiting for a current employee profile that can be reviewed.';
  return '';
}

function reviewButton(request, user, label) {
  const wait = reviewWait(user);
  return wait ? `<span class="small muted">${esc(wait)}</span>` :
    workflowButton('department-review', label, 'OPEN', `data-id="${esc(request.id)}"`);
}

export async function usersPage(_id, query = new URLSearchParams()) {
  const tab = ['STANDARD', 'LDAP', 'ACTION_REQUIRED', 'LDAP_DEPARTMENTS'].includes(query.get('tab')) ? query.get('tab') : 'STANDARD';
  const request = state.routeNumber;
  const [data, departmentRequests] = await Promise.all([api('/admin/users'),
    api('/admin/employee-profile-reviews')]);
  if (request !== state.routeNumber || !state.identity) return '';
  state.view.users = data;
  state.adminAccess = data.summary;
  state.view.departmentRequests = departmentRequests;
  const userTabs = [['STANDARD', 'Standard users', data.summary.standard], ['LDAP', 'LDAP users', data.summary.ldap],
    ['ACTION_REQUIRED', 'Action required', data.summary.action_required], ['LDAP_DEPARTMENTS', 'Employee profile changes', data.summary.department_pending]];
  if (tab === 'LDAP_DEPARTMENTS') {
    const requests = departmentRequests;
    if (request !== state.routeNumber || !state.identity) return '';
    return heading('Employee profile changes', 'Review the employee details submitted for independent approval.',
      button('refresh-users', 'Refresh requests')) + tabs(userTabs, tab, 'users', new URLSearchParams()) +
      tablePanel(table(['Employee', 'Review needed', 'Home organisation', 'Next action'], requests.map(r => [
        person(r.current?.employee_name || r.full_name, r.username), esc(reviewSummary(r)), esc(r.home_organisation || 'Not selected'),
        reviewButton(r, data.users.find(u => u.id === r.user_id), 'Review request')]),
        { empty: 'No employee profile reviews are pending.' }), 'Pending employee profile reviews');
  }
  const status = query.get('status') || '';
  const departmentFilter = tab === 'LDAP' ? query.get('department') || '' : '';
  const q = (query.get('q') || '').trim().toLowerCase();
  const focusedUser = query.get('user');
  const byType = data.users.filter((u) => tab === 'ACTION_REQUIRED' ? u.admin_action_required : u.login_type === tab);
  const assignmentsByUser = new Map<string, typeof data.assignments>();
  for (const assignment of data.assignments) {
    if (!assignmentsByUser.has(assignment.user_id)) assignmentsByUser.set(assignment.user_id, []);
    assignmentsByUser.get(assignment.user_id).push(assignment);
  }
  const pending = departmentRequests.filter(r => r.status === 'PENDING');
  const pendingByUser = new Map(pending.map(r => [r.user_id, r] as const));
  const rows = byType.filter((u) => {
    if (focusedUser && u.id !== focusedUser) return false;
    if (status === 'ACTION_REQUIRED' && !u.admin_action_required) return false;
    if (status === 'ROLES_REQUIRED' && !['ROLE_ASSIGNMENT_REQUIRED', 'ROLE_REVIEW_REQUIRED'].includes(u.access_status)) return false;
    const departmentStatus = {LDAP_DEPARTMENT_REQUIRED:'not-approved',LDAP_DEPARTMENT_CHANGED:'changed',
      LDAP_DEPARTMENT_UNAVAILABLE:'unavailable',LDAP_DEPARTMENT_RECHECK:'recheck'}[status];
    if (departmentStatus ? u.login_type !== 'LDAP' || ldapDepartmentState(u).key !== departmentStatus
      : status && !['ACTION_REQUIRED', 'ROLES_REQUIRED'].includes(status) && u.access_status !== status) return false;
    if (departmentFilter === 'pending' ? !pendingByUser.has(u.id)
      : !matchesDepartmentFilter(u, departmentFilter)) return false;
    if (!q) return true;
    const roleNames = (assignmentsByUser.get(u.id) || []).map((a) => ref('role', a.role_id));
    return [u.full_name,u.username,u.email,...Object.values(u.employee_approved||{}),...Object.values(u.employee_observed||{}),u.access_status_label,ref('organisational_unit',u.org_unit_id),...roleNames]
      .join(' ').toLowerCase().includes(q);
  });
  const filterOptions = [
    ['', 'All access statuses'], ['ACTION_REQUIRED', 'Administrator action required'],
    ['PENDING_APPROVAL', 'Pending access approval'], ['ROLES_REQUIRED', 'Roles need attention'],
    ['ROLE_ASSIGNMENT_REQUIRED', 'Role assignment required'], ['ROLE_REVIEW_REQUIRED', 'Role review required'],
    ['DEPARTMENT_REQUIRED','Employee department verification required'],['DEPARTMENT_CHANGED','Employee department changed'],['DEPARTMENT_UNAVAILABLE','Employee department unavailable'],['DEPARTMENT_RECHECK','Fresh employee sign-in required'],
    ['LDAP_DEPARTMENT_REQUIRED', 'LDAP department verification required'], ['LDAP_DEPARTMENT_CHANGED', 'LDAP department changed'],
    ['LDAP_DEPARTMENT_UNAVAILABLE', 'LDAP department unavailable'], ['LDAP_DEPARTMENT_RECHECK', 'Fresh LDAP sign-in required'],
    ...(tab === 'ACTION_REQUIRED' ? [] : [['PROFILE_PENDING', 'Profile confirmation pending'],
      ['PASSWORD_CHANGE_REQUIRED', 'Password change required'], ['ACCESS_READY', 'Access assigned'], ['INACTIVE', 'Inactive account']]),
  ];
  const resetQuery = new URLSearchParams(query);resetQuery.delete('user');
  return '<section class="user-access-page">' + heading('Users & access', 'Manage Standard and LDAP accounts, access requests and scoped role assignments.',
      button('refresh-users', 'Refresh access status') + button('user', 'Add user', '', 'primary')) +
    `<div class="row gap8 mb16 access-catalogue-summary"><span class="tag green">${data.summary.active_accounts} enabled accounts</span><span class="tag neutral">${state.masters.role.filter((r) => r.active_flag).length} application roles</span><span class="grow"></span><a class="text-link" href="#help?tab=roles">Role-access guide</a></div>` +
    (tab === 'LDAP' ? '' : `<div class="access-overview" aria-label="Access request overview">
      <a href="#users?tab=LDAP&status=PENDING_APPROVAL"><strong>${data.summary.pending_approval}</strong><span>Pending access approval</span><small>Review the confirmed LDAP profile and assign roles</small></a>
      <a href="#users?tab=ACTION_REQUIRED&status=ROLES_REQUIRED"><strong>${data.summary.role_assignment_required + data.summary.role_review_required}</strong><span>Roles need attention</span><small>Assign or review effective roles and scope</small></a>
      <a href="#users?tab=LDAP&status=PROFILE_PENDING"><strong>${data.summary.profile_pending}</strong><span>Awaiting LDAP profile</span><small>User must confirm email and Home organisation</small></a>
    </div>`) +
    tabs(userTabs, tab, 'users', new URLSearchParams()) +
    (focusedUser ? `<div class="mb16">${note('Showing the account linked from the access notification. <a class="text-link" href="#users?' + esc(resetQuery.toString()) + '">Show all users in this view</a>')}</div>` : '') +
    searchForm('view-filter', 'Search name, username, department or role…', query.get('q') || '',
      `<input type="hidden" name="tab" value="${esc(tab)}"><div class="field access-status-filter"><label for="access-status">Access status</label><select id="access-status" data-choice-key="user_access_status" name="status">${filterOptions.map(([key, label]) => `<option value="${key}" ${status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>` +
      (tab === 'LDAP' ? `<div class="field ldap-approval-filter"><label for="ldap-approval">Employee profile</label><select id="ldap-approval" data-choice-key="employee_profile_filter" name="department">${[['','All profile statuses'],['not-approved','Approval required'],['pending','Review pending'],['changed','Profile changed'],['approved','Approved and verified'],['recheck','Approved — sign-in required'],['unavailable','LDAP details unavailable']].map(([value,label]) => `<option value="${value}" ${departmentFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>` : '')) +
    (tab === 'LDAP' ? ldapAccounts(rows, byType, assignmentsByUser, pending.length) :
    '<p class="small muted users-table-hint">Review account status, assigned roles and the next step for each person.</p>' +
    tablePanel(table(['User', 'Status and next step', 'Home organisation', 'Roles & scope', 'Actions'],
      rows.map((u) => {
        const assignments = assignmentsByUser.get(u.id) || [];
        const effective = assignments.filter((a) => a.effective_flag);
        const actionLabel = u.access_status === 'PENDING_APPROVAL' ? 'Review request'
          : u.access_status === 'ROLE_ASSIGNMENT_REQUIRED' ? 'Assign roles'
          : u.access_status === 'ROLE_REVIEW_REQUIRED' ? 'Review roles' : 'Edit access';
        const request = pendingByUser.get(u.id);
        const next = request ? reviewWait(u) || 'Review the submitted employee details.' :
          u.employee_profile_status === 'REJECTED' ? 'The employee can request reconsideration with a new explanation.' :
          u.employee_profile_status === 'UNVERIFIED' ? u.employee_warning || 'Employee details are incomplete. Review can begin once the missing details arrive.' : u.access_message;
        const history = u.employee_profile_required ? button('department-history', 'Employee profile history', `data-id="${esc(u.id)}"`, 'small') : '';
        return [person(u.full_name, u.username + ' · ' + (u.login_type === 'LDAP' ? 'LDAP' : 'Standard')),
          accessBadge(u) + `<small class="access-account-state">${esc(next)}</small>`,
          u.org_unit_id ? esc(ref('organisational_unit', u.org_unit_id)) : '<span class="small muted">Not selected</span>',
          (effective.map((a) => `<span class="scope-line">${esc(ref('role', a.role_id))} · ${a.global_scope_flag ? 'Global' : esc(ref('organisational_unit', a.scope_org_unit_id))}</span>`).join('') || '<span class="small muted">No effective roles assigned</span>') +
            (assignments.length > effective.length ? `<small class="access-account-state">${assignments.length - effective.length} assignment(s) not currently effective</small>` : ''),
          `<div class="review-row-actions">${request && !reviewWait(u) ? reviewButton(request,u,'Review profile') : ''}${history}${
            u.id === state.identity.user.id ? '' : button('user',actionLabel,`data-id="${esc(u.id)}"`,'small')
          }</div>`];
      }), { empty: 'No users match this account type and access status.' }),
      tab === 'ACTION_REQUIRED' ? 'Accounts requiring administrator action' : 'Standard portal accounts', '', 'access-account-table')) +
    `<div class="mt16">${note('An enabled account still needs effective roles and any first-sign-in steps. Profile confirmation belongs to the LDAP user. Access changes revoke sessions; Standard password resets are available in Edit access.')}</div></section>`;
}
async function openUser(id) {
  const user: Record<string, any> = state.view.users.users.find((u) => u.id === id) || {};
  const assignments = state.view.users.assignments.filter((a) => a.user_id === id);
  const today = localDate();
  const homeDepartments = state.masters.organisational_unit.filter((unit) => unit.unit_type !== 'SUB_DEPARTMENT' && (unit.id === user.org_unit_id || (
    unit.unit_type === 'DEPARTMENT' && unit.active_flag && (!unit.effective_from || unit.effective_from <= today) &&
    (!unit.effective_to || unit.effective_to > today)
  )));
  state.view.editUser = id;
  modal(
    id ? user.login_type === 'LDAP' ? 'Manage LDAP profile & roles' : 'Edit user access' : 'Create user account',
    /* HTML */ `${id ? `<div class="mb16">${note('<strong>' + esc(user.access_status_label) + '</strong><br>' + esc(user.access_message), user.admin_action_required ? 'warn' : 'info')}</div>` : ''}
      ${id && (user.login_type === 'LDAP'||user.employee_profile_required) ? departmentStatusNotice(user) + userDepartmentDetails(user) +
        '<p>Department verification is separate from the Home organisation and role assignments below.</p>' : ''}<div class="grid">
        ${field(
          'Username',
          input('username', user.username || '', 'text', `required ${id ? 'readonly' : ''}`),
        )}${field(
          'Display name',
          input('full_name', user.full_name || '', 'text', 'required'),
        )}${field('Email', input('email', user.email || '', 'email'))}${field(
          'Home department',
          select('org_unit_id', homeDepartments, user.org_unit_id),
        )}${field(
          'Login type',
          fixedSelect(
            'login_type',
            ['STANDARD', 'LDAP'],
            user.login_type || (new URLSearchParams(location.hash.split('?')[1]).get('tab') === 'LDAP' ? 'LDAP' : 'STANDARD'),
            id ? 'disabled' : '',
          ),
        )}${field(
          id ? 'Reset temporary password (optional)' : 'Temporary password for Standard account',
          input(
            'password',
            '',
            'password',
            'autocomplete="new-password" minlength="12" maxlength="72"' +
              ((user.login_type === 'LDAP' || (!id && new URLSearchParams(location.hash.split('?')[1]).get('tab') === 'LDAP')) ? ' disabled' : !id ? ' required' : ''),
          ),
          'Standard accounts must change it on first sign-in. LDAP has no local password.',
        )}
        <div class="full">
          <label class="check-label"
            ><input type="checkbox" name="active_flag" ${user.active_flag !== 0 ? 'checked' : ''} />
            Active account</label
          >
        </div>
      </div>
      <h3>Role assignments</h3>
      <p class="muted">
        Each role has its own scope. Global Admin scope does not grant global business authority.
      </p>
      <div id="role-rows">${assignments.map(roleLine).join('')}</div>
      ${button('add-role', '+ Add role')}
      <div class="notice">
        Access changes revoke the user’s current sessions. Admin alone cannot review or approve
        regulatory content.
      </div>`,
    'user',
    id && user.login_type === 'LDAP' ? 'Save profile & roles' : id && user.admin_action_required ? 'Save approved access' : id ? 'Save user' : 'Create user',
    'Home organisation and role scope are separate assignments.',
  );
  dialog.querySelector<HTMLFormElement>('#user')!.dataset.existing = id || '';
}
function roleLine(r: Record<string, any> = {}) {
  const roleUnits = state.masters.organisational_unit.filter(unit => unit.unit_type !== 'SUB_DEPARTMENT');
  return `<div class="role-line role-assignment"><div class="role-field">${field('Role', select('role_id', state.masters.role, r.role_id, 'name', 'required'))}</div><label class="check-label"><input type="checkbox" name="global_scope_flag" ${r.global_scope_flag ? 'checked' : ''}> Global scope</label>${button('remove-role', 'Remove', '', 'small')}<div class="scope-field" ${r.global_scope_flag ? 'hidden' : ''}>${field('Organisation scope', select('scope_org_unit_id', roleUnits, r.scope_org_unit_id, 'name', r.global_scope_flag ? 'disabled' : 'required'), 'This unit and its authorised descendants, including its Sub-departments.')}</div></div>`;
}
async function departmentHistory(id, trigger: HTMLElement) {
  const route = state.routeNumber;
  const fromDialog = dialog.contains(trigger);
  const [requests, archived] = await Promise.all([
    api('/admin/employee-profile-reviews?user_id=' + encodeURIComponent(id)),
    api('/admin/employee-profile-archive/' + encodeURIComponent(id)),
  ]);
  if (route !== state.routeNumber || !trigger.isConnected || dialog.open !== fromDialog) return;
  state.view.departmentRequests = state.view.departmentRequests.filter(r => r.user_id !== id)
    .concat(requests.filter(r => r.status === 'PENDING'));
  const user = state.view.users.users.find((u) => u.id === id);
  const pending = requests.find(r => r.status === 'PENDING');
  const history = requests.map(r => [
    reviewTime(r.requested_at), `<details class="review-disclosure"><summary>${esc(reviewSummary(r))}</summary>${reviewValues(r)}</details>`,
    badge(r.status), r.status === 'PENDING' ? 'Awaiting review' :
      [r.decision_reason && esc(r.decision_reason), r.decided_at && reviewTime(r.decided_at)].filter(Boolean).join('<br>') || '—',
  ]);
  modal('Employee profile history', `<div class="review-history">
    ${pending ? `<section class="review-callout"><div><h3>Pending profile review</h3><p>${esc(reviewSummary(pending))} · Submitted ${reviewTime(pending.requested_at)}</p></div>${reviewButton(pending,user,'Review request')}</section>` : '<p class="review-callout">No profile decision is pending.</p>'}
    <h3>Review history</h3>${history.length ? table(['Submitted','Profile details','Status','Decision'],history,{summary:false}) : '<p>No requests have been submitted.</p>'}
    <details class="review-disclosure"><summary>Current profile and Home organisation</summary><p>${esc(ref('organisational_unit',user.org_unit_id) || 'Not selected')}</p>${userDepartmentDetails(user)}</details>
    ${archived.length ? `<details class="review-disclosure"><summary>Archived pre-migration evidence (${archived.length})</summary>${archived.map(r=>`<h4>${esc(title(r.record_type))}</h4>${table(['Archived field','Retained value'],Object.entries(JSON.parse(r.payload)).filter(([,v])=>v!=null).map(([k,v])=>[esc(title(k)),esc(typeof v==='object'?JSON.stringify(v):String(v))]),{summary:false,pageKey:'archived-profile-'+r.id})}`).join('')}</details>` : ''}
  </div>`, '', '', user.full_name + ' · ' + user.username, trigger);
}
function reviewDepartment(id, trigger) {
  const request = state.view.departmentRequests.find((r) => r.id === id);
  if (!request || request.status !== 'PENDING') {
    message('This employee profile request is no longer pending. Refresh the account list before reviewing.', true);
    return;
  }
  state.view.departmentRequest = id;
  const user = state.view.users.users.find((u) => u.id === request.user_id);
  const wait = reviewWait(user);
  if (wait) { message(wait, true); return; }
  const home = request.home_organisation || ref('organisational_unit',user.org_unit_id) || 'Not selected';
  modal('Review employee profile', `<div class="review-dialog">
    <header class="review-callout"><div><h3>${esc(reviewSummary(request))}</h3><p>${esc(request.current?.employee_name || user.full_name)} · ${esc(user.username)}</p></div>${badge('PENDING')}</header>
    ${request.warning ? note(esc(request.warning),'warn') : ''}
    <div class="review-columns"><section><h3>Submitted details</h3>
      <p class="small muted">Home organisation · ${esc(home)}</p>${reviewValues(request)}
    </section><section class="review-decision"><h3>Your decision</h3>
      <p>Review the employee details and record your reason. Approval requires the employee to sign in again.</p>
      ${request.request_reason && request.request_reason !== 'Automatically submitted after an employee profile observation.' ? `<p class="review-reason"><strong>Employee explanation</strong>${esc(request.request_reason)}</p>` : ''}
      ${field('Decision', fixedSelect('decision', ['APPROVE','REJECT'], '', 'required'))}
      ${field('Decision reason', '<textarea name="reason" rows="3" minlength="3" maxlength="1000" required></textarea>')}
      <p class="small muted">Manage roles and scope separately in Edit access.</p></section></div>
    <details class="review-disclosure"><summary>Source and refresh details</summary><p>Profile observed · ${reviewTime(request.observed_at)}</p><p>Last complete employee API result · ${reviewTime(request.api_observed_at)}</p>
      ${request.using_cached_api ? '<p>The current lookup is incomplete. This review includes retained employee details.</p>' : ''}</details></div>`,
    'employee-profile-decision', workflowSubmit('Record decision', 'REVIEW'), 'Independent administrator review', trigger);
}
export function userHandlers({ render, loadIdentity, loginView }) {
  return {
    actions: {
      'ldap-account-details': ({ id }, trigger) => {
        const data = state.view.users;
        const user = data.users.find(u => u.id === id && u.login_type === 'LDAP');
        if (user) showLdapAccount(user, data.assignments.filter(a => a.user_id === id),
          state.view.departmentRequests.find(r => r.user_id === id && r.status === 'PENDING'), state.identity.user.id, trigger);
      },
      user: ({ id }) => openUser(id),
      'department-history': ({ id }, trigger) => departmentHistory(id, trigger),
      'department-review': ({ id }, trigger) => reviewDepartment(id, trigger),
      'refresh-users': async () => { await render(); message('Access statuses refreshed.'); },
      'add-role': () =>
        dialog.querySelector('#role-rows').insertAdjacentHTML('beforeend', roleLine()),
      'remove-role': (_, target) => target.closest('.role-line').remove(),
    },
    forms: {
      'employee-profile-decision': async (form) => {
        const result = await api('/admin/employee-profile-reviews/' + state.view.departmentRequest + '/decision',
          'POST', Object.fromEntries(new FormData(form)));
        close(); await render(); message(result.message);
      },
      user: async (form) => {
        const values: Record<string, any> = Object.fromEntries(new FormData(form));
        for (const k of ['role_id', 'scope_org_unit_id', 'global_scope_flag']) delete values[k];
        if (state.view.editUser)
          values.login_type = state.view.users.users.find(
            (u) => u.id === state.view.editUser,
          ).login_type;
        values.active_flag = form.elements.active_flag.checked;
        values.email = values.email || null;
        values.org_unit_id = values.org_unit_id || null;
        values.password = values.password || null;
        values.roles = (Array.from(form.querySelectorAll('.role-line')) as HTMLElement[]).map((row) => {
          const role = row.querySelector<HTMLSelectElement>('[name=role_id]');
          const globalScope = row.querySelector<HTMLInputElement>('[name=global_scope_flag]');
          const scopeUnit = row.querySelector<HTMLSelectElement>('[name=scope_org_unit_id]');
          return {
            role_id: role?.value || '',
            global_scope_flag: globalScope?.checked || false,
            scope_org_unit_id: globalScope?.checked ? null : scopeUnit?.value || null,
          };
        });
        const result = await api(
          '/admin/users' + (state.view.editUser ? '/' + state.view.editUser : ''),
          state.view.editUser ? 'PUT' : 'POST',
          values,
        );
        close();
        message(result.message + (state.view.editUser ? ' Existing sessions were revoked; the user must sign in again.' : ''));
        state.masters = await api('/masters');
        await render();
      },
    },
  };
}
