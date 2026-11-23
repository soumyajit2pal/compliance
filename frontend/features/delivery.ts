import {workflowActionGroup, workflowButton, workflowSubmit} from '../ui/workflow-actions.ts';
import {customFields,customDetails,captureCustom} from '../ui/dropdown-fields.ts';
import {workContext} from './work-context.ts';
import {auditActor} from '../ui/components.ts';
/** Actual authenticated Week 5 workflow. No browser-owned business state. */
import { api,throwApiError,apiHeaders } from '../core/api.ts';
import { state } from '../core/state.ts';
import { has } from '../core/access.ts';
import { esc,title,ref,badge,date,link,button,field,input,select,fixedSelect,area,message } from '../ui/components.ts';
import { heading,canNavigate } from '../ui/layout.ts';
import { panel,note,table,tablePanel,detailFields,tabs } from '../ui/widgets.ts';
import { modal,close } from '../ui/dialog.ts';
import { actionTrackerPage,trackerMonthChange,trackerBack } from './action-tracker.ts';
import {reportView} from '../core/navigation.ts';
import { dashboardTiles } from '../ui/dashboard.ts';
import { ccoOverview, departmentOverview, reportInsights, reportRecords, reportTiles } from './report-dashboard.ts';
import { activeObligationOptions } from './action-assignment-options.ts';
import { domainFilterChoices } from '../ui/domains.ts';

const active=(key)=>(state.masters?.[key]||[]).filter(r=>r.active_flag!==0);
const choices=(values)=>values.map(id=>({id,name:title(id)}));
const values=(form)=>Object.fromEntries(new FormData(form)) as Record<string,any>;
const required='required';
const reason=()=>field('Reason / review notes',area('reason','','required minlength="10" maxlength="10000"'));
const details=(d)=>detailFields([
  ['Requirement',esc(d.obligation.statement),true],['What proof is needed?',esc(d.action.evidence_requirement),true],
  ['Exact source edition',link('repository/'+d.source.id+'?version='+d.source.version_id,d.source.title+' · '+d.source.version_number)],
])+`<details class="delivery-metadata"><summary>Responsibilities and retained dates</summary>`+detailFields([
  ['Obligation',link('obligations/'+d.obligation.id,d.obligation.code)],
  ['Department',esc(ref('organisational_unit',d.action.owner_unit_id))],['Owner',esc(ref('user',d.action.owner_user_id))],
  ['Type / priority',esc(title(d.action.action_type))+' · '+esc(title(d.action.priority))],
  ['Independent reviewer',esc(ref('user',d.action.reviewer_user_id))],['Escalation authority',esc(ref('user',d.action.escalation_user_id))],
  ['Reporting period',date(d.action.period_from)+' – '+date(d.action.period_to)],['Original target',date(d.action.original_due_date)],
  ['Current internal target',date(d.action.current_due_date)],['Regulatory deadline',d.regulatory_deadline?date(d.regulatory_deadline.due_date):'No approved source-backed date recorded'],
])+`</details>`;

export async function actionsPage(id,query=new URLSearchParams()){
  if(id==='new')return assignmentPage(query);
  if(id)return actionDetail(id,query);
  return actionTrackerPage(query);
}

