import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { has,covered } from '../core/access.ts';
import { detailPolicy,sectionSteps,ownerRoles,stageLabel,statusLabel,obligationReturnPath,processRelationshipChoices } from '../core/obligation-detail.ts';
import { renderObligationDetail } from './obligation-detail.ts';
import { splitBusinessAccountability } from '../core/obligation-accountability.ts';
import { obligationSetupSteps,assessmentChoices } from '../core/obligation-setup.ts';
import { renderSetupQuestions,renderSetupReview,refreshScopeProcessLimits,refreshDepartmentFields,setupDepartmentCard } from './obligation-setup.ts';
import { primaryBusinessOwnerFields,refreshPrimaryBusinessOwner,primaryBusinessSelectionChanged,syncAdditionalOwnerRole,validateBusinessAccountability } from './obligation-accountability.ts';
import { copyText } from '../ui/clipboard.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { esc,title,ref,badge,button,field,input,select,fixedSelect,area,link,localDate,date,message,options,statusTag } from '../ui/components.ts';
import { heading } from '../ui/layout.ts';
import { panel,table,tablePanel,detailFields,note,recordCell } from '../ui/widgets.ts';
import { icon } from '../ui/icons.ts';
import { showWizardStep, validateWizardStep } from '../ui/wizard.ts';
import { modal,close } from '../ui/dialog.ts';
import { obligationImportsPage,obligationImportHandlers } from './obligation-import.ts';
import { obligationSummary,ownershipSummary,applicabilitySummary,processSummary } from './obligation-summary.ts';
import { obligationView } from '../core/obligation-workspace.ts';
import { obligationWorkspacePage, workspaceTabs } from './obligation-workspace.ts';

const criticalities=['CRITICAL','HIGH','MEDIUM','LOW'];
const roles=['REGULATORY','BUSINESS','CONTROL','EVIDENCE','DATA'];
const roleCodes={REGULATORY:'AUTHOR',BUSINESS:'BUSINESS_OWNER',CONTROL:'CONTROL_OWNER',EVIDENCE:'EVIDENCE_OWNER',DATA:'BUSINESS_OWNER'};
const issueNames={SOURCE_PERIOD_MISMATCH:'Source edition does not cover the obligation start',PENDING_BUSINESS_VALIDATION:'Owner confirmation pending',MISSING_REGULATORY_OWNER:'No primary regulatory owner',MISSING_BUSINESS_OWNER:'No primary business owner',MISSING_CONTROL_OWNER:'No control owner',MISSING_COMPLIANCE_REVIEWER_OWNER:'No Compliance reviewer',INVALID_OWNER_ACCESS:'Owner access requires review',MISSING_APPLICABILITY:'Applicability not assessed',MISSING_PROCESS_MAPPING:'No process mapping',CONTENT_VALIDATION_PENDING:'Content validation pending',MISSING_EVIDENCE_STANDARD:'No evidence requirement',UNAPPROVED_SOURCE:'Source approval required',SOURCE_REASSESSMENT_REQUIRED:'Source changed — reassessment required',PROCESS_REASSESSMENT_REQUIRED:'Process changed — reassessment required',PRODUCT_REASSESSMENT_REQUIRED:'Product changed — reassessment required',MISSING_OR_UNAVAILABLE_CLAUSE:'Source clause unavailable',PARTIAL_APPLICABILITY:'Partially applicable',UNAPPROVED_NON_APPLICABILITY:'Non-applicability awaiting approval',REVIEW_OVERDUE:'Review overdue',HIGH_CRITICAL:'High / critical'};
const active=(name)=> (state.masters[name]||[]).filter(r=>r.active_flag!==0);
const current=(expectedId='')=>{
  const d=state.view.obligation;
  if(!d||location.hash.slice(1).split('?')[0]!=='obligations/'+d.obligation.id||(expectedId&&expectedId!==d.obligation.id))throw new Error('The open obligation changed. Close this dialog and refresh the record before continuing.');
  return d;
};
const recordContext=()=>input('obligation_id',current().obligation.id,'hidden');
const check=(name,label,value=false)=>`<label class="check-row"><input type="checkbox" name="${esc(name)}" ${value?'checked':''}>${esc(label)}</label>`;
const later=()=>{const d=new Date();d.setDate(d.getDate()+365);return d.toLocaleDateString('en-CA');};
let rowSequence=0;
let ownerPopupSequence=0;

export async function obligationsPage(identifier,query=new URLSearchParams()) {
  if(identifier==='imports')return obligationImportsPage(query);
  if(identifier==='new'||query.get('edit')==='1')return editor(identifier,query);
  if(identifier)return detailPage(identifier,query);
  const view=obligationView(query);
  if(view!=='register')return obligationWorkspacePage(view,query);
  state.view.obligationRegisterQuery=query.toString();
  const response=await api('/obligations?'+apiPageQuery(query,'obligations'));
  const report=query.get('tab')==='reports';
  const filter=(name,rows,label,blank)=>select(name,rows,query.get(name),label,'class="filter-select"',blank);
  return heading('Obligations','Requirements, department applicability and named responsibilities.',
    (has('AUTHOR')?link('obligations/new','Add obligation','btn primary'):'')+(has('AUTHOR','REVIEWER')?link('obligations/imports','Import obligations','btn'):'')+
    (has('AUTHOR','REVIEWER','APPROVER','CCO')?`<a class="btn" href="/api/obligations/report.csv?${esc(query.toString())}" download>Export report</a>`:''))+
    workspaceTabs('register',query)+
    `<form id="view-filter" class="obligation-register-filters" aria-label="Register filters"><div class="obligation-register-filter-heading"><label class="obligation-register-mode"><span>Register view</span><select name="tab" aria-label="Register view"><option value="register" ${report?'':'selected'}>All obligations</option><option value="reports" ${report?'selected':''}>Exceptions</option></select></label><span class="obligation-register-total">${response.pagination.total} obligation${response.pagination.total===1?'':'s'}</span></div><div class="filters obligation-filters obligation-register-filter-fields"><div class="search-field">${icon('search')}${input('q',query.get('q')||'','search','placeholder="Search obligations or sources" aria-label="Search obligations"')}</div>
    ${filter('domain',active('regulatory_domain'),'name','All domains')}
    ${filter('department',active('organisational_unit'),'name','All departments')}
    ${filter('status',['DRAFT','COMPLIANCE_REVIEW','BUSINESS_VALIDATION','FINAL_APPROVAL','ACTIVE','APPROVED','REJECTED','SUPERSEDED'].map(id=>({id,name:stageLabel(id)})),'name','All statuses')}
    ${filter('criticality',criticalities.map(id=>({id,name:stageLabel(id)})),'name','All criticalities')}
    ${filter('owner',active('user'),'full_name','All owners')}
    ${filter('exception',Object.entries(issueNames).map(([id,name])=>({id,name})),'name','All findings')}
    <button class="btn primary" type="submit">Apply filters</button>${link('obligations','Clear','btn')}</div></form>`+
    (report?note('Current Draft and Active records are shown by default. Unmapped legacy clauses and owners remain in '+link('obligations/imports','Import validation findings')+'.'):'')+
    tablePanel(table(['Obligation','Regulatory source','Accountable department','Stage','Criticality','Findings'],response.items.map(r=>[
      `<div class="obligation-register-cell">${recordCell(r.code+' · v'+r.version_number,r.title,'obligations/'+r.id,'',`data-obligation-preview="${esc(r.id)}" aria-haspopup="dialog" aria-expanded="false" aria-controls="obligation-quick-view"`)}<button type="button" class="btn small obligation-quick-view-trigger" data-obligation-preview="${esc(r.id)}" aria-label="Quick view: ${esc(r.title)}" aria-haspopup="dialog" aria-expanded="false" aria-controls="obligation-quick-view">${icon('eye')}Quick view</button></div>`,
      link('repository/'+r.instrument_id,r.instrument_code)+`<small>${esc(r.source_clause_reference||r.clause_code)} · edition ${esc(r.source_version)}</small>`,
      esc(ref('organisational_unit',r.business_owner_unit_id)),statusTag(statusLabel(r,r.stage,localDate()).label,statusLabel(r,r.stage,localDate()).tone),badge(r.criticality),
      r.issues.map(k=>`<small>${esc(issueNames[k]||title(k))}</small>`).join('')||'—',
    ]),{pageKey:'obligations',pagination:response.pagination,empty:'No obligations match this view.'}));
}

