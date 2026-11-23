import test from 'node:test';
import assert from 'node:assert/strict';
import { selectClauseScope } from '../core/clause-scope.ts';
const today = '2026-10-28';
const instruments = [{id:'a',current_version_id:'a-current'}, {id:'b',current_version_id:'b-expired'},
  {id:'c',current_version_id:'c-empty'}, {id:'d'}];
const edition = (id, instrument_id, approval_status, effective_from, extra={}) =>
  ({id,instrument_id,approval_status,effective_from,version_date:effective_from,...extra});
const editions = [edition('a-old','a','APPROVED','2020-01-01',{effective_to:'2025-01-01'}),
  edition('a-current','a','APPROVED','2025-01-01'), edition('a-draft','a','DRAFT','2026-10-01'),
  edition('a-future','a','APPROVED','2999-01-01'), edition('b-expired','b','APPROVED','2020-01-01',{effective_to:today}),
  edition('b-effective','b','APPROVED','2026-01-01'), edition('c-empty','c','APPROVED','2025-01-01'),
  edition('d-draft','d','DRAFT','2026-01-01')];
const resolve = query => selectClauseScope(instruments, editions, new URLSearchParams(query), today);
test('blank filters expose all instruments and editions, independent of selected clause',()=>{
  const result=resolve('clause=a-old-clause');
  assert.equal(result.instrumentId,'all');assert.equal(result.editionFilter,'all');
  assert.deepEqual(result.visibleEditions,editions);
});
test('Current approved resolves each instrument independently and includes empty current editions',()=>{
  const result=resolve('edition=current');
  assert.deepEqual(result.visibleEditions.map(v=>v.id),['a-current','b-effective','c-empty']);
});
test('Current approved never falls back to an unapproved or reference-only edition',()=>{
  assert.deepEqual(resolve('instrument=d&edition=current').visibleEditions,[]);
  const result=selectClauseScope([{id:'future'}],[edition('future-only','future','APPROVED','2999-01-01')],new URLSearchParams('edition=current'),today);
  assert.deepEqual(result.visibleEditions,[]);
});
test('specific edition filters are scoped to the selected instrument',()=>{
  const result=resolve('instrument=a&edition=a-old');assert.equal(result.specific.id,'a-old');
  assert.deepEqual(result.visibleEditions.map(v=>v.id),['a-old']);
  const invalid=resolve('instrument=b&edition=a-old');assert.equal(invalid.invalidEdition,true);
  assert.equal(invalid.editionFilter,'all');assert.ok(invalid.visibleEditions.every(v=>v.instrument_id==='b'));
});
test('unavailable filters fall back to the displayed all scope without trusting clause or version numbers',()=>{
  const result=resolve('instrument=missing&edition=missing');
  assert.equal(result.invalidInstrument,true);assert.equal(result.invalidEdition,true);
  assert.deepEqual(result.visibleEditions,editions);
  assert.equal(resolve('edition=a-current').invalidEdition,true);
});
test('legacy version links resolve the instrument; explicit new filters take precedence',()=>{
  const result=resolve('version=a-old');assert.equal(result.instrumentId,'a');assert.equal(result.specific.id,'a-old');
  const explicit=resolve('edition=all&version=a-old');assert.equal(explicit.instrumentId,'all');
  assert.deepEqual(explicit.visibleEditions,editions);
});
test('empty catalogues and instruments without editions render an empty selection',()=>{
  const result=selectClauseScope([{id:'empty'}],[],new URLSearchParams('instrument=empty'),today);
  assert.equal(result.instrumentId,'empty');assert.deepEqual(result.visibleEditions,[]);
  assert.deepEqual(selectClauseScope([],[],new URLSearchParams(),today).visibleEditions,[]);
});
