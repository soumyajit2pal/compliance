import test from 'node:test';
import assert from 'node:assert/strict';
import {coverageSummary,coverageSections,exclusionLabel} from '../core/obligation-coverage.ts';

const assessment=(status,approval_status='DRAFT')=>({applicability_status:status,approval_status});
const unit=(name,assessments=[],owners=[])=>({id:name,name,assessments,owners});
test('owner departments never become applicable without a recorded scope assessment',()=>{
  const summary=coverageSummary({departments:[unit('Compliance',[],[{approval_status:'DRAFT'}]),unit('Retail',[assessment('PARTIALLY_APPLICABLE')]),unit('Operations',[assessment('NOT_APPLICABLE')])]});
  assert.deepEqual(summary,{applying:['Retail'],excluded:['Operations'],unassessed:['Compliance']});
});
test('retained or rejected assessments do not establish coverage for the revision',()=>{
  const summary=coverageSummary({departments:[unit('Old',[assessment('APPLICABLE','WITHDRAWN')]),unit('Rejected',[assessment('APPLICABLE','REJECTED')]),unit('Current',[assessment('APPLICABLE','APPROVED')])]});
  assert.deepEqual(summary.applying,['Current']);
});
test('mixed activity scopes retain both relevance and exclusions without double-counting a department',()=>{
  const summary=coverageSummary({departments:[unit('Retail',[assessment('APPLICABLE'),assessment('PARTIALLY_APPLICABLE'),assessment('NOT_APPLICABLE')])]});
  assert.deepEqual(summary,{applying:['Retail'],excluded:['Retail'],unassessed:[]});
});
test('entity-only assessments do not assign all named departments',()=>{
  const summary=coverageSummary({departments:[unit('Retail',[],[{approval_status:'APPROVED'}])],unallocated_assessments:[assessment('APPLICABLE')]});
  assert.deepEqual(summary,{applying:[],excluded:[],unassessed:['Retail']});
});
test('replaced approved owners remain retained and cannot establish current responsibilities',()=>{
  const old={id:'old',approval_status:'APPROVED',ended_by_change_id:'request'},current={id:'current',approval_status:'APPROVED'};
  const sections=coverageSections({departments:[unit('Former',[],[old]),unit('Current',[],[current])]});
  assert.equal(sections.unassessed.length,1);assert.equal(sections.unassessed[0].name,'Current');assert.deepEqual(sections.retained[0].owners,[old]);
});
test('mixed activity scopes are split without losing owners or putting exclusions in the included section',()=>{
  const applicable=assessment('PARTIALLY_APPLICABLE'),excluded=assessment('NOT_APPLICABLE');
  const owners=[{approval_status:'REVIEWED',owner_role:'BUSINESS'}];
  const sections=coverageSections({departments:[unit('Retail',[applicable,excluded],owners)]});
  assert.deepEqual(sections.included[0].assessments,[applicable]);
  assert.deepEqual(sections.exclusions[0].assessments,[excluded]);
  assert.deepEqual(sections.included[0].owners,owners);assert.deepEqual(sections.exclusions[0].owners,owners);
  assert.equal(sections.pendingExclusions,1);assert.equal(sections.unassessed.length,0);
});
test('an all-excluded obligation has no included departments and retains separate pending/approved counts',()=>{
  const sections=coverageSections({departments:[unit('Retail',[assessment('NOT_APPLICABLE','REVIEWED')]),unit('Operations',[assessment('NOT_APPLICABLE','APPROVED')])]});
  assert.equal(sections.included.length,0);assert.equal(sections.pendingExclusions,1);assert.equal(sections.approvedExclusions,1);
  assert.equal(exclusionLabel('REVIEWED'),'Exclusion proposed — approval pending');
  assert.equal(exclusionLabel('APPROVED'),'Excluded from this scope — approved');
});
test('rejected/withdrawn scope and owner rows remain in history and do not become proposed exclusions',()=>{
  const rows=[assessment('NOT_APPLICABLE','REJECTED'),assessment('APPLICABLE','WITHDRAWN')];
  const owners=[{approval_status:'WITHDRAWN',owner_role:'CONTROL'}];
  const sections=coverageSections({departments:[unit('Old department',rows,owners)]});
  assert.equal(sections.included.length,0);assert.equal(sections.exclusions.length,0);assert.equal(sections.unassessed.length,0);
  assert.deepEqual(sections.retained[0].assessments,rows);assert.deepEqual(sections.retained[0].owners,owners);
});
test('unallocated exclusions remain separate from named departments and every assessment is retained once',()=>{
  const unnamed=[assessment('APPLICABLE'),assessment('NOT_APPLICABLE','APPROVED'),assessment('NOT_APPLICABLE','WITHDRAWN')];
  const sections=coverageSections({departments:[unit('Compliance',[],[{approval_status:'DRAFT'}])],unallocated_assessments:unnamed});
  assert.equal(sections.included.length,0);assert.equal(sections.unassessed.length,1);
  assert.equal(sections.exclusions[0].id,null);assert.equal(sections.approvedExclusions,1);
  assert.equal(sections.unallocated.length+sections.exclusions[0].assessments.length+sections.retained[0].assessments.length,unnamed.length);
});
