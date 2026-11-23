import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {partitionOwnerAssignments} from '../core/obligation-ownership.ts';
import {detailPolicy} from '../core/obligation-detail.ts';
import {renderObligationDetail} from '../features/obligation-detail.ts';
state.masters={user:[{id:'person',full_name:'Current person'},{id:'previous',full_name:'Previous person'}],organisational_unit:[{id:'retail',name:'Retail Banking'}]};
const row=(id,extra={})=>({id,obligation_id:'obl',owner_role:'BUSINESS',org_unit_id:'retail',user_id:'person',primary_owner_flag:1,approval_status:'APPROVED',validation_decision:'ACCEPT',effective_from:'2026-11-01',created_at:'2026-11-01T10:00:00',...extra});
const detail=(owners,history)=>({obligation:{id:'obl',code:'EXAMPLE',title:'Example obligation',version_number:2,record_status:'ACTIVE',approval_status:'APPROVED',created_by:'maker',effective_from:'2026-11-01'},versions:[{id:'obl',version_number:2,record_status:'ACTIVE',approval_status:'APPROVED'},{id:'older',version_number:1,record_status:'SUPERSEDED',approval_status:'APPROVED'}],owners,ownership_history:history,owner_changes:[],applicability:[],applicability_history:[],tasks:[],issues:[],citations:[]});
const render=d=>renderObligationDetail(d,detailPolicy(d,'reader',()=>false,'2026-11-02'),new URLSearchParams('tab=owners'));

test('current assignment IDs are never repeated in assignment history',()=>{
 const owners=[row('a'),row('b')];const p=partitionOwnerAssignments(owners,[...owners,...owners]);assert.deepEqual(p.current,owners);assert.equal(p.history.length,0);assert.equal(owners.length,2);
});
test('earlier assignment identity is preserved even when the person and role are unchanged',()=>{
 const current=row('new'),old=row('old',{approval_status:'WITHDRAWN',created_at:'2026-10-01'}),prior=row('prior',{obligation_id:'older',created_at:'2026-09-01'});
 const p=partitionOwnerAssignments([current,current],[prior,old,current,old]);assert.deepEqual(p.current.map(r=>r.id),['new']);assert.deepEqual(p.history.map(r=>r.id),['old','prior']);
});
test('replaced approved and withdrawn assignments belong to history without rewriting approval',()=>{
 const replaced=row('replaced',{ended_by_change_id:'change',replacement_effective_from:'2026-11-02'}),withdrawn=row('withdrawn',{approval_status:'WITHDRAWN'});
 const p=partitionOwnerAssignments([row('new'),replaced,withdrawn],[replaced]);assert.equal(p.current.length,1);assert.equal(p.history.length,2);assert.equal(replaced.approval_status,'APPROVED');
});
test('a closed review response does not make a current assignment historical',()=>{
 const owner=row('closed-task',{approval_status:'REVIEWED',validation_decision:'PENDING',validation_task:{workflow_status:'RETURNED'}});const p=partitionOwnerAssignments([owner],[owner]);assert.equal(p.current.length,1);assert.equal(p.history.length,0);
});
test('Owners with no earlier records keeps history collapsed with an honest empty count',()=>{
 const owners=[row('a')],html=render(detail(owners,owners));assert(html.includes('Assignment history · 0 earlier assignments'));assert(html.includes('No earlier owner assignments.'));assert(!/<details[^>]*class="[^"]*obligation-assignment-history[^"]*"[^>]*open/.test(html));assert.equal((html.match(/Current person/g)||[]).length,1);assert(!html.includes('Previous owner'));
});
test('history renders only earlier people with revision, saved date, response and replacement facts',()=>{
 const old=row('old',{user_id:'previous',ended_by_change_id:'change',replacement_effective_from:'2026-11-02',effective_to:'2026-11-02',created_at:'2026-10-01T10:00:00'}),d=detail([row('new')],[row('new'),old]);
 const html=render(d),history=html.slice(html.indexOf('class="panel obligation-history-detail obligation-assignment-history"'));assert(history.includes('1 earlier assignment'));assert(history.includes('Previous person'));assert(!history.includes('Current person'));assert(history.includes('Revision 2'));assert(history.includes('Saved on 01 Oct 2026'));assert(history.includes('Previous assignment · replaced'));assert(history.includes('Accepted'));assert(history.includes('Approved'));
});
test('earlier-revision labels, missing saved dates and escaped comments remain accurate',()=>{
 const old=row('old',{obligation_id:'older',user_id:'previous',created_at:null,approval_status:'WITHDRAWN'}),d=detail([], [old]);d.tasks=[{owner_id:'old',decision:'OBJECT',comments:'<script>private markup</script>'}];
 const html=render(d);assert(html.includes('Revision 1'));assert(html.includes('Saved on Date not recorded'));assert(html.includes('&lt;script&gt;private markup&lt;/script&gt;'));assert(!html.includes('<script>'));assert(html.includes('Withdrawn'));
});
