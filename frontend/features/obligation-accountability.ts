import { esc,ref,field,select,button,options } from '../ui/components.ts';
import { primaryBusinessOwnerError } from '../core/obligation-accountability.ts';

export function primaryBusinessOwnerFields(department,owner,eligible,requireOwner=false,compact=false){
  const choices=[...eligible];
  if(owner?.user_id&&!choices.some(row=>row.id===owner.user_id))choices.push({id:owner.user_id,full_name:ref('user',owner.user_id),option_status:'Current assignment — access needs review'});
  const assignedDepartment=owner?.org_unit_id||department||'';
  return `<section class="obligation-primary-business" data-primary-business-owner data-obl-row="owners" data-lookup-state="ready" data-eligible-users="${esc(JSON.stringify(eligible.map(row=>row.id)))}">
    <div class="obligation-primary-heading"><h3>Primary Business owner</h3><span class="tag neutral">Business · Primary</span></div>
    <p class="obligation-primary-explanation">Choose the person who takes primary business responsibility for <strong data-primary-business-department>${department?esc(ref('organisational_unit',department)):'the department selected above'}</strong>.</p>
    <input type="hidden" name="wizard_primary_business_role" data-obl-field="owner_role" value="BUSINESS">
    <input type="hidden" name="wizard_primary_business_department" data-obl-field="org_unit_id" value="${esc(assignedDepartment)}">
    <input type="checkbox" name="wizard_primary_business_flag" data-obl-field="primary_owner_flag" checked hidden>
    <div class="form-grid">${field('Named primary Business owner',select('wizard_primary_business_owner',choices,owner?.user_id||'','full_name',`${department?'':'disabled'} ${requireOwner?'required':''} data-obl-field="user_id"`,'Not assigned yet'),compact?'This person will be asked to accept responsibility after Compliance review.':'This person is recorded as the primary Business owner for the department above. No separate primary checkbox is needed.','full')}</div>
    <p class="obligation-primary-status" data-primary-business-status role="status" aria-live="polite">${owner?.user_id?owner.org_unit_id!==department?'The saved assignment uses '+esc(ref('organisational_unit',owner.org_unit_id))+'. Choose the primary Business owner again for the department above.':!eligible.some(person=>person.id===owner.user_id)?'The saved owner needs an eligibility review. Choose an eligible Business owner.':'The saved primary assignment is shown here.':department?'Select an eligible person for this department.':'Select the accountable business department first to see eligible people.'}</p>
    <p class="obligation-primary-draft-note">${compact?'A primary Business owner is required before sending for review.':requireOwner?'A primary Business owner is required for this request. Acceptance follows Compliance review; assignments become current after final approval.':'Required before submission for review. You can save a draft without assigning this person. Assignment acceptance follows Compliance review.'}</p>
    ${button('obl-retry-primary-business','Retry owner lookup','data-primary-business-retry hidden','small')}
  </section>`;
}

const businessDepartment=(form:HTMLFormElement)=>form.elements.namedItem('business_owner_unit_id') as HTMLSelectElement;
export function primaryBusinessRow(form:HTMLFormElement){return form.querySelector<HTMLElement>('[data-primary-business-owner]');}
export function primaryBusinessSelectionChanged(form:HTMLFormElement){
  const row=primaryBusinessRow(form);if(!row)return;
  const user=row.querySelector<HTMLSelectElement>('[data-obl-field=user_id]');
  if(!user.value){row.querySelector('[data-primary-business-status]').textContent=form.dataset.requiresReview==='1'?'Select a primary Business owner before submitting this ownership request.':'No primary Business owner is selected. You can save a draft and assign the person before submitting for review.';validateBusinessAccountability(form);return;}
  const department=businessDepartment(form).value;
  row.querySelector<HTMLInputElement>('[data-obl-field=org_unit_id]').value=department;
  let promoted=false;
  form.querySelectorAll<HTMLElement>('[data-obl-list=owners] [data-obl-row=owners]').forEach(other=>{
    const value=(key)=>other.querySelector<HTMLInputElement>('[data-obl-field='+key+']')?.value;
    if(value('owner_role')==='BUSINESS'&&value('org_unit_id')===department&&value('user_id')===user.value){(other.closest('.obligation-owner-edit')||other).remove();promoted=true;}
  });
  row.querySelector('[data-primary-business-status]').textContent=(promoted?'Moved from additional assignments. ':'')+user.selectedOptions[0].textContent.trim()+' is selected as the primary Business owner for '+ref('organisational_unit',department)+'.';
  validateBusinessAccountability(form);
}

