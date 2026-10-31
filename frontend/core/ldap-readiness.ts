/** Presentation only. The API remains the authority for access and decisions. */
export function ldapDepartmentState(user) {
  const status = user.ldap_department_status;
  const approved = user.department_code;
  const current = user.ldap_last_seen_department_code;
  const valid = value => typeof value === 'string' && value.trim().length > 0 && [...value].length <= 100 && !/[\x00-\x1f\x7f]/.test(value);
  const matches = Boolean(valid(approved) && valid(current) && approved === current);
  if (status === 'UNAVAILABLE') return {
    key: 'unavailable', label: 'LDAP department code unavailable', tone: 'amber', approved: false, blocked: true,
    detail: 'LDAP must return one valid department code before it can be verified.',
  };
  if (status === 'MISMATCH' || (['VERIFIED', 'RECHECK_REQUIRED'].includes(status) && valid(approved) && valid(current) && approved !== current)) return {
    key: 'changed', label: 'Department code changed — approval required', tone: 'amber', approved: false, blocked: true,
    detail: 'The current LDAP code differs from the approved code. Application access is blocked.',
  };
  if (status === 'RECHECK_REQUIRED' && matches) return {
    key: 'recheck', label: 'Department approved — sign-in required', tone: 'neutral', approved: true, blocked: true,
    detail: 'The update is approved. The user must sign in with LDAP again to verify the current code.',
  };
  if (status === 'VERIFIED' && matches) return {
    key: 'approved', label: 'Department code approved', tone: 'green', approved: true, blocked: false,
    detail: 'The current LDAP code matches the approved code.',
  };
  return {
    key: 'not-approved', label: 'Department code not approved', tone: 'amber', approved: false, blocked: true,
    detail: 'Application access is blocked until the LDAP department code is independently approved.',
  };
}

export function matchesDepartmentFilter(user, filter) {
  if (!filter) return true;
  const state = ldapDepartmentState(user);
  if (filter === 'not-approved') return !state.approved;
  if (filter === 'pending') return false; // Pending requests are matched by their immutable request rows.
  return state.key === filter;
}

export function ldapReadiness(user, effectiveRoleCount, pendingRequest = false) {
  const department = ldapDepartmentState(user);
  const profilePending = Boolean(user.needs_email_confirmation_flag || user.needs_department_selection_flag);
  const ready = Boolean(user.active_flag && !department.blocked && !profilePending && effectiveRoleCount > 0 && user.access_status === 'ACCESS_READY');
  let next;
  if (!user.active_flag) next = 'Review the disabled account before restoring access.';
  else if (department.key === 'unavailable') next = 'Check the LDAP code mapping, then ask the user to sign in again.';
  else if (department.key === 'recheck') next = 'The user must sign out and sign in with LDAP again.';
  else if (department.blocked && pendingRequest) next = 'An independent administrator must review the department-code request.';
  else if (profilePending) next = 'The user must confirm their work email and Home organisation.';
  else if (department.blocked) next = user.ldap_last_seen_department_code
    ? 'The user must submit a department-code verification request from the sign-in screen.'
    : 'The user must sign in with LDAP to retrieve their department code.';
  else if (!effectiveRoleCount) next = 'Assign or review effective roles and organisation scope.';
  else next = ready ? 'All access checks are complete.' : user.access_message || 'Review the remaining access requirements.';
  return { department, profilePending, ready, next };
}