async function assignmentPage(query){
  const identifier=query.get('obligation'),unit=query.get('department');
  if(!identifier||!unit){
    const selected=identifier?await api('/obligations/'+identifier):null;
    const obls=identifier?[]:await activeObligationOptions(api);
    const units=selected?[...new Set(selected.applicability.filter(a=>a.approval_status==='APPROVED'&&a.applicability_status!=='NOT_APPLICABLE').map(a=>a.org_unit_id))]:[];
    if(!identifier&&!obls.length)return heading('Assign work','Work must start from an approved obligation.')+panel('No active approved obligations available',note('No Active, approved obligations are available in your authorised scope. Open the obligation register to check their preparation and approval status.')+link('obligations','Open obligations','btn')+' '+link('actions','Back to tracker','btn'));
    return heading('Assign work','Choose the approved obligation and applicable department. The requirement and proof standard carry forward.')+
      panel('Where does this work belong?',`<form id="delivery-choose" class="form-grid">${identifier?input('obligation',identifier,'hidden')+field('Approved obligation',`<p>${esc(selected.obligation.title)}</p>`):field('Approved obligation',select('obligation',obls.map(o=>({id:o.id,name:o.code+' · '+o.title})),'','name',required))}${identifier?field('Department',select('department',units.map(id=>({id,name:ref('organisational_unit',id)})),'','name',required)):''}<div class="full actions"><button class="btn primary" type="submit">Continue</button>${link('actions','Back to work','text-link')}</div></form>`);
  }
  const d=await api('/obligations/'+identifier),o=d.obligation;
  const roles=await Promise.all(['OWNER','REVIEWER','ESCALATION'].map(role=>api('/actions/assignees?'+new URLSearchParams({obligation_id:identifier,unit_id:unit,role}))));
  const mappings=await api('/action-control-options?'+new URLSearchParams({obligation_id:identifier,department:unit}));
  state.view.deliveryAssignment={id:identifier,unit};
  const mappingChoices=mappings.length?`<div class="full"><h3>Checks to perform</h3><p>Select the approved checks this work will carry out for its reporting period. Each check is linked to this obligation and department.</p><div class="cm-mapping-choices">${mappings.map(m=>`<label class="cm-mapping-choice"><input type="checkbox" name="control_mapping_ids" value="${esc(m.id)}" ${m.control_status==='IMPLEMENTED'?'':'disabled'}><span>${esc(m.control_code)} · ${esc(m.control_title)}<small>Revision ${esc(m.control_version)} · ${esc(title(m.coverage_type))} coverage · ${esc(ref('evidence_type',m.evidence_type_id))}</small><small>${esc(m.gap_description||'')}${m.control_status==='IMPLEMENTED'?'':' · Designed check: assign implementation work first.'}</small></span></label>`).join('')}</div></div>`:note('No current approved check links are available for this obligation and department. '+link('control-mappings?obligation='+identifier,'View checks and coverage'));
  const scope=field('If no check is selected, why?',area('control_scope_reason','','maxlength="10000"'),'Explain implementation or other work outside check execution. This is retained for independent review; it does not establish check coverage.','full');
  return heading('Assign a clear next step',o.title,link('obligations/'+o.id,'View approved requirement','btn'))+
    panel('Work and responsibility',`<form id="delivery-assign" class="form-grid">${field('What needs to be done?',area('description',o.statement,'required minlength="10" maxlength="10000"'),'Describe the concrete outcome staff should provide.','full')}${field('Named owner',select('owner_user_id',roles[0],'','full_name',required))}${field('Independent Compliance reviewer',select('reviewer_user_id',roles[1].filter(u=>u.id!==state.identity.user.id),o.compliance_reviewer_user_id,'full_name',required))}${field('Escalate to',select('escalation_user_id',roles[2],'','full_name',required))}${field('Type of work',fixedSelect('action_type',['IMPLEMENTATION','PERIODIC_REVIEW','CORRECTIVE','FOLLOW_UP'],'IMPLEMENTATION',required))}${field('Priority',fixedSelect('priority',['CRITICAL','HIGH','MEDIUM','LOW'],o.criticality,required))}${field('Period starts',input('period_from','','date',required))}${field('Period ends',input('period_to','','date',required))}${field('Internal target date',input('due_date','','date',required))}${field('Evidence type',select('evidence_type_id',active('evidence_type'),'','name',required))}${field('Proof needed',area('evidence_requirement',o.evidence_standard,'required minlength="10" maxlength="10000"'),'The independent reviewer will check this standard.','full')}${mappingChoices}${scope}${field('Retained testing / certification result',`<label><input type="checkbox" name="retained_validation_required_flag" ${o.testing_required_flag||o.certification_required_flag?'checked disabled':''}> Require an independently reviewed result from the retained bank process</label>`)}<p class="full muted">The server checks effective ownership, approved applicability and the source-backed regulatory deadline. Future periods remain upcoming until they start.</p>${customFields('action')}<div class="full actions"><button type="submit" class="btn primary">Assign and notify owner</button>${link('actions','Cancel','text-link')}</div></form>`);
}

