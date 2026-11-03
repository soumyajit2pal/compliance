/** A single explicit primary Business assignment; other owner roles remain independent. */
export const isPrimaryBusinessOwner=(row)=>row.owner_role==='BUSINESS'&&Boolean(row.primary_owner_flag);
export function splitBusinessAccountability(owners){
  const primary=owners.find(isPrimaryBusinessOwner)||null;
  return {primary,additional:owners.filter(row=>row!==primary&&row.owner_role!=='COMPLIANCE_REVIEWER')};
}
export function primaryBusinessOwnerError(department,assignmentDepartment,user,eligible){
  if(!user)return '';
  if(department!==assignmentDepartment)return 'The primary Business owner must be assigned to the accountable business department. Choose the owner again for this department.';
  return eligible.includes(user)?'':'This person is no longer an eligible Business owner for this department. Choose an eligible person.';
}
