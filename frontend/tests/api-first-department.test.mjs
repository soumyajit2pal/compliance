import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentGate,userDepartmentDetails} from '../features/ldap-department.ts';
test('separate LDAP and API baselines are clearly labelled and external text is escaped',()=>{
 const html=userDepartmentDetails({employee_approved:{ldap_department_code:'LDAP-54',department_code:'0054-QA',designation:'Manager'},employee_observed:{ldap_department_code:'LDAP-99',department_code:'0054-QA',employee_name:'<Private person>'}});
 assert.match(html,/LDAP department code/);assert.match(html,/API department code/);assert.match(html,/LDAP-54/);assert.match(html,/LDAP-99/);assert.match(html,/0054-QA/);assert.match(html,/&lt;Private person&gt;/);assert(!html.includes('<Private person>'));
 assert.match(html,/Registered branch name/);assert.match(html,/Current branch code/);
});
test('automatic full-profile review has no redundant staff submission',()=>{
 const html=departmentGate({status:'PENDING',approved:{},current:{},message:'Employee details changed',can_request:false,requests:[{id:'pending',status:'PENDING'}]});
 assert.match(html,/submitted automatically/);assert.match(html,/Waiting for administrator approval/);assert(!html.includes('id="employee-profile-request"'));assert.match(html,/assigns workspace roles separately/);assert(html.indexOf('Check review status') < html.indexOf('View employee details'));
});
test('rejected observations need a new explicit explanation and display the outage restriction',()=>{
 const html=departmentGate({status:'REJECTED',approved:{},current:{},message:'Existing restrictions remain',warning:'API unavailable <error>',can_request:true,requests:[]});
 assert.match(html,/id="employee-profile-request"/);assert.match(html,/New explanation/);assert.match(html,/&lt;error&gt;/);assert.match(html,/Your profile review was rejected/);
});