async function actionDetail(identifier,query=new URLSearchParams()){
  const back=trackerBack(query);
  const d=await api('/actions/'+identifier);state.view.delivery=d;
  const a=d.action,p=d.permissions,editable=['OPEN','IN_PROGRESS'].includes(a.record_status),pending=a.record_status==='PENDING_VALIDATION';
  const latest=d.submissions.at(-1),proof=latest?JSON.parse(latest.evidence_snapshot):[];
  const evidence=d.evidence.map(e=>{
    const item=proof.find(x=>x.evidence_id===e.id),decision=item&&d.evidence_decisions.find(x=>x.submission_id===latest.id&&x.evidence_link_id===item.link_id);
    const access=e.document_id?`<a href="/api/evidence/${esc(e.id)}/file" class="text-link">Download original</a>`:e.repository_uri?`<a href="${esc(e.repository_uri)}" target="_blank" rel="noopener noreferrer" class="text-link">Open repository reference</a>`:'';
    return [link('evidence/'+e.id,e.code)+`<strong>${esc(e.title)}</strong><small>${esc(e.source_system)} · ${esc(e.source_record)}</small>`,badge(e.evidence_status)+(decision?`<small>This submission: ${esc(title(decision.decision))}</small>`:''),date(e.period_from)+' – '+date(e.period_to)+`<small>Retain to ${date(e.retention_end_date)}</small>`,`<code class="delivery-hash">${esc(e.file_hash)}</code>`,access+(p.can_review&&pending&&item&&!decision?workflowButton('delivery-evidence-review','Review proof','OPEN',`data-id="${esc(item.link_id)}"`):'')];
  });
  // The server rechecks the named stage and current role on every decision.
  const assignedExtensions = new Set(state.work.filter(task=>task.workflow_kind==='ACTION_EXTENSION').map(task=>task.extension_id));
  const extensions=d.extensions.map(e=>{
    const named=assignedExtensions.has(e.id);
    return [date(e.previous_due_date)+' → '+date(e.revised_due_date),esc(e.reason),badge(e.approval_status),date(e.applied_at),named?workflowButton('delivery-extension-review','Review request','OPEN',`data-id="${esc(e.id)}" data-stage="${esc(e.approval_status)}"`):''];
  });
  const controlPanel=relatedControls(d);
  const showAssignedDecisions = d.extensions.some(e=>assignedExtensions.has(e.id)) ||
    (p.can_review && d.validations.some(v=>v.decision==='PENDING'));
  const validation=d.validations.map(v=>[esc(v.reference)+`<small>${esc(v.procedure_text)}</small>`,badge(v.result),badge(v.decision),`<a class="text-link" href="/api/documents/${esc(v.document_id)}">Read result</a>`+(p.can_review&&v.decision==='PENDING'?workflowButton('delivery-validation-review','Review result','OPEN',`data-id="${esc(v.id)}"`):'')]);
  const needsWorkReview=p.can_review&&pending;
  const workReview=needsWorkReview?panel('Your next step',
    `<p>Check the submitted outcome and every proof item, then record a decision with reasons.</p><div class="delivery-outcome">${esc(latest?.result_notes)}</div>`+
    workflowActionGroup(workflowButton('delivery-decide','Complete this period','COMPLETE','data-choice="COMPLETE"')+
      workflowButton('delivery-decide','Return for correction','RETURN','data-choice="RETURN"')),{cls:'delivery-work-review'}):'';
  return `<div class="delivery-workspace">${heading(a.record_status==='COMPLETED'?'This period is complete':p.can_review&&pending?'Review assigned work':'Your assigned work',a.description,link(back||'tasks',back?'Back to tracker':'Back to My tasks','btn'))}<div class="delivery-status">${badge(a.record_status)}<span>${esc(a.code)}</span><span>Period ${date(a.period_from)} – ${date(a.period_to)}</span><span>Internal target ${date(a.current_due_date)}</span></div>`+
    `<ol class="delivery-steps" aria-label="Work flow"><li>1. Read the requirement</li><li>2. Record outcome and proof</li><li>3. Independent review</li></ol>`+
    (d.return_reason?note('<strong>Returned for correction</strong><br>'+esc(d.return_reason),'warn'):'')+
    (a.record_status==='COMPLETED'?note('This period’s work was independently completed. The obligation remains active; its next review and future periods still apply.'):!a.period_from?note('This legacy action needs a validated period, reviewer and evidence standard before delivery can proceed. Its original record is retained.','warn'):'')+
    `${workReview}${workContext(d)}${customDetails(a.custom_answers)}<div class="delivery-columns"><div>${needsWorkReview?'':panel('Your next step',p.can_work&&editable?`<p>${esc(a.evidence_requirement)}</p><form id="delivery-result">${field('What was done?',area('notes',a.result_notes||'','required minlength="10" maxlength="10000"'),'State the outcome, any exceptions and how the proof supports it.')}<div class="actions"><button class="btn" type="submit" name="intent" value="save">Save progress</button><button class="btn primary" type="submit" name="intent" value="submit">Submit for independent review</button></div></form><div class="actions mt24">${a.record_status==='OPEN'?button('delivery-start','Start work','','small'):''}${button('delivery-proof','Add proof','','small')}${button('delivery-reuse','Reuse existing proof','','small')}${button('delivery-extension','Request target change','','small')}</div>`:`<p>${pending?'Waiting for the named independent reviewer.':a.record_status==='COMPLETED'?'This period’s review is retained below.':'No task is assigned to you at the current stage.'}</p><div class="delivery-outcome">${esc(a.result_notes||'No outcome recorded yet.')}</div>`)}${controlPanel}${panel('Supporting evidence',table(['Evidence / source','Review status','Period / retention','SHA-256','Next step'],evidence,{caption:'Retained action evidence'}))}</div><aside>${panel('Requirement and dates',details(d))}</aside></div>`+
    `<details class="delivery-records" ${showAssignedDecisions?'open':''}><summary>Target changes, retained validation and history</summary>${panel('Internal target requests',table(['Target change','Reason','Decision','Applied','Next step'],extensions))}${panel('Retained bank process results',note(a.retained_validation_required_flag?'A PASS result recorded by an independent person and accepted by the named reviewer is required before completion.':'Use this area when a retained bank testing or certification process supplies a result.')+table(['Reference / procedure','Result','Review','Original'],validation)+(p.can_validate&&['OPEN','IN_PROGRESS','PENDING_VALIDATION'].includes(a.record_status)?button('delivery-validation','Record retained result','','small'):''))}${panel('Submissions',table(['Submission','Outcome','Submitted by','Date'],d.submissions.map(s=>[esc(s.submission_number),esc(s.result_notes),esc(ref('user',s.submitted_by)),date(s.submitted_at)])))}${panel('Recorded changes',table(['Event','Reason','By','Date'],d.audit.map(h=>[esc(title(h.action)),esc(h.reason),auditActor(h),date(h.created_at)])))}${p.can_cancel&&['OPEN','IN_PROGRESS'].includes(a.record_status)?workflowButton('delivery-decide','Cancel assignment with reason','CANCEL','data-choice="CANCEL"'):''}</details></div>`;
}

