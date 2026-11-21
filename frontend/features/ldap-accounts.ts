import {workflowButton} from '../ui/workflow-actions.ts';
import { button, esc, ref, statusTag } from '../ui/components.ts';
import { modal } from '../ui/dialog.ts';
import { panel, person, table } from '../ui/widgets.ts';
import { ldapDepartmentState, ldapReadiness } from '../core/ldap-readiness.ts';
import { departmentStatusBadge, userDepartmentDetails } from './ldap-department.ts';

function accessTag(user, ready) {
  if (!user.active_flag) return statusTag('Account disabled', 'neutral');
  return ready ? statusTag('Access ready', 'green') : statusTag('Access blocked', 'amber');
}

function homeOrganisation(user) {
  return user.org_unit_id ? ref('organisational_unit', user.org_unit_id) : 'Not selected';
}

export function ldapAccounts(rows, ldapUsers, assignmentsByUser, pendingCount) {
  const awaiting = ldapUsers.filter(user => user.active_flag && !ldapDepartmentState(user).approved).length;
  const accounts = rows.map(user => {
    const effective = (assignmentsByUser.get(user.id) || []).filter(role => role.effective_flag);
    const { ready } = ldapReadiness(user, effective.length);
    return [
      person(user.full_name, user.username),
      esc(homeOrganisation(user)),
      accessTag(user, ready),
      departmentStatusBadge(user),
      button('ldap-account-details', 'Details',
        `data-id="${esc(user.id)}" aria-label="Details for ${esc(user.full_name)} (${esc(user.username)})" aria-haspopup="dialog"`, 'small'),
    ];
  });
  return panel('LDAP accounts', table(['Account', 'Home organisation', 'Application access', 'Employee profile', 'Actions'], accounts, {
    pageKey: 'ldap-accounts', label: 'LDAP accounts', caption: 'LDAP accounts',
    empty: 'No LDAP accounts match these filters.',
  }), {
    cls: 'table-panel ldap-directory',
    sub: awaiting ? `${awaiting} enabled ${awaiting === 1 ? 'account awaits' : 'accounts await'} employee profile verification` : '',
    action: `<a class="text-link" href="#users?tab=LDAP_DEPARTMENTS">${pendingCount} pending profile ${pendingCount === 1 ? 'review' : 'reviews'}</a>`,
  });
}

export function showLdapAccount(user, assignments, request, currentUserId, trigger: HTMLElement) {
  const effective = assignments.filter(role => role.effective_flag);
  const { department, profilePending, ready, next } = ldapReadiness(user, effective.length, Boolean(request));
  const roles = effective.map(role => `<li><strong>${esc(ref('role', role.role_id))}</strong> · ${role.global_scope_flag ? 'Global scope' : esc(ref('organisational_unit', role.scope_org_unit_id))}</li>`).join('');
  const inactive = assignments.length - effective.length;
  const ownAccount = user.id === currentUserId;
  const userId = `data-id="${esc(user.id)}"`;
  modal(user.full_name, `<div class="ldap-account-detail">
    <div class="ldap-detail-status">${accessTag(user, ready)}${departmentStatusBadge(user)}</div>
    <p><strong>Next step</strong><br>${esc(next)}</p>
    <div class="ldap-account-actions">
      ${request && !ownAccount && user.active_flag && !profilePending ? workflowButton('department-review', 'Review employee profile request', 'OPEN', `data-id="${esc(request.id)}"`) : ''}
      ${button('department-history', 'Employee profile history', userId, 'small')}
      ${ownAccount ? '<span class="small muted">Another administrator must review or edit your access.</span>' : button('user', 'Manage profile & roles', userId, 'small')}
    </div>
    <dl class="ldap-profile-facts">
      <div><dt>Account</dt><dd>${user.active_flag ? 'Enabled' : 'Disabled'}</dd></div>
      <div><dt>Work profile</dt><dd>${profilePending ? 'Confirmation pending' : 'Confirmed'}</dd></div>
      <div><dt>Home organisation</dt><dd>${esc(homeOrganisation(user))}</dd></div>
      <div><dt>Work email</dt><dd>${esc(user.email || 'Not provided')}</dd></div>
    </dl>
    <section><h3>Roles &amp; scope</h3>${roles ? `<ul class="ldap-effective-roles">${roles}</ul>` : '<p>No effective roles assigned.</p>'}
      ${inactive ? `<p class="small muted">${inactive} ${inactive === 1 ? 'assignment is' : 'assignments are'} currently ineffective.</p>` : ''}</section>
    <section class="ldap-profile-values"><h3>Separate LDAP and API baselines</h3><p>${esc(department.detail)}</p>${userDepartmentDetails(user)}</section>
  </div>`, '', '', user.username + ' · LDAP', trigger);
}
