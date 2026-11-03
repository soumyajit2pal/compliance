/** Department coverage comes from assessments, never from an owner's department. */
type CoverageOwner={id:string;[key:string]:any};
export const recordedRows=(rows)=>rows.filter(row=>!row.ended_by_change_id&&!['WITHDRAWN','REJECTED'].includes(row.approval_status));
export function coverageOwnerResponse(row){
  if(!recordedRows([row]).length)return null;
  const task=row.validation_task||{},decision=row.validation_decision;
  if(decision==='OBJECT')return 'OBJECT';
  if(decision==='PENDING'&&task.workflow_status==='OPEN')return 'PENDING';
  if(decision==='ACCEPT'&&row.approval_status!=='DRAFT'&&!['RETURNED','WITHDRAWN','REJECTED'].includes(task.workflow_status))return 'ACCEPT';
  return null;
}
export function currentGroupOwners(group){return [...new Map<string,CoverageOwner>(group.departments.flatMap(department=>recordedRows(department.owners)).map(row=>[row.id,row] as const)).values()];}
export function primaryGroupOwner(group){return currentGroupOwners(group).find(row=>row.owner_role==='BUSINESS'&&row.primary_owner_flag);}
/** Compatibility for a preceding API build: explicitly labelled as this page, never a global total. */
export function coveragePageTotals(groups){
  const counts={awaiting:0,accepted:0,objected:0,without_accepted_business:0},seen=new Set();
  for(const group of groups){
    const owners=currentGroupOwners(group);
    if(!owners.some(row=>row.owner_role==='BUSINESS'&&row.primary_owner_flag&&coverageOwnerResponse(row)==='ACCEPT'))counts.without_accepted_business++;
    for(const row of owners){if(seen.has(row.id))continue;seen.add(row.id);const key={PENDING:'awaiting',ACCEPT:'accepted',OBJECT:'objected'}[coverageOwnerResponse(row)];if(key)counts[key]++;}
  }
  return counts;
}
const retainedRows=(rows)=>rows.filter(row=>row.ended_by_change_id||['WITHDRAWN','REJECTED'].includes(row.approval_status));
/** Split scopes, not whole departments: one department can have included and excluded activities. */
export function coverageSections(group){
  const included=[],exclusions=[],unassessed=[],retained=[];
  for(const department of group.departments){
    const assessments=recordedRows(department.assessments),owners=recordedRows(department.owners);
    const applies=assessments.filter(row=>row.applicability_status!=='NOT_APPLICABLE');
    const excluded=assessments.filter(row=>row.applicability_status==='NOT_APPLICABLE');
    if(applies.length)included.push({...department,assessments:applies,owners});
    if(excluded.length)exclusions.push({...department,assessments:excluded,owners});
    if(!assessments.length&&owners.length)unassessed.push({...department,assessments:[],owners});
    const oldAssessments=retainedRows(department.assessments),oldOwners=retainedRows(department.owners);
    if(oldAssessments.length||oldOwners.length)retained.push({...department,assessments:oldAssessments,owners:oldOwners});
  }
  const unallocated=recordedRows(group.unallocated_assessments||[]);
  const excludedUnallocated=unallocated.filter(row=>row.applicability_status==='NOT_APPLICABLE');
  const unnamed={id:null,name:'Scope without a named department',owners:[]};
  if(excludedUnallocated.length)exclusions.push({...unnamed,assessments:excludedUnallocated});
  const oldUnallocated=retainedRows(group.unallocated_assessments||[]);
  if(oldUnallocated.length)retained.push({...unnamed,assessments:oldUnallocated});
  const excluded=exclusions.flatMap(department=>department.assessments);
  const pendingExclusions=excluded.filter(row=>row.approval_status!=='APPROVED').length;
  return {included,exclusions,unassessed,retained,
    unallocated:unallocated.filter(row=>row.applicability_status!=='NOT_APPLICABLE'),
    pendingExclusions,approvedExclusions:excluded.length-pendingExclusions};
}
export function exclusionLabel(approval){
  return approval==='APPROVED'?'Excluded from this scope — approved':approval==='REJECTED'?'Exclusion rejected':approval==='WITHDRAWN'?'Exclusion withdrawn':'Exclusion proposed — approval pending';
}
export function coverageSummary(group){
  const sections=coverageSections(group);
  return {applying:sections.included.map(department=>department.name||department.id),
    excluded:sections.exclusions.filter(department=>department.id!==null).map(department=>department.name||department.id),
    unassessed:sections.unassessed.map(department=>department.name||department.id)};
}