export async function libraryPage(){
  const items=[['actions','Compliance work tracker','Follow a requirement through outcome, proof and independent review.'],['obligations','Obligations','Approved requirements, applicability, owners and retained revisions.'],['repository','Regulatory sources','Original documents, exact editions and independent approval.'],['notification-families','Source families and regulatory dates','Amendments, supersession and source-backed date governance.'],['clauses','Clauses / Para','Source wording, interpretation, validation and references.'],['clause-relationships','Clause relationships','Governed links between exact source clauses.'],['controls','Checks and procedures','Approved checks, their owners and review dates.'],['evidence','Evidence library','Review the evidence you can access and open its linked work.'],['migration','Import existing records','Preview, independent review, lineage and reconciliation.'],['applications','Retained applications','Bank processes and applications retained outside this release.']];
  const symbols={actions:'checkSquare',obligations:'layers',repository:'book','notification-families':'org',clauses:'file',
    'clause-relationships':'link',controls:'shield',evidence:'folder',migration:'upload',applications:'external'};
  return heading('Compliance library','Find the governed records behind your work.')+
    dashboardTiles('Library destinations',items.filter(([key])=>canNavigate(key)).map(([key,title,description])=>({
      title, description, explanation:description, href:key, symbol:symbols[key],
    })));
}