async function detailPage(identifier,query){
  const request=state.routeNumber,d=await api('/obligations/'+identifier);
  if(request!==state.routeNumber||!state.identity||location.hash.slice(1).split('?')[0]!=='obligations/'+identifier)return '';
  state.view.obligation=d;
  const policy=detailPolicy(d,state.identity.user.id,covered,localDate());
  return renderObligationDetail(d,policy,query,obligationReturnPath(query.get('return_to'))||'obligations'+(state.view.obligationRegisterQuery?'?'+state.view.obligationRegisterQuery:''));
}

function rowControls(kind,value:any={}){
  const index=++rowSequence;
  const ctl=(key,markup,label=title(key),help='')=>field(label,markup.replace(/<(input|select|textarea)\b/,`<$1 data-obl-field="${esc(key)}"`),help);
  const key=(name)=>kind+'.'+index+'.'+name;
  let fields='';
  if(kind==='owners'){
    const business=(value.owner_role||'BUSINESS')==='BUSINESS';
    fields=(value.setup_fixed_role?input(key('owner_role'),value.owner_role,'hidden','data-obl-field="owner_role"'):ctl('owner_role',select(key('owner_role'),roles.map(id=>({id,name:ownerRoles[id]})),value.owner_role||'BUSINESS','name','required'),'Owner role'))+
      ctl('org_unit_id',select(key('org_unit_id'),active('organisational_unit'),value.org_unit_id,'name','required'),'Owner department')+
      ctl('user_id',select(key('user_id'),value.people||active('user'),value.user_id,'full_name','required'),'Named owner')+
      `<div data-additional-primary-setting ${value.setup_fixed_role||business&&!value.primary_owner_flag?'hidden':''}>${ctl('primary_owner_flag',`<input type="checkbox" name="${key('primary_owner_flag')}" ${value.primary_owner_flag?'checked':''}>`,'Primary owner for this role')}</div>`+
      `<p class="field-hint full" data-additional-business-note ${business?'':'hidden'}>This is an additional Business owner. Select the primary Business owner in the dedicated section above.</p>`;
  }
  if(kind==='applicability'){
    fields=ctl('legal_entity_id',select(key('legal_entity_id'),active('legal_entity'),value.legal_entity_id,'name','required'),'Which bank / legal entity?')+
      ctl('org_unit_id',select(key('org_unit_id'),active('organisational_unit'),value.org_unit_id,'name','required'),'Department')+
      ctl('applicability_status',select(key('applicability_status'),assessmentChoices,value.applicability_status||'APPLICABLE','name','required'),'Does this department need to follow the requirement?')+
      ctl('basis',area(key('basis'),value.basis,'required minlength="10" maxlength="10000"'),'Why have you made this decision?')+
      ctl('conditions',area(key('conditions'),value.conditions,'maxlength="10000"'),'Which activities are included, and which are excluded?')+
      input(key('process_id'),value.process_id||'','hidden','data-obl-field="process_id"');
    fields+='<details class="full obligation-extra-details"><summary>Product, channel, customer and review details</summary><div class="form-grid">'+
      ['product','channel','customer_segment','geography'].map(name=>ctl(name+'_id',select(key(name+'_id'),active(name),value[name+'_id']),title(name))).join('')+ctl('next_review_date',input(key('next_review_date'),value.next_review_date||later(),'date',`required ${value.setup_new?'data-setup-review-auto="1"':''}`),'Next department assessment review')+'</div></details>';
  }
  if(kind==='processes')fields=ctl('process_id',select(key('process_id'),active('process'),value.process_id,'name','required'),'Process')+
    ctl('relevance_type',select(key('relevance_type'),processRelationshipChoices,value.relevance_type||'DIRECT','name','required'),'How this process relates to the obligation','For example, Customer onboarding is Direct when it performs the identity check required by the obligation.')+
    `<details class="full obligation-extra-details"><summary>Process criticality</summary><div class="form-grid">${ctl('criticality',fixedSelect(key('criticality'),criticalities,value.criticality||'MEDIUM','required'),'Process criticality')}</div></details>`;
  if(kind==='citations')fields=ctl('clause_id',select(key('clause_id'),state.view.obligationClauses||[],value.clause_id,'name','required'),'Another approved clause');
  return `<fieldset class="obligation-form-row" data-obl-row="${kind}" ${value.setup_source_default?'data-setup-source-owner':''}><legend>${esc(({owners:'Additional owner assignment',applicability:'Department assessment',processes:'Process mapping',citations:'Additional source clause'})[kind])}</legend><div class="form-grid">${fields}</div>${button('obl-remove-row','Remove row','','small')}</fieldset>`;
}

