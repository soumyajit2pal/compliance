import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPage,pageInfo,pageNumbers,pageRequest,pagePath,withoutPaging,apiPageQuery,collectionKey} from '../core/pagination.ts';
import {instrumentWorkspacePath,clauseWorkspacePath} from '../core/source-navigation.ts';

test('empty, exact boundary, last partial page and page overflow have truthful ranges',()=>{
  assert.deepEqual(pageInfo(0,8),{page:1,page_size:25,total:0,total_pages:0,start:0,end:0});
  assert.deepEqual(pageInfo(50,2),{page:2,page_size:25,total:50,total_pages:2,start:26,end:50});
  assert.deepEqual(pageInfo(51,99),{page:3,page_size:25,total:51,total_pages:3,start:51,end:51});
  assert.equal(pageInfo(50,3).page,2); // Deleting the last record cannot leave an empty page.
});
test('malformed URL choices normalize to supported defaults',()=>{
  for(const bad of ['0','-2','1.5','NaN','Infinity','9007199254740992']) {
    assert.equal(pageRequest(new URLSearchParams('page.a='+bad),'a').page,1);
  }
  assert.equal(pageRequest(new URLSearchParams('size.a=9999'),'a').page_size,25);
  for(const size of [10,25,50,100]) assert.equal(pageRequest(new URLSearchParams('size.a='+size),'a').page_size,size);
});
test('one list changes without overwriting filters or a neighbouring list',()=>{
  const next=pagePath('#masters?tab=organisation&unit=BANK&page.a=2&page.b=3&size.b=10','a',4,50);
  const q=new URLSearchParams(next.split('?')[1]);
  assert.equal(q.get('page.a'),'4');assert.equal(q.get('size.a'),'50');
  assert.equal(q.get('page.b'),'3');assert.equal(q.get('size.b'),'10');
  assert.equal(q.get('unit'),'BANK');assert.equal(q.get('tab'),'organisation');
});
test('filter and tab resets remove every paging key while retaining business filters',()=>{
  const original=new URLSearchParams('q=KYC&edition=all&page.a=4&size.a=50&page.b=2');
  assert.equal(withoutPaging(original).toString(),'q=KYC&edition=all');
  assert.equal(original.get('page.a'),'4');
  assert.equal(apiPageQuery(original,'a').toString(),'q=KYC&edition=all&page=4&page_size=50');
});
test('hierarchy deep links reveal a complete selected group without overriding explicit navigation',()=>{
  assert.equal(initialPage(100,new URLSearchParams(),'tree',60).page,3);
  assert.equal(initialPage(100,new URLSearchParams('page.tree=1'),'tree',60).page,1);
});
test('record and clause links reset paging while retaining their exact edition and filters',()=>{
  const query=new URLSearchParams('tab=versions&page.history=4&size.history=50&q=5.1');
  const record=instrumentWorkspacePath('instrument-1','edition-2',query);
  assert.equal(new URLSearchParams(record.split('?')[1]).get('version'),'edition-2');
  assert(!record.includes('page.history'));assert(!record.includes('size.history'));
  const clause=clauseWorkspacePath('clause-1',query);
  assert.equal(new URLSearchParams(clause.split('?')[1]).get('q'),'5.1');
  assert(!clause.includes('page.history'));assert(!clause.includes('size.history'));
});
test('page windows are bounded, ordered and include first, last and current pages',()=>{
  assert.deepEqual(pageNumbers(1,0),[]);
  assert.deepEqual(pageNumbers(50,100),[1,'ellipsis',49,50,51,'ellipsis',100]);
  assert.deepEqual(pageNumbers(2,3),[1,2,3]);
  assert.equal(collectionKey('Unit|Type'),collectionKey('Unit|Type'));
  assert.notEqual(collectionKey('Unit|Type'),collectionKey('User|Type'));
});
