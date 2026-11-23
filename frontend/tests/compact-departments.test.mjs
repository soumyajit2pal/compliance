import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {coverageOwnerResponse,coveragePageTotals} from '../core/obligation-coverage.ts';
import {obligationCoverageCards,coverageResponseStats} from '../features/obligation-coverage.ts';
state.masters={user:[{id:'business',full_name:'Example Person'}],organisational_unit:[]};
const owner=(id='owner',extra={})=>({id,user_id:'business',owner_role:'BUSINESS',primary_owner_flag:1,approval_status:'REVIEWED',validation_decision:'ACCEPT',...extra});
const group=(owners=[owner()],assessments=[])=>({obligation:{id:'obligation',title:'Verify identity',code:'EXAMPLE',version_number:1,approval_status:'REVIEWED',record_status:'DRAFT'},departments:[{id:'retail',name:'Retail Banking',owners,assessments}],unallocated_assessments:[]});
const render=g=>obligationCoverageCards([g],{pageKey:'accountability'},'accountability?department=retail');
test('a pending task from a closed review and earlier Draft acceptance are not current responses',()=>{
 assert.equal(coverageOwnerResponse(owner('closed',{validation_decision:'PENDING',validation_task:{workflow_status:'RETURNED'}})),null);assert.equal(coverageOwnerResponse(owner('draft',{approval_status:'DRAFT'})),null);assert.equal(coverageOwnerResponse(owner('pending',{validation_decision:'PENDING',validation_task:{workflow_status:'OPEN'}})),'PENDING');
});
test('summary counts distinct assignments and requires an accepted primary Business owner',()=>{
 const g=group([owner(),owner('data',{owner_role:'DATA',primary_owner_flag:0})]);g.departments.push({...g.departments[0],id:'operations'});assert.deepEqual(coveragePageTotals([g,group([owner('additional',{primary_owner_flag:0})])]),{awaiting:0,accepted:3,objected:0,without_accepted_business:1});
});
test('compact obligation and exclusion disclosures start closed and preserve explicit linked destinations',()=>{
 const html=render(group([owner()],[{id:'excluded',applicability_status:'NOT_APPLICABLE',approval_status:'REVIEWED'}]));assert(html.includes('coverage-obligation-details'));assert(!/<details[^>]*coverage-obligation-details[^>]*open/.test(html));assert(!/<details[^>]*coverage-exclusions[^>]*open/.test(html));assert(html.includes('data-obligation-preview="obligation"'));assert(html.includes('return_to=accountability%3Fdepartment%3Dretail'));assert(html.includes('Exclusions awaiting approval'));assert(!html.includes('coverage-scope-status'));
});
test('global metrics use server totals rather than silently treating one page as the full population',()=>{
 const data={items:[group()],summary:{awaiting:30,accepted:40,objected:2,without_accepted_business:10}},html=coverageResponseStats(data);assert(html.includes('All matching obligations'));assert(html.includes('<strong>30</strong>'));assert(html.includes('<strong>40</strong>'));assert(!html.includes('On this page'));assert(coverageResponseStats({items:[group()]}).includes('On this page'));
});
test('owners without applicability are kept outside covered departments',()=>{
 const html=render(group());assert(html.includes('Departments with owners only'));assert(html.includes('Applicability not assessed'));assert(html.includes('Not assessed'));assert(!html.includes('coverage-scope-status'));
});
test('replaced owners are retained as earlier records and cannot supply the current primary owner',()=>{
 const html=render(group([owner('old',{ended_by_change_id:'change'})]));assert(html.includes('Earlier records'));assert(html.includes('Not assigned'));assert.equal(coveragePageTotals([group([owner('old',{ended_by_change_id:'change'})])]).accepted,0);
});
test('titles and owner names stay escaped in compact summaries and expanded department rows',()=>{
 const g=group([owner('one',{owner_name:'<script>Person</script>'})]);g.obligation.title='<b>Requirement</b>';const html=render(g);assert(html.includes('&lt;b&gt;Requirement&lt;/b&gt;'));assert(html.includes('&lt;script&gt;Person&lt;/script&gt;'));assert(!html.includes('<script>'));
});