function popupOwnerRow(value:any={},open=false){
  return `<details class="obligation-owner-edit" ${open?'open':''}><summary><strong data-owner-summary-name>${esc(value.user_id?ref('user',value.user_id):'Choose a named owner')}</strong><span data-owner-summary-role>${esc(ownerRoles[value.owner_role||'BUSINESS'])}${value.org_unit_id?' · '+esc(ref('organisational_unit',value.org_unit_id)):''}</span></summary>${rowControls('owners',value)}</details>`;
}
function updatePopupOwnerSummaries(form:HTMLFormElement){
  if(!['obl-owner-form','obligation-editor'].includes(form.id))return;
  const rows=form.querySelectorAll<HTMLElement>('.obligation-owner-edit');
  rows.forEach(row=>{
    const value=key=>row.querySelector<HTMLSelectElement>('[data-obl-field='+key+']')?.value;
    row.querySelector('[data-owner-summary-name]').textContent=value('user_id')?ref('user',value('user_id')):'Choose a named owner';
    row.querySelector('[data-owner-summary-role]').textContent=ownerRoles[value('owner_role')]+(value('org_unit_id')?' · '+ref('organisational_unit',value('org_unit_id')):'');
  });
  const count=form.querySelector('[data-additional-owner-count]');if(count)count.textContent=String(rows.length);
}
function updateOwnershipApprovers(form:HTMLFormElement){
  if(form.id!=='obl-owner-form'||form.dataset.requiresReview!=='1')return;
  const select=form.elements.namedItem('approver_id') as HTMLSelectElement;
  const excluded=new Set([...JSON.parse(form.dataset.approverExclusions),form.elements['compliance_reviewer_user_id'].value,...readRows(form,'owners').map(owner=>owner.user_id)]);
  select.innerHTML=options(JSON.parse(form.dataset.approverChoices).filter(person=>!excluded.has(person.id)),select.value,'full_name','Choose an independent Approver');
}
async function openOwnerAssignment(){
  const id=current().obligation.id,request=state.routeNumber,sequence=++ownerPopupSequence,user=state.identity.user.id;
  const d=await api('/obligations/'+id);
  if(sequence!==ownerPopupSequence||request!==state.routeNumber||state.identity?.user.id!==user)return;
  current(id);
  const policy=detailPolicy(d,user,covered,localDate());
  if(!policy.canAssignOwners)throw new Error('Owner assignments cannot be changed at this stage. Complete any pending ownership request or obligation revision first.');
  const value=d.input,accountability=splitBusinessAccountability(value.owners);
  const [primaryPeople,reviewerPeople,approverPeople,...ownerPeople]=await Promise.all([
    people('BUSINESS_OWNER',value.business_owner_unit_id),people('REVIEWER',value.regulatory_owner_unit_id),policy.canEdit?Promise.resolve([]):people('APPROVER',value.regulatory_owner_unit_id),
    ...accountability.additional.map(owner=>people(roleCodes[owner.owner_role],owner.org_unit_id)),
  ]);
  if(sequence!==ownerPopupSequence||request!==state.routeNumber||state.identity?.user.id!==user)return;
  current(id);
  const savedChoices=(eligible,saved)=>eligible.some(person=>person.id===saved)||!saved?eligible:[...eligible,{id:saved,full_name:ref('user',saved),option_status:'Current assignment — access needs review'}];
  const reviewers=savedChoices(reviewerPeople.filter(person=>person.id!==user),value.compliance_reviewer_user_id);
  const additional=accountability.additional.map((owner,i)=>popupOwnerRow({...owner,people:savedChoices(ownerPeople[i],owner.user_id)})).join('');
  const guidance=policy.canEdit?'Save the owner changes to this Draft. Owner acceptance and final approval follow the existing review process.':'Submit a separate ownership change for Compliance review, owner acceptance and independent final approval. The obligation revision stays unchanged. Current owners remain assigned until final approval. Changes take effect on approval, or from the obligation’s future start date.';
  modal('Assign / reassign owner',input('obligation_id',id,'hidden')+input('expected_revision',d.obligation.edit_revision,'hidden')+note(guidance)+
    `<div class="obligation-business-accountability"><div class="form-grid">${field('Accountable business department',select('business_owner_unit_id',active('organisational_unit'),value.business_owner_unit_id,'name','required'),'The primary Business owner below is assigned to this department.','full')}</div>${primaryBusinessOwnerFields(value.business_owner_unit_id,accountability.primary,primaryPeople,!policy.canEdit)}</div>`+
    `<section class="obligation-editor-group"><div class="obligation-group-heading"><h3>Additional owner assignments (<span data-additional-owner-count>${accountability.additional.length}</span>)</h3>${button('obl-add-row','Add additional owner','data-kind="owners"','small')}</div><p class="obligation-additional-hint">Expand a person to change their role, department or assignment. Keep the primary Regulatory owner and at least one Control owner here.</p><div data-obl-list="owners">${additional}</div><p class="obligation-empty muted">No additional owner assignments added.</p></section>`+
    `<section class="obligation-editor-group"><h3>Compliance reviewer</h3><p class="obligation-additional-hint">Reviews this ${policy.canEdit?'obligation':'ownership change'} for ${esc(ref('organisational_unit',value.regulatory_owner_unit_id))} before named owner responses.</p>${field('Named Compliance reviewer',select('compliance_reviewer_user_id',reviewers,value.compliance_reviewer_user_id,'full_name','required'))}</section>`+
    (policy.canEdit?'':field('Independent final Approver',select('approver_id',[],'','full_name','required'),'Must be independent of the request author, Compliance reviewer and current/proposed owners.'))+
    field('Reason for assignment / reassignment',area('reason','','required minlength="10" maxlength="2000"'),'Explain the change for the retained history.'),
    'obl-owner-form',policy.canEdit?'Save owner changes':'Submit ownership change',d.obligation.title);
  const form=document.querySelector<HTMLFormElement>('#obl-owner-form');
  form.dataset.requiresReview=policy.canEdit?'0':'1';form.dataset.approverChoices=JSON.stringify(approverPeople);
  form.dataset.approverExclusions=JSON.stringify([user,d.obligation.created_by,...d.owners.map(owner=>owner.user_id)]);updateOwnershipApprovers(form);
  const popup=form.closest('dialog');popup.classList.add('obligation-owner-dialog');
  const preventClosingDuringSave=(event)=>{if(form.dataset.saving==='true')event.preventDefault();};
  popup.addEventListener('cancel',preventClosingDuringSave);
  popup.addEventListener('close',()=>popup.removeEventListener('cancel',preventClosingDuringSave),{once:true});
  form.addEventListener('invalid',event=>{const details=(event.target as HTMLElement).closest<HTMLDetailsElement>('.obligation-owner-edit');if(details)details.open=true;},true);
  validateBusinessAccountability(form);
}

const setupSteps=obligationSetupSteps;

function sourceContext(clause,unit){
  if(!clause)return '<p class="muted" data-obl-regulatory-label>Select an approved document and clause.</p>';
  const path='clauses?'+new URLSearchParams({instrument:clause.instrument_id,edition:clause.instrument_version_id,clause:clause.id});
  return `<div class="obligation-rule-summary"><strong>${esc(clause.instrument_title)}</strong><p>${esc(clause.heading||clause.name)}</p><small>Approved edition ${esc(clause.version_number)} · ${esc(clause.source_clause_reference||'')}</small></div>
    <details class="obligation-extra-details"><summary>Read the original clause</summary><div>${clause.clause_text?'<div class="source-wording">'+esc(clause.clause_text)+'</div>':''}${link(path,'Open approved clause','btn small')}</div></details>
    <details class="obligation-extra-details"><summary>Document reference and regulatory responsibility</summary><div>${detailFields([['Source edition','Version '+esc(clause.version_number)+' · '+badge(clause.version_current_flag?'CURRENT_APPROVED':'APPROVED')],['Lead regulatory department',`<span data-obl-regulatory-label>${esc(ref('organisational_unit',unit))}</span>`],['Permanent clause reference',esc(clause.code)]])}</div></details>`;
}

