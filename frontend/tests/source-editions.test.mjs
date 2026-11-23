import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSourceEdition, isPendingEdition, sourceEditionStatus} from '../core/source-editions.ts';
const today='2026-10-27';
const version=(id,status,from,extra={})=>({id,approval_status:status,effective_from:from,version_date:from,version_number:id,...extra});
const approved=version('1.0','APPROVED','2026-01-01');
const draft=version('2.0','DRAFT','2026-09-01');
const future=version('3.0','APPROVED','2026-12-01');
test('current approved edition stays selected while a newer draft exists',()=>{
 const selection=selectSourceEdition([draft,approved],'1.0',null,today);
 assert.equal(selection.selected.id,'1.0');assert.deepEqual(selection.drafts,[draft]);
});
test('explicit draft, history and task links keep the requested edition',()=>{
 for(const requested of [draft,approved,future])
  assert.equal(selectSourceEdition([draft,approved,future],'1.0',requested.id,today).selected.id,requested.id);
});
test('future approved edition does not replace the effective default',()=>{
 assert.equal(selectSourceEdition([draft,future,approved],'1.0',null,today).selected.id,'1.0');
 assert.equal(selectSourceEdition([draft,future,approved],null,null,today).selected.id,'1.0');
});
test('fallback selects latest effective approval and excludes expired sources',()=>{
 const expired={...approved,effective_to:'2026-10-27'};
 const current=version('1.1','APPROVED','2026-10-01');
 assert.equal(selectSourceEdition([draft,expired,current],expired.id,null,today).selected.id,'1.1');
});
test('no approved editions selects a draft and reports the empty approved population',()=>{
 const rejected=version('9.0','REJECTED','2026-10-27');
 const result=selectSourceEdition([rejected,draft],null,null,today);
 assert.equal(result.selected.id,'2.0');assert.deepEqual(result.approved,[]);
});
test('approved future-only or historical-only sources remain reference views',()=>{
 for(const row of [future,{...approved,effective_to:'2026-09-01'}]){
  const result=selectSourceEdition([draft,row],null,null,today);
  assert.equal(result.selected.id,row.id);assert.equal(result.approvedEffective,undefined);
 }
});
test('invalid explicit link safely falls back, and ordering is deterministic',()=>{
 const newer=version('1.1','APPROVED','2026-10-01');
 for(const list of [[draft,approved,newer],[newer,approved,draft]]){
  const result=selectSourceEdition(list,null,'missing',today);
  assert.equal(result.selected.id,'1.1');assert.equal(result.invalidRequest,true);
 }
});
test('empty collection has no selected edition',()=>{
 assert.equal(selectSourceEdition([],null,null,today).selected,undefined);
});
test('all open workflow states count as pending; terminal editions do not',()=>{
 for(const status of ['DRAFT','IN_REVIEW','REVIEWED']) assert.equal(isPendingEdition({approval_status:status}),true);
 for(const status of ['APPROVED','REJECTED','WITHDRAWN']) assert.equal(isPendingEdition({approval_status:status}),false);
 const review=version('2.0','IN_REVIEW','2026-10-01');
 const result=selectSourceEdition([approved,review],approved.id,null,today);
 assert.deepEqual(result.pending,[review]);assert.deepEqual(result.drafts,[]);assert.equal(result.selected,approved);
});
test('cancelled drafts retain a distinct label and cannot become pending or the approved default',()=>{
 const cancelled={...draft,approval_status:'WITHDRAWN',cancelled_draft:true};
 assert.equal(sourceEditionStatus(cancelled),'CANCELLED');
 assert.equal(sourceEditionStatus({approval_status:'WITHDRAWN'}),'WITHDRAWN');
 const result=selectSourceEdition([approved,cancelled],approved.id,null,today);
 assert.equal(result.selected,approved);assert.deepEqual(result.pending,[]);
 assert.equal(selectSourceEdition([approved,cancelled],approved.id,cancelled.id,today).selected,cancelled);
});