export async function teamPage(_id,query=new URLSearchParams()){
  const request=state.routeNumber;
  const report=await api('/team-overview?'+query);
  if(request!==state.routeNumber||!state.identity)return '';
  state.view.deliveryReport=report;
  const view=reportView(query);
  const audience=query.get('audience');
  const metric=report.metrics[query.get('metric')]?query.get('metric'):view.defaultMetric;
  const preferred=audience==='cco'?['instruments','obligations','open','approval',
    'portfolio_high','high_owner_validation','content','overdue','escalated','evidence',
    'no_business_owner','no_evidence_definition','no_linked_checks','unapproved_non_applicability','extended_due_date']:[];
  const metrics=[...new Set([...preferred,...(view.metrics||Object.keys(report.metrics)),metric])]
    .filter(key=>key!=='portfolio'&&(key!=='due_30'||audience==='department')
      &&(key!=='high'||audience!=='cco'||!report.metrics.portfolio_high)&&report.metrics[key]);
  const clear=new URLSearchParams();
  if(audience)clear.set('audience',audience);
  const clearPath='team'+(clear.size?'?'+clear:'');
  const filter=(key,label,rows)=>field(label,select(key,rows,query.get(key)||'','name','','All '+label.toLowerCase()));
  const additional=metrics.slice(4);
  return `<div class="report-dashboard${audience==='cco'?' cco-dashboard':''}">`+heading(view.label,view.description,button('delivery-refresh','Refresh'))+
    reportTiles(report.metrics,metrics.slice(0,4),metric,query)+
    `<form id="view-filter" class="delivery-filters form-grid">${query.get('audience')?input('audience',query.get('audience'),'hidden'):''}
      ${filter('domain','Domains',domainFilterChoices(state.masters.regulatory_domain))}${filter('department','Departments',active('organisational_unit'))}${filter('owner','Owners',active('user'))}${filter('criticality','Criticalities',choices(['CRITICAL','HIGH','MEDIUM','LOW']))}${filter('status','Statuses',choices(['ACTIVE','OPEN','IN_PROGRESS','PENDING_VALIDATION','COMPLETED','DRAFT','ACCEPTED','SUBMITTED']))}${field('Relevant date from',input('from',query.get('from')||'','date'))}${field('Relevant date to',input('to',query.get('to')||'','date'))}<div class="actions"><button type="submit" class="btn primary">Apply filters</button>${link(clearPath,'Clear','text-link')}</div></form>`+
    `<p class="muted delivery-refresh">Refreshed ${esc(new Date(report.generated_at).toLocaleString('en-IN'))} · Business date ${date(report.business_date)} · ${esc(report.timezone)} · ${report.delivery.scheduler_enabled?'In-app reminders enabled':'In-app reminder scheduler disabled'}</p>`+
    (audience==='department'?departmentOverview(report.metrics.portfolio,report.evidence_status):'')+
    (additional.length?`<details class="dashboard-more-measures" open><summary>More measures <span>${additional.length}</span></summary>${
      reportTiles(report.metrics,additional,metric,query)
    }</details>`:'')+
    (audience==='cco'?ccoOverview(report.metrics,query,report.scope_counts):'')+
    reportInsights(report.metrics,metric,query)+
    reportRecords(report.metrics[metric],metric)+
    note('Open the underlying records for the approved scope and review evidence.')+'</div>';
}