async function editor(identifier,query){
  const request=state.routeNumber,isCurrent=()=>request===state.routeNumber&&Boolean(state.identity);
  if(!has('AUTHOR'))throw new Error('Author access is required to capture obligations.');
  const clauses=(await api('/clauses')).filter(c=>c.approval_status==='APPROVED'&&c.version_approval_status==='APPROVED'&&c.interpretation_status==='APPROVED').map(c=>({...c,name:(c.source_clause_reference||c.code)+' · '+(c.heading||'Untitled clause')+' · edition '+c.version_number+' · '+c.code}));
  if(!isCurrent())return "";
  state.view.obligationClauses=clauses;
  let value:any={effective_from:localDate(),next_review_date:later(),criticality:'MEDIUM',obligation_nature:'ONGOING',owners:[],applicability:[],processes:[],supporting_clause_ids:[]};
  const editing=Boolean(identifier&&identifier!=='new');
  if(editing){
    const d=await api('/obligations/'+identifier);if(!isCurrent())return '';state.view.obligation=d;value=d.input;
    if(d.obligation.approval_status!=='DRAFT'||d.obligation.created_by!==state.identity.user.id)throw new Error('Only the Draft maker can edit this obligation.');
  }else value.primary_clause_id=query.get('clause')||'';
  const chosen=clauses.find(c=>c.id===value.primary_clause_id);
  let source:any=null,reviewers=[];
  if(chosen){
    source=await api('/instruments/'+chosen.instrument_id);value.regulatory_owner_unit_id=source.instrument.regulatory_owner_unit_id;value.primary_domain_id=value.primary_domain_id||source.instrument.primary_domain_id;
    reviewers=await people('REVIEWER',value.regulatory_owner_unit_id);
  }
  const instruments=[...new Map(clauses.map(c=>[c.instrument_id,{id:c.instrument_id,name:c.instrument_title}])).values()];
  for(const owner of value.owners)owner.people=await people(roleCodes[owner.owner_role]||'REVIEWER',owner.org_unit_id);
  if(!editing&&value.regulatory_owner_unit_id){
    const authors=await people('AUTHOR',value.regulatory_owner_unit_id);
    if(authors.some(person=>person.id===state.identity?.user.id))value.owners.push({owner_role:'REGULATORY',org_unit_id:value.regulatory_owner_unit_id,user_id:state.identity.user.id,primary_owner_flag:true,people:authors,setup_source_default:true});
  }
  const primaryPeople=value.business_owner_unit_id?await people('BUSINESS_OWNER',value.business_owner_unit_id):[];
  if(!isCurrent())return '';
  state.view.obligationEditorUnit=value.regulatory_owner_unit_id;
  const fields=renderSetupQuestions(value,{active,row:rowControls,ownerCard:owner=>popupOwnerRow(owner),primaryPeople,clauses,instruments,chosen,reviewers,sourceMarkup:sourceContext(chosen,value.regulatory_owner_unit_id),editing});
  const cancel=editing?'obligations/'+identifier:'obligations';
  return heading(editing?'Edit Draft obligation':'Create a new obligation','One question at a time. Prepare the requirement, then send it for independent review.')+
    '<ol class="obligation-lifecycle-strip" aria-label="Obligation lifecycle"><li aria-current="step">1. Prepare</li><li>2. Compliance review</li><li>3. Owner acceptance</li><li>4. Final approval</li></ol>'+
    `<div class="wizard obligation-wizard"><aside class="wizard-steps"><div class="eyebrow">OBLIGATION SETUP</div><nav aria-label="Obligation setup steps"><ol>${setupSteps.map((name,i)=>`<li><button type="button" class="wizard-step ${i===0?'active':''}" data-step-label="${i}" data-action="obl-wizard-go" data-step-target="${i}" ${i===0?'aria-current="step"':''}><span>${i+1}</span>${esc(name.label)}</button></li>`).join('')}</ol></nav><p class="obligation-progress-note">Your entries stay while you move between questions. Save draft after completing the required details; leaving without saving discards changes.</p></aside>
      <div class="wizard-body"><form id="obligation-editor" data-id="${editing?esc(identifier):''}" data-revision="${value.expected_revision||1}" data-setup-new="${editing?'0':'1'}" data-wizard="0" data-initial-step="${editing?(Object.hasOwn(sectionSteps,query.get('section'))?sectionSteps[query.get('section')]:0):0}" novalidate>
      <p class="inline-error" data-dialog-feedback="error" role="alert"></p>
      ${fields.map((content,i)=>`<fieldset class="form-section wizard-step-panel" data-step="${i}" ${i?'hidden':''}><div class="eyebrow">PREPARE · QUESTION ${i+1} OF ${setupSteps.length}</div><h2 tabindex="-1">${esc(setupSteps[i].title)}</h2><p class="obligation-step-hint">${esc(setupSteps[i].hint)}</p>${content}</fieldset>`).join('')}
      <div class="wizard-footer"><div class="obligation-footer-back">${link(cancel,'Cancel','btn')}<button type="button" class="btn" data-action="obl-wizard-back" data-wizard-back hidden>${icon('back')}Back</button></div><div class="obligation-footer-forward"><button class="btn" type="submit" data-save-intent="draft">${icon('file')}Save draft</button><button type="button" class="btn primary" data-action="obl-wizard-next" data-wizard-next>Continue ${icon('arrow')}</button><button type="submit" class="btn primary" data-save-intent="review" data-wizard-finish hidden>Send for review ${icon('arrow')}</button></div></div>
      <p class="obligation-save-note">Complete required details before saving a Draft. Sending starts Compliance review, followed by owner acceptance and final approval.</p></form></div></div>`;
}

