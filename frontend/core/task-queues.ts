/** Read-only convenience queues; delegation and scope are enforced by existing APIs. */
export function taskQueue(tasks:any[],queue:string,sources:any[],regulators:any[]){
 if(queue==='rbi'){
  const ids=new Set(regulators.filter(r=>r.code==='RBI').map(r=>r.id));
  const instruments=new Set(sources.filter(s=>ids.has(s.regulator_id)).map(s=>s.id));
  return tasks.filter(t=>instruments.has(t.instrument_id));
 }
 return tasks;
}
