/** One obligation, with included scopes first and exclusions in a closed disclosure. */
import { esc,ref,date,statusTag,localDate,title } from '../ui/components.ts';
import { pagedCollection } from '../ui/widgets.ts';
import { statusLabel,ownerRoles,ownerResponse,assignmentApproval } from '../core/obligation-detail.ts';
import { coverageSections,exclusionLabel,coverageOwnerResponse,primaryGroupOwner,coveragePageTotals } from '../core/obligation-coverage.ts';
import { applicabilityChoices,assessmentApproval } from './applicability-register.ts';

const scopeFields=[['legal_entity','legal_entity_id','Legal entity'],['process','process_id','Process'],['product','product_id','Product'],['channel','channel_id','Channel'],['customer_segment','customer_segment_id','Customer segment'],['geography','geography_id','Geography']];
const path=(o,tab,returnPath)=>'#obligations/'+encodeURIComponent(o.id)+'?'+new URLSearchParams({tab,return_to:returnPath});
const field=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
const role=(row)=>ownerRoles[row.owner_role]||title(row.owner_role);
const name=(row)=>row.user_id?row.owner_name||ref('user',row.user_id):'Not assigned';
const count=(value,label)=>`<span class="coverage-count">${value} ${label}${value===1?'':'s'}</span>`;
function assessment(row){
  const excluded=row.applicability_status==='NOT_APPLICABLE';
  const decision=excluded?exclusionLabel(row.approval_status):applicabilityChoices.find(item=>item.id===row.applicability_status)?.name||'Not recorded';
  const approval=assessmentApproval(row.approval_status);
  const scope=scopeFields.filter(([,key])=>row[key]).map(([master,key,label])=>esc(label)+': '+esc(row.scope?.[master]||ref(master,row[key]))).join(' · ');
  const reason=field(excluded?'Reason for exclusion':'Reason',esc(row.basis||'Not recorded'))+(row.conditions?field('Included activities & limitations',esc(row.conditions)):'');
  return `<div class="coverage-assessment ${excluded?'coverage-exclusion-assessment':''} ${row.ended_by_change_id||['WITHDRAWN','REJECTED'].includes(row.approval_status)?'coverage-retained':''}" data-assessment="${esc(row.id||'')}"><p><strong class="coverage-decision ${excluded&&row.approval_status!=='APPROVED'?'coverage-pending':''}">${esc(decision)}</strong><span class="coverage-assessment-state">${esc(approval.label)}</span></p><p class="coverage-scope">${scope||'Scope details not recorded'}</p>
    ${excluded?`<dl class="coverage-exclusion-reason">${reason}</dl>`:''}<details><summary>${excluded?'Assessment details':'Reason & scope details'}</summary><dl>${excluded?'':reason}${field('Assessment approval',esc(approval.help))}${field('Assessed by',row.assessed_by?esc(row.assessor_name||ref('user',row.assessed_by)):'Not recorded')}${field('Assessment date',row.assessed_date?date(row.assessed_date):'Not recorded')}${field('Next review',row.next_review_date?date(row.next_review_date):'Not scheduled')}${row.reviewed_by?field('Reviewed by',esc(ref('user',row.reviewed_by))):''}${row.approved_by?field('Approved by',esc(ref('user',row.approved_by))):''}${field('Effective period',date(row.effective_from)+' → '+(row.effective_to?'ends before '+date(row.effective_to):'No end date'))}</dl></details></div>`;
}
function response(row){
  const current=coverageOwnerResponse(row);
  return current?{label:{ACCEPT:'Accepted',PENDING:'Awaiting response',OBJECT:'Changes requested'}[current],tone:current==='ACCEPT'?'green':'amber'}:ownerResponse(row,row.validation_task);
}
function owners(rows){
  if(!rows.length)return '<p class="coverage-missing">No owners assigned.</p>';
  return `<ul class="coverage-people">${rows.map(row=>{const state=response(row);return `<li class="${row.ended_by_change_id||['WITHDRAWN','REJECTED'].includes(row.approval_status)?'coverage-retained':''}"><div><strong>${esc(name(row))}</strong><span>${esc(role(row))}${row.primary_owner_flag?' · Primary':''}</span></div>${statusTag(state.label,state.tone)}</li>`;}).join('')}</ul>`;
}
function ownerFacts(rows){return rows.map(row=>{
  const state=response(row),approval=assignmentApproval(row.approval_status);
  return `<section class="coverage-owner-facts"><h6>${esc(name(row))} · ${esc(role(row))}</h6><dl>${field('Owner response',statusTag(state.label,state.tone))}${row.validation_task?.comments?field('Response comments',esc(row.validation_task.comments)):''}${field('Assignment approval',statusTag(approval.label,approval.tone))}${field('Effective period',row.effective_from?(row.approval_status==='APPROVED'?'Approved from ':'Proposed from ')+date(row.effective_from)+' · '+(row.effective_to?'ends before '+date(row.effective_to):'No end date'):'Set with the obligation dates')}</dl></section>`;
}).join('');}
function departmentRows(rows,group,kind){return rows.map(department=>{
  const decisions=[...new Set(department.assessments.map(row=>row.applicability_status==='NOT_APPLICABLE'?exclusionLabel(row.approval_status):applicabilityChoices.find(item=>item.id===row.applicability_status)?.name||'Not recorded'))];
  const pending=department.assessments.some(row=>row.approval_status!=='APPROVED');
  const work=[...new Set(department.assessments.filter(row=>row.process_id).map(row=>row.scope?.process||ref('process',row.process_id)))];
  return `<section class="coverage-department ${department.id===null?'coverage-unallocated':''}" ${department.id===null?'':`data-department="${esc(department.id)}"`} data-scope-kind="${kind}" aria-label="${esc(department.name||department.id)}"><div class="coverage-department-overview"><div class="coverage-department-name"><h5>${esc(department.name||department.id)}</h5>${(group.matching_department_ids||[]).includes(department.id)?'<small class="coverage-match">Matches your filters</small>':''}${department.id===null?'<p class="coverage-missing">No department is specified; this does not apply to every department automatically.</p>':''}</div><div class="coverage-department-decision">${decisions.map(decision=>`<strong>${esc(decision)}</strong>`).join('')||'<span class="coverage-missing">Applicability not assessed</span>'}${work.length?`<small>${esc(work.join(' · '))}</small>`:''}${department.assessments.length?`<small>${pending?'Assessment approval pending':'Assessment approved'}</small>`:''}</div><div class="coverage-responsibility">${kind==='excluded'?'<span class="coverage-owner-label">Recorded owners for reference</span>':''}${owners(department.owners)}</div></div><details class="coverage-department-more"><summary>Details</summary><div class="coverage-department-facts"><div class="coverage-decisions">${department.assessments.map(assessment).join('')||'<p class="coverage-missing">No department assessment recorded.</p>'}</div><div>${ownerFacts(department.owners)}</div></div></details></section>`;
}).join('');}
function disclosure(kind,label,number,unit,note,body,rows,group){
  const matches=rows.some(row=>(group.matching_department_ids||[]).includes(row.id));
  return `<details class="coverage-secondary coverage-${kind}" data-coverage-section="${kind}"><summary><span>${esc(label)}</span>${count(number,unit)}${note?`<span class="coverage-section-note ${kind==='exclusions'&&rows.some(row=>row.assessments.some(a=>a.approval_status!=='APPROVED'))?'coverage-pending':''}">${esc(note)}</span>`:''}${matches?'<span class="coverage-match">Matching department inside</span>':''}</summary>${body}</details>`;
}
function departmentSections(group){
  const sections=coverageSections(group);
  const includedRows=sections.included.flatMap(department=>department.assessments);
  const includedHeading=includedRows.length&&includedRows.every(row=>row.approval_status!=='APPROVED')?'Departments proposed in scope':'Departments in scope';
  const pendingText=sections.pendingExclusions?`${sections.pendingExclusions} proposed exclusion${sections.pendingExclusions===1?' awaits':'s await'} approval.`:'';
  const approvedText=sections.approvedExclusions?`${sections.approvedExclusions} scope exclusion${sections.approvedExclusions===1?' is':'s are'} approved.`:'';
  let result=`<section class="coverage-in-scope" aria-label="Departments in scope"><div class="coverage-section-heading"><h4>${includedHeading}</h4>${count(sections.included.length,'department')}</div>${sections.included.length?departmentRows(sections.included,group,'included'):`<div class="coverage-empty-departments"><p>No departments marked applicable</p><small>${esc([pendingText,approvedText,sections.unallocated.length?'Additional scopes have no named department.':''].filter(Boolean).join(' ')||'Check the other recorded departments and assessment history below.')}</small></div>`}</section>`;
  const exclusions=sections.pendingExclusions+sections.approvedExclusions;
  if(exclusions){
    const label=sections.pendingExclusions?(sections.approvedExclusions?'Exclusions':'Proposed exclusions'):'Approved exclusions';
    const note=sections.pendingExclusions?(sections.approvedExclusions?`${sections.pendingExclusions} awaiting approval · ${sections.approvedExclusions} approved`:'Approval pending'):'Approved';
    result+=disclosure('exclusions',label,exclusions,'scope',note,departmentRows(sections.exclusions,group,'excluded'),sections.exclusions,group);
  }
  if(sections.unassessed.length)result+=disclosure('unassessed','Departments with owners only',sections.unassessed.length,'department','Applicability not assessed',departmentRows(sections.unassessed,group,'unassessed'),sections.unassessed,group);
  if(sections.unallocated.length){const rows=[{id:null,name:'Scope without a named department',assessments:sections.unallocated,owners:[]}];result+=disclosure('unnamed','Assessments without a department',sections.unallocated.length,'scope','Department not specified',departmentRows(rows,group,'unallocated'),rows,group);}
  if(sections.retained.length)result+=disclosure('history','Earlier records',sections.retained.reduce((total,row)=>total+row.assessments.length+row.owners.length,0),'record','Replaced, withdrawn or rejected',departmentRows(sections.retained,group,'retained'),sections.retained,group);
  return result;
}
export function coverageResponseStats(data){
  const keys=['awaiting','accepted','objected','without_accepted_business'];
  const complete=keys.every(key=>Number.isSafeInteger(data.summary?.[key])&&data.summary[key]>=0),counts=complete?data.summary:coveragePageTotals(data.items);
  return `<section class="coverage-metrics" aria-label="Owner response summary"><p>${complete?'All matching obligations':'On this page'} · current owner assignments</p><div>${[['awaiting','Awaiting response','owner assignments','amber'],['accepted','Accepted','owner assignments','green'],['objected','Changes requested','owner assignments','amber'],['without_accepted_business','No accepted primary Business owner','obligations','red']].map(([key,label,unit,tone])=>`<div class="coverage-metric coverage-metric-${tone}" data-owner-metric="${key}"><span>${esc(label)}</span><strong>${counts[key]}</strong><small>${unit}</small></div>`).join('')}</div></section>`;
}
export function obligationCoverageCards(groups,options,returnPath){
  const cards=groups.map(group=>{
    const o=group.obligation,status=statusLabel(o,o.approval_status,localDate()),sections=coverageSections(group),primary=primaryGroupOwner(group),responseState=primary?response(primary):null;
    const applying=sections.included.map(department=>department.name||department.id),extra=applying.length-2;
    const departments=applying.length?applying.slice(0,2).map(unit=>`<span>${esc(unit)}</span>`).join('')+(extra>0?`<small>+${extra} more</small>`:''):sections.pendingExclusions?'<span>No departments marked applicable</span><small>Exclusions awaiting approval</small>':sections.approvedExclusions?'<span>No departments marked applicable</span><small>Approved exclusions recorded</small>':'<span>Not assessed</span>';
    return `<article class="coverage-card" data-obligation="${esc(o.id)}"><details class="coverage-obligation-details"><summary class="coverage-card-head" aria-label="${esc('Departments and owners for '+o.title)}"><span class="coverage-obligation-cell"><a class="coverage-title" href="${esc(path(o,'overview',returnPath))}" data-obligation-preview="${esc(o.id)}" aria-haspopup="dialog" aria-expanded="false" aria-controls="obligation-quick-view">${esc(o.title)}</a><small>${esc(o.code)} · Revision ${esc(o.version_number)}</small></span><span class="coverage-row-departments"><span class="coverage-mobile-label">Departments covered</span>${departments}</span><span class="coverage-row-owner"><span class="coverage-mobile-label">Primary Business owner</span>${primary?`<strong>${esc(name(primary))}</strong>${statusTag(responseState.label,responseState.tone)}`:'<span class="coverage-missing">Not assigned</span>'}</span><span class="coverage-row-status">${statusTag(status.label,status.tone)}</span><span class="coverage-row-toggle"><span>Details</span>${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'}</span></summary><div class="coverage-expanded"><div class="coverage-departments">${departmentSections(group)}</div><footer class="coverage-card-foot"><div><span>${o.effective_from?'From '+date(o.effective_from):'Start not recorded'} · ${o.effective_to?'Ends before '+date(o.effective_to):'No end date'}</span><details class="coverage-reference-details"><summary>Obligation reference & dates</summary><dl>${field('Permanent reference',esc(o.code))}${o.legacy_codes?.length?field('Earlier references',o.legacy_codes.map(esc).join(', ')):''}${field('Revision',esc(o.version_number))}${field('Effective period',date(o.effective_from)+' → '+(o.effective_to?'ends before '+date(o.effective_to):'No end date'))}</dl></details></div><nav aria-label="${esc('Details for '+o.title)}"><a href="${esc(path(o,'overview',returnPath))}" aria-label="${esc('Open obligation: '+o.title)}">Open obligation</a><a href="${esc(path(o,'applicability',returnPath))}">View assessments</a><a href="${esc(path(o,'owners',returnPath))}">View owners</a></nav></footer></div></details></article>`;
  });
  return pagedCollection(cards,{...options,label:'obligations',className:'coverage-cards',empty:'<div class="empty"><h3>No obligations match these filters.</h3><p>Change the filters or clear them to see all obligations you can access.</p></div>'});
}
