import test from 'node:test';
import assert from 'node:assert/strict';
import {ldapDepartmentState,ldapReadiness,matchesDepartmentFilter} from '../core/ldap-readiness.ts';
const user=(overrides={})=>({login_type:'LDAP',active_flag:1,employee_profile_required:true,employee_profile_status:'PENDING',employee_approved_version_id:null,employee_latest_version_id:'latest',needs_email_confirmation_flag:0,needs_department_selection_flag:0,access_status:'DEPARTMENT_REQUIRED',...overrides});
const verified=(overrides={})=>user({employee_profile_status:'VERIFIED',employee_approved_version_id:'approved',employee_latest_version_id:'approved',access_status:'ACCESS_READY',...overrides});
test('initial profile setup remains available while independent review is pending',()=>{
 const state=ldapReadiness(user({needs_email_confirmation_flag:1,needs_department_selection_flag:1,access_status:'PROFILE_PENDING'}),0);
 assert(state.profilePending);assert(state.department.blocked);assert(!state.ready);assert.match(state.next,/confirm.*Home organisation/);
});
test('prepared roles cannot bypass pending or rejected employee changes',()=>{
 for(const status of ['PENDING','REJECTED','UNVERIFIED','UNAVAILABLE'])assert(!ldapReadiness(user({employee_profile_status:status,access_status:'ACCESS_READY'}),3).ready);
});
test('only the currently approved version opens presentation access',()=>{
 assert(ldapReadiness(verified(),1).ready);
 for(const overrides of [{employee_latest_version_id:'different'},{employee_latest_version_id:null},{employee_approved_version_id:null},{employee_profile_status:'PENDING'}])assert(!ldapReadiness(verified(overrides),1).ready);
});
test('a cached approved profile can stay ready with a visible outage warning',()=>{
 const state=ldapReadiness(verified({employee_warning:'Employee API unavailable. Approved employee data is retained.'}),1);
 assert(state.ready);assert.match(state.department.detail,/Approved employee data/);
});
test('approval requires a fresh sign-in and cannot open access immediately',()=>{
 const state=ldapReadiness(verified({employee_profile_status:'RECHECK_REQUIRED'}),1);
 assert(state.department.approved);assert.equal(state.department.key,'recheck');assert(!state.ready);assert.match(state.next,/fresh sign-in/);
});
test('employee approval cannot bypass roles, account activity or profile confirmation',()=>{
 assert(!ldapReadiness(verified(),0).ready);
 assert(!ldapReadiness(verified({active_flag:0}),1).ready);
 assert(!ldapReadiness(verified({needs_email_confirmation_flag:1}),1).ready);
});
test('filters retain separate initial, changed and recheck states',()=>{
 assert(matchesDepartmentFilter(user(),'not-approved'));
 assert(matchesDepartmentFilter(user({employee_approved_version_id:'approved'}),'changed'));
 assert(matchesDepartmentFilter(verified({employee_profile_status:'RECHECK_REQUIRED'}),'recheck'));
});
test('unmanaged technical Standard accounts retain existing readiness',()=>{
 assert(ldapReadiness({active_flag:1,login_type:'STANDARD',access_status:'ACCESS_READY'},1).ready);
});
