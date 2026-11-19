/** The obligation register always returns a page envelope, including for selectors. */
export async function activeObligationOptions(request:(path:string)=>Promise<any>){
 const rows:any[]=[],seen=new Set<string>();let page=1,total:number|undefined;
 while(true){
  const result=await request('/obligations?status=ACTIVE&page='+page+'&page_size=100');
  const p=result?.pagination;
  if(!Array.isArray(result?.items)||!p||!Number.isSafeInteger(p.page)||!Number.isSafeInteger(p.page_size)||!Number.isSafeInteger(p.total)||!Number.isSafeInteger(p.total_pages)||p.page!==page||p.page_size<1||p.page_size>100||p.total<0||p.total_pages!==Math.ceil(p.total/p.page_size)){
   throw new Error('The approved obligation list could not be loaded. Refresh and try again.');
  }
  if(total!==undefined&&total!==p.total)throw new Error('The obligation list changed while loading. Refresh and try again.');
  total=p.total;
  const expected=Math.min(p.page_size,Math.max(0,p.total-(page-1)*p.page_size));
  if(result.items.length!==expected)throw new Error('The approved obligation list is incomplete. Refresh and try again.');
  for(const row of result.items){
   if(typeof row?.id!=='string'||seen.has(row.id))throw new Error('The obligation list changed while loading. Refresh and try again.');
   seen.add(row.id);rows.push(row);
  }
  if(page>=p.total_pages)break;
  page++;
 }
 return rows.filter(row=>row.record_status==='ACTIVE'&&row.approval_status==='APPROVED');
}
