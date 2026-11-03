/** Current assessments and earlier saved records must never duplicate the same row. */
type AssessmentRecord = {id:string;[key:string]:any};
const retained = (row:AssessmentRecord) => ['WITHDRAWN','REJECTED'].includes(row.approval_status);
const unique = (rows:AssessmentRecord[]) => [...new Map(rows.map(row=>[row.id,row] as const)).values()];
export function partitionAssessments(currentRows:AssessmentRecord[]=[],recordedRows:AssessmentRecord[]=[]){
  const current=unique(currentRows.filter(row=>!retained(row)));
  const ids=new Set(current.map(row=>row.id));
  const history=unique([...recordedRows,...currentRows.filter(retained)]).filter(row=>!ids.has(row.id))
    .sort((a,b)=>String(b.created_at||b.assessed_date||'').localeCompare(String(a.created_at||a.assessed_date||''))||String(b.id).localeCompare(String(a.id)));
  return {current,included:current.filter(row=>row.applicability_status!=='NOT_APPLICABLE'),exclusions:current.filter(row=>row.applicability_status==='NOT_APPLICABLE'),history};
}
export function groupDepartmentAssessments(rows:AssessmentRecord[]){
  const groups=new Map();
  for(const row of rows){const key=row.org_unit_id||null;if(!groups.has(key))groups.set(key,{id:key,rows:[]});groups.get(key).rows.push(row);}
  return [...groups.values()];
}
export function assessmentDecision(row,history=false){
  if(row.applicability_status==='NOT_APPLICABLE')return history?'Exclusion recorded':row.approval_status==='APPROVED'?'Exclusion approved':'Exclusion proposed';
  return row.applicability_status==='PARTIALLY_APPLICABLE'?'Applies to some activities':'Applies';
}
