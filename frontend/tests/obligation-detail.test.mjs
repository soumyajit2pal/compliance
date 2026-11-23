import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../core/state.ts';
import {detailPolicy,detailTab,statusLabel,ownerResponse,assignmentApproval,readinessItems,activationChecklistItems,timestamp} from '../core/obligation-detail.ts';
import {renderObligationDetail} from '../features/obligation-detail.ts';
import {ownershipSummary} from '../features/obligation-summary.ts';
state.masters={user:[{id:'maker',full_name:'Author'},{id:'business',full_name:'Business Owner'},{id:'control',full_name:'Control Owner'}],organisational_unit:[{id:'compliance',name:'Compliance Department'},{id:'retail',name:'Retail Department'}]};
const today='2026-11-02';
const draft=()=>({obligation:{id:'obl',code:'INS-RBI-REG-KYC-ACT-2026-001-C001-OBL-001',title:'Review account access',version_number:1,record_status:'DRAFT',approval_status:'DRAFT',created_by:'maker',regulatory_owner_unit_id:'compliance',business_owner_unit_id:'retail',effective_from:'2026-11-01',criticality:'HIGH',statement:'Review access monthly.',internal_interpretation:'Retain independent evidence.',evidence_standard:'Approved access report.'},versions:[{id:'obl',approval_status:'DRAFT',record_status:'DRAFT',version_number:1}],owners:[],ownership_history:[],applicability:[],applicability_history:[],processes:[],tasks:[],citations:[],issues:[],audit:[],history:[],instrument:{id:'ins',title:'Access controls',code:'INS-RBI-2026'},clause:{id:'child',heading:'Access review',code:'INS-RBI-2026-C002',source_clause_reference:'5.1'},edition:{id:'edition-2',version_number:'2.0'}});
const covers=(unit,roles)=>unit==='compliance'&&roles.includes('AUTHOR');
const policy=(d,user='maker',scope=covers)=>detailPolicy(d,user,scope,today);
const ownerTask=(id,user,role)=>({id,entity_id:'obl',stage:'BUSINESS_VALIDATION',current_stage:'BUSINESS_VALIDATION',workflow_status:'OPEN',assignee_user_id:user,owner_id:'owner-'+id,owner_role:role});
function ownerReview(){const d=draft();d.obligation.approval_status='REVIEWED';d.versions[0].approval_status='REVIEWED';d.tasks=[ownerTask('b','business','BUSINESS'),ownerTask('c','control','CONTROL')];d.owners=d.tasks.map(t=>({id:t.owner_id,owner_role:t.owner_role,org_unit_id:'retail',user_id:t.assignee_user_id,approval_status:'REVIEWED',validation_decision:'PENDING'}));return d;}
test('only the scoped Draft author can edit; no unrelated actor or historical task acquires actions',()=>{
 const d=draft();assert(policy(d).canEdit);assert(!policy(d,'business').canEdit);assert(!policy(d,'maker',()=>false).canEdit);
 d.tasks=[{...ownerTask('old','maker','BUSINESS'),entity_id:'old-revision'}];assert.equal(policy(d).open.length,0);assert(!policy(d).canWithdraw);
 d.obligation.record_status='RETIRED';assert(!policy(d).canEdit);
});
test('owner tasks require the exact current role, department and accessible citations',()=>{
 const d=ownerReview();let p=policy(d,'business',(unit,roles)=>unit==='retail'&&roles.includes('BUSINESS_OWNER'));
 assert.equal(p.mine.length,1);assert.equal(p.mine[0].owner_role,'BUSINESS');assert.equal(p.open.length,2);assert(!p.canEdit);
 assert.equal(policy(d,'business',()=>false).mine.length,0);
 d.citations=[{restricted:true}];assert.equal(policy(d,'business',()=>true).mine.length,0);
});
test('a completed owner response is not offered again; final approval waits for its assigned stage',()=>{
 const d=ownerReview();d.tasks[0].decision='ACCEPT';assert.equal(policy(d,'business',()=>true).mine.length,0);assert.equal(policy(d,'approver',()=>true).mine.length,0);
 d.tasks.push({...ownerTask('final','approver',''),stage:'FINAL_APPROVAL'});assert.equal(policy(d,'approver',()=>true).mine.length,0);
 for(const task of d.tasks)task.current_stage='FINAL_APPROVAL';assert.equal(policy(d,'approver',()=>true).mine.length,1);
});
test('future approval, ready activation, expired period and Active remain distinct',()=>{
 const d=draft();d.obligation.approval_status='APPROVED';d.versions[0].approval_status='APPROVED';d.obligation.effective_from='2026-12-01';
 assert.match(statusLabel(d.obligation,'APPROVED',today).label,/not yet effective/);assert(!policy(d,'approver',()=>true).canActivate);
 d.obligation.effective_from='2026-11-01';assert.match(statusLabel(d.obligation,'APPROVED',today).label,/awaiting activation/);assert(policy(d,'approver',()=>true).canActivate);
 d.obligation.effective_to=today;assert(!policy(d,'approver',()=>true).canActivate);assert.match(statusLabel(d.obligation,'APPROVED',today).label,/period ended/);
 d.obligation.record_status='ACTIVE';assert.equal(statusLabel(d.obligation,'APPROVED',today).label,'Active');assert(!policy(d,'approver',()=>true).canActivate);
});
test('only the current eligible approved revision can be revised; pending successors block another revision',()=>{
 const d=draft();d.obligation.approval_status='APPROVED';d.versions[0].approval_status='APPROVED';assert(policy(d).canRevise);
 d.versions.unshift({id:'next',approval_status:'DRAFT',record_status:'DRAFT',version_number:2});assert(!policy(d).canRevise);
 d.versions[0].approval_status='APPROVED';assert(!policy(d).canRevise);
 const rejected=draft();rejected.obligation.approval_status='REJECTED';rejected.versions[0].approval_status='REJECTED';assert(policy(rejected).canRevise);
});
test('readiness separates missing assignment and pending response; expected characteristics are not blockers',()=>{
 const d=ownerReview();d.issues=['MISSING_CONTROL_OWNER','PENDING_BUSINESS_VALIDATION','CONTENT_VALIDATION_PENDING','HIGH_CRITICAL','PARTIAL_APPLICABILITY','UNAPPROVED_NON_APPLICABILITY'];
 const items=readinessItems(d,policy(d));assert.equal(items.filter(i=>i.kind==='attention').length,1);assert.equal(items.filter(i=>i.kind==='pending').length,2);
 assert(items.some(i=>i.status==='Not assigned'));assert(items.some(i=>i.status==='Assigned · response pending'));assert(!items.some(i=>i.key==='HIGH_CRITICAL'||i.key==='PARTIAL_APPLICABILITY'));
});
test('proposed authors, completed review, owner acceptance and assignment approval are different facts',()=>{
 assert.equal(ownerResponse({validation_decision:'PROPOSED_BY_MAKER'}).label,'Proposed by author');
 assert.equal(ownerResponse({validation_decision:'REVIEW_ACCEPTED'}).label,'Review complete');
 assert.equal(ownerResponse({validation_decision:'ACCEPT'}).label,'Accepted');
 assert.equal(assignmentApproval('REVIEWED').label,'Awaiting final approval');
 const html=ownershipSummary([{owner_role:'REGULATORY',validation_decision:'PROPOSED_BY_MAKER',approval_status:'REVIEWED',user_id:'maker',org_unit_id:'compliance'}]);
 assert(html.includes('Proposed by author'));assert(html.includes('Awaiting final approval'));assert(!html.includes('Acceptance: Accepted'));
});
test('new tabs preserve old workflow deep links and reject unknown tab values',()=>{
 assert.equal(detailTab('workflow'),'history');assert.equal(detailTab('sources'),'sources');assert.equal(detailTab('<script>'),'overview');
});
test('reader uses the full reference, two overview cards, exact edition clause links and escaped content',()=>{
 const d=draft();d.obligation.title='<img src=x onerror=alert(1)>';d.obligation.statement='<script>unsafe</script>';
 const html=renderObligationDetail(d,policy(d),new URLSearchParams());
 assert(html.includes(d.obligation.code));assert(html.includes('Copy obligation reference'));assert(html.includes('Key details'));assert(html.includes('What needs to be done'));assert(html.includes('Evidence required'));
 assert(html.includes('#clauses?instrument=ins&edition=edition-2&clause=child'));assert(!html.includes('#clauses/child'));
 assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;script&gt;'));assert(html.includes('No end date'));assert(html.includes('Awaiting approval'));
 assert.equal((html.match(/class="tab /g)||[]).length,5);assert(!html.includes('Raise action'));assert(!html.includes('Map control'));assert(!html.includes('Actions &amp; evidence'));
});
test('waiting viewer sees the named person and no decision control; own task has an explicit response action',()=>{
 const d=ownerReview();const other=renderObligationDetail(d,policy(d),new URLSearchParams());assert(other.includes('Waiting for Business Owner, Control Owner'));assert(other.includes('No response is needed from you'));assert(!other.includes('data-decision="ACCEPT"'));
 const own=renderObligationDetail(d,policy(d,'business',()=>true),new URLSearchParams());assert(own.includes('Review and accept'));assert(own.includes('data-task="b"'));assert(!own.includes('data-task="c"'));
});
test('history is readable, paginated, escaped, and the technical audit is initially collapsed',()=>{
 const d=draft();d.audit=[{entity_id:'obl',action:'CREATED',actor_user_id:'maker',event_at:'2026-11-01T10:00:00',new_value:'{}'},{entity_id:'obl',action:'OBJECT',actor_user_id:'business',event_at:'2026-11-01T11:00:00',reason:'<img src=x>',new_value:'{}'}];
 const html=renderObligationDetail(d,policy(d),new URLSearchParams('tab=workflow'));
 assert(html.includes('Changes requested by owner'));assert(html.indexOf('Changes requested by owner')<html.indexOf('Draft created'));assert(html.includes('data-page-key="obligation-decisions"'));
 assert(html.includes('<time datetime="2026-11-01T11:00:00.000Z">'));assert(html.includes('<summary>Detailed audit</summary>'));assert(!/<details[^>]*open[^>]*><summary>Detailed audit/.test(html));assert(!html.includes('<img src=x>'));
});
test('audit timestamps without an offset are interpreted as UTC and explicit offsets are preserved',()=>{
 assert.equal(timestamp('2026-11-01T10:00:00').toISOString(),'2026-11-01T10:00:00.000Z');assert.equal(timestamp('2026-11-01T15:30:00+05:30').toISOString(),'2026-11-01T10:00:00.000Z');assert.equal(timestamp('not a date'),null);
});

test('cancelled Draft is distinct from a withdrawn review that returns to an editable Draft',()=>{
 const d=draft();d.obligation.approval_status='WITHDRAWN';d.versions[0].approval_status='WITHDRAWN';assert.equal(statusLabel(d.obligation,'WITHDRAWN',today).label,'Cancelled Draft');assert(!policy(d).canEdit);
 const html=renderObligationDetail(d,policy(d),new URLSearchParams());assert(html.includes('This Draft was cancelled'));assert(!html.includes('Complete the Draft and submit'));
 d.obligation.approval_status='DRAFT';assert(policy(d).canEdit);
});
test('old owner tasks cannot imply that a response is currently pending after a return or withdrawal',()=>{
 assert.equal(ownerResponse({validation_decision:'PENDING',approval_status:'DRAFT'},{workflow_status:'WITHDRAWN'}).label,'Not requested yet');
 assert.equal(ownerResponse({validation_decision:'ACCEPT',approval_status:'DRAFT'}).label,'Accepted in an earlier review');
 assert.equal(ownerResponse({validation_decision:'PENDING',approval_status:'REJECTED'},{workflow_status:'REJECTED'}).label,'Closed without a response');
});

test('status changes remain their own recorded events rather than guessed matches to nearby edits',()=>{
 const d=draft();d.audit=[{entity_id:'obl',action:'DRAFT_EDITED',actor_user_id:'maker',event_at:'2026-11-01T10:00:00.100',reason:'Edited wording'}];d.history=[{entity_id:'obl',previous_status:'DRAFT',new_status:'COMPLIANCE_REVIEW',changed_by:'maker',changed_at:'2026-11-01T10:00:00.200',reason:'Submitted separately'}];
 const html=renderObligationDetail(d,policy(d),new URLSearchParams('tab=history'));
 assert(html.includes('Draft updated'));assert(html.includes('<summary>Status changes · 1</summary>'));assert(html.includes('Submitted separately'));assert(!html.slice(0,html.indexOf('<summary>Review assignments')).includes('obligation-transition'));
});

test('activation checklist separates missing setup, future acceptance and applicability approval without characteristic warnings',()=>{
 const d=draft();d.issues=['MISSING_CONTROL_OWNER','PARTIAL_APPLICABILITY','HIGH_CRITICAL'];
 d.owners=[{id:'b',owner_role:'BUSINESS',primary_owner_flag:1,org_unit_id:'retail',user_id:'business',approval_status:'DRAFT',validation_decision:'ACCEPT'}];
 d.tasks=[{...ownerTask('old','business','BUSINESS'),owner_id:'b',decision:'ACCEPT',workflow_status:'WITHDRAWN'}];
 d.applicability=[{approval_status:'DRAFT',applicability_status:'PARTIALLY_APPLICABLE'}];
 const items=activationChecklistItems(d,policy(d),today);
 assert.equal(items.length,4);assert.equal(new Set(items.map(i=>i.key)).size,4);
 assert(items.some(i=>i.key==='MISSING_CONTROL_OWNER'&&i.status==='Not assigned'));
 assert(items.some(i=>i.key==='owner-acceptance-b'&&i.status==='After Compliance review'&&!i.task));
 assert(items.some(i=>i.key==='applicability-approval'));assert(!items.some(i=>['HIGH_CRITICAL','PARTIAL_APPLICABILITY'].includes(i.key)));
});
test('only current-revision and current-workflow responses remove an owner acceptance requirement',()=>{
 const d=ownerReview();d.tasks.unshift({...ownerTask('old','business','BUSINESS'),owner_id:'owner-b',decision:'ACCEPT',workflow_status:'RETURNED'});
 d.tasks.unshift({...ownerTask('prior','control','CONTROL'),owner_id:'owner-c',entity_id:'prior-revision',decision:'ACCEPT'});
 assert.equal(activationChecklistItems(d,policy(d),today).filter(i=>i.key.startsWith('owner-acceptance-')).length,2);
 d.tasks.find(t=>t.id==='b').decision='ACCEPT';
 const items=activationChecklistItems(d,policy(d),today);assert(!items.some(i=>i.key==='owner-acceptance-owner-b'));assert(items.some(i=>i.task?.id==='c'));
});
test('author-proposed Regulatory responsibility does not invent an acceptance task; other named roles still need one',()=>{
 const d=draft();d.owners=[{id:'maker-reg',owner_role:'REGULATORY',primary_owner_flag:1,user_id:'maker',org_unit_id:'compliance',approval_status:'DRAFT'},{id:'other-reg',owner_role:'REGULATORY',user_id:'other',org_unit_id:'compliance',approval_status:'DRAFT'},{id:'reviewer',owner_role:'COMPLIANCE_REVIEWER',user_id:'reviewer',org_unit_id:'compliance',approval_status:'DRAFT'}];
 const items=activationChecklistItems(d,policy(d),today);
 assert(!items.some(i=>i.key==='owner-acceptance-maker-reg'||i.key==='owner-acceptance-reviewer'));assert(items.some(i=>i.key==='owner-acceptance-other-reg'));assert(items.some(i=>i.key==='compliance-review'));
});
test('approved applicability is complete; future starts and ended periods are explicit, and Active only lists actual review issues',()=>{
 const d=draft();d.obligation.approval_status='APPROVED';d.obligation.effective_from='2026-12-01';d.versions[0].approval_status='APPROVED';d.applicability=[{approval_status:'APPROVED'}];
 d.owners=[{id:'b',owner_role:'BUSINESS',primary_owner_flag:1,user_id:'business',org_unit_id:'retail',approval_status:'APPROVED',validation_decision:'ACCEPT'}];
 assert.deepEqual(activationChecklistItems(d,policy(d),today).map(i=>i.key),['effective-start']);
 assert.equal(activationChecklistItems(d,policy(d),'2026-12-01').length,0);
 d.obligation.effective_to='2026-12-02';assert.deepEqual(activationChecklistItems(d,policy(d),'2026-12-02').map(i=>i.key),['effective-period-ended']);
 d.obligation.record_status='ACTIVE';assert.equal(activationChecklistItems(d,policy(d),today).length,0);
 d.issues=['REVIEW_OVERDUE'];assert.deepEqual(activationChecklistItems(d,policy(d),today).map(i=>i.key),['REVIEW_OVERDUE']);
});
test('checklist shows the exact visible count and owner popup action, a completed state, and no activation prompt for terminal records',()=>{
 const d=draft();d.issues=['MISSING_BUSINESS_OWNER','MISSING_CONTROL_OWNER','MISSING_APPLICABILITY'];
 const html=renderObligationDetail(d,policy(d),new URLSearchParams());
 assert(html.includes('Activation checklist — 4 items outstanding'));assert.equal((html.match(/class="obligation-check"/g)||[]).length,4);assert(html.includes('<ul class="obligation-checks"'));assert(html.includes('data-action="obl-assign-owner"'));
 d.obligation.approval_status='APPROVED';d.obligation.effective_from=today;d.versions[0].approval_status='APPROVED';d.issues=[];
 assert(renderObligationDetail(d,policy(d),new URLSearchParams()).includes('Activation checklist — all checks complete'));
 for(const [record,approval] of [['DRAFT','WITHDRAWN'],['DRAFT','REJECTED'],['SUPERSEDED','APPROVED'],['RETIRED','APPROVED']]){
  d.obligation.record_status=record;d.obligation.approval_status=approval;assert(!renderObligationDetail(d,policy(d),new URLSearchParams()).includes('Activation checklist'));
 }
});

test('approved owner changes are separate from obligation revisions, and a pending request blocks parallel changes',()=>{
 const d=draft();d.obligation.approval_status='APPROVED';d.obligation.record_status='ACTIVE';d.versions[0].approval_status='APPROVED';d.versions[0].record_status='ACTIVE';
 assert(policy(d).canAssignOwners);assert(policy(d).canRevise);
 d.owner_changes=[{id:'change',obligation_id:'obl',created_by:'maker',approval_status:'IN_REVIEW',stage:'COMPLIANCE_REVIEW',workflow_status:'OPEN',business_owner_unit_id:'retail',compliance_reviewer_user_id:'reviewer',approver_user_id:'approver',reason:'Change the named business owner.',assignments:[],tasks:[],actionable_task_ids:[]}];
 assert(!policy(d).canAssignOwners);assert(!policy(d).canRevise);assert.equal(d.versions.length,1);
 const html=renderObligationDetail(d,policy(d),new URLSearchParams('tab=owners'));
 assert(html.includes('Ownership change request'));assert(html.includes('Current assignments remain effective until final approval'));assert(!html.includes('data-action="obl-assign-owner"'));assert(html.includes('Withdraw ownership request'));
 d.owner_changes[0].approval_status='APPROVED';d.owner_changes[0].workflow_status='APPROVED';assert(policy(d).canAssignOwners);assert(policy(d).canRevise);
});
test('ownership request responses require the server-authorised exact recipient, independently from parent workflow tasks',()=>{
 const d=draft();d.obligation.approval_status='APPROVED';d.versions[0].approval_status='APPROVED';
 d.owner_changes=[{id:'change',obligation_id:'obl',approval_status:'REVIEWED',tasks:[{id:'own-task',assignee_user_id:'business',stage:'BUSINESS_VALIDATION'}],actionable_task_ids:['own-task']}];
 assert.equal(policy(d,'business',()=>true).ownerChangeTasks.length,1);assert.equal(policy(d,'maker',()=>true).ownerChangeTasks.length,0);
 assert.equal(policy(d,'business',()=>true).mine.length,0);
 d.owner_changes[0].obligation_id='other-revision';assert.equal(policy(d,'business',()=>true).ownerChangeTasks.length,0);
});
test('replaced approved assignments stay in history without being current department responsibilities',()=>{
 const html=ownershipSummary([{id:'old',obligation_id:'obl',owner_role:'BUSINESS',org_unit_id:'retail',user_id:'business',approval_status:'APPROVED',validation_decision:'ACCEPT',effective_from:'2026-10-01',effective_to:'2026-11-02',replacement_effective_from:'2026-11-02',ended_by_change_id:'change'}],{}, {history:true,versions:[{id:'obl',version_number:1}]});
 assert(html.includes('Previous assignment · replaced'));assert(html.includes('Accepted'));assert(html.includes('Approved'));assert(html.includes('Revision 1'));
});
test('one person accepting multiple roles sees the exact role and department on each request action',()=>{
 const d=draft();d.obligation.approval_status='APPROVED';d.obligation.record_status='ACTIVE';d.versions[0].approval_status='APPROVED';
 d.owner_changes=[{id:'change',obligation_id:'obl',created_by:'maker',approval_status:'REVIEWED',stage:'BUSINESS_VALIDATION',workflow_status:'OPEN',reason:'Change distinct role responsibilities.',tasks:[{id:'a',assignee_user_id:'business',stage:'BUSINESS_VALIDATION'},{id:'b',assignee_user_id:'business',stage:'BUSINESS_VALIDATION'}],actionable_task_ids:['a','b'],assignments:[{owner_role:'BUSINESS',user_id:'business',org_unit_id:'retail',task_id:'a'},{owner_role:'DATA',user_id:'business',org_unit_id:'compliance',task_id:'b'}]}];
 const html=renderObligationDetail(d,policy(d,'business',()=>true),new URLSearchParams('tab=owners'));
 assert(html.includes('Accept ownership change · Business owner · Retail Department'));assert(html.includes('Accept ownership change · Data owner · Compliance Department'));
});
