/** Plain-language preparation questions; indices also resolve existing edit-section links. */
export const obligationSetupSteps = [
  {label:'Rule',title:'Which rule is this based on?',hint:'Choose an approved document and clause. You can save a Draft while the bank interpretation is pending.'},
  {label:'Requirement',title:'What must your team do?',hint:'Describe one clear task, how your bank will carry it out and the consequence of missing it.'},
  {label:'Departments',title:'Which departments does this apply to?',hint:'Record a separate decision and reason for each department. These decisions still need approval.'},
  {label:'People',title:'Who will take responsibility?',hint:'Choose the lead business department and its primary owner, then name the people who check or support the work.'},
  {label:'Evidence & dates',title:'What records and dates are needed?',hint:'Describe the evidence, when the task is carried out and the dates for this obligation.'},
  {label:'Check & send',title:'Ready to send for review?',hint:'Check the summary and choose an independent Compliance reviewer and final approver.'},
];

export const obligationGroupingGuide: { heading: string; entries: [string, string][] } = {
  heading: 'One obligation per requirement you can track and prove',
  entries: [
    ['Add supporting clauses', 'Choose the clause that states the main duty in Primary clause. Under Supporting clauses (optional), choose Browse supporting clauses, read the wording, and check the clauses that support the same duty. Select Apply selection to add them.'],
    ['Use Link earlier clause', 'In Clauses / Para, this action links the newer clause to an earlier approved clause in the same notification family. Use it when the newer clause amends, replaces, cites, depends on or repeals the earlier clause.'],
    ['Create separate obligations', 'Separate duties that need different accountable owners, deadlines, evidence or compliance decisions. A single clause can contain several duties to track separately.'],
    ['Reporting example', 'Create one obligation to prepare, validate and file a monthly report. Use the filing clause as the primary clause and link the clauses on report contents and checks. Track a separate annual Board review as its own obligation.'],
    ['If a later circular changes the deadline', 'Open the newer clause and choose Link earlier clause. Select the original filing clause, choose Amends, and submit for review and approval. Once the new source is approved, revise the obligation to cite it and reflect the new deadline.'],
  ],
};

export const setupSectionSteps = {source:0,requirement:1,applicability:2,processes:2,owners:3,evidence:4,history:5,review:5};
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