export function deliveryHandlers({render}){
  const d=()=>state.view.delivery;
  const mutate=async(path,body,method='POST')=>{await api(path,method,body);await render();close();message('Saved. The record and history have been updated.');};
  return {actions:{
    'delivery-control-result':({mapping})=>{state.view.controlResultMapping=mapping;modal('Record this check’s period result',field('Performance date',input('performed_date','','date',required))+field('Result',fixedSelect('result',['EFFECTIVE','EXCEPTION','FAILED'],'EFFECTIVE',required))+field('Exceptions found',input('exception_count','0','number','required min="0" step="1"'))+field('What was checked and what did you find?',area('comments','','required minlength="10" maxlength="10000"'))+note('The independent reviewer checks this result against the submitted proof. Failed or exception results remain retained.'),'delivery-control-result-form','Save result');},
    'delivery-control-review':({id,choice},trigger)=>{state.view.controlResultDecision={id,choice};modal('Review this check result',reason()+note('Accept the submitted proof before accepting a result. Confirm the exact check, period, procedure and exceptions.'),'delivery-control-review-form',workflowSubmit('Record decision',choice),'',trigger);},
    'delivery-refresh':async()=>render(),
    'delivery-start':async()=>mutate('/actions/'+d().action.id+'/start',{expected_revision:d().action.edit_revision}),
    'delivery-proof':()=>{const a=d().action;modal('Add proof',`<p>${esc(a.evidence_requirement)}</p><p>Period ${date(a.period_from)} – ${date(a.period_to)} is inherited from this work.</p><div class="form-grid">${field('Proof title',input('title','','text','required minlength="3" maxlength="500"'))}${field('File',input('file','','file','accept=".pdf,.txt,.docx"'),'PDF, TXT or DOCX, up to 20 MB. Use a repository reference for other formats.')}${field('Source system',input('source_system','','text','required maxlength="250"'))}${field('Source record / reference',input('source_record','','text','required maxlength="250"'))}${field('Classification',select('confidentiality_class_id',active('confidentiality_class'),'','name',required))}${field('Retain until',input('retention_end_date','','date',required))}</div><details><summary>Existing repository or corrected proof</summary><div class="form-grid">${field('Repository HTTPS reference',input('repository_uri','','url'))}${field('Source record SHA-256',input('file_hash','','text','pattern="[a-fA-F0-9]{64}"'),'Required for an external repository; the reviewer must confirm the reference and hash.')}${field('Corrects this original proof',select('supersedes_evidence_id',d().evidence.filter(e=>e.uploaded_by===state.identity.user.id).map(e=>({id:e.id,name:e.code+' · '+e.title}))))}</div></details>`,'delivery-proof-form','Save proof');},
    'delivery-reuse':async()=>{const a=d().action;const rows=(await api('/evidence')).filter(e=>e.evidence_type_id===a.evidence_type_id&&e.period_from===a.period_from&&e.period_to===a.period_to&&!['REJECTED','EXPIRED','SUPERSEDED'].includes(e.evidence_status));modal('Reuse proof',field('Existing proof',select('evidence_id',rows.map(e=>({id:e.id,name:e.code+' · '+e.title})),'','name',required))+`<p>The server checks department, classification, reporting period and retention. Reuse creates a retained link and requires a fresh decision for this submission.</p>`,'delivery-reuse-form','Link proof');},
    'delivery-evidence-review':({id},trigger)=>{state.view.deliveryDecision={id,kind:'evidence'};modal('Review submitted proof',field('Decision',fixedSelect('decision',['ACCEPT','REJECT'],'ACCEPT',required))+reason()+note('Inspect the original bytes or repository reference, source, exact period, hash and retention before deciding.'),'delivery-decision-form',workflowSubmit('Record proof decision','REVIEW'),'',trigger);},
    'delivery-decide':({choice},trigger)=>{state.view.deliveryDecision={kind:'work',choice};modal(title(choice)+' this assignment',reason()+note(choice==='COMPLETE'?'Every proof item in the latest submission must be accepted. Required retained-process results must also pass independent review.':'The decision and reason will remain in history.'),'delivery-decision-form',workflowSubmit('Record decision',choice),'',trigger);},
    'delivery-extension':async()=>{const a=d().action;const rows=await api('/actions/assignees?'+new URLSearchParams({obligation_id:a.obligation_id,unit_id:a.owner_unit_id,role:'APPROVER'}));modal('Request an internal target change',field('Proposed target',input('due_date','','date',required))+field('Independent final approver',select('approver_id',rows.filter(u=>![state.identity.user.id,a.reviewer_user_id].includes(u.id)),'','full_name',required))+reason()+note('The original target is retained. Compliance review and separate final approval are required. This request cannot change a source-backed regulatory deadline.'),'delivery-extension-form','Send request');},
    'delivery-extension-review':({id,stage},trigger)=>{state.view.deliveryDecision={kind:'extension',id};modal('Review internal target request',field('Decision',fixedSelect('decision',[stage==='IN_REVIEW'?'REVIEW':'APPROVE','RETURN','REJECT'],stage==='IN_REVIEW'?'REVIEW':'APPROVE',required))+reason(),'delivery-decision-form',workflowSubmit('Record decision','REVIEW'),'',trigger);},
    'delivery-validation':()=>modal('Record retained bank result',field('Result reference',input('reference','','text','required minlength="5"'))+field('Procedure and scope',area('procedure_text','','required minlength="10"'))+field('Result',fixedSelect('result',['PASS','FAIL'],'PASS',required))+field('Original result file',input('file','','file','required accept=".pdf,.txt,.docx"'))+field('Classification',select('confidentiality_class_id',active('confidentiality_class'),'','name',required)),'delivery-validation-form','Submit result for review'),
    'delivery-validation-review':({id},trigger)=>{state.view.deliveryDecision={kind:'validation',id};modal('Review retained result',field('Decision',fixedSelect('decision',['ACCEPT','REJECT'],'ACCEPT',required))+reason(),'delivery-decision-form',workflowSubmit('Record decision','REVIEW'),'',trigger);},
    'delivery-export':async({metric})=>{const report=state.view.deliveryReport,m=report.metrics[metric];const q=new URLSearchParams(report.filters);q.set('metric',metric);q.set('population_hash',m.population_hash);const path='/team-overview/export?'+q;const response=await fetch('/api'+path,{cache:'no-store',headers:apiHeaders(path)});if(!response.ok)throwApiError(response.status,await response.json(),path);if(response.headers.get('X-Source-Records')!==String(m.count))throw new Error('The export count does not match. Refresh the dashboard.');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='compliance-'+metric+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},
  },forms:{
    'delivery-control-result-form':async form=>{const v=values(form);v.exception_count=Number(v.exception_count);v.mapping_id=state.view.controlResultMapping;await mutate('/actions/'+d().action.id+'/control-results',{...v,expected_revision:d().action.edit_revision});},
    'delivery-control-review-form':async form=>{const s=state.view.controlResultDecision;await mutate('/control-results/'+s.id+'/decision',{...values(form),decision:s.choice,expected_revision:d().action.edit_revision});},
    'action-tracker-month':trackerMonthChange,
    'delivery-choose':async(form)=>{location.hash='actions/new?'+new URLSearchParams(values(form));},
    'delivery-assign':async(form)=>{const v=values(form),s=state.view.deliveryAssignment;v.custom_fields=captureCustom(form,v);v.obligation_id=s.id;v.owner_unit_id=s.unit;v.control_mapping_ids=new FormData(form).getAll('control_mapping_ids');if(!v.control_scope_reason)v.control_scope_reason=null;v.retained_validation_required_flag=v.retained_validation_required_flag==='on';const r=await api('/actions','POST',v);location.hash='actions/'+r.id;},
    'delivery-result':async(form,submitter)=>mutate('/actions/'+d().action.id+(submitter?.value==='submit'?'/submit':'/result'),{...values(form),expected_revision:d().action.edit_revision},submitter?.value==='submit'?'POST':'PUT'),
    'delivery-proof-form':async(form)=>{const data=new FormData(form),v=values(form),file=data.get('file') as File;delete v.file;for(const key of ['repository_uri','file_hash','supersedes_evidence_id'])if(!v[key])v[key]=null;v.evidence_type_id=d().action.evidence_type_id;v.expected_revision=d().action.edit_revision;const body=new FormData();body.set('metadata',JSON.stringify(v));if(file?.size)body.set('file',file);await mutate('/actions/'+d().action.id+'/evidence',body);},
    'delivery-reuse-form':async(form)=>mutate('/actions/'+d().action.id+'/evidence-links',{...values(form),expected_revision:d().action.edit_revision}),
    'delivery-extension-form':async(form)=>mutate('/actions/'+d().action.id+'/extensions',{...values(form),expected_revision:d().action.edit_revision}),
    'delivery-validation-form':async(form)=>{const v=values(form),body=new FormData();body.set('file',new FormData(form).get('file'));body.set('owner_unit_id',d().action.owner_unit_id);body.set('confidentiality_class_id',v.confidentiality_class_id);const doc=await api('/documents','POST',body);await mutate('/actions/'+d().action.id+'/validations',{reference:v.reference,procedure_text:v.procedure_text,result:v.result,document_id:doc.id,expected_revision:d().action.edit_revision});},
    'delivery-decision-form':async(form)=>{const v=values(form),s=state.view.deliveryDecision,a=d().action;if(s.kind==='extension')return mutate('/action-extensions/'+s.id+'/decision',v);if(s.kind==='validation')return mutate('/action-validations/'+s.id+'/decision',v);if(s.kind==='evidence')return mutate('/actions/'+a.id+'/evidence-decision',{...v,submission_id:d().submissions.at(-1).id,evidence_link_id:s.id,expected_revision:a.edit_revision});return mutate('/actions/'+a.id+'/decision',{...v,decision:s.choice,expected_revision:a.edit_revision});},
  }};
}

