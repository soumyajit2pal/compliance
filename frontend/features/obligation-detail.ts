/** Obligation reading experience, shared with existing summary, table and pagination components. */
import { esc,title,ref,badge,button,link,date,localDate,statusTag } from '../ui/components.ts';
import { panel,table,tabs,pagedCollection } from '../ui/widgets.ts';
import { icon } from '../ui/icons.ts';
import { detailTab,statusLabel,activationChecklistItems,ownerRoles,decisionLabel,timestamp,stageLabel } from '../core/obligation-detail.ts';
import { ownershipSummary,applicabilitySummary,processSummary,requirementEntries,classificationEntries } from './obligation-summary.ts';
import { renderObligationApplicability } from './obligation-applicability.ts';
import { partitionOwnerAssignments } from '../core/obligation-ownership.ts';
import { renderLinkedRegulatoryClauses } from './obligation-sources.ts';
import { obligationExportButton } from '../ui/obligation-export.ts';

const sectionNames={owners:'owners',applicability:'where it applies',sources:'sources & processes',history:'history & decisions',evidence:'evidence requirement',requirement:'requirement'};
const compactEmpty=(text)=>`<p class="obligation-empty-state">${esc(text)}</p>`;
const fields=(entries)=>`<dl class="obligation-definition-list">${entries.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${value||'Not recorded'}</dd></div>`).join('')}</dl>`;
const when=(value)=>{const parsed=timestamp(value);return parsed?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(parsed):'Date not recorded';};
const revisionOf=(d,id)=>d.versions.find(v=>v.id===id)?.version_number;
function editLink(d,section,label,css='small'){return link('obligations/'+d.obligation.id+'?edit=1&section='+section,label,'btn '+css);}
function viewLink(d,section,label=''){return link('obligations/'+d.obligation.id+'?tab='+(['evidence','requirement'].includes(section)?'overview':section),label||'View '+sectionNames[section],'btn small');}
function nextStep(d,p,today){
  const o=d.obligation;
  if(o.record_status==='SUPERSEDED')return {heading:'This revision has been replaced',text:'Use History & decisions to open the newer revision.'};
  if(o.approval_status==='WITHDRAWN'&&['DRAFT','RETIRED'].includes(o.record_status))return {heading:'This Draft was cancelled',text:'It cannot be submitted. Its details and decisions remain available for reference.'};
  if(o.record_status==='RETIRED')return {heading:'This obligation is retired',text:'The record and its decisions remain available for reference.'};
  if(p.ownerChangeTasks?.length)return {heading:'Your response to an ownership change is needed',text:'Review the proposed assignments in Owners. Current ownership stays effective until the separate request receives final approval.'};
  if(o.record_status==='ACTIVE')return {heading:'Approved and active',text:'Ownership and applicability are approved. Active does not mean implementation is complete.'};
  if(o.approval_status==='APPROVED'){
    if(o.effective_to&&o.effective_to<=today)return {heading:'The approved period has ended',text:'This revision can no longer be activated. A changed requirement needs a new revision.'};
    if(o.effective_from>today)return {heading:'Approved · starts '+date(o.effective_from),text:'It is not Active yet. Activation becomes available to an authorised Approver when the effective period starts.'};
    if(activationChecklistItems(d,p,today).some(r=>r.kind==='attention'))return {heading:'Resolve the outstanding checks before activation',text:'Approval is retained. Review the items below before an authorised Approver activates this obligation.'};
    return {heading:p.canActivate?'Ready for activation':'Waiting for an authorised Approver to activate',text:p.canActivate?'The approved period has started. Activate after checking the approved details.':'The approved period has started. No activation action is available to your role.'};
  }
  if(p.assigned.length&&!p.mine.length)return {heading:'Your assigned task needs an access check',text:'Your current role or access to a cited source no longer permits this decision. Contact your administrator.'};
  if(p.mine.length)return {heading:({COMPLIANCE_REVIEW:'Your Compliance review is needed',BUSINESS_VALIDATION:'Your ownership and applicability response is needed',FINAL_APPROVAL:'Your final decision is needed'})[p.stage]||'Your response is needed',text:p.stage==='BUSINESS_VALIDATION'?'Review the requirement, your owner assignment and the applicability assessments before accepting or requesting changes.':'Review the requirement, owners, applicability and sources before recording your decision.'};
  if(p.open.length){
    const names=[...new Set(p.open.map(t=>ref('user',t.assignee_user_id)))];
    return {heading:'Waiting for '+names.join(', '),text:({COMPLIANCE_REVIEW:'Compliance review is pending.',BUSINESS_VALIDATION:'Named owner responses are pending.',FINAL_APPROVAL:'Independent final approval is pending.'})[p.stage]+' No response is needed from you at this stage.'};
  }
  if(o.approval_status==='REJECTED')return {heading:'This proposal was rejected',text:'Read the decision basis in History & decisions.'+(p.canRevise?' Create a new Draft revision if a replacement is needed.':' No response is needed from you.')};
  return {heading:p.canEdit?'Complete the Draft and submit for review':'Draft preparation is in progress',text:p.canEdit?'Check the setup below, then choose an independent final approver when submitting.':'The author prepares and submits this proposal. No response is needed from you.'};
}
function workflowActions(d,p){
  const o=d.obligation;
  let result=p.canEdit?editLink(d,'source','Edit Draft')+button('obl-submit','Submit for review','','primary'):'';
  if(p.ownerChangeTasks?.length)result+=viewLink(d,'owners','View ownership request');
  if(p.canActivate)result+=button('obl-activate','Activate approved obligation',activationChecklistItems(d,p,localDate()).length?'disabled aria-describedby="obligation-readiness-title"':'','primary');
  for(const task of p.mine){
    const choices=task.stage==='COMPLIANCE_REVIEW'?['REVIEW','RETURN','REJECT','DELEGATE']:task.stage==='BUSINESS_VALIDATION'?['ACCEPT','OBJECT']:['APPROVE','RETURN','REJECT','DELEGATE'];
    const action=choice=>button('obl-decision',choice==='ACCEPT'?(p.mine.length>1?'Review and accept · '+(ownerRoles[task.owner_role]||'owner'):'Review and accept'):({REVIEW:'Complete Compliance review',OBJECT:'Request changes',APPROVE:'Approve obligation',RETURN:'Return to author',REJECT:'Reject proposal',DELEGATE:'Delegate review'})[choice],`data-decision="${choice}" data-task="${esc(task.id)}"`,['REVIEW','ACCEPT','APPROVE'].includes(choice)?'primary':'');
    result+=choices.filter(choice=>['REVIEW','ACCEPT','OBJECT','APPROVE'].includes(choice)).map(action).join('');
    const other=choices.filter(choice=>!['REVIEW','ACCEPT','OBJECT','APPROVE'].includes(choice));
    if(other.length)result+=`<details class="obligation-other-decisions"><summary>Other decisions</summary><div>${other.map(action).join('')}</div></details>`;
  }
  return result;
}
export function obligationLifecycle(d,p){
  const o=d.obligation,terminal=['SUPERSEDED','RETIRED'].includes(o.record_status)||['REJECTED','WITHDRAWN'].includes(o.approval_status);
  if(terminal)return '';
  const phase=o.approval_status==='APPROVED'?4:({COMPLIANCE_REVIEW:1,BUSINESS_VALIDATION:2,FINAL_APPROVAL:3})[p.stage]??0;
  return `<ol class="obligation-lifecycle-strip" aria-label="Obligation lifecycle">${['Prepare','Compliance review','Owner acceptance','Final approval'].map((label,index)=>`<li class="${phase===index?'is-current':phase>index?'is-complete':''}" ${phase===index?'aria-current="step"':''}>${phase>index?icon('check'):index+1+'.'} ${esc(label)}${phase===index?'<span class="sr-only"> · current stage</span>':''}</li>`).join('')}</ol>`;
}
function readiness(d,p){
  const o=d.obligation;
  if(['SUPERSEDED','RETIRED'].includes(o.record_status)||['WITHDRAWN','REJECTED'].includes(o.approval_status))return '';
  const items=activationChecklistItems(d,p,localDate());
  if(!items.length)return o.record_status==='ACTIVE'?'':`<section class="obligation-readiness checklist-complete" aria-labelledby="obligation-readiness-title"><header><div><h2 id="obligation-readiness-title">Activation checklist — all checks complete</h2><p>${p.canActivate?'An authorised Approver can now activate this obligation.':'Waiting for an authorised Approver to activate this obligation.'}</p></div>${icon('check')}</header></section>`;
  const attention=items.filter(r=>r.kind==='attention').length,pending=items.length-attention;
  const counts=[attention?attention+' '+(attention===1?'item needs':'items need')+' setup or review':'',pending?pending+' '+(pending===1?'response, decision or date is':'responses, decisions or dates are')+' pending':''].filter(Boolean).join(' · ');
  const rows=items.map(item=>{
    const task=item.task,mine=task&&p.mine.some(t=>t.id===task.id);
    const decision=task?.stage==='COMPLIANCE_REVIEW'?'REVIEW':task?.stage==='FINAL_APPROVAL'?'APPROVE':'ACCEPT';
    let action=mine?button('obl-decision',({ACCEPT:'Review and accept',REVIEW:'Complete Compliance review',APPROVE:'Approve obligation'})[decision],`data-decision="${decision}" data-task="${esc(task.id)}"`,'small'):'';
    if(!action&&p.canAssignOwners&&item.kind==='attention'&&item.section==='owners')action=button('obl-assign-owner','Assign / reassign owner','','small');
    if(!action&&p.canEdit&&item.key==='MISSING_PROCESS_MAPPING')action=editLink(d,'applicability','Add process');
    if(!action&&p.canEdit&&item.kind==='attention')action=item.section==='owners'?button('obl-assign-owner','Assign / reassign owner','','small'):editLink(d,item.section==='sources'?'source':item.section==='history'?'requirement':item.section,item.section==='applicability'?'Add or edit assessment':item.section==='sources'?'Check sources & processes':'Edit '+sectionNames[item.section]);
    if(!action)action=viewLink(d,item.section);
    const owner=item.owner;
    const context=owner?ref('user',owner.user_id)+' · '+ref('organisational_unit',owner.org_unit_id):task?ref('user',task.assignee_user_id):item.startsOn?'Starts '+date(item.startsOn):'';
    return `<li class="obligation-check" data-check-key="${esc(item.key)}"><div class="obligation-check-row"><div><strong>${esc(item.message||item.label)}</strong>${context?`<small>${esc(context)}</small>`:''}</div><span>${statusTag(item.status,item.kind==='attention'?'amber':'neutral')}</span><div class="obligation-check-action">${action}</div></div></li>`;
  });
  return `<section class="obligation-readiness needs-attention" aria-labelledby="obligation-readiness-title"><header><div><h2 id="obligation-readiness-title">${o.record_status==='ACTIVE'?'Review checklist':'Activation checklist'} — ${items.length} ${items.length===1?'item':'items'} outstanding</h2><p>${esc(counts)}</p></div>${icon('alert')}</header><ul class="obligation-checks" aria-label="Outstanding ${o.record_status==='ACTIVE'?'review':'activation'} checks">${rows.join('')}</ul></section>`;
}
export function renderObligationOverview(d){
  const o=d.obligation,primaryOwner=d.owners.find(r=>r.owner_role==='BUSINESS'&&r.primary_owner_flag),instrument=d.instrument,clause=d.clause;
  const source=instrument?link('repository/'+instrument.id+'?version='+d.edition.id,instrument.title)+`<small>${esc(instrument.code)}</small>`:'Source unavailable';
  const sourceClause=clause?link('clauses?instrument='+instrument.id+'&edition='+d.edition.id+'&clause='+clause.id,(clause.source_clause_reference?clause.source_clause_reference+' · ':'')+clause.heading)+`<small>${esc(clause.code)} · Edition ${esc(d.edition.version_number)}</small>`:'Source unavailable';
  const key=fields([
    ['Instrument',source],['Primary clause',sourceClause],
    ...classificationEntries(o),
    ['Accountable department',esc(ref('organisational_unit',o.business_owner_unit_id))],
    ['Primary business owner',primaryOwner?.user_id?esc(ref('user',primaryOwner.user_id)):'Not assigned'],
    ['Lead regulatory department',esc(ref('organisational_unit',o.regulatory_owner_unit_id))],['Compliance reviewer',esc(ref('user',o.compliance_reviewer_user_id))],
    ['Effective period',(o.effective_from?'From '+date(o.effective_from):'Start not recorded')+'<small>'+(o.effective_to?'Ends before '+date(o.effective_to):'No end date')+'</small>'],
    ['Next review',o.next_review_date?date(o.next_review_date):'Not scheduled'],
    ['Approved by',o.approved_by?esc(ref('user',o.approved_by))+'<small>'+when(o.approved_at)+'</small>':['REJECTED','WITHDRAWN'].includes(o.approval_status)?'Not approved':o.approval_status==='APPROVED'?'Approver not recorded':'Awaiting approval'],
    ...(o.legacy_codes?.length?[['Legacy references',o.legacy_codes.map(esc).join('<br>')]]:[]),
  ]);
  const wording=requirementEntries(o,true).map(([label,value])=>`<section class="obligation-wording"><h3>${esc(label)}</h3><div class="source-wording">${esc(value)||'Not recorded'}</div></section>`).join('');
  const flags=['testing','certification','reporting','retention'].filter(k=>o[k+'_required_flag']).map(k=>title(k));
  return `<div class="obligation-overview-grid">${panel('Key details',key)}${panel('Requirement',wording+(flags.length?'<p class="obligation-flags-summary"><strong>Also required:</strong> '+esc(flags.join(', '))+'</p>':''))}</div>`;
}
function sources(d,p){
  return renderLinkedRegulatoryClauses(d.citations)+
    panel('Processes',d.processes.length?processSummary(d.processes,{pageKey:'obligation-processes'}):compactEmpty('No processes mapped.'),{action:p.canEdit?editLink(d,'applicability','Manage processes'):'',sub:'The processes affected by this requirement.'});
}
function fold(label,body){return `<details class="panel obligation-history-detail"><summary>${esc(label)}</summary><div class="panel-body">${body}</div></details>`;}
function ownershipRequest(change,d,p,history=false){
  const label=change.workflow_status==='RETURNED'?'Returned for changes':change.approval_status==='APPROVED'?'Approved and applied':change.workflow_status==='WITHDRAWN'?'Withdrawn':change.workflow_status==='REJECTED'?'Rejected':stageLabel(change.stage);
  const tasks=change.tasks||[];
  const rows=change.assignments.map(item=>{
    const task=tasks.find(t=>t.id===item.task_id);
    const notRequested=item.previous_owner_id?'Existing assignment retained':item.owner_role==='REGULATORY'&&item.user_id===change.created_by?'Proposed by request author':change.workflow_status==='OPEN'?'After Compliance review':'Not requested · request closed';
    return [esc(ownerRoles[item.owner_role])+(item.primary_owner_flag?'<small>Primary</small>':''),esc(ref('organisational_unit',item.org_unit_id)),esc(ref('user',item.user_id)),item.previous_owner_id?'Unchanged assignment':'New / reassigned',task?statusTag(task.decision==='ACCEPT'?'Accepted':task.decision==='OBJECT'?'Changes requested':change.workflow_status==='OPEN'?'Awaiting response':'Closed',task.decision==='ACCEPT'?'green':'neutral'):esc(notRequested)];
  });
  let actions='';
  if(!history&&change.obligation_id===d.obligation.id){
    const mine=tasks.filter(t=>t.assignee_user_id===p.userId&&(change.actionable_task_ids||[]).includes(t.id));
    for(const task of mine){
      const choices=task.stage==='COMPLIANCE_REVIEW'?['REVIEW','RETURN','REJECT']:task.stage==='BUSINESS_VALIDATION'?['ACCEPT','OBJECT']:['APPROVE','RETURN','REJECT'];
      const assignment=change.assignments.find(item=>item.task_id===task.id);
      const suffix=mine.length>1&&assignment?' · '+ownerRoles[assignment.owner_role]+' · '+ref('organisational_unit',assignment.org_unit_id):'';
      actions+=choices.map(decision=>button('obl-ownership-decision',({REVIEW:'Complete Compliance review',ACCEPT:'Accept ownership change',OBJECT:'Request changes',APPROVE:'Approve ownership change',RETURN:'Return for changes',REJECT:'Reject request'})[decision]+suffix,`data-change="${esc(change.id)}" data-task="${esc(task.id)}" data-decision="${decision}"`,['REVIEW','ACCEPT','APPROVE'].includes(decision)?'primary':'')).join('');
    }
    if(change.created_by===p.userId&&p.canManageOwnershipRequests)actions+=button('obl-ownership-decision','Withdraw ownership request',`data-change="${esc(change.id)}" data-decision="WITHDRAW"`);
  }
  const context=fields([
    ['Status',statusTag(label,change.approval_status==='APPROVED'?'green':change.workflow_status==='OPEN'?'amber':'neutral')],
    ['Requested by',esc(ref('user',change.created_by))+'<small>'+when(change.created_at)+'</small>'],
    ['Accountable business department',esc(ref('organisational_unit',change.business_owner_unit_id))],
    ['Compliance reviewer',esc(ref('user',change.compliance_reviewer_user_id))],['Independent final Approver',esc(ref('user',change.approver_user_id))],
    ['Reason',esc(change.reason)],...(change.effective_from?[['Ownership effective from',date(change.effective_from)]]:[]),
  ]);
  const decisions=tasks.filter(task=>task.decision).map(task=>`<li><strong>${esc(stageLabel(task.stage))} · ${esc(decisionLabel(task.decision))}</strong><small>${esc(ref('user',task.acted_by||task.assignee_user_id))} · ${esc(when(task.acted_at))}</small><p>${esc(task.comments)}</p></li>`).join('');
  return panel(history?'Recorded ownership request':'Ownership change request',context+table(['Role','Department','Proposed owner','Change','Owner response'],rows,{pageKey:'ownership-request-'+change.id})+(actions?'<div class="obligation-ownership-actions">'+actions+'</div>':'')+(decisions?'<details class="ownership-request-decisions"><summary>Review decisions & comments</summary><ul>'+decisions+'</ul></details>':''),{
    cls:'obligation-ownership-request',sub:history?'The obligation revision was retained. Earlier assignments and decisions remain available.':'This request changes ownership only. Current assignments remain effective until final approval; the obligation revision stays unchanged.',
  });
}
function owners(d,p){
  const assignments=partitionOwnerAssignments(d.owners,d.ownership_history);
  const pending=(d.owner_changes||[]).filter(change=>change.obligation_id===d.obligation.id&&['IN_REVIEW','REVIEWED'].includes(change.approval_status));
  const old=(d.owner_changes||[]).filter(change=>!pending.includes(change));
  const earlier=assignments.history;
  const assignmentHistory=`<details class="panel obligation-history-detail obligation-assignment-history"><summary>Assignment history · ${earlier.length} earlier ${earlier.length===1?'assignment':'assignments'}</summary><div class="panel-body"><p class="obligation-assignment-history-help">Earlier saved assignments, including replaced owners, withdrawn proposals and assignments from earlier revisions. Current assignments are shown above.</p>${earlier.length?ownershipSummary(earlier,{pageKey:'obligation-owner-history',caption:'Earlier saved owner assignments'},{tasks:d.tasks,versions:d.versions,history:true}):compactEmpty('No earlier owner assignments. The current assignments have not been replaced or withdrawn.')}</div></details>`;
  return pending.map(change=>ownershipRequest(change,d,p)).join('')+panel('Owners',assignments.current.length?ownershipSummary(assignments.current,{pageKey:'obligation-owners'},{tasks:d.tasks,versions:d.versions}):compactEmpty('No owners assigned.'),{
    cls:'obligation-owner-panel',
    sub:d.obligation.approval_status==='APPROVED'?'Current assignments for this revision. Proposed ownership changes appear separately and take effect only after Compliance review, owner acceptance and final approval.':'People assigned to this proposal. Owner response and final approval are separate; these assignments are not yet approved.',
    action:p.canAssignOwners?button('obl-assign-owner','Assign / reassign owner','','primary'):'',
  })+(old.length?fold('Ownership change history · '+old.length,old.map(change=>ownershipRequest(change,d,p,true)).join('')):'')+assignmentHistory;
}
function applicability(d,p){
  return renderObligationApplicability(d,p.canEdit?editLink(d,'applicability','Add or edit assessment'):p.canRevise?button('obl-revise','Create revision to reassess','data-section="applicability"'):'');
}
function parsed(value){if(value&&typeof value==='object')return value;try{return JSON.parse(value||'null')||{};}catch{return {};}}
function eventLabel(action){return ({CREATED:'Draft created',IMPORTED_DRAFT:'Imported as Draft',DRAFT_EDITED:'Draft updated',OWNERS_UPDATED:'Owner assignments updated',OWNERSHIP_CHANGE_REQUESTED:'Ownership change requested',OWNERSHIP_CHANGE_APPLIED:'Ownership change applied',OWNERSHIP_REVIEW:'Ownership Compliance review completed',OWNERSHIP_ACCEPT:'Ownership change accepted',OWNERSHIP_OBJECT:'Ownership changes requested',OWNERSHIP_APPROVE:'Ownership change approved',OWNERSHIP_RETURN:'Ownership request returned',OWNERSHIP_REJECT:'Ownership request rejected',OWNERSHIP_WITHDRAW:'Ownership request withdrawn',REVISED:'Draft revision created',SUBMITTED:'Submitted for Compliance review',ACTIVATED:'Obligation activated',CANCELLED:'Draft cancelled',SOURCE_REASSESSMENT_REQUIRED:'Source change flagged',PROCESS_REASSESSMENT_REQUIRED:'Process change flagged',PRODUCT_REASSESSMENT_REQUIRED:'Product change flagged',DRAFT_CANCELLED:'Draft cancelled'})[action]||(decisionLabel(action)!==action?decisionLabel(action):title(action));}
const auditLabels={statement:'Requirement',evidence_standard:'Evidence required',primary_clause_id:'Primary clause',regulatory_owner_unit_id:'Lead regulatory department',business_owner_unit_id:'Accountable department',compliance_reviewer_user_id:'Compliance reviewer',primary_domain_id:'Domain',version_number:'Revision',edit_revision:'Draft edit revision',source_system:'Import source',import_reference:'Import reference',legacy_reference:'Existing register reference'};
function auditChanges(a){
  const before=parsed(a.old_value),after=parsed(a.new_value);
  const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
  const value=v=>v===null||v===undefined?'Not recorded':typeof v==='object'?JSON.stringify(v,null,2):String(v);
  return keys.length?`<details class="obligation-field-audit"><summary>View ${keys.length} recorded field${keys.length===1?'':'s'}</summary><dl>${keys.map(k=>`<div><dt>${esc(auditLabels[k]||title(k))}</dt><dd><span>Before</span><pre>${esc(value(before[k]))}</pre><span>After</span><pre>${esc(value(after[k]))}</pre></dd></div>`).join('')}</dl></details>`:'No field values recorded.';
}
function history(d){
  const events=[...d.audit].sort((a,b)=>(timestamp(b.event_at)?.getTime()||0)-(timestamp(a.event_at)?.getTime()||0));
  const items=events.map(a=>{
    const task=d.tasks.find(t=>t.id===parsed(a.new_value).task_id),version=revisionOf(d,a.entity_id);

    return `<article class="obligation-activity"><div class="obligation-activity-title"><strong>${esc(eventLabel(a.action))}</strong>${version?`<span class="obligation-revision">Revision ${esc(version)}</span>`:''}</div><p>${esc(ref('user',a.actor_user_id))}${task?.owner_role?' · '+esc(ownerRoles[task.owner_role]||title(task.owner_role)):''} · <time datetime="${esc(timestamp(a.event_at)?.toISOString()||'')}">${esc(when(a.event_at))}</time></p>${a.reason?`<blockquote>${esc(a.reason)}</blockquote>`:''}</article>`;
  });
  const timeline=items.length?pagedCollection(items,{pageKey:'obligation-decisions',label:'events',className:'obligation-activity-list'}):compactEmpty('No decisions or changes recorded yet.');
  const taskRows=d.tasks.map(t=>[esc('Revision '+(revisionOf(d,t.entity_id)||'not recorded')),esc(stageLabel(t.stage))+(t.owner_role?'<small>'+esc(ownerRoles[t.owner_role])+'</small>':''),esc(ref('user',t.assignee_user_id)),esc(when(t.due_at)),t.decision?esc(decisionLabel(t.decision)):t.workflow_status==='OPEN'&&t.stage===t.current_stage?statusTag('Awaiting response','amber'):'Closed without a decision',esc(t.comments)||'No comment recorded']);
  return panel('Decisions & changes',timeline,{sub:'Most recent first. Includes retained decisions and changes across visible revisions.'})+
    fold('Review assignments · '+d.tasks.length,taskRows.length?table(['Revision','Stage / role','Named person','Due','Decision','Comments'],taskRows,{pageKey:'obligation-review-assignments'}):compactEmpty('No review assignments yet.'))+
    fold('Status changes · '+d.history.length,d.history.length?pagedCollection(d.history.map(h=>`<article class="obligation-activity"><div class="obligation-transition">${h.previous_status?statusTag(stageLabel(h.previous_status)):'Record created'}${icon('arrow')}${statusTag(stageLabel(h.new_status))}</div><p>${esc(ref('user',h.changed_by))} · ${esc(when(h.changed_at))} · Revision ${esc(revisionOf(d,h.entity_id)||'not recorded')}</p>${h.reason?'<blockquote>'+esc(h.reason)+'</blockquote>':''}</article>`),{pageKey:'obligation-status-changes',label:'changes',className:'obligation-activity-list'}):compactEmpty('No status changes recorded.'))+
    fold('Revisions · '+d.versions.length,table(['Revision','Status','Effective from','Author'],d.versions.map(v=>[link('obligations/'+v.id,'Revision '+v.version_number)+(v.id===d.obligation.id?'<small>Viewing this revision</small>':''),statusTag(statusLabel(v,v.approval_status,localDate()).label,statusLabel(v,v.approval_status,localDate()).tone),date(v.effective_from),esc(ref('user',v.created_by))]),{pageKey:'obligation-revisions'}))+
    fold('Detailed audit',table(['When','Action','Changed by','Recorded values'],events.map(a=>[esc(when(a.event_at)),esc(eventLabel(a.action)),esc(ref('user',a.actor_user_id)),auditChanges(a)]),{pageKey:'obligation-audit',empty:'No field audit entries recorded.'})+
      table(['When','Status before','Status after','Changed by','Reason'],d.history.map(h=>[esc(when(h.changed_at)),h.previous_status?statusTag(stageLabel(h.previous_status)):'Record created',statusTag(stageLabel(h.new_status)),esc(ref('user',h.changed_by)),esc(h.reason)]),{pageKey:'obligation-status-history',caption:'Retained status changes'}));
}
export function renderObligationDetail(d,p,query,returnPath='obligations'){
  const o=d.obligation,today=localDate(),status=statusLabel(o,p.stage,today),guidance=nextStep(d,p,today),tab=detailTab(query.get('tab'));
  const recordActions=obligationExportButton(o.id)+(p.canRevise?button('obl-revise','Create revision'):'')+(p.canWithdraw?button('obl-decision','Withdraw to Draft','data-decision="WITHDRAW"'):'')+(p.canEdit?button('obl-cancel','Cancel Draft'):'');
  const contents=tab==='overview'?renderObligationOverview(d):tab==='owners'?owners(d,p):tab==='applicability'?applicability(d,p):tab==='sources'?sources(d,p):history(d);
  const checks=readiness(d,p),foldChecks=o.approval_status!=='APPROVED'&&checks;
  const checklist=foldChecks?`<details class="obligation-setup-checks"><summary>Setup and activation checks · ${activationChecklistItems(d,p,today).length} outstanding</summary>${checks}</details>`:checks;
  return `<article class="obligation-detail">${link(returnPath,obligationBackLabel(returnPath),'back-link')}
    <header class="obligation-detail-header page-header"><div><h1>${esc(o.title)}</h1><div class="obligation-reference"><code>${esc(o.code)}</code><button type="button" class="btn small" data-action="obl-copy-reference" aria-label="Copy obligation reference">Copy reference</button></div><div class="obligation-title-meta"><span>Revision ${esc(o.version_number)}</span>${statusTag(title(o.criticality),o.criticality==='CRITICAL'?'red':o.criticality==='HIGH'?'amber':'neutral')}</div></div>${recordActions?'<div class="obligation-record-actions">'+recordActions+'</div>':''}</header>
    ${obligationLifecycle(d,p)}<section class="obligation-next-step" aria-labelledby="obligation-next-step-title"><div class="obligation-status">${statusTag(status.label,status.tone)}</div><div class="obligation-guidance"><h2 id="obligation-next-step-title">${esc(guidance.heading)}</h2><p>${esc(guidance.text)}</p></div><div class="obligation-workflow-actions">${workflowActions(d,p)}</div></section>
    ${checklist}${tabs([['overview','Overview'],['owners','Owners',partitionOwnerAssignments(d.owners).current.length],['applicability','Where it applies',d.applicability.length],['sources','Sources & processes'],['history','History & decisions']],tab,'obligations/'+o.id,query)}<div class="obligation-tab-content">${contents}</div></article>`;
}
import { obligationBackLabel } from '../core/obligation-workspace.ts';