function prepareValidation(form:HTMLFormElement){
  refreshDepartmentFields(form);validateBusinessAccountability(form);
  const start=form.elements['effective_from'].value,end=form.elements['effective_to'] as HTMLInputElement;
  end.setCustomValidity(end.value&&end.value<=start?'The end date must be after the effective start.':'');
  const next=form.elements['next_review_date'] as HTMLInputElement;
  next.setCustomValidity(next.value&&next.value<start?'Review must be on or after the effective start.':'');
  form.querySelectorAll<HTMLElement>('[data-obl-row=applicability]').forEach(row=>{
    const status=row.querySelector<HTMLSelectElement>('[data-obl-field=applicability_status]').value;
    const basis=row.querySelector<HTMLTextAreaElement>('[data-obl-field=basis]'),conditions=row.querySelector<HTMLTextAreaElement>('[data-obl-field=conditions]');
    basis.setCustomValidity(status==='NOT_APPLICABLE'&&basis.value.trim().length<20?'Explain non-applicability in at least 20 characters.':'');
    conditions.setCustomValidity(status==='PARTIALLY_APPLICABLE'&&conditions.value.trim().length<10?'Describe the applicable component and limitations (at least 10 characters).':'');
    const review=row.querySelector<HTMLInputElement>('[data-obl-field=next_review_date]');
    review.setCustomValidity(review.value&&review.value<start?'Assessment review must be on or after the effective start.':'');
  });
  const processes=[...form.querySelectorAll<HTMLSelectElement>('[data-obl-row=processes] [data-obl-field=process_id]')];
  processes.forEach(control=>control.setCustomValidity(control.value&&processes.some(other=>other!==control&&other.value===control.value)?'This process is already linked. Keep one mapping and use department limits for its scope.':''));
}
function moveObligationStep(form:HTMLFormElement,index:number){
  const current=Number(form.dataset.wizard);prepareValidation(form);
  if(index>current)for(let i=0;i<index;i++)if(!validateWizardStep(form,i))return false;
  showWizardStep(form,index,true);
  refreshDepartmentFields(form);refreshScopeProcessLimits(form);
  if(index===setupSteps.length-1){
    const value=readInput(form),clause=state.view.obligationClauses.find(c=>c.id===value.primary_clause_id);
    form.querySelector('[data-obl-review]').innerHTML=renderSetupReview(value,clause);
    void refreshSetupApprovers(form);
  }

  return true;
}
async function refreshSetupApprovers(form:HTMLFormElement){
  const control=form.elements.namedItem('wizard_final_approver') as HTMLSelectElement;if(!control)return;
  const sequence=String(Number(form.dataset.approverLookupRevision||0)+1);form.dataset.approverLookupRevision=sequence;
  const unit=form.elements['regulatory_owner_unit_id'].value,reviewerControl=form.elements['compliance_reviewer_user_id'] as HTMLSelectElement,reviewer=reviewerControl.value;
  const selected=control.value,actor=state.identity?.user.id;
  const assignments=readRows(form,'owners'),excluded=new Set([actor,reviewer,...assignments.map(owner=>owner.user_id)]);
  const reviewerExcluded=new Set([actor,...assignments.filter(owner=>!(owner.owner_role==='REGULATORY'&&owner.user_id===actor)).map(owner=>owner.user_id)]);
  reviewerControl.setCustomValidity(reviewer&&reviewerExcluded.has(reviewer)?'Choose a Compliance reviewer independent of the author and named owners.':'');
  const status=form.querySelector('[data-setup-approver-status]'),retry=form.querySelector<HTMLElement>('[data-setup-approver-retry]');
  form.dataset.approverLookupState='pending';control.disabled=true;retry.hidden=true;
  control.innerHTML=options([],'','full_name','Loading independent Approvers…');status.textContent='Loading eligible final approvers…';
  try{
    const [approvers,reviewers]=await Promise.all([people('APPROVER',unit),people('REVIEWER',unit)]);
    const choices=approvers.filter(person=>!excluded.has(person.id)),eligibleReviewers=reviewers.filter(person=>!reviewerExcluded.has(person.id));
    if(!form.isConnected||state.identity?.user.id!==actor||form.dataset.approverLookupRevision!==sequence)return;
    const reviewerValid=!reviewer||eligibleReviewers.some(person=>person.id===reviewer);
    if(reviewer&&!reviewerValid)eligibleReviewers.push({id:reviewer,full_name:ref('user',reviewer),option_status:'Saved reviewer needs an access or independence check'});
    reviewerControl.innerHTML=options(eligibleReviewers,reviewer,'full_name');
    reviewerControl.setCustomValidity(reviewerValid?'':'Choose a currently eligible Compliance reviewer independent of the author and named owners.');
    control.innerHTML=options(choices,selected,'full_name','Choose an independent Approver');form.dataset.approverLookupState='ready';
    status.textContent=choices.length?'The final approver will decide after Compliance review and all required owner responses.':'No independent final approver is currently eligible. Ask your access administrator to arrange a different eligible Approver before sending.';
  }catch(error){
    if(!form.isConnected||form.dataset.approverLookupRevision!==sequence)return;
    control.innerHTML=options([],'','full_name','Approver lookup unavailable');form.dataset.approverLookupState='failed';retry.hidden=false;
    status.textContent='Eligible final approvers could not load. Retry before sending for review.';
  }finally{if(form.isConnected&&form.dataset.approverLookupRevision===sequence)control.disabled=false;}
}
function invalidateSetupReview(form:HTMLFormElement){
  if(form.id!=='obligation-editor')return;
  delete form.dataset.approverLookupState;
  form.dataset.approverLookupRevision=String(Number(form.dataset.approverLookupRevision||0)+1);
  const control=form.elements.namedItem('wizard_final_approver') as HTMLSelectElement;
  if(control)control.innerHTML=options([],'','full_name','Choose an independent Approver');
}
function refreshSetupRegulatoryOwner(form:HTMLFormElement,unit,choices){
  if(form.dataset.setupNew!=='1')return;
  const existing=form.querySelector<HTMLElement>('[data-setup-source-owner]');
  const hasPrimary=readRows(form,'owners').some(owner=>owner.owner_role==='REGULATORY'&&owner.primary_owner_flag);
  const eligible=choices.some(person=>person.id===state.identity?.user.id);
  if(existing){
    existing.querySelector<HTMLSelectElement>('[data-obl-field=org_unit_id]').value=unit||'';
    existing.querySelector<HTMLSelectElement>('[data-obl-field=user_id]').innerHTML=options(choices,eligible?state.identity.user.id:'','full_name');
  }else if(!hasPrimary&&eligible){
    form.querySelector('[data-other-owner-list]')?.insertAdjacentHTML('beforeend',popupOwnerRow({owner_role:'REGULATORY',org_unit_id:unit,user_id:state.identity.user.id,primary_owner_flag:true,people:choices,setup_source_default:true}));
  }
  updatePopupOwnerSummaries(form);refreshDepartmentFields(form);
}
function setupMounted(){
  const form=document.querySelector<HTMLFormElement>('#obligation-editor');if(!form)return;
  refreshDepartmentFields(form);refreshScopeProcessLimits(form);updatePopupOwnerSummaries(form);
  if(Number(form.dataset.wizard)===setupSteps.length-1){const value=readInput(form);form.querySelector('[data-obl-review]').innerHTML=renderSetupReview(value,state.view.obligationClauses.find(clause=>clause.id===value.primary_clause_id));void refreshSetupApprovers(form);}
}
async function openObligationSubmission(d=current()){
  const o=d.obligation,excluded=new Set([o.created_by,o.compliance_reviewer_user_id,...d.owners.map(r=>r.user_id)]);
  const choices=(await people('APPROVER',o.regulatory_owner_unit_id)).filter(r=>!excluded.has(r.id));
  current(o.id);
  modal('Submit obligation',recordContext()+input('edit_revision',o.edit_revision,'hidden')+field('Independent final approver',select('approver_id',choices,'','full_name','required'))+field('Submission basis',area('comments','','required minlength="5"')),'obl-submit-form','Submit for Compliance review');
}

