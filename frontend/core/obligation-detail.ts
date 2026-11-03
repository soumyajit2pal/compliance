/** Presentation policy only. The API remains authoritative for all decisions and activation. */
import { setupSectionSteps } from './obligation-setup.ts';
export const ownerRoles = {REGULATORY:'Regulatory owner',BUSINESS:'Business owner',CONTROL:'Control owner',EVIDENCE:'Evidence owner',DATA:'Data owner',COMPLIANCE_REVIEWER:'Compliance reviewer'};
export const processRelationshipChoices = [
  {id:'PRIMARY',name:'Primary — main process for this obligation'},
  {id:'DIRECT',name:'Direct — performs the required activity'},
  {id:'INDIRECT',name:'Indirect — affected through another process'},
  {id:'SUPPORTING',name:'Supporting — helps fulfil the requirement'},
];
export const processRelationshipLabel = value => processRelationshipChoices.find(row=>row.id===value)?.name || stageLabel(value);
const grants = {REGULATORY:'AUTHOR',BUSINESS:'BUSINESS_OWNER',CONTROL:'CONTROL_OWNER',EVIDENCE:'EVIDENCE_OWNER',DATA:'BUSINESS_OWNER',COMPLIANCE_REVIEWER:'REVIEWER'};
export const sectionSteps = setupSectionSteps;
export const detailTabs = ['overview','owners','applicability','sources','history'];
export function detailTab(value) { return value==='workflow'?'history':detailTabs.includes(value)?value:'overview'; }
export function detailPolicy(d, userId, covers, today) {
  const o=d.obligation;
  const workflows=(d.tasks||[]).filter(t=>t.entity_id===o.id&&t.workflow_status==='OPEN');
  const open=workflows.filter(t=>t.stage===t.current_stage&&!t.decision);
  const assigned=open.filter(t=>t.assignee_user_id===userId);
  const mine=assigned.filter(t=>{
    if((d.citations||[]).some(r=>r.restricted))return false;
    if(t.stage==='BUSINESS_VALIDATION') {
      const owner=(d.owners||[]).find(r=>r.id===t.owner_id);
      return !!owner&&covers(owner.org_unit_id,[grants[owner.owner_role]]);
    }
    return covers(o.regulatory_owner_unit_id,[t.stage==='COMPLIANCE_REVIEW'?'REVIEWER':'APPROVER']);
  });
  const author=covers(o.regulatory_owner_unit_id,['AUTHOR']);
  const pending=d.versions.some(v=>['DRAFT','IN_REVIEW','REVIEWED'].includes(v.approval_status));
  const latest=d.versions.find(v=>v.approval_status==='APPROVED'&&['ACTIVE','DRAFT'].includes(v.record_status))?.id||null;
  const ownerPending=(d.owner_changes||[]).some(change=>['IN_REVIEW','REVIEWED'].includes(change.approval_status));
  const ownerChangeTasks=(d.owner_changes||[]).filter(change=>change.obligation_id===o.id).flatMap(change=>change.tasks.filter(task=>task.assignee_user_id===userId&&(change.actionable_task_ids||[]).includes(task.id)).map(task=>({...task,change_id:change.id})));
  const revisable=!pending&&(o.approval_status==='APPROVED'?o.id===latest:o.approval_status==='REJECTED'&&(o.supersedes_obligation_id||null)===latest);
  const canEdit=author&&o.created_by===userId&&o.approval_status==='DRAFT'&&o.record_status==='DRAFT';
  return {stage:workflows[0]?.current_stage||o.approval_status,open,assigned,mine,
    canEdit,canAssignOwners:canEdit||author&&!pending&&!ownerPending&&o.id===latest&&o.approval_status==='APPROVED'&&['DRAFT','ACTIVE'].includes(o.record_status)&&(!o.effective_to||o.effective_to>today),
    canRevise:author&&revisable&&!ownerPending,ownerChangeTasks,userId,canManageOwnershipRequests:author,
    canWithdraw:author&&o.created_by===userId&&!!workflows.length,
    canActivate:o.approval_status==='APPROVED'&&o.record_status==='DRAFT'&&o.effective_from<=today&&(!o.effective_to||o.effective_to>today)&&covers(o.regulatory_owner_unit_id,['APPROVER']),
  };
}
export const stageLabel=(value)=>({BUSINESS_VALIDATION:'Owner acceptance',COMPLIANCE_REVIEW:'Compliance review',FINAL_APPROVAL:'Final approval',REVIEWED:'Compliance review complete',WITHDRAWN:'Withdrawn to Draft',RETURNED:'Returned to author',APPROVED:'Approved',ACTIVE:'Active',DRAFT:'Draft'})[value]||String(value||'Not recorded').replace(/_/g,' ').toLowerCase().replace(/^./,letter=>letter.toUpperCase());
export function statusLabel(o, stage, today) {
  if(o.approval_status==='WITHDRAWN'&&['DRAFT','RETIRED'].includes(o.record_status))return {label:'Cancelled Draft',tone:'neutral'};
  if(o.record_status!=='DRAFT')return {label:({ACTIVE:'Active',SUPERSEDED:'Superseded',RETIRED:'Retired'})[o.record_status]||o.record_status,tone:o.record_status==='ACTIVE'?'green':'neutral'};
  if(o.approval_status==='APPROVED')return {label:o.effective_to&&o.effective_to<=today?'Approved · period ended':o.effective_from>today?'Approved · not yet effective':'Approved · awaiting activation',tone:'green'};
  return {label:({DRAFT:'Draft',COMPLIANCE_REVIEW:'Compliance review',BUSINESS_VALIDATION:'Owner acceptance',FINAL_APPROVAL:'Final approval',REJECTED:'Rejected',WITHDRAWN:'Withdrawn'})[stage]||'In review',tone:stage==='REJECTED'?'red':stage==='DRAFT'?'neutral':'amber'};
}
export function ownerResponse(owner, task=null) {
  const status=owner.validation_decision||'NOT_STARTED';
  if(status==='ACCEPT'&&owner.approval_status==='DRAFT')return {label:'Accepted in an earlier review',tone:'neutral'};
  if(status==='PENDING'&&task&&task.workflow_status!=='OPEN')return {label:owner.approval_status==='DRAFT'?'Not requested yet':'Closed without a response',tone:'neutral'};
  return ({ACCEPT:{label:'Accepted',tone:'green'},OBJECT:{label:'Changes requested',tone:'amber'},PENDING:{label:'Awaiting response',tone:'amber'},PROPOSED_BY_MAKER:{label:'Proposed by author',tone:'neutral'},REVIEW_ACCEPTED:{label:'Review complete',tone:'green'}})[status]||{label:'Not requested yet',tone:'neutral'};
}
export function assignmentApproval(value) {
  return value==='APPROVED'?{label:'Approved',tone:'green'}:value==='REJECTED'?{label:'Rejected',tone:'red'}:value==='WITHDRAWN'?{label:'Withdrawn',tone:'neutral'}:['IN_REVIEW','REVIEWED'].includes(value)?{label:'Awaiting final approval',tone:'amber'}:{label:'Proposed',tone:'neutral'};
}
const setupIssues = {
  MISSING_REGULATORY_OWNER:['Primary regulatory owner','Not assigned','owners'],
  MISSING_BUSINESS_OWNER:['Primary business owner','Not assigned','owners'],
  MISSING_CONTROL_OWNER:['Control owner','Not assigned','owners'],
  MISSING_COMPLIANCE_REVIEWER_OWNER:['Compliance reviewer','Not assigned','owners'],
  INVALID_OWNER_ACCESS:['Owner access','Needs attention','owners'],
  MISSING_APPLICABILITY:['Where it applies','Not assessed','applicability'],
  MISSING_PROCESS_MAPPING:['Process mapping','Not added','sources'],
  MISSING_EVIDENCE_STANDARD:['Evidence requirement','Not added','evidence'],
  UNAPPROVED_SOURCE:['Source approval','Approval required','sources'],
  SOURCE_PERIOD_MISMATCH:['Source dates','Do not cover the obligation start','sources'],
  MISSING_OR_UNAVAILABLE_CLAUSE:['Source clause','Unavailable','sources'],
  SOURCE_REASSESSMENT_REQUIRED:['Source changed','Reassessment required','sources'],
  PROCESS_REASSESSMENT_REQUIRED:['Process changed','Reassessment required','sources'],
  PRODUCT_REASSESSMENT_REQUIRED:['Product changed','Reassessment required','applicability'],
  REVIEW_OVERDUE:['Review date','Review overdue','applicability'],
};
export function readinessItems(d, policy) {
  const items=(d.issues||[]).filter(k=>setupIssues[k]).map(key=>{
    const [label,status,section]=setupIssues[key];return {key,label,status,section,kind:'attention'};
  });
  if(policy.stage==='BUSINESS_VALIDATION')for(const task of policy.open) {
    items.push({key:task.id,label:ownerRoles[task.owner_role]||'Owner confirmation',status:'Assigned · response pending',section:'owners',kind:'pending',task});
  }
  if(policy.stage==='COMPLIANCE_REVIEW')items.push({key:'compliance-review',label:'Compliance review',status:'Assigned · review pending',section:'history',kind:'pending'});
  if(policy.stage==='FINAL_APPROVAL')items.push({key:'final-approval',label:'Final approval',status:'Assigned · decision pending',section:'history',kind:'pending'});
  // Partial/Not applicable and high criticality describe the requirement; they are not missing setup.
  // All applicability proposals become approved through final approval, never through this UI.
  if(d.obligation.approval_status==='APPROVED'&&(d.issues||[]).includes('CONTENT_VALIDATION_PENDING'))items.push({key:'content',label:'Content validation',status:'Review required',section:'history',kind:'attention'});
  if(d.obligation.approval_status==='APPROVED'&&(d.issues||[]).includes('UNAPPROVED_NON_APPLICABILITY'))items.push({key:'non-applicable',label:'Not applicable decision',status:'Approval required',section:'applicability',kind:'attention'});
  return items;
}

