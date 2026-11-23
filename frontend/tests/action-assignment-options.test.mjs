import test from 'node:test';
import assert from 'node:assert/strict';
import {activeObligationOptions} from '../features/action-assignment-options.ts';
const row=(id,extra={})=>({id,title:'Approved requirement '+id,record_status:'ACTIVE',approval_status:'APPROVED',...extra});
const page=(items,index,size,total)=>({items,pagination:{page:index,page_size:size,total,total_pages:Math.ceil(total/size)}});

test('New action reads the actual paginated obligation contract, not an array',async()=>{
 const calls=[];const result=await activeObligationOptions(async path=>{calls.push(path);return page([row('active'),row('draft',{record_status:'DRAFT'}),row('unapproved',{approval_status:'IN_REVIEW'})],1,100,3);});
 assert.deepEqual(result.map(r=>r.id),['active']);assert.deepEqual(calls,['/obligations?status=ACTIVE&page=1&page_size=100']);
});
test('all authorised pages are loaded so approved options after the first 100 are included',async()=>{
 const rows=Array.from({length:205},(_,i)=>row('o'+i)),calls=[];
 const result=await activeObligationOptions(async path=>{const query=new URLSearchParams(path.split('?')[1]),p=Number(query.get('page'));calls.push(p);return page(rows.slice((p-1)*100,p*100),p,100,205);});
 assert.equal(result.length,205);assert.equal(result.at(-1).id,'o204');assert.deepEqual(calls,[1,2,3]);
});
test('an empty authorised page is a valid empty choice set',async()=>{
 assert.deepEqual(await activeObligationOptions(async()=>page([],1,100,0)),[]);
});
test('malformed responses are not silently converted into an empty register',async()=>{
 for(const response of [[],{},null,{items:[]},page([],1,100,2),page([],1,100,-1)])await assert.rejects(activeObligationOptions(async()=>response),/could not be loaded|incomplete/);
});
test('changing populations and repeated pages fail with refresh guidance instead of losing choices or looping',async()=>{
 const first=Array.from({length:100},(_,i)=>row('o'+i));
 await assert.rejects(activeObligationOptions(async path=>path.includes('page=1&')?page(first,1,100,101):page([row('next')],2,100,102)),/changed/);
 await assert.rejects(activeObligationOptions(async path=>path.includes('page=1&')?page(first,1,100,101):page([first[0]],2,100,101)),/changed/);
 await assert.rejects(activeObligationOptions(async()=>page(first,1,100,101)),/could not be loaded/);
});
test('API authorisation and transport errors propagate without supplying fallback options',async()=>{
 const denied=new Error('Your approved role does not permit this workspace.');
 await assert.rejects(activeObligationOptions(async()=>{throw denied;}),error=>error===denied);
});