async function people(role,unit){return unit?api('/obligations/assignees?'+new URLSearchParams({role,unit_id:unit})):[];}
function readRows(form,kind){return [...form.querySelectorAll(`[data-obl-row="${kind}"]`)].filter((row:any)=>!row.hasAttribute('data-primary-business-owner')||row.querySelector('[data-obl-field=user_id]').value).map((row:any)=>Object.fromEntries([...row.querySelectorAll('[data-obl-field]')].map((control:any)=>[control.dataset.oblField,control.type==='checkbox'?control.checked:control.value||null])));}
function readInput(form){
  const value:any=Object.fromEntries([...new FormData(form)].filter(([key])=>!key.includes('.')&&!key.startsWith('wizard_')));
  for(const flag of ['testing','certification','reporting','retention'])value[flag+'_required_flag']=Boolean(form.elements[flag+'_required_flag'].checked);
  value.effective_to=value.effective_to||null;
  value.owners=readRows(form,'owners');value.applicability=readRows(form,'applicability');value.processes=readRows(form,'processes');value.supporting_clause_ids=readRows(form,'citations').map(r=>r.clause_id);
  if(form.dataset.id)value.expected_revision=Number(form.dataset.revision);
  return value;
}

export function installObligationEditorEvents(){
  document.addEventListener('portal:obligation-setup-mounted',setupMounted);
  document.addEventListener('change',async event=>{
    const target=event.target as HTMLInputElement,form=target.closest<HTMLFormElement>('#obligation-editor, #obl-owner-form');if(!form)return;
    try{
      if(target.closest('[data-obl-row=owners]')||['business_owner_unit_id','primary_clause_id','wizard_instrument_id','compliance_reviewer_user_id'].includes(target.name))invalidateSetupReview(form);
      if(target.name==='wizard_instrument_id'){
        form.dataset.sourceRevision=String(Number(form.dataset.sourceRevision||0)+1);
        const primary=form.elements['primary_clause_id'] as HTMLSelectElement;
        primary.innerHTML=options((state.view.obligationClauses||[]).filter(c=>c.instrument_id===target.value),'','name');primary.setCustomValidity('');
        form.elements['regulatory_owner_unit_id'].value='';form.elements['primary_domain_id'].value='';
        const reviewer=form.elements['compliance_reviewer_user_id'] as HTMLSelectElement;reviewer.innerHTML=options([],'','full_name');reviewer.disabled=false;
        form.querySelector('[data-obl-source-context]').innerHTML=sourceContext(null,null);refreshSetupRegulatoryOwner(form,'',[]);
      }
      if(target.name==='primary_clause_id'){
        const revision=String(Number(form.dataset.sourceRevision||0)+1);form.dataset.sourceRevision=revision;
        const clause=(state.view.obligationClauses||[]).find(c=>c.id===target.value);
        const primary=target as unknown as HTMLSelectElement,reviewer=form.elements['compliance_reviewer_user_id'] as HTMLSelectElement;
        reviewer.innerHTML=options([],'','full_name');form.elements['regulatory_owner_unit_id'].value='';
        form.querySelector('[data-obl-source-context]').innerHTML=sourceContext(null,null);
        primary.setCustomValidity('');if(!clause)return;
        primary.setCustomValidity('Wait for the approved source details to finish loading.');reviewer.disabled=true;
        try{
          const data=await api('/instruments/'+clause.instrument_id);if(!form.isConnected||form.dataset.sourceRevision!==revision)return;
          const unit=data.instrument.regulatory_owner_unit_id;form.elements['regulatory_owner_unit_id'].value=unit;
          form.querySelector('[data-obl-source-context]').innerHTML=sourceContext(clause,unit);
          form.elements['primary_domain_id'].value=data.instrument.primary_domain_id;
          const [recipients,authors]=await Promise.all([people('REVIEWER',unit),form.dataset.setupNew==='1'?people('AUTHOR',unit):Promise.resolve([])]);if(!form.isConnected||form.dataset.sourceRevision!==revision)return;
          reviewer.innerHTML=options(recipients,'','full_name');refreshSetupRegulatoryOwner(form,unit,authors);primary.setCustomValidity('');
        }catch(error){if(form.isConnected&&form.dataset.sourceRevision===revision)primary.setCustomValidity('Source details could not load. Select the clause again to retry.');throw error;}
        finally{if(form.isConnected&&form.dataset.sourceRevision===revision)reviewer.disabled=false;}
      }
      if(target.name==='business_owner_unit_id')await refreshPrimaryBusinessOwner(form,unit=>people('BUSINESS_OWNER',unit));
      if(target.closest('[data-primary-business-owner]')&&target.dataset.oblField==='user_id')primaryBusinessSelectionChanged(form);
      const row=target.closest<HTMLElement>('[data-obl-row="owners"]');
      if(row&&!row.hasAttribute('data-primary-business-owner')&&['owner_role','org_unit_id'].includes(target.dataset.oblField||'')){
        if(target.dataset.oblField==='owner_role')syncAdditionalOwnerRole(row);
        const unit=row.querySelector<HTMLSelectElement>('[data-obl-field=org_unit_id]').value;
        const role=row.querySelector<HTMLSelectElement>('[data-obl-field=owner_role]').value;
        const user=row.querySelector<HTMLSelectElement>('[data-obl-field=user_id]');const previous=user.value;
        const version=String(Number(row.dataset.lookupRevision||0)+1);row.dataset.lookupRevision=version;row.dataset.lookupState='pending';user.disabled=true;
        user.innerHTML=options([],'','full_name','Loading eligible owners…');validateBusinessAccountability(form);
        try{const choices=await people(roleCodes[role],unit);if(row.isConnected&&row.dataset.lookupRevision===version){user.innerHTML=options(choices,previous,'full_name');row.dataset.lookupState='ready';}}
        catch(error){if(row.isConnected&&row.dataset.lookupRevision===version){row.dataset.lookupState='failed';user.innerHTML=options([],'','full_name','Select the owner role or department to retry');}throw error;}
        finally{if(row.isConnected&&row.dataset.lookupRevision===version){user.disabled=false;validateBusinessAccountability(form);}}
      }
      if(form.id==='obligation-editor'){
        if(row?.hasAttribute('data-setup-source-owner'))row.removeAttribute('data-setup-source-owner');
        if(target.dataset.setupScopeProcess!==undefined){const scope=form.querySelector<HTMLElement>('[data-obl-row=applicability][data-scope-index="'+target.dataset.setupScopeProcess+'"]');if(scope)scope.querySelector<HTMLInputElement>('[data-obl-field=process_id]').value=target.value;}
        if(target.dataset.oblField==='next_review_date')target.dataset.setupReviewAuto='0';
        if(target.name==='next_review_date')form.querySelectorAll<HTMLInputElement>('[data-setup-review-auto="1"]').forEach(control=>control.value=target.value);
        if(target.closest('[data-obl-row=applicability],[data-obl-row=processes]')){refreshDepartmentFields(form);refreshScopeProcessLimits(form);}
        if(target.name==='compliance_reviewer_user_id'&&Number(form.dataset.wizard)===setupSteps.length-1)void refreshSetupApprovers(form);
      }
      validateBusinessAccountability(form);
      updatePopupOwnerSummaries(form);
      updateOwnershipApprovers(form);
    }catch(error){message(error.message,true);}
  });
}

