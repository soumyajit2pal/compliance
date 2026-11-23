import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {obligationReturnPath} from '../core/obligation-detail.ts';
import {ownershipSummary,applicabilitySummary} from '../features/obligation-summary.ts';
state.masters={user:[],organisational_unit:[]};
const obligation={id:'o',code:'INS-RBI-REG-KYC-ACT-2026-001-C001-OBL-001',title:'Check customer records',version_number:2,record_status:'DRAFT',approval_status:'DRAFT',effective_from:'2026-11-01'};
test('return paths preserve register filters and pagination while rejecting other routes/schemes',()=>{
 assert.equal(obligationReturnPath('accountability?role=BUSINESS&page.accountability=2'),'accountability?role=BUSINESS&page.accountability=2');
 for(const value of ['https://example.com','javascript:alert(1)','obligations/x','//accountability','users?admin=1'])assert.equal(obligationReturnPath(value),'');
 assert(!obligationReturnPath('applicability?q=" onmouseover="x').includes('"'));
});
test('accountability reuses the owner summary with the correct obligation tab and retained return context',()=>{
 const html=ownershipSummary([{obligation,owner_role:'BUSINESS',user_id:'u',owner_name:'Named owner <unsafe>',org_unit_id:'d',department_name:'Retail',approval_status:'REVIEWED',validation_decision:'ACCEPT'}],{pageKey:'accountability'},{register:true,returnPath:'accountability?role=BUSINESS&page.accountability=2'});
 assert(html.includes('tab=owners'));assert(html.includes('return_to=accountability'));assert(html.includes(obligation.code));assert(html.includes('Revision 2'));
 assert(html.includes('Accepted'));assert(html.includes('Awaiting final approval'));assert(html.includes('Named owner &lt;unsafe&gt;'));assert(!html.includes('Named owner <unsafe>'));
});
test('applicability register links to the existing assessment workflow and retains partial conditions',()=>{
 const html=applicabilitySummary([{obligation,legal_entity_id:'le',org_unit_id:'u',scope:{legal_entity:'Bank',organisational_unit:'Retail'},applicability_status:'PARTIALLY_APPLICABLE',basis:'The source applies.',conditions:'Only the listed channel.',approval_status:'DRAFT'}],{pageKey:'applicability'},{register:true,returnPath:'applicability?assessment=PARTIALLY_APPLICABLE'});
 assert(html.includes('tab=applicability'));assert(html.includes('return_to=applicability'));assert(html.includes('Only the listed channel.'));assert(html.includes('Retail'));assert(html.includes('Proposed'));assert(!html.includes('New assessment'));
});
test('closed ownership tasks in the cross-register view do not appear as current pending responses',()=>{
 const html=ownershipSummary([{obligation,id:'owner',owner_role:'BUSINESS',approval_status:'DRAFT',validation_decision:'PENDING',validation_task:{workflow_status:'WITHDRAWN'}}],{}, {register:true});
 assert(html.includes('Not requested yet'));assert(!html.includes('Awaiting response'));
});
