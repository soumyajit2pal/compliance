/** Department-first applicability reader with explicit activities, separate exclusions and actual history. */
import { esc,ref,date,statusTag } from '../ui/components.ts';
import { panel,pagedCollection } from '../ui/widgets.ts';
import { partitionAssessments,groupDepartmentAssessments,assessmentDecision } from '../core/obligation-applicability.ts';
import { timestamp } from '../core/obligation-detail.ts';

const item=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
const person=(row,key,master='user')=>row[key]?esc(ref(master,row[key])):'Not recorded';
const recordedAt=value=>{const parsed=timestamp(value);return parsed?new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(parsed):'Not recorded';};
function activities(row){
  return `<dl class="obligation-scope-facts">${item('Bank / legal entity',row.legal_entity_id?esc(row.scope?.legal_entity||ref('legal_entity',row.legal_entity_id)):'Not recorded')}${item('Work covered',row.process_id?esc(row.scope?.process||ref('process',row.process_id)):'No specific process limit recorded')}${[['product','product_id','Product'],['channel','channel_id','Channel'],['customer_segment','customer_segment_id','Customer segment'],['geography','geography_id','Geography']].filter(([,key])=>row[key]).map(([master,key,label])=>item(label,esc(row.scope?.[master]||ref(master,row[key])))).join('')}</dl>`;
}
function approval(row){
  return row.approval_status==='APPROVED'?statusTag('Approved','green'):row.approval_status==='REVIEWED'?statusTag('Review complete · approval pending','amber'):row.approval_status==='IN_REVIEW'?statusTag('In review · not approved','amber'):statusTag('Draft proposal');
}
function detailFacts(row){
  return `<dl class="obligation-scope-facts">${item('Assessed by',row.assessed_by?esc(row.assessor_name||ref('user',row.assessed_by)):'Not recorded')}${item('Assessment date',row.assessed_date?date(row.assessed_date):'Not recorded')}${item('Reviewed by',person(row,'reviewed_by'))}${item('Approved by',person(row,'approved_by'))}${item('Effective period',row.effective_from?'From '+date(row.effective_from)+(row.effective_to?' · ends before '+date(row.effective_to):' · no end date'):'Set with the obligation dates')}</dl>`;
}
function assessment(row){
  const excluded=row.applicability_status==='NOT_APPLICABLE';
  return `<section class="obligation-scope-record" data-current-assessment="${esc(row.id)}"><div class="obligation-scope-decision"><strong>${esc(assessmentDecision(row))}</strong>${approval(row)}</div>${activities(row)}${row.conditions?`<div class="obligation-scope-limits"><h4>Included activities and limits</h4><p>${esc(row.conditions)}</p></div>`:''}${excluded?`<div class="obligation-scope-reason"><h4>Reason for exclusion</h4><p>${esc(row.basis||'Not recorded')}</p></div>`:''}<div class="obligation-scope-bottom"><span>Next review: ${row.next_review_date?date(row.next_review_date):'Not scheduled'}</span><details><summary>${excluded?'Assessment and approval details':'Why this applies and approval details'}</summary>${excluded?'':`<div class="obligation-scope-reason"><h4>Why this applies</h4><p>${esc(row.basis||'Not recorded')}</p></div>`}${detailFacts(row)}</details></div></section>`;
}
function departments(rows,key){
  const cards=groupDepartmentAssessments(rows).map(group=>`<article class="obligation-scope-department" data-assessment-department="${esc(group.id||'unassigned')}"><header><h3>${esc(group.id?ref('organisational_unit',group.id):'Department not recorded')}</h3>${group.rows.length>1?`<span>${group.rows.length} recorded areas</span>`:''}</header>${group.id?'':'<p class="obligation-scope-unnamed">This record has no named department. It does not automatically cover every department.</p>'}${group.rows.map(assessment).join('')}</article>`);
  return pagedCollection(cards,{pageKey:key,label:'departments',className:'obligation-scope-departments'});
}
function historyRows(rows){
  const cards=rows.map(row=>`<article class="obligation-assessment-past" data-assessment-history-record="${esc(row.id)}"><header><div><h3>${esc(row.org_unit_id?ref('organisational_unit',row.org_unit_id):'Department not recorded')}</h3><p>${esc(assessmentDecision(row,true))} · earlier saved assessment</p><small>Saved on: ${esc(recordedAt(row.created_at||row.assessed_date))}</small></div>${statusTag(row.approval_status==='WITHDRAWN'?'Replaced / withdrawn':row.approval_status==='REJECTED'?'Rejected':row.approval_status==='APPROVED'?'Earlier approved record':'Earlier proposal',row.approval_status==='REJECTED'?'red':'neutral')}</header>${activities(row)}<details><summary>Earlier reason, dates and decisions</summary><div class="obligation-scope-reason"><h4>Reason recorded at the time</h4><p>${esc(row.basis||'Not recorded')}</p>${row.conditions?`<h4>Included activities and limits recorded at the time</h4><p>${esc(row.conditions)}</p>`:''}</div>${detailFacts(row)}<dl class="obligation-scope-facts">${item('Review date recorded',row.next_review_date?date(row.next_review_date):'Not scheduled')}${row.reviewed_at?item('Reviewed on',esc(recordedAt(row.reviewed_at))):''}${row.approved_at?item('Approved on',esc(recordedAt(row.approved_at))):''}</dl></details></article>`);
  return pagedCollection(cards,{pageKey:'obligation-assessment-history',label:'earlier records',className:'obligation-assessment-past-list'});
}
export function renderObligationApplicability(d,action=''){
  const parts=partitionAssessments(d.applicability,d.applicability_history),pendingExclusions=parts.exclusions.filter(row=>row.approval_status!=='APPROVED').length;
  const included=parts.included.length?departments(parts.included,'obligation-applicable-departments'):`<div class="obligation-scope-empty"><h3>No activities marked as applying in this revision</h3><p>${parts.exclusions.length?(pendingExclusions?'The recorded exclusions below are proposals and still need final approval.':'The exclusions below are approved for their recorded departments and activities.'):'Add a department assessment, or open history to inspect earlier proposals.'}</p></div>`;
  const exclusionLabel=pendingExclusions===parts.exclusions.length?'Proposed exclusions':pendingExclusions?'Exclusions':'Approved exclusions';
  const exclusions=parts.exclusions.length?`<details class="obligation-scope-exclusions"><summary><strong>${esc(exclusionLabel)}</strong><span>${parts.exclusions.length} recorded ${parts.exclusions.length===1?'area':'areas'}${pendingExclusions?' · '+pendingExclusions+' awaiting approval':''}</span></summary><div>${departments(parts.exclusions,'obligation-excluded-departments')}</div></details>`:'';
  const body=`<section class="obligation-scope-included" aria-label="Departments and activities covered">${parts.included.length?'<h3>Departments and activities covered</h3>':''}${included}</section>${exclusions}`;
  return panel('Where it applies',body,{action,cls:'obligation-applicability-panel',sub:'See each department, the bank or legal entity, and the activities covered. A proposed decision becomes approved only after final approval.'})+
    `<details class="panel obligation-history-detail obligation-assessment-history"><summary>Assessment history · ${parts.history.length} earlier ${parts.history.length===1?'record':'records'}</summary><div class="panel-body"><p class="obligation-assessment-history-note">Earlier saved assessments for this revision. Current records shown above are excluded from this list.</p>${parts.history.length?historyRows(parts.history):'<p class="obligation-empty-state">No earlier assessment records for this revision.</p>'}</div></details>`;
}
