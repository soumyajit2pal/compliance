/** The history DTO includes current assignments; record identity, not person, separates them. */
type OwnerAssignment = {id:string;[key:string]:any};
const unique=(rows:OwnerAssignment[])=>[...new Map(rows.map(row=>[row.id,row] as const)).values()];
const ended=(row:OwnerAssignment)=>Boolean(row.ended_by_change_id)||row.approval_status==='WITHDRAWN';
export function partitionOwnerAssignments(currentRows:OwnerAssignment[]=[],recordedRows:OwnerAssignment[]=[]){
  // A closed review task does not end its assignment. Use the assignment record itself.
  const current=unique(currentRows.filter(row=>!ended(row)));
  const ids=new Set(current.map(row=>row.id));
  const history=unique([...recordedRows,...currentRows.filter(ended)]).filter(row=>!ids.has(row.id))
    .sort((a,b)=>String(b.created_at||b.effective_from||'').localeCompare(String(a.created_at||a.effective_from||''))||String(b.id).localeCompare(String(a.id)));
  return {current,history};
}
