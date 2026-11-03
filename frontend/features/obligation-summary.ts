/** Shared read-only summary for the workspace and mapped Excel validation preview. */
import { esc,ref,title,badge,date,statusTag,link,localDate } from '../ui/components.ts';
import { detailFields,table,recordCell } from '../ui/widgets.ts';
import { ownerRoles,ownerResponse,assignmentApproval,statusLabel,processRelationshipLabel,timestamp } from '../core/obligation-detail.ts';

/** One field definition feeds the reader, wizard review and import preview. */
const narrativeFields=[['statement','Requirement','What needs to be done'],['internal_interpretation','Internal interpretation','Bank’s interpretation'],['evidence_standard','Evidence requirement','Evidence required'],['breach_consequence','Breach consequence','Breach consequence']];
export function requirementEntries(o,reading=false){return narrativeFields.map(([key,label,readingLabel])=>[reading?readingLabel:label,o[key]]);}
export function classificationEntries(o){return [['Category',esc(ref('obligation_category',o.category_id))],['Domain',esc(ref('regulatory_domain',o.primary_domain_id))],['Frequency',esc(ref('frequency',o.frequency_id))],['Nature',esc(title(o.obligation_nature))]];}

export function obligationSummary(o,stage=o.approval_status||'PROPOSED'){
  return detailFields([
    ...(o.code?[['Obligation reference',esc(o.code)+' · revision '+esc(o.version_number)]]:[]),
    ...(o.legacy_codes?.length?[['Legacy references',o.legacy_codes.map(esc).join(', ')]]:[]),
    ['Title',esc(o.title)],['Status',badge(o.record_status==='DRAFT'?stage:o.record_status||stage)],
    ...requirementEntries(o).map(([label,value])=>[label,`<div class="source-wording">${esc(value)}</div>`,true]),
    ...classificationEntries(o),['Criticality',badge(o.criticality)],
    ['Lead regulatory department',esc(ref('organisational_unit',o.regulatory_owner_unit_id))],
    ['Accountable business department',esc(ref('organisational_unit',o.business_owner_unit_id))],
    ['Compliance reviewer',esc(ref('user',o.compliance_reviewer_user_id))],
    ['Effective period',date(o.effective_from)+' → '+(o.effective_to?date(o.effective_to):'Open-ended')],
    ['Next review',date(o.next_review_date)],...(o.content_validation_status?[['Content validation',badge(o.content_validation_status)]]:[]),
  ]);
}

function registerObligation(row,context,tab){
  const o=row.obligation,query=new URLSearchParams({tab});if(context.returnPath)query.set('return_to',context.returnPath);
  const status=statusLabel(o,o.approval_status,localDate());
  return recordCell(o.code+' · Revision '+o.version_number,o.title,'obligations/'+o.id+'?'+query)+statusTag(status.label,status.tone);
}

export function ownershipSummary(rows,tableOptions={},context:any={}){
  const tasks=context.tasks||[],versions=context.versions||[];
  const history=Boolean(context.history);
  return table([...(context.register?['Obligation']:[]),...(history?['Revision / recorded on']:[]),'Role','Department',history?'Previous owner':'Named owner','Owner response','Assignment approval','Effective period'],rows.map(r=>{
    const version=versions.find(v=>v.id===r.obligation_id);
    const last=tasks.filter(t=>t.owner_id===r.id).at(-1);
    const decision=r.validation_decision||(last?(last.decision||'PENDING'):r.owner_role==='REGULATORY'&&r.user_id===version?.created_by?'PROPOSED_BY_MAKER':r.owner_role==='COMPLIANCE_REVIEWER'&&['REVIEWED','APPROVED'].includes(r.approval_status)?'REVIEW_ACCEPTED':'NOT_STARTED');
    const response=ownerResponse({...r,validation_decision:decision},r.validation_task||last),approval=assignmentApproval(r.approval_status);
    const recorded=timestamp(r.created_at);
    const recordedOn=recorded?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(recorded):'Date not recorded';
    return [...(context.register?[registerObligation(r,context,'owners')]:[]),...(history?[esc('Revision '+(version?.version_number||'not recorded'))+'<small>Saved on '+esc(recordedOn)+'</small>']:[]),
      esc(ownerRoles[r.owner_role]||title(r.owner_role))+(r.primary_owner_flag?'<small>Primary owner</small>':''),
      esc(r.department_name||ref('organisational_unit',r.org_unit_id)),r.user_id?esc(r.owner_name||ref('user',r.user_id)):'Not assigned',
      statusTag(response.label,response.tone)+(last?.comments?'<small>'+esc(last.comments)+'</small>':''),statusTag(approval.label,approval.tone)+(r.ended_by_change_id?'<small>Previous assignment · replaced</small>':''),
      r.effective_from?(r.approval_status==='APPROVED'?'Approved from ':'Proposed from ')+date(r.effective_from)+'<small>'+(r.ended_by_change_id?'Replaced from '+date(r.replacement_effective_from):r.effective_to?'Ends before '+date(r.effective_to):'No end date')+'</small>':'Set with the obligation dates'];
  }),tableOptions);
}

export function applicabilitySummary(rows,tableOptions={},context:any={}){return table([...(context.register?['Obligation']:[]),'Scope','Assessment','Basis / limitations','Assessed by','Review / approval','Next review'],rows.map(a=>[
  ...(context.register?[registerObligation(a,context,'applicability')]:[]),
  ['legal_entity','organisational_unit','product','process','channel','customer_segment','geography'].map((key,i)=>{
    const name=['legal_entity_id','org_unit_id','product_id','process_id','channel_id','customer_segment_id','geography_id'][i];
    return a[name]?`<small>${esc(title(key))}: ${esc(a.scope?.[key]||ref(key,a[name]))}</small>`:'';
  }).join(''),badge(a.applicability_status),esc(a.basis)+(a.conditions?'<p>'+esc(a.conditions)+'</p>':''),
  a.assessed_by?esc(a.assessor_name||ref('user',a.assessed_by))+'<small>'+date(a.assessed_date)+'</small>':'Proposed assessment',
  statusTag(assignmentApproval(a.approval_status).label,assignmentApproval(a.approval_status).tone)+(a.reviewed_by?'<small>Reviewed by '+esc(ref('user',a.reviewed_by))+'</small>':'')+(a.approved_by?'<small>Approved by '+esc(ref('user',a.approved_by))+'</small>':''),date(a.next_review_date),
]),tableOptions);}

export function processSummary(rows,tableOptions={}){return table(['Process','How this process relates to the obligation','Process criticality'],rows.map(p=>[
  esc(ref('process',p.process_id)),esc(processRelationshipLabel(p.relevance_type)),badge(p.criticality),
]),tableOptions);}
