/** Presentation only; server-side employee approval and role scope remain authoritative. */
export function ldapDepartmentState(user){
 const required=user.employee_profile_required??user.login_type==='LDAP';
 if(!required)return {key:'approved',label:'Employee profile not required',tone:'neutral',approved:true,blocked:false,detail:'Existing Standard account access rules apply.'};
 const state=user.employee_profile_status;
 const verified=state==='VERIFIED'&&!!user.employee_approved_version_id&&user.employee_latest_version_id===user.employee_approved_version_id;
 return {key:verified?'approved':state==='RECHECK_REQUIRED'?'recheck':state==='UNAVAILABLE'?'unavailable':user.employee_approved_version_id?'changed':'not-approved',
  label:verified?'Employee profile approved':state==='RECHECK_REQUIRED'?'Profile approved — sign-in required':state==='UNAVAILABLE'?'LDAP department unavailable':state==='REJECTED'?'Employee profile change rejected':'Employee profile approval required',
  tone:verified?'green':'amber',approved:verified||state==='RECHECK_REQUIRED',blocked:!verified,
  detail:user.employee_warning||(verified?'Separate LDAP and API baselines are approved.':state==='RECHECK_REQUIRED'?'Sign out and sign in again.':'Review the LDAP department and API employee details together. Home organisation, roles and scope remain separately administered.')};
}
export function matchesDepartmentFilter(user,filter){return !filter||(filter==='not-approved'?!ldapDepartmentState(user).approved:ldapDepartmentState(user).key===filter);}
export function ldapReadiness(user,effectiveRoleCount,pendingRequest=false){
 const department=ldapDepartmentState(user),profilePending=Boolean(user.needs_email_confirmation_flag||user.needs_department_selection_flag);
 const ready=Boolean(user.active_flag&&!department.blocked&&!profilePending&&effectiveRoleCount>0&&user.access_status==='ACCESS_READY');
 const next=!user.active_flag?'Review the disabled account.':profilePending?'The employee must confirm work email and Home organisation.':department.key==='recheck'?'A fresh sign-in is required.':department.blocked?pendingRequest?'An independent administrator must review the employee profile.':'Complete valid LDAP/API details are required; check the refresh warning.':!effectiveRoleCount?'Assign or review effective roles and organisation scope.':ready?'All access checks are complete.':user.access_message||'Review the remaining access requirements.';
 return {department,profilePending,ready,next};
}
