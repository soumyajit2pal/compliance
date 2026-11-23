import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationModel,navigationSelection,navigationLabel,reportView,ccoViewAllowed} from '../core/navigation.ts';
import {taskQueue} from '../core/task-queues.ts';
const identity=(roles=['AUTHOR'],ids=['home','tasks','approvals','repository','notification-families','clauses','clause-relationships','obligations','applicability','accountability','actions','evidence','controls','control-mappings','delegations','team','applications'])=>({roles,menu:ids.map(id=>({id}))});
test('reference navigation groups existing governed destinations without discarding mappings or decisions',()=>{
 const model=navigationModel(identity(),'home');assert.deepEqual(model.primary.map(i=>i.label),['Compliance at a glance']);
 assert.deepEqual(model.groups.find(g=>g.id==='regulations').items.map(i=>i.label),['Regulatory library','Notification families','Clauses','Clause relationships','Obligations','Applicability','Accountability']);
 assert.deepEqual(model.groups.find(g=>g.id==='work').items.map(i=>i.label),['My tasks','Compliance work tracker','Evidence','Checks and procedures','RBI notification workflow','Delegation']);
 assert.equal(navigationSelection('approvals'),'tasks');assert.equal(navigationSelection('control-mappings'),'controls');
});
test('canonical aliases, focused views, report presets and exceptions identify one matching entry',()=>{
 for(const [page,query,expected]of [['obligations','view=applicability','applicability'],['obligations','view=accountability','accountability'],['obligations','tab=reports','exceptions'],['team','audience=department','department'],['team','audience=cco','cco'],['masters','tab=organisation','organisation'],['delegations','','delegation']])assert.equal(navigationSelection(page,new URLSearchParams(query)),expected);
 assert.equal(navigationLabel('obligations',new URLSearchParams('view=applicability')),'Applicability');assert.equal(navigationLabel('approvals'),'My decisions');
});
test('navigation does not manufacture permissions for technical Admin or menu-restricted users',()=>{
 const model=navigationModel(identity(['ADMIN'],['home','tasks','approvals','users','masters','ldap','applications']),'users');
 assert.deepEqual(model.groups.find(g=>g.id==='work').items.map(i=>i.id),['tasks']);
 assert(!model.groups.some(g=>g.id==='regulations'));assert(!model.groups.flatMap(g=>g.items).some(i=>['controls','cco','department','delegation'].includes(i.id)));
 const limited=navigationModel(identity(['REVIEWER'],['home','tasks']),'home');assert(!limited.groups.flatMap(g=>g.items).some(i=>i.id==='rbi-workflow'));
});
test('CCO destination requires the existing team permission and CCO role; the query adds no authority',()=>{
 assert(!navigationModel(identity(),'home').groups.flatMap(g=>g.items).some(i=>i.id==='cco'));
 assert(navigationModel(identity(['CCO']),'team').groups.flatMap(g=>g.items).some(i=>i.id==='cco'));
 assert(!ccoViewAllowed(['AUTHOR'],new URLSearchParams('audience=cco')));assert(ccoViewAllowed(['CCO'],new URLSearchParams('audience=cco')));
});
test('dashboard presets retain appropriate defaults and legacy overview links',()=>{
 assert.equal(reportView(new URLSearchParams()).label,'Team overview');assert.equal(reportView(new URLSearchParams('audience=department')).defaultMetric,'applicable');
 assert.equal(reportView(new URLSearchParams('audience=operational')).defaultMetric,'open');assert.equal(reportView(new URLSearchParams('audience=cco')).metrics,null);
});
test('RBI queue filters by the actual regulator reference and never guesses from task wording',()=>{
 const tasks=[{id:'rbi',instrument_id:'a'},{id:'other',instrument_id:'b'},{id:'unlinked',title:'RBI task'}];
 assert.deepEqual(taskQueue(tasks,'rbi',[{id:'a',regulator_id:'r'},{id:'b',regulator_id:'s'}],[{id:'r',code:'RBI'},{id:'s',code:'SEBI'}]).map(t=>t.id),['rbi']);
 assert.deepEqual(taskQueue(tasks,'rbi',[],[]),[]);assert.equal(taskQueue(tasks,'',[],[]),tasks);
});