function relatedControls(d){
  const a=d.action,p=d.permissions,sub=d.submissions.at(-1),editable=['OPEN','IN_PROGRESS'].includes(a.record_status);
  if(!d.controls?.length)return panel('Linked checks',note(a.control_scope_reason?'No check execution is assigned for this work. The retained scope reason is shown below.':'No check link was recorded on this legacy assignment. Check coverage requires separate assessment.','warn')+(a.control_scope_reason?`<p class="cm-scope-note">${esc(a.control_scope_reason)}</p>`:'')+link('control-mappings?obligation='+a.obligation_id,'View obligation coverage','text-link'));
  return panel('Linked checks and period results',table(['Check / obligation link','Coverage','Period result','Next step'],d.controls.map(x=>{
    const last=x.results.at(-1),e=last?.execution;
    const review=p.can_review&&a.record_status==='PENDING_VALIDATION'&&last?.submission_id===sub?.id&&last?.decision==='PENDING';
    const next=p.can_work&&editable?button('delivery-control-result',last?'Record corrected / fresh result':'Record period result',`data-mapping="${esc(x.mapping.id)}"`,'small'):review?workflowActionGroup(workflowButton('delivery-control-review','Accept result','ACCEPT',`data-id="${esc(last.id)}" data-choice="ACCEPT"`)+workflowButton('delivery-control-review','Reject result','REJECT',`data-id="${esc(last.id)}" data-choice="REJECT"`),'Decision required',true):'';
    return [link('controls/'+x.control.id,x.control.code+' · '+x.control.title)+`<small>Check revision ${x.control.version_number} · ${link('control-mappings/'+x.mapping.id,'Obligation link revision '+x.mapping.version_number)}</small>`,badge(x.mapping.coverage_type)+(x.mapping.gap_description?`<small>${esc(x.mapping.gap_description)}</small>`:''),last?badge(last.proposed_result)+`<small>Independent review: ${esc(title(last.decision))}</small><p>${esc(e.comments)}</p>`:'Not recorded',next+`<details><summary>Retained attempts (${x.results.length})</summary>${x.results.map(r=>`<p>Attempt ${r.attempt_number} · ${esc(title(r.proposed_result))} · ${esc(title(r.decision))}<br>${esc(r.execution.comments)}<br>${esc(r.decision_reason||'')}</p>`).join('')}</details>`];
  })))+note('Partial or compensating coverage remains an assessed limitation. Completing this period does not prove full obligation coverage or sustained effectiveness.');
}
