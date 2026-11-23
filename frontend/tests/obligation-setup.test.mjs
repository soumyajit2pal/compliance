import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {scopeProcessChoices,setupSectionSteps} from '../core/obligation-setup.ts';
import {renderSetupReview} from '../features/obligation-setup.ts';
import {obligationLifecycle} from '../features/obligation-detail.ts';

test('process limits offer deduplicated linked processes without creating inferred mappings',()=>{
 const source=['onboarding','onboarding','monitoring'];
 assert.deepEqual(scopeProcessChoices(source,'',id=>id),[{id:'onboarding',name:'onboarding'},{id:'monitoring',name:'monitoring'}]);
 assert.deepEqual(source,['onboarding','onboarding','monitoring']);
 assert.deepEqual(scopeProcessChoices([],'',id=>id),[]);
});
test('an existing unlinked scope remains explicit and selectable until the user changes it',()=>{
 const choices=scopeProcessChoices(['onboarding'],'old-process',id=>id);
 assert.equal(choices.length,2);assert.equal(choices[1].id,'old-process');assert.match(choices[1].name,/existing scope, not a linked process/);
 assert.equal(scopeProcessChoices(['old-process'],'old-process',id=>id).length,1);
});
test('existing semantic edit links resolve after splitting Departments and Processes',()=>{
 assert.equal(setupSectionSteps.applicability,2);assert.equal(setupSectionSteps.processes,3);assert.equal(setupSectionSteps.owners,4);assert.equal(setupSectionSteps.evidence,5);assert.equal(setupSectionSteps.source,0);
});
test('the final summary retains exclusions and scope limits separately from linked process responsibility',()=>{
 state.masters={organisational_unit:[{id:'retail',name:'Retail Banking'}],process:[{id:'process',name:'Onboarding'}],user:[{id:'business',full_name:'Example Owner'}]};
 const value={title:'<script>unsafe</script>',statement:'Verify identity.',applicability:[{org_unit_id:'retail',legal_entity_id:'bank',applicability_status:'NOT_APPLICABLE',basis:'This scope excludes account servicing.',process_id:'process',next_review_date:'2027-01-01'}],processes:[{process_id:'process',relevance_type:'DIRECT',criticality:'MEDIUM'}],owners:[{owner_role:'BUSINESS',primary_owner_flag:true,user_id:'business',org_unit_id:'retail'}],business_owner_unit_id:'retail',effective_from:'2026-11-02',next_review_date:'2027-01-01'};
 const html=renderSetupReview(value,{instrument_title:'Rule',heading:'Clause',version_number:1});
 assert.match(html,/Does not apply — exclusion proposed/);assert.match(html,/Limited to Onboarding/);assert.match(html,/Direct — performs the required activity/);assert.match(html,/Example Owner/);
 assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert.match(html,/Add at least one Check owner/);assert.match(html,/Add a primary Regulatory owner/);
 assert.equal(value.applicability[0].applicability_status,'NOT_APPLICABLE');
});
test('the lifecycle follows the current workflow stage through owner acceptance and independent final approval',()=>{
 const d={obligation:{record_status:'DRAFT',approval_status:'REVIEWED'}};
 const html=obligationLifecycle(d,{stage:'BUSINESS_VALIDATION'});
 assert.match(html,/aria-current="step">3\. Owner acceptance/);assert(!html.includes('data-decision='));
 assert.match(obligationLifecycle(d,{stage:'FINAL_APPROVAL'}),/aria-current="step">4\. Final approval/);
});
test('terminal records do not show a fresh lifecycle and approved records show completed stages',()=>{
 for(const status of ['RETIRED','SUPERSEDED'])assert.equal(obligationLifecycle({obligation:{record_status:status,approval_status:'APPROVED'}},{}),'');
 const html=obligationLifecycle({obligation:{record_status:'ACTIVE',approval_status:'APPROVED'}},{});assert.equal((html.match(/is-complete/g)||[]).length,4);assert(!html.includes('aria-current'));
});
