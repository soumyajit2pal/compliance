/** Readable assessments over the existing authorised register response. */

export const applicabilityChoices=[
  {id:'APPLICABLE',name:'Applies',meaning:'The whole requirement is relevant to this scope.'},
  {id:'PARTIALLY_APPLICABLE',name:'Applies in part',meaning:'Only the stated activities or components are covered.'},
  {id:'NOT_APPLICABLE',name:'Does not apply',meaning:'Outside this scope, with a recorded reason.'},
];
const approvalStates={
  DRAFT:{label:'Draft proposal',tone:'neutral',help:'This assessment has not been approved.'},
  IN_REVIEW:{label:'In review',tone:'amber',help:'This assessment has not been approved.'},
  REVIEWED:{label:'Awaiting final approval',tone:'amber',help:'Review is complete; final approval is pending.'},
  APPROVED:{label:'Approved',tone:'green',help:'Approved through the obligation workflow.'},
  REJECTED:{label:'Rejected',tone:'red',help:'This assessment was not approved.'},
  WITHDRAWN:{label:'Withdrawn',tone:'neutral',help:'Retained for history.'},
};

export const assessmentApproval=(status)=>approvalStates[status]||{label:'Not recorded',tone:'neutral',help:'Approval status is unavailable.'};