export async function refreshPrimaryBusinessOwner(form:HTMLFormElement,lookup:(department:string)=>Promise<any[]>){
  const row=primaryBusinessRow(form);if(!row)return;
  const department=businessDepartment(form).value;
  const user=row.querySelector<HTMLSelectElement>('[data-obl-field=user_id]');
  const status=row.querySelector('[data-primary-business-status]');
  const retry=row.querySelector<HTMLElement>('[data-primary-business-retry]');
  const revision=String(Number(row.dataset.lookupRevision||0)+1);row.dataset.lookupRevision=revision;
  row.querySelector<HTMLInputElement>('[data-obl-field=org_unit_id]').value=department;
  row.querySelector('[data-primary-business-department]').textContent=department?ref('organisational_unit',department):'the department selected above';
  user.innerHTML=options([],'','full_name',department?'Loading eligible people…':'Not assigned yet');user.disabled=true;
  row.dataset.eligibleUsers='[]';row.dataset.lookupState=department?'pending':'ready';retry.hidden=true;
  status.textContent=department?'Department changed. Choose the primary Business owner for this department once eligible people finish loading.':'Select the accountable business department first to see eligible people.';
  validateBusinessAccountability(form);
  if(!department)return;
  try{
    const choices=await lookup(department);
    if(!form.isConnected||!row.isConnected||row.dataset.lookupRevision!==revision||businessDepartment(form).value!==department)return;
    row.dataset.eligibleUsers=JSON.stringify(choices.map(person=>person.id));row.dataset.lookupState='ready';
    user.innerHTML=options(choices,'','full_name','Not assigned yet');user.disabled=false;
    status.textContent=choices.length?'Choose the primary Business owner for '+ref('organisational_unit',department)+'.':form.dataset.requiresReview==='1'?'No eligible Business owners are available for this department. Choose a department with an eligible owner before submitting.':'No eligible Business owners are available for this department. A draft can be saved without a primary Business owner.';
    validateBusinessAccountability(form);
  }catch(error){
    if(form.isConnected&&row.isConnected&&row.dataset.lookupRevision===revision){
      row.dataset.lookupState='failed';status.textContent='Eligible Business owners could not load. Retry before continuing.';retry.hidden=false;
      validateBusinessAccountability(form);
    }
    throw error;
  }
}

export function syncAdditionalOwnerRole(row:HTMLElement){
  const business=row.querySelector<HTMLSelectElement>('[data-obl-field=owner_role]').value==='BUSINESS';
  const flag=row.querySelector<HTMLInputElement>('[data-obl-field=primary_owner_flag]');
  flag.checked=false;
  row.querySelector<HTMLElement>('[data-additional-primary-setting]').hidden=business;
  row.querySelector<HTMLElement>('[data-additional-business-note]').hidden=!business;
}
export function validateBusinessAccountability(form:HTMLFormElement){
  const primary=primaryBusinessRow(form);if(!primary)return;
  const department=businessDepartment(form);
  const user=primary.querySelector<HTMLSelectElement>('[data-obl-field=user_id]');
  const pending=primary.dataset.lookupState==='pending',failed=primary.dataset.lookupState==='failed';
  const additionalPending=Boolean(form.querySelector('[data-obl-list=owners] [data-lookup-state=pending]'));
  department.setCustomValidity(pending?'Wait for eligible primary Business owners to finish loading.':failed?'Primary Business owners could not load. Use Retry owner lookup.':additionalPending?'Wait for eligible additional owners to finish loading.':'');
  const assignmentDepartment=primary.querySelector<HTMLInputElement>('[data-obl-field=org_unit_id]').value;
  user.setCustomValidity(primaryBusinessOwnerError(department.value,assignmentDepartment,user.value,JSON.parse(primary.dataset.eligibleUsers||'[]')));
  form.querySelectorAll<HTMLElement>('[data-obl-list=owners] [data-obl-row=owners]').forEach(row=>{
    const value=(key)=>row.querySelector<HTMLInputElement>('[data-obl-field='+key+']')?.value;
    const named=row.querySelector<HTMLSelectElement>('[data-obl-field=user_id]');
    const business=value('owner_role')==='BUSINESS';
    const duplicate=business&&user.value&&value('org_unit_id')===department.value&&named.value===user.value;
    const secondPrimary=business&&row.querySelector<HTMLInputElement>('[data-obl-field=primary_owner_flag]').checked;
    named.setCustomValidity(duplicate?'This person is already the primary Business owner for this department. Remove this duplicate additional assignment.':secondPrimary?'Select the primary Business owner in the section above. Additional Business owners must not be marked primary.':'');
  });
}
