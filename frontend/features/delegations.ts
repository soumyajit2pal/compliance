import {api} from '../core/api.ts';
import {state} from '../core/state.ts';
import {selectDelegation} from '../core/delegation-context.ts';
import {esc,ref,title,badge,date,link,button,field,input,select,fixedSelect,area,message} from '../ui/components.ts';
import {heading} from '../ui/layout.ts';
import {panel,note,table,detailFields} from '../ui/widgets.ts';
import {modal,close} from '../ui/dialog.ts';
const values=form=>Object.fromEntries(new FormData(form)) as Record<string,any>;
const why=()=>field('Reason',area('reason','','required minlength="10" maxlength="10000"'));
const formError='<p id="form-error" class="inline-error full" role="alert" aria-live="assertive"></p>';
const person=(id,name='')=>esc(name||ref('user',id));
const expected='required';

export async function delegationsPage(id,q=new URLSearchParams()){
 if(id==='new'){
  const options=await api('/delegations/options?'+new URLSearchParams({...(q.get('role')?{role:q.get('role')}:{}),...(q.get('unit')?{unit:q.get('unit')}:{})}));
  if(!q.get('role')||!q.get('unit'))return heading('New leave delegation','Choose one of your existing business roles and the department to cover.',link('delegations','Cancel','btn'))+panel('Responsibility',options.roles.length?`<form id="leave-setup" class="form-grid">${formError}${field('Role to cover',fixedSelect('role',options.roles,'',expected))}${field('Department',select('unit',options.units,'','name',expected),'Cover is limited to this department and authorised descendants.')}<div class="full"><button type="submit" class="btn primary">Continue</button></div></form>`:note('You have no business role available for leave cover. Technical administration access cannot be delegated.'));
  state.view.leaveDraft={role:q.get('role'),unit:q.get('unit')};
  return heading('New leave delegation',title(q.get('role'))+' · '+ref('organisational_unit',q.get('unit')),link('delegations','Cancel','btn'))+panel('Leave cover',`<form id="leave-create" class="form-grid">${formError}${field('Delegate',select('delegate_user_id',options.delegates,'','full_name',expected),'Only active people who already hold this role in the department are offered.')}${field('First day',input('starts_on','','date',expected))}${field('Last day (inclusive)',input('ends_on','','date',expected),'Up to 90 calendar days, including both dates.')}${field('Independent reviewer',select('reviewer_user_id',options.reviewers,'','full_name',expected))}${field('Separate final approver',select('approver_user_id',options.approvers,'','full_name',expected))}${why()}<p class="full muted">You, your delegate, the reviewer and final approver must be four different people. Cover starts only after approval and within these dates. Existing access and independent-review checks still apply.</p><div class="full"><button type="submit" class="btn primary">Request leave cover</button></div></form>`);
 }
 const records=await api('/delegations');state.view.leaveRecords=records;
 if(id){
  const data=await api('/delegations/'+id),r=data.record;state.view.leaveRecord=r;
  const decision=r.approval_status==='IN_REVIEW'?'REVIEW':'APPROVE';
  return heading('Leave delegation',title(r.display_status),link('delegations','Back to delegations','btn'))+panel('People, authority and dates',detailFields([
   ['On behalf of',person(r.principal_user_id)],['Delegate',person(r.delegate_user_id)],['Role',esc(title(r.role_code))],['Department',esc(ref('organisational_unit',r.scope_unit_id))],['First day',date(r.starts_on)],['Last day (inclusive)',date(r.ends_on)],['Reason',esc(r.reason),true],['Independent reviewer',person(r.reviewed_by||r.reviewer_user_id)],['Final approver',person(r.approved_by||r.approver_user_id)],['Revocation',r.revoked_at?person(r.revoked_by)+' · '+date(r.revoked_at)+' · '+esc(r.revocation_reason):'Not revoked'],
  ])+`<div class="actions">${r.can_decide?button('leave-decision',decision==='REVIEW'?'Complete review':'Approve leave cover',`data-choice="${decision}"`,'primary')+button('leave-decision','Reject','data-choice="REJECT"'):''}${r.principal_user_id===(state.identity.actual_user||state.identity.user).id&&['IN_REVIEW','REVIEWED'].includes(r.approval_status)?button('leave-decision','Withdraw request','data-choice="WITHDRAW"'):''}${r.can_revoke?button('leave-decision','Revoke cover now','data-choice="REVOKE"'):''}${r.can_act?button('leave-act','Act on behalf',`data-id="${esc(r.id)}"`,'primary'):''}</div>`)+
   panel('Request and decision history',table(['When','Decision','By','Reason'],data.audit.map(a=>[date(a.event_at),esc(title(a.action)),person(a.actor_user_id,a.actor_name),esc(a.reason)])))+
   panel('Authorised activity on behalf',table(['When','Actual actor','On behalf of','Record / activity','Reason'],data.decisions_on_behalf.map(a=>[date(a.event_at),person(a.actor_user_id,a.actor_name),person(a.on_behalf_of_user_id,a.on_behalf_of_name),esc(a.entity_type)+' · '+esc(title(a.action))+`<small>${esc(a.entity_id)}</small>`,esc(a.reason)])))+note('Only currently authorised business records appear here. Revocation or expiry stops new represented requests; work already being saved may finish before revocation takes effect.');
 }
 return heading('Delegation','Delegate your tasks during leave for up to 90 days. Delegates act on your behalf, and every decision records both names.',link('delegations/new','New delegation','btn primary'))+
  note('Leave cover requires independent review and separate approval. It does not grant a new role, widen department access or bypass maker/reviewer/approver independence.')+
  panel('Leave delegations',records.length?table(['Principal / delegate','Role / department','Period','Status','Next step'],records.map(r=>[person(r.principal_user_id)+`<small>Covered by ${person(r.delegate_user_id)}</small>`,esc(title(r.role_code))+`<small>${esc(ref('organisational_unit',r.scope_unit_id))}</small>`,date(r.starts_on)+' – '+date(r.ends_on),badge(r.display_status),link('delegations/'+r.id,r.can_decide?'Review request':'Open','btn small')+(r.can_act?button('leave-act','Act on behalf',`data-id="${esc(r.id)}"`,'small'):'')])):'<div class="empty"><h3>No delegations</h3><p>Request cover for leave, or return when someone nominates you.</p></div>')+
  note('Your own tasks remain available when you stop leave cover. Represented authority cannot be passed on to another delegate.');
}
export function delegationHandlers({render,loadIdentity}){return {actions:{
 'leave-decision':({choice})=>{state.view.leaveDecision=choice;modal(title(choice)+' leave cover',why()+(choice==='REVOKE'?note('New requests using this cover will be stopped. Its terms and past decisions remain retained.'):''),'leave-decision-form','Record decision');},
 'leave-act':async({id})=>{selectDelegation(id);try{await loadIdentity();location.hash='tasks';await render();}catch(error){selectDelegation('');await loadIdentity();throw error;}},
 'leave-stop':async()=>{selectDelegation('');await loadIdentity();location.hash='home';await render();message('Returned to your own workspace.');},
 },forms:{
 'leave-setup':form=>{location.hash='delegations/new?'+new URLSearchParams(values(form));},
 'leave-create':async form=>{const r=await api('/delegations','POST',{...values(form),role_code:state.view.leaveDraft.role,scope_unit_id:state.view.leaveDraft.unit});location.hash='delegations/'+r.id;},
 'leave-decision-form':async form=>{const r=state.view.leaveRecord;await api('/delegations/'+r.id+'/decision','POST',{...values(form),expected_revision:r.edit_revision,decision:state.view.leaveDecision});close();await render();message('Leave-cover decision recorded.');},
 }};}
