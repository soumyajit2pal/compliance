import { esc, button } from '../ui/components.ts';
import { person, note } from '../ui/widgets.ts';
import { ldapReadiness } from '../core/ldap-readiness.ts';
import { departmentStatusBadge } from './ldap-department.ts';

export function ldapAccounts(rows, data, requests, currentUserId, ref) {
  const ldap = data.users.filter(user => user.login_type === 'LDAP');
  const unapproved = ldap.filter(user => user.active_flag && !ldapReadiness(user, 0).department.approved).length;
  const pending = requests.filter(request => request.status === 'PENDING');
  const overview = `<div class="ldap-directory-overview"><span><strong>${unapproved}</strong> enabled ${unapproved === 1 ? 'account awaiting department approval or verification' : 'accounts awaiting department approval or verification'}</span><a class="text-link" href="#users?tab=LDAP_DEPARTMENTS">${pending.length} pending department ${pending.length === 1 ? 'request' : 'requests'}</a></div>`;
  const cards = rows.map(user => {
    const assignments = data.assignments.filter(role => role.user_id === user.id);
    const effective = assignments.filter(role => role.effective_flag);
    const request = pending.find(item => item.user_id === user.id);
    const readiness = ldapReadiness(user, effective.length, Boolean(request));
    const { department, profilePending, ready } = readiness;
    const roles = effective.map(role => `<li>${esc(ref('role', role.role_id))}<small>${role.global_scope_flag ? 'Global scope' : esc(ref('organisational_unit', role.scope_org_unit_id))}</small></li>`).join('');
    return `<article class="ldap-account-card" data-user-id="${esc(user.id)}" aria-labelledby="ldap-account-${esc(user.id)}">
      <header class="ldap-account-header"><div id="ldap-account-${esc(user.id)}">${person(user.full_name, user.username + ' · LDAP')}</div>
        <div class="ldap-account-flags"><span class="tag ${user.active_flag ? 'neutral' : 'amber'}">${user.active_flag ? 'Account enabled' : 'Account disabled'}</span><span class="tag ${ready ? 'green' : 'amber'}">${ready ? 'Access ready' : 'Application access blocked'}</span></div></header>
      <div class="ldap-account-department ${department.tone}">${departmentStatusBadge(user)}<p>${esc(department.detail)}</p></div>
      <div class="ldap-account-checks">
        <section aria-label="LDAP department approval"><h3>LDAP department code</h3><dl class="ldap-account-codes"><div><dt>Approved code</dt><dd><code>${esc(user.department_code || 'Not approved')}</code></dd></div><div><dt>Current LDAP code</dt><dd><code>${esc(user.ldap_last_seen_department_code || 'Not returned')}</code></dd></div></dl><small>${request ? 'Approval request pending' : department.key === 'not-approved' || department.key === 'changed' ? 'No pending approval request' : department.key === 'recheck' ? 'Fresh LDAP sign-in required' : department.key === 'approved' ? 'Current and approved codes match' : 'Directory verification required'}</small></section>
        <section aria-label="Work profile"><h3>Work profile</h3><span class="tag ${profilePending ? 'amber' : 'green'}">${profilePending ? 'Confirmation pending' : 'Confirmed'}</span><dl><dt>Home organisation</dt><dd>${esc(user.org_unit_id ? ref('organisational_unit', user.org_unit_id) : 'Not selected')}</dd><dt>Work email</dt><dd>${esc(user.email || 'Not provided')}</dd></dl></section>
        <section aria-label="Roles and scope"><h3>Roles & scope</h3><span class="tag ${effective.length ? 'green' : 'amber'}">${effective.length ? effective.length + ' effective ' + (effective.length === 1 ? 'role' : 'roles') : 'No effective roles'}</span>${roles ? '<ul class="ldap-account-roles">' + roles + '</ul>' : '<p class="small muted">Roles must be assigned separately.</p>'}${assignments.length > effective.length ? `<small>${assignments.length - effective.length} assignment(s) not currently effective</small>` : ''}</section>
      </div>
      <footer class="ldap-account-footer"><div><strong>Next step</strong><p>${esc(readiness.next)}</p></div><div class="ldap-account-actions">
        ${request && user.id !== currentUserId ? button('department-review', 'Review department request', `data-id="${esc(request.id)}"`, 'primary small') : request ? '<span class="small muted">Another administrator must review</span>' : ''}
        ${button('department-history', 'Department history', `data-id="${esc(user.id)}"`, 'small')}
        ${user.id !== currentUserId ? button('user', 'Manage profile & roles', `data-id="${esc(user.id)}"`, 'small') : '<span class="small muted">Use another administrator to edit your access</span>'}
      </div></footer></article>`;
  }).join('');
  return `<section class="panel ldap-directory" aria-labelledby="ldap-directory-title"><header class="panel-header"><h2 id="ldap-directory-title">LDAP directory accounts</h2><p>Department approval, profile confirmation and role access are separate checks.</p></header>${overview}<div class="ldap-account-list">${cards || note('No LDAP accounts match these filters.')}</div><footer class="ldap-directory-count">Showing ${rows.length} of ${ldap.length} LDAP accounts</footer></section>`;
}
