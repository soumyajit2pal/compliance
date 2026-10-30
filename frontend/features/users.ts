import { state } from '../core/state.ts';
import { dialog } from '../core/dom.ts';
import { api } from '../core/api.ts';

import {
  esc,
  ref,
  badge,
  button,
  field,
  input,
  select,
  fixedSelect,
  message,
} from '../ui/components.ts';
import { modal, close } from '../ui/dialog.ts';
import { heading } from '../ui/layout.ts';
import { table, tablePanel, person, searchForm, note, tabs } from '../ui/widgets.ts';
import { departmentDetails } from './ldap-department.ts';

function accessBadge(user) {
  const color = user.admin_action_required || ['PROFILE_PENDING', 'PASSWORD_CHANGE_REQUIRED'].includes(user.access_status)
    ? 'amber' : user.access_status === 'ACCESS_READY' ? 'green' : 'neutral';
  return `<span class="tag ${color}">${esc(user.access_status_label)}</span>`;
}

export async function usersPage(_id, query = new URLSearchParams()) {
  const request = state.routeNumber, data = await api('/admin/users');
  if (request !== state.routeNumber || !state.identity) return '';
  state.view.users = data;
  state.adminAccess = data.summary;
  const tab = ['STANDARD', 'LDAP', 'ACTION_REQUIRED', 'LDAP_DEPARTMENTS'].includes(query.get('tab')) ? query.get('tab') : 'STANDARD';
  const userTabs = [['STANDARD', 'Standard users', data.summary.standard], ['LDAP', 'LDAP users', data.summary.ldap],
    ['ACTION_REQUIRED', 'Action required', data.summary.action_required], ['LDAP_DEPARTMENTS', 'LDAP department changes', data.summary.department_pending]];
  if (tab === 'LDAP_DEPARTMENTS') {
    const requests = await api('/admin/ldap-department-requests');
    if (request !== state.routeNumber || !state.identity) return '';
    state.view.departmentRequests = requests;
    return heading('LDAP department changes', 'Verify directory department changes separately from Home organisation and role access.',
      button('refresh-users', 'Refresh requests')) + tabs(userTabs, tab, 'users', new URLSearchParams()) +
      `<div class="mb16">${note('Approval records the observed LDAP code and name. Home organisation and roles remain unchanged. The user must sign in again after approval.')}</div>` +
      tablePanel(table(['User', 'Previously approved', 'Returned by LDAP', 'Home organisation', 'Status', 'Review'],
        requests.map((r) => [person(r.full_name, r.username), departmentText(r.previous_code, r.previous_name),
          departmentText(r.proposed_code, r.proposed_name), esc(r.home_organisation || 'Not selected'), badge(r.status),
          r.user_id === state.identity.user.id ? 'Another administrator must review' : button('department-review', 'Review request', `data-id="${r.id}"`, 'small')]),
        { empty: 'No LDAP department requests are pending.' }), 'Pending LDAP department requests');
  }
  const status = query.get('status') || '';
  const q = (query.get('q') || '').trim().toLowerCase();
  const focusedUser = query.get('user');
  const byType = data.users.filter((u) => tab === 'ACTION_REQUIRED' ? u.admin_action_required : u.login_type === tab);
  const rows = byType.filter((u) => {
    if (focusedUser && u.id !== focusedUser) return false;
    if (status === 'ACTION_REQUIRED' && !u.admin_action_required) return false;
    if (status === 'ROLES_REQUIRED' && !['ROLE_ASSIGNMENT_REQUIRED', 'ROLE_REVIEW_REQUIRED'].includes(u.access_status)) return false;
    if (status && !['ACTION_REQUIRED', 'ROLES_REQUIRED'].includes(status) && u.access_status !== status) return false;
    const roleNames = data.assignments.filter((a) => a.user_id === u.id).map((a) => ref('role', a.role_id));
    return [u.full_name, u.username, u.email, u.department_code, u.ldap_department_name,
      u.ldap_last_seen_department_code, u.ldap_last_seen_department_name, ref('organisational_unit', u.org_unit_id), ...roleNames]
      .join(' ').toLowerCase().includes(q);
  });
  const filterOptions = [
    ['', 'All access statuses'], ['ACTION_REQUIRED', 'Administrator action required'],
    ['PENDING_APPROVAL', 'Pending access approval'], ['ROLES_REQUIRED', 'Roles need attention'],
    ['ROLE_ASSIGNMENT_REQUIRED', 'Role assignment required'], ['ROLE_REVIEW_REQUIRED', 'Role review required'],
    ['LDAP_DEPARTMENT_REQUIRED', 'LDAP department verification required'], ['LDAP_DEPARTMENT_CHANGED', 'LDAP department changed'],
    ['LDAP_DEPARTMENT_UNAVAILABLE', 'LDAP department unavailable'], ['LDAP_DEPARTMENT_RECHECK', 'Fresh LDAP sign-in required'],
    ...(tab === 'ACTION_REQUIRED' ? [] : [['PROFILE_PENDING', 'Profile confirmation pending'],
      ['PASSWORD_CHANGE_REQUIRED', 'Password change required'], ['ACCESS_READY', 'Access assigned'], ['INACTIVE', 'Inactive account']]),
  ];
  const resetQuery = new URLSearchParams(query);resetQuery.delete('user');
  return '<section class="user-access-page">' + heading('Users & access', 'Manage Standard and LDAP accounts, access requests and scoped role assignments.',
      button('refresh-users', 'Refresh access status') + button('user', 'Add user', '', 'primary')) +
    `<div class="row gap8 mb16 access-catalogue-summary"><span class="tag green">${data.summary.active_accounts} enabled accounts</span><span class="tag neutral">${state.masters.role.filter((r) => r.active_flag).length} application roles</span><span class="grow"></span><a class="text-link" href="#help?tab=roles">Role-access guide</a></div>` +
    `<div class="access-overview" aria-label="Access request overview">
      <a href="#users?tab=LDAP&status=PENDING_APPROVAL"><strong>${data.summary.pending_approval}</strong><span>Pending access approval</span><small>Review the confirmed LDAP profile and assign roles</small></a>
      <a href="#users?tab=ACTION_REQUIRED&status=ROLES_REQUIRED"><strong>${data.summary.role_assignment_required + data.summary.role_review_required}</strong><span>Roles need attention</span><small>Assign or review effective roles and scope</small></a>
      <a href="#users?tab=LDAP&status=PROFILE_PENDING"><strong>${data.summary.profile_pending}</strong><span>Awaiting LDAP profile</span><small>User must confirm email and department</small></a>
    </div>` +
    tabs(userTabs, tab, 'users', new URLSearchParams()) +
    (focusedUser ? `<div class="mb16">${note('Showing the account linked from the access notification. <a class="text-link" href="#users?' + esc(resetQuery.toString()) + '">Show all users in this view</a>')}</div>` : '') +
    searchForm('view-filter', 'Search name, username, department or role…', query.get('q') || '',
      `<input type="hidden" name="tab" value="${esc(tab)}"><div class="field access-status-filter"><label for="access-status">Access status</label><select id="access-status" name="status">${filterOptions.map(([key, label]) => `<option value="${key}" ${status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`) +
    '<p class="small muted users-table-hint">Scroll the table to see roles, next steps and account actions.</p>' +
    tablePanel(table(['User', 'Access status', 'LDAP department', 'Home organisation', 'Effective roles & scope', 'Next step', 'Manage'],
      rows.map((u) => {
        const assignments = data.assignments.filter((a) => a.user_id === u.id);
        const effective = assignments.filter((a) => a.effective_flag);
        const actionLabel = u.access_status === 'PENDING_APPROVAL' ? 'Review request'
          : u.access_status === 'ROLE_ASSIGNMENT_REQUIRED' ? 'Assign roles'
          : u.access_status === 'ROLE_REVIEW_REQUIRED' ? 'Review roles' : 'Edit access';
        return [person(u.full_name, u.username + ' · ' + (u.login_type === 'LDAP' ? 'LDAP' : 'Standard')),
          accessBadge(u) + `<small class="access-account-state">${u.active_flag ? 'Account enabled' : 'Account disabled'}</small>`,
          u.login_type === 'LDAP' ? departmentText(u.department_code, u.ldap_department_name) +
            `<small class="access-account-state">Current LDAP: ${esc(u.ldap_last_seen_department_code || 'Not returned')} · ${esc(u.ldap_last_seen_department_name || 'Not returned')}</small>` +
            button('department-history', 'Department history', `data-id="${u.id}"`, 'small') : '—',
          u.org_unit_id ? esc(ref('organisational_unit', u.org_unit_id)) : '<span class="small muted">Not selected</span>',
          (effective.map((a) => `<span class="scope-line">${esc(ref('role', a.role_id))} · ${a.global_scope_flag ? 'Global' : esc(ref('organisational_unit', a.scope_org_unit_id))}</span>`).join('') || '<span class="small muted">No effective roles assigned</span>') +
            (assignments.length > effective.length ? `<small class="access-account-state">${assignments.length - effective.length} assignment(s) not currently effective</small>` : ''),
          `<span class="access-next-step">${esc(u.access_message)}</span>`,
          u.id !== state.identity.user.id ? button('user', actionLabel, `data-id="${u.id}"`, 'small')
            : '<span class="small muted">Use another administrator</span>'];
      }), { empty: 'No users match this account type and access status.' }),
      tab === 'ACTION_REQUIRED' ? 'Accounts requiring administrator action' : tab === 'LDAP' ? 'LDAP directory accounts' : 'Standard portal accounts') +
    `<div class="mt16">${note('An enabled account still needs effective roles and any first-sign-in steps. Profile confirmation belongs to the LDAP user. Access changes revoke sessions; Standard password resets are available in Edit access.')}</div></section>`;
}
async function openUser(id) {
  const user: Record<string, any> = state.view.users.users.find((u) => u.id === id) || {};
  const assignments = state.view.users.assignments.filter((a) => a.user_id === id);
  state.view.editUser = id;
  modal(
    id ? 'Edit user access' : 'Create user account',
    /* HTML */ `${id ? `<div class="mb16">${note('<strong>' + esc(user.access_status_label) + '</strong><br>' + esc(user.access_message), user.admin_action_required ? 'warn' : 'info')}</div>` : ''}
      ${id && user.login_type === 'LDAP' ? departmentDetails({approved:{code:user.department_code,name:user.ldap_department_name},
        current:{code:user.ldap_last_seen_department_code,name:user.ldap_last_seen_department_name}}) +
        '<p>LDAP department approval is separate from the Home organisation and role assignments below.</p>' : ''}<div class="grid">
        ${field(
          'Username',
          input('username', user.username || '', 'text', `required ${id ? 'readonly' : ''}`),
        )}${field(
          'Display name',
          input('full_name', user.full_name || '', 'text', 'required'),
        )}${field('Email', input('email', user.email || '', 'email'))}${field(
          'Home organisation',
          select('org_unit_id', state.masters.organisational_unit, user.org_unit_id),
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
    id && user.admin_action_required ? 'Save approved access' : id ? 'Save user' : 'Create user',
    'Home organisation and role scope are separate assignments.',
  );
  dialog.querySelector<HTMLFormElement>('#user')!.dataset.existing = id || '';
}
function roleLine(r: Record<string, any> = {}) {
  return `<div class="role-line role-assignment"><div class="role-field">${field('Role', select('role_id', state.masters.role, r.role_id, 'name', 'required'))}</div><label class="check-label"><input type="checkbox" name="global_scope_flag" ${r.global_scope_flag ? 'checked' : ''}> Global scope</label>${button('remove-role', 'Remove', '', 'small')}<div class="scope-field" ${r.global_scope_flag ? 'hidden' : ''}>${field('Organisation scope', select('scope_org_unit_id', state.masters.organisational_unit, r.scope_org_unit_id, 'name', r.global_scope_flag ? 'disabled' : 'required'), 'This unit and its authorised descendants.')}</div></div>`;
}
function departmentText(code, name) {
  return `<strong>${esc(code || 'Not approved')}</strong><small class="access-account-state">${esc(name || 'Not approved')}</small>`;
}
async function departmentHistory(id) {
  const requests = await api('/admin/ldap-department-requests?user_id=' + encodeURIComponent(id));
  state.view.departmentRequests = requests;
  const user = state.view.users.users.find((u) => u.id === id);
  modal('LDAP department history', departmentDetails({approved:{code:user.department_code,name:user.ldap_department_name},
    current:{code:user.ldap_last_seen_department_code,name:user.ldap_last_seen_department_name}}) +
    `<p><strong>Home organisation:</strong> ${esc(ref('organisational_unit', user.org_unit_id) || 'Not selected')}</p>` +
    table(['Previously approved', 'Requested department', 'Status', 'Decision / action'], requests.map((r) => [
      departmentText(r.previous_code, r.previous_name), departmentText(r.proposed_code, r.proposed_name), badge(r.status),
      r.status === 'PENDING' && r.user_id !== state.identity.user.id ? button('department-review', 'Review request', `data-id="${r.id}"`, 'small')
        : esc(r.decision_reason || 'Awaiting directory refresh or administrator review')]),{empty:'No department requests have been submitted.'}));
}
function reviewDepartment(id) {
  const request = state.view.departmentRequests.find((r) => r.id === id);
  state.view.departmentRequest = id;
  const user = state.view.users.users.find((u) => u.id === request.user_id);
  modal('Review LDAP department request',
    `<p><strong>${esc(user.full_name)}</strong> · ${esc(user.username)}</p>` +
    departmentDetails({approved:{code:request.previous_code,name:request.previous_name},current:{code:request.proposed_code,name:request.proposed_name}}) +
    `<p><strong>Home organisation:</strong> ${esc(ref('organisational_unit', user.org_unit_id) || 'Not selected')}</p>
    <p><strong>Observed at:</strong> ${esc(request.observed_at)} UTC</p>
    <p><strong>User explanation:</strong> ${esc(request.request_reason || 'No explanation supplied')}</p>
    <p>Review the Home organisation and existing roles in Edit access separately. This decision changes only the approved LDAP department.</p>` +
    field('Decision', fixedSelect('decision', ['APPROVE','REJECT'], 'APPROVE', 'required')) +
    field('Decision reason', '<textarea name="reason" rows="3" minlength="3" maxlength="1000" required></textarea>'),
    'ldap-department-decision', 'Record decision', 'A different administrator must decide. Approval requires fresh LDAP sign-in.');
}
export function userHandlers({ render, loadIdentity, loginView }) {
  return {
    actions: {
      user: ({ id }) => openUser(id),
      'department-history': ({ id }) => departmentHistory(id),
      'department-review': ({ id }) => reviewDepartment(id),
      'refresh-users': async () => { await render(); message('Access statuses refreshed.'); },
      'add-role': () =>
        dialog.querySelector('#role-rows').insertAdjacentHTML('beforeend', roleLine()),
      'remove-role': (_, target) => target.closest('.role-line').remove(),
    },
    forms: {
      'ldap-department-decision': async (form) => {
        const result = await api('/admin/ldap-department-requests/' + state.view.departmentRequest + '/decision',
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
