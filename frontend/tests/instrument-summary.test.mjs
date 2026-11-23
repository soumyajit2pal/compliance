import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {renderInstrumentSummary} from '../features/repository/summary.ts';
import {rememberLibraryLocation,libraryReturnPath} from '../core/library-navigation.ts';
state.masters={
 regulator:[{id:'rbi',code:'RBI',name:'Reserve Bank of India'}],
 instrument_type:[{id:'notification',name:'Notification'}],
 regulatory_domain:[{id:'kyc',name:'KYC / AML / CFT'}],
 organisational_unit:[{id:'compliance',name:'Compliance Department'}],
 user:[{id:'author',full_name:'Regulatory Author'}],
};
const record={instrument:{id:'instrument',regulator_id:'rbi',instrument_type_id:'notification',
 primary_domain_id:'kyc',regulatory_owner_unit_id:'compliance',interpretation_owner_user_id:'author',
 official_reference_number:'REF-2026',materiality:'HIGH',issue_date:'2026-10-30',effective_date:'2026-10-31'},
 secondary_domains:[{name:'Customer Protection'}],source_documents:{old:'approved-source.txt',new:'draft-source.txt'}};
test('retained legacy references are visible and escaped in the shared summary',()=>{
 const html=renderInstrumentSummary({...record,instrument:{...record.instrument,legacy_codes:['INS-RBI-REG-KYC-ACT-001','<legacy>']}},{source_document_id:'old'});
 assert(html.includes('Legacy references'));assert(html.includes('INS-RBI-REG-KYC-ACT-001'));
 assert(html.includes('&lt;legacy&gt;'));assert(!html.includes('<legacy>'));
});
test('shared summary keeps all thirteen fields and selects only the displayed edition source',()=>{
 const html=renderInstrumentSummary(record,{source_document_id:'new'});
 assert.equal((html.match(/data-summary-field=/g)||[]).length,13);
 assert(html.includes('RBI — Reserve Bank of India'));
 assert(html.includes('Compliance Department'));assert(html.includes('Regulatory Author'));
 assert(html.includes('Customer Protection'));assert(html.includes('draft-source.txt'));
 assert(!html.includes('approved-source.txt'));assert(html.includes('data-id="new"'));
 assert(html.includes('href="/api/documents/new" download'));
 assert(html.includes('download="draft-source.txt"'));
 assert(!html.includes('href="/api/documents/old"'));
 assert(html.includes('aria-label="Download draft-source.txt"'));
 assert(html.includes('#notification-families/instrument'));
 assert(!/data-action="(?:edit|approve|submit|cancel)/.test(html));
});
test('metadata and document names are escaped and missing documents remain explicit',()=>{
 const unsafe={...record,instrument:{...record.instrument,official_reference_number:'<script>alert(1)</script>',keywords:'"><img src=x>'},
  source_documents:{new:'"><svg onload=alert(1)>'}};
 const html=renderInstrumentSummary(unsafe,{source_document_id:'new'});
 assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(!html.includes('<svg onload'));
 assert(html.includes('&lt;script&gt;'));
 assert(renderInstrumentSummary(record,null).includes('Not recorded'));
});
test('full-page return preserves library filters, page and size without caching record data',()=>{
 const previous={identity:state.identity,window:globalThis.window,location:globalThis.location,history:globalThis.history};
 try{
  state.identity={user:{id:'author'}};
  globalThis.window={scrollY:324};
  globalThis.location={hash:'#repository?q=KYC&page.instruments=2&size.instruments=25',href:'https://localhost:8010/#repository?q=KYC&page.instruments=2&size.instruments=25'};
  globalThis.history={state:{existing:'retained'},replaceState(value){this.state=value;}};
  rememberLibraryLocation('instrument');
  assert.equal(libraryReturnPath('instrument'),'repository?q=KYC&page.instruments=2&size.instruments=25');
  assert.equal(history.state.existing,'retained');
  assert.deepEqual(Object.keys(history.state.cbdLibraryReturn).sort(),['hash','ownerId','recordId','scrollY']);
  assert.equal(history.state.cbdLibraryReturn.scrollY,324);
  assert.equal(libraryReturnPath('different'),'repository');
  state.identity={user:{id:'someone-else'}};
  assert.equal(libraryReturnPath('instrument'),'repository');
 }finally{Object.assign(globalThis,{window:previous.window,location:previous.location,history:previous.history});state.identity=previous.identity;}
});
