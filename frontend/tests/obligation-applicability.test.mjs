import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {partitionAssessments,groupDepartmentAssessments,assessmentDecision} from '../core/obligation-applicability.ts';
import {renderObligationApplicability} from '../features/obligation-applicability.ts';
const row=(id,extra={})=>({id,org_unit_id:'retail',legal_entity_id:'bank',process_id:'onboarding',applicability_status:'APPLICABLE',approval_status:'REVIEWED',basis:'This department performs the required activity.',next_review_date:'2027-01-30',...extra});
state.masters={organisational_unit:[{id:'retail',name:'Retail Banking'},{id:'operations',name:'Operations'}],legal_entity:[{id:'bank',name:'Example Bank'}],process:[{id:'onboarding',name:'Customer onboarding'}]};

test('current rows repeated by the history DTO do not become assessment history',()=>{
 const current=[row('a'),row('b')],p=partitionAssessments(current,current);assert.equal(p.current.length,2);assert.equal(p.history.length,0);
});
test('earlier saved records are retained once and sorted independently of current rows',()=>{
 const current=[row('new')],old=row('old',{approval_status:'WITHDRAWN',created_at:'2026-11-01'}),older=row('older',{approval_status:'WITHDRAWN',created_at:'2026-10-01'});
 const p=partitionAssessments(current,[older,current[0],old,old]);assert.deepEqual(p.history.map(r=>r.id),['old','older']);assert.equal(current.length,1);
});
test('withdrawn and rejected proposals appear only in history',()=>{
 const rejected=row('rejected',{approval_status:'REJECTED'}),withdrawn=row('withdrawn',{approval_status:'WITHDRAWN'});const p=partitionAssessments([rejected,withdrawn],[rejected]);assert.equal(p.current.length,0);assert.equal(p.history.length,2);
});
test('an exclusion is separate from included activities even within the same department',()=>{
 const p=partitionAssessments([row('included'),row('excluded',{applicability_status:'NOT_APPLICABLE'})]);assert.equal(p.included.length,1);assert.equal(p.exclusions.length,1);assert.equal(groupDepartmentAssessments(p.current).length,1);
});
test('pending and approved exclusions have explicitly different decisions',()=>{
 assert.equal(assessmentDecision(row('a',{applicability_status:'NOT_APPLICABLE'})),'Exclusion proposed');assert.equal(assessmentDecision(row('a',{applicability_status:'NOT_APPLICABLE',approval_status:'APPROVED'})),'Exclusion approved');
});
test('the reader names departments, bank and work; Partial limits stay visible and escaped',()=>{
 const a=row('a',{applicability_status:'PARTIALLY_APPLICABLE',conditions:'Include digital accounts. Exclude <script>unsafe</script>.'});const html=renderObligationApplicability({applicability:[a],applicability_history:[a]});
 assert(html.includes('Retail Banking'));assert(html.includes('Example Bank'));assert(html.includes('Customer onboarding'));assert(html.includes('Included activities and limits'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(!html.includes('data-assessment-history-record="a"'));
});
test('all-excluded records keep exclusions closed and avoid implying an approved exemption',()=>{
 const a=row('a',{applicability_status:'NOT_APPLICABLE'}),html=renderObligationApplicability({applicability:[a],applicability_history:[a]});assert(html.includes('Proposed exclusions'));assert(html.includes('still need final approval'));assert(!/<details[^>]*class="obligation-scope-exclusions"[^>]*open/.test(html));assert(html.includes('0 earlier records'));assert(!html.includes('Exclusion approved'));
});
test('unnamed legacy scopes never become a claim about all departments',()=>{
 const html=renderObligationApplicability({applicability:[row('a',{org_unit_id:null,process_id:null})],applicability_history:[]});assert(html.includes('Department not recorded'));assert(html.includes('does not automatically cover every department'));assert(html.includes('No specific process limit recorded'));
});