const activationMessages={
  MISSING_REGULATORY_OWNER:'A primary Regulatory owner is required.',
  MISSING_BUSINESS_OWNER:'A primary Business owner is required for the accountable business department.',
  MISSING_CONTROL_OWNER:'At least one Control owner is required.',
  MISSING_COMPLIANCE_REVIEWER_OWNER:'A named Compliance reviewer is required.',
  INVALID_OWNER_ACCESS:'Assigned owners must have current access for their role and department.',
  MISSING_APPLICABILITY:'At least one applicability assessment is required, followed by final approval.',
  MISSING_PROCESS_MAPPING:'At least one process must be mapped to this obligation.',
  MISSING_EVIDENCE_STANDARD:'The required evidence must be specified.',
  UNAPPROVED_SOURCE:'All cited source clauses and interpretations must be approved.',
  SOURCE_PERIOD_MISMATCH:'The source edition must cover the obligation’s effective start date.',
  MISSING_OR_UNAVAILABLE_CLAUSE:'All cited source clauses must be available in your authorised area.',
  SOURCE_REASSESSMENT_REQUIRED:'The changed regulatory source requires reassessment.',
  PROCESS_REASSESSMENT_REQUIRED:'The changed process requires reassessment.',
  PRODUCT_REASSESSMENT_REQUIRED:'The changed product requires reassessment.',
  REVIEW_OVERDUE:'The overdue obligation or applicability review must be completed.',
  content:'Content validation must be completed.',
  'non-applicable':'The proposed exclusion requires approval.',
};
/** Unfinished activation requirements, including later review steps; never infers acceptance from assignment. */
export function activationChecklistItems(d,policy,today){
  const o=d.obligation;
  if(['SUPERSEDED','RETIRED'].includes(o.record_status)||['WITHDRAWN','REJECTED'].includes(o.approval_status))return [];
  const items=readinessItems(d,policy).filter(item=>item.kind==='attention').map(item=>({...item,message:activationMessages[item.key]}));
  if(o.record_status==='ACTIVE')return items;
  const approved=o.approval_status==='APPROVED';
  const currentTasks=(d.tasks||[]).filter(task=>task.entity_id===o.id&&task.workflow_status==='OPEN');
  const owners=(d.owners||[]).filter(owner=>owner.user_id&&!['WITHDRAWN','REJECTED'].includes(owner.approval_status));
  for(const owner of owners){
    if(owner.owner_role==='COMPLIANCE_REVIEWER'||owner.owner_role==='REGULATORY'&&owner.user_id===(owner.created_by||o.created_by))continue;
    const task=currentTasks.find(t=>t.stage==='BUSINESS_VALIDATION'&&t.owner_id===owner.id);
    const accepted=approved?owner.approval_status==='APPROVED'&&owner.validation_decision==='ACCEPT':task?.decision==='ACCEPT';
    if(accepted)continue;
    const primary=owner.primary_owner_flag&&['BUSINESS','REGULATORY'].includes(owner.owner_role);
    const role=(primary?'Primary ':'')+(ownerRoles[owner.owner_role]||'Owner');
    items.push({key:'owner-acceptance-'+owner.id,label:role,message:role+' must accept ownership and the proposed applicability.',section:'owners',
      status:task&&!task.decision&&task.current_stage==='BUSINESS_VALIDATION'?'Assigned · response pending':approved?'Acceptance required':'After Compliance review',
      kind:approved?'attention':'pending',task:task&&!task.decision&&task.current_stage==='BUSINESS_VALIDATION'?task:null,owner});
  }
  const assessments=(d.applicability||[]).filter(row=>!['WITHDRAWN','REJECTED'].includes(row.approval_status));
  if(assessments.some(row=>row.approval_status!=='APPROVED')){
    // One requirement covers both positive scope and exclusions approved in the final decision.
    const exclusion=items.findIndex(item=>item.key==='non-applicable');if(exclusion>=0)items.splice(exclusion,1);
    items.push({key:'applicability-approval',label:'Applicability approval',message:'The applicability assessments require final approval.',section:'applicability',status:'Awaiting final approval',kind:approved?'attention':'pending'});
  }
  if(!approved){
    if(owners.some(owner=>owner.owner_role==='COMPLIANCE_REVIEWER')&&!['BUSINESS_VALIDATION','FINAL_APPROVAL'].includes(policy.stage)){
      items.push({key:'compliance-review',label:'Compliance review',message:'Compliance review must be completed before owner responses.',section:'history',kind:'pending',status:policy.stage==='COMPLIANCE_REVIEW'?'Assigned · review pending':'Not submitted yet',task:policy.open.find(task=>task.stage==='COMPLIANCE_REVIEW')});
    }
    items.push({key:'final-approval',label:'Final approval',message:'Independent final approval of this obligation and its ownership is required.',section:'history',kind:'pending',status:policy.stage==='FINAL_APPROVAL'?'Assigned · decision pending':'After owner acceptance',task:policy.open.find(task=>task.stage==='FINAL_APPROVAL')});
  }else if(o.effective_to&&o.effective_to<=today){
    items.push({key:'effective-period-ended',label:'Effective period',message:'The approved effective period has ended. A replacement revision is required.',section:'history',kind:'attention',status:'Period ended'});
  }else if(o.effective_from>today){
    items.push({key:'effective-start',label:'Effective start',message:'The approved effective start date must be reached before activation.',section:'history',kind:'pending',status:'Not yet effective',startsOn:o.effective_from});
  }
  return items;
}
/** Database audit timestamps are UTC, including Oracle's timezone-less timestamp strings. */
export function timestamp(value) {
  if(!value)return null;
  const normalized=/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value)&&!/(Z|[+-]\d\d:\d\d)$/i.test(value)?value.replace(' ','T')+'Z':value;
  const parsed=new Date(normalized);return Number.isNaN(parsed.getTime())?null:parsed;
}
export function decisionLabel(value) {
  return ({REVIEW:'Compliance review completed',ACCEPT:'Ownership and applicability accepted',OBJECT:'Changes requested by owner',APPROVE:'Final approval granted',RETURN:'Returned to author',REJECT:'Rejected',WITHDRAW:'Withdrawn to Draft',DELEGATED:'Review task delegated'})[value]||value;
}

/** Canonical register-only return paths; query strings cannot inject markup or a different scheme. */
export function obligationReturnPath(value){
  if(!value)return '';
  const index=value.indexOf('?'),path=index<0?value:value.slice(0,index);
  if(!['obligations','applicability','accountability'].includes(path))return '';
  const query=new URLSearchParams(index<0?'':value.slice(index+1));
  return path+(query.size?'?'+query:'');
}
