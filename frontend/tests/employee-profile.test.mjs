import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeWarning,employeeDetails} from '../ui/employee-profile.ts';
import {navigationModel} from '../core/navigation.ts';
test('employee warning is nonblocking, escaped and handles first failure or stale data',()=>{
 assert.equal(employeeWarning(null),'');assert.equal(employeeWarning({warning:null}),'');
 assert.match(employeeWarning({warning:'Retry <script>'}),/role="status"/);
 assert.match(employeeWarning({warning:'Retry <script>'}),/&lt;script&gt;/);
 assert.match(employeeWarning({warning:'Retry'}),/shown as NA/);
 assert.match(employeeWarning({warning:'Retry',last_success_at:'2026-11-19'}),/successful details are retained/);
});
test('profile keeps branch name distinct from current branch code and access data',()=>{
 const html=employeeDetails({branch_code:'0001',branch_name:'Example branch',current_branch_code:'0002',designation:'<Manager>',sync_status:'FAILED',missing_fields:['designation'],stale:true,retry_enabled:true});
 assert.match(html,/Branch name \(for branch code\)/);assert.match(html,/Current branch code/);assert.match(html,/0001/);assert.match(html,/0002/);
 assert.match(html,/&lt;Manager&gt;/);assert.match(html,/NA/);assert.match(html,/LDAP and API department codes are separate/);
});
test('employee API settings stays in existing Administration and requires its server menu permission',()=>{
 const identity={roles:['ADMIN'],menu:[{id:'home'},{id:'employee-api'}]};
 const model=navigationModel(identity,'employee-api');assert.equal(model.groups.length,1);assert.equal(model.groups[0].id,'administration');assert.equal(model.groups[0].items[0].href,'employee-api');
 assert(!navigationModel({roles:['AUTHOR'],menu:[{id:'home'}]},'home').groups.some(g=>g.items.some(i=>i.id==='employee-api')));
});
