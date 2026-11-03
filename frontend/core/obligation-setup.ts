/** Plain-language preparation questions; indices also resolve existing edit-section links. */
export const obligationSetupSteps = [
  {label:'Rule',title:'Which rule is this based on?',hint:'Choose an approved document and clause. Its exact edition is kept with this obligation.'},
  {label:'Requirement',title:'What must your team do?',hint:'Describe one clear task, how your bank will carry it out and the consequence of missing it.'},
  {label:'Departments',title:'Which departments does this apply to?',hint:'Record a separate decision and reason for each department. These decisions still need approval.'},
  {label:'Processes',title:'Which processes carry out this work?',hint:'Choose each process once. Reuse a linked process below if a department assessment needs a process limit.'},
  {label:'People',title:'Who will take responsibility?',hint:'Choose the lead business department and its primary owner, then name the people who check or support the work.'},
  {label:'Evidence & dates',title:'What records and dates are needed?',hint:'Describe the evidence, when the task is carried out and the dates for this obligation.'},
  {label:'Check & send',title:'Ready to send for review?',hint:'Check the summary and choose an independent Compliance reviewer and final approver.'},
];
export const setupSectionSteps = {source:0,requirement:1,applicability:2,processes:3,owners:4,evidence:5,history:6,review:6};
export const assessmentChoices = [
  {id:'APPLICABLE',name:'Applies'},
  {id:'PARTIALLY_APPLICABLE',name:'Applies to some activities'},
  {id:'NOT_APPLICABLE',name:'Does not apply — exclusion proposed'},
];
export const assessmentLabel=value=>assessmentChoices.find(row=>row.id===value)?.name || 'Not assessed';
/** A scope selection is a limit, never an implied new mapping or department approval. */
export function scopeProcessChoices(mapped,existing,lookup){
  const ids=[...new Set(mapped.filter(Boolean))];
  if(existing&&!ids.includes(existing))ids.push(existing);
  return ids.map(id=>({id,name:lookup(id)+(id===existing&&!mapped.includes(id)?' · existing scope, not a linked process':'')}));
}