export function obligationHandlers(context){
  const imported=obligationImportHandlers(context);
  return {actions:{...imported.actions,
    'obl-assign-owner':()=>openOwnerAssignment(),
    'obl-review-applicability':()=>{close();location.hash='obligations/'+current().obligation.id+'?tab=applicability';},
    'obl-copy-reference':async()=>{await copyText(current().obligation.code);message('Obligation reference copied.');},
    'obl-retry-primary-business':(_data,trigger)=>refreshPrimaryBusinessOwner(trigger.closest('form'),unit=>people('BUSINESS_OWNER',unit)),
    'obl-add-row':({kind,role},trigger)=>{
      const form=trigger.closest('form');if(!form)return;
      let target=form.querySelector(`[data-obl-list="${kind}"]`),markup='';
      if(form.id==='obl-owner-form')markup=popupOwnerRow({},true);
      else if(kind==='owners'){
        if(role==='CONTROL'){target=form.querySelector('[data-control-owner-list]');markup=rowControls(kind,{owner_role:'CONTROL',org_unit_id:form.elements.business_owner_unit_id.value||'',people:[],setup_fixed_role:true});}
        else{target=form.querySelector('[data-other-owner-list]');markup=popupOwnerRow({},true);}
      }else if(kind==='applicability'){
        const value={legal_entity_id:active('legal_entity').length===1?active('legal_entity')[0].id:'',next_review_date:form.elements.next_review_date.value||later(),setup_new:true};markup=setupDepartmentCard(rowControls(kind,value),value,true);
      }else markup=rowControls(kind);
      target?.insertAdjacentHTML('beforeend',markup);
      if(kind==='owners')invalidateSetupReview(form);
      if(role==='CONTROL')target?.lastElementChild?.querySelector('[data-obl-field=org_unit_id]')?.dispatchEvent(new Event('change',{bubbles:true}));
      validateBusinessAccountability(form);updatePopupOwnerSummaries(form);updateOwnershipApprovers(form);refreshDepartmentFields(form);refreshScopeProcessLimits(form);
    },
    'obl-remove-row':(_data,trigger)=>{const form=trigger.closest('form'),kind=trigger.closest('[data-obl-row]')?.dataset.oblRow;(trigger.closest('.obligation-owner-edit,.obligation-department-edit')||trigger.closest('[data-obl-row]'))?.remove();if(form){if(kind==='owners')invalidateSetupReview(form);validateBusinessAccountability(form);updatePopupOwnerSummaries(form);updateOwnershipApprovers(form);refreshDepartmentFields(form);refreshScopeProcessLimits(form);}},
    'obl-setup-retry-approvers':(_data,trigger)=>refreshSetupApprovers(trigger.closest('form')),
    'obl-ownership-decision':({change,task,decision})=>{
      const proposal=current().owner_changes?.find(row=>row.id===change);if(!proposal)throw new Error('Refresh the ownership request before deciding.');
      const assignment=proposal.assignments.find(row=>row.task_id===task);
      const label=({REVIEW:'Complete ownership Compliance review',ACCEPT:'Accept ownership change',OBJECT:'Request ownership changes',APPROVE:'Approve ownership change',RETURN:'Return ownership request',REJECT:'Reject ownership request',WITHDRAW:'Withdraw ownership request'})[decision];
      modal(label,recordContext()+input('change_id',change,'hidden')+input('task_id',task||'','hidden')+input('decision',decision,'hidden')+
        note(decision==='ACCEPT'?'You accept the '+esc(assignment?ownerRoles[assignment.owner_role]+' assignment for '+ref('organisational_unit',assignment.org_unit_id):'proposed ownership responsibility')+' and acknowledge the obligation’s current approved applicability. This does not give final approval.':'This decision applies to the ownership request. The obligation revision and wording remain unchanged.')+
        field('Decision basis',area('comments','','required minlength="5" maxlength="10000"')),'obl-ownership-decision-form',label);
    },
    'obl-submit':()=>openObligationSubmission(),
    'obl-wizard-next':(_data,trigger)=>{const form=trigger.closest('form');moveObligationStep(form,Number(form.dataset.wizard)+1);},
    'obl-wizard-back':(_data,trigger)=>{const form=trigger.closest('form');moveObligationStep(form,Math.max(0,Number(form.dataset.wizard)-1));},
    'obl-wizard-go':({stepTarget})=>{const form=document.querySelector<HTMLFormElement>('#obligation-editor');if(form)moveObligationStep(form,Number(stepTarget));},
    'obl-decision':async({decision,task})=>{
      const contextId=current().obligation.id;
      let delegate='';
      if(decision==='DELEGATE'){
        const o=current().obligation,t=current().tasks.find(r=>r.id===task),role=t?.stage==='COMPLIANCE_REVIEW'?'REVIEWER':'APPROVER';
        const excluded=new Set([o.created_by,...current().owners.map(r=>r.user_id),...current().tasks.map(r=>r.assignee_user_id)]);
        delegate=field('Eligible delegate',select('delegate_user_id',(await people(role,o.regulatory_owner_unit_id)).filter(r=>!excluded.has(r.id)),'','full_name','required'));
      }
      current(contextId);
      const assignment=current().tasks.find(r=>r.id===task),owner=current().owners.find(r=>r.id===assignment?.owner_id);
      const confirmation=decision==='ACCEPT'?note('You are accepting this '+esc(ownerRoles[assignment?.owner_role]||'owner')+' assignment'+(owner?' for '+esc(ref('organisational_unit',owner.org_unit_id)):'')+' and confirming the proposed applicability assessments for this obligation. This does not grant final approval.')+button('obl-review-applicability','Review where it applies','','small'):'';
      const label=({ACCEPT:'Accept ownership and applicability',OBJECT:'Request changes',REVIEW:'Complete Compliance review',APPROVE:'Approve obligation',WITHDRAW:'Withdraw to Draft',RETURN:'Return to author',REJECT:'Reject proposal',DELEGATE:'Delegate review'})[decision]||title(decision);
      modal(label,recordContext()+confirmation+input('decision',decision,'hidden')+input('task_id',task||'','hidden')+delegate+field('Decision basis',area('comments','','required minlength="5" maxlength="10000"')),'obl-decision-form',label);
    },
    'obl-revise':({section})=>modal('Create governed revision',recordContext()+input('edit_section',Object.hasOwn(sectionSteps,section)?section:'','hidden')+field('Reason for revision / ownership change',area('reason','','required minlength="10" maxlength="2000"')),'obl-revision-form','Create Draft revision'),
    'obl-cancel':()=>modal('Cancel unapproved Draft',recordContext()+field('Cancellation reason',area('reason','','required minlength="10" maxlength="2000"')),'obl-cancel-form','Cancel Draft'),
    'obl-activate':async()=>{await api('/obligations/'+current().obligation.id+'/activate','POST',{});await context.render();},
  },forms:{...imported.forms,
    'obl-owner-form':async form=>{
      const id=form.elements.obligation_id.value;current(id);validateBusinessAccountability(form);if(!form.reportValidity())return;
      const value={
        expected_revision:Number(form.elements.expected_revision.value),business_owner_unit_id:form.elements.business_owner_unit_id.value,
        compliance_reviewer_user_id:form.elements.compliance_reviewer_user_id.value,owners:readRows(form,'owners'),reason:form.elements.reason.value,
        ...(form.elements.approver_id?{approver_id:form.elements.approver_id.value}:{}),
      };
      const popup=form.closest('dialog') as HTMLDialogElement;
      const closers=[...popup.querySelectorAll<HTMLButtonElement>('[data-action=close]')];
      form.dataset.saving='true';closers.forEach(control=>control.disabled=true);
      let result;
      try{result=await api('/obligations/'+id+'/owners','PUT',value);}
      finally{delete form.dataset.saving;closers.forEach(control=>control.disabled=false);}
      if(!form.isConnected||location.hash.slice(1).split('?')[0]!=='obligations/'+id)return;
      close();const query=new URLSearchParams(location.hash.split('?')[1]);query.set('tab','owners');if(result.change_id)query.set('ownership_change',result.change_id);const target='obligations/'+result.id+'?'+query;
      if(location.hash.slice(1)===target)await context.render();else location.hash=target;
      message(!result.changed?'Owner assignments are unchanged.':result.submitted_for_review?'Ownership change submitted for Compliance review. Obligation revision unchanged.':'Draft owner assignments saved.');
    },
    'obl-ownership-decision-form':async form=>{
      const id=current(form.elements.obligation_id.value).obligation.id;
      await api('/obligations/'+id+'/owner-changes/'+encodeURIComponent(form.elements.change_id.value)+'/decision','POST',{
        decision:form.elements.decision.value,task_id:form.elements.task_id.value||null,comments:form.elements.comments.value,
      });if(!form.isConnected||location.hash.slice(1).split('?')[0]!=='obligations/'+id)return;
      close();if(form.elements.decision.value==='OBJECT'){location.hash='tasks';message('Your request for ownership changes was recorded. Current assignments remain unchanged.');}else await context.render();
    },
    'obligation-editor':async(form,submitter)=>{
      const sending=submitter?.dataset.saveIntent==='review',approver=form.elements.wizard_final_approver as HTMLSelectElement;
      approver.required=sending;form.elements.wizard_submission_comments.required=sending;
      prepareValidation(form);for(let i=0;i<setupSteps.length;i++)if(!validateWizardStep(form,i)){
        if(i===setupSteps.length-1){const value=readInput(form);form.querySelector('[data-obl-review]').innerHTML=renderSetupReview(value,state.view.obligationClauses.find(clause=>clause.id===value.primary_clause_id));if(!form.dataset.approverLookupState)void refreshSetupApprovers(form);}
        return;
      }
      if(sending&&form.dataset.approverLookupState!=='ready'){showWizardStep(form,6,true);throw new Error('Wait for eligible final approvers to load, or retry the lookup before sending.');}
      const payload=readInput(form);
      if(sending){
        const requirements=[!payload.owners.some(owner=>owner.owner_role==='REGULATORY'&&owner.primary_owner_flag)?['Add a primary Regulatory owner before sending.',4]:null,!payload.owners.some(owner=>owner.owner_role==='BUSINESS'&&owner.primary_owner_flag)?['Choose a primary Business owner before sending.',4]:null,!payload.owners.some(owner=>owner.owner_role==='CONTROL')?['Add at least one Control owner before sending.',4]:null,!payload.applicability.length?['Add a department assessment before sending.',2]:null,!payload.processes.length?['Link at least one process before sending.',3]:null].filter(Boolean);
        if(requirements.length){showWizardStep(form,requirements[0][1] as number,true);throw new Error(requirements[0][0] as string);}
      }
      const actor=state.identity.user.id,route=state.routeNumber,id=form.dataset.id,chosenApprover=approver.value,comments=form.elements.wizard_submission_comments.value;
      const result=await api('/obligations'+(id?'/'+id:''),id?'PUT':'POST',payload);
      if(!form.isConnected||state.identity?.user.id!==actor||state.routeNumber!==route)return;
      form.dataset.id=result.id;form.dataset.revision=String(result.edit_revision||1);form.dataset.setupNew='0';
      if(sending){
        try{await api('/obligations/'+result.id+'/submit','POST',{approver_id:chosenApprover,comments,expected_revision:Number(form.dataset.revision)});}
        catch(error){if(form.isConnected)throw new Error('Your Draft was saved, but it could not be sent for review: '+error.message);throw error;}
        if(!form.isConnected||state.identity?.user.id!==actor||state.routeNumber!==route)return;
        location.hash='obligations/'+result.id;message('Sent for Compliance review. Owner acceptance and final approval follow.');
      }else{location.hash='obligations/'+result.id;message('Draft obligation saved.');}
    },
    'obl-submit-form':async form=>{const o=current(form.elements.obligation_id.value).obligation;await api('/obligations/'+o.id+'/submit','POST',{approver_id:form.elements.approver_id.value,comments:form.elements.comments.value,expected_revision:Number(form.elements.edit_revision.value)});close();await context.render();},
    'obl-decision-form':async form=>{const value:any=Object.fromEntries(new FormData(form)),o=current(value.obligation_id).obligation;delete value.obligation_id;if(!value.task_id)delete value.task_id;await api('/obligations/'+o.id+'/decision','POST',value);close();await context.render();},
    'obl-revision-form':async form=>{const result=await api('/obligations/'+current(form.elements.obligation_id.value).obligation.id+'/revisions','POST',{reason:form.elements.reason.value});close();const section=form.elements.edit_section.value;location.hash='obligations/'+result.id+'?edit=1'+(Object.hasOwn(sectionSteps,section)?'&section='+section:'');},
    'obl-cancel-form':async form=>{await api('/obligations/'+current(form.elements.obligation_id.value).obligation.id+'/cancel','POST',{reason:form.elements.reason.value});close();await context.render();},
  }};
}
