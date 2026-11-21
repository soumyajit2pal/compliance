import { api } from '../core/api.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { state } from '../core/state.ts';
import { covered } from '../core/access.ts';
import { choosePeople } from '../core/assignees.ts';
import { esc, date, localDate, badge, statusTag, title, link, field, input, select, options, area, versionLabel, ref, message } from '../ui/components.ts';
import { heading, pageHelp } from '../ui/layout.ts';
import { panel, table, tablePanel, tabs, note, pagedCollection } from '../ui/widgets.ts';
import { modal, close } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { workflowActionGroup, workflowButton, workflowSubmit } from '../ui/workflow-actions.ts';
import { openImplementationStage, renderImplementationProgress } from './repository/implementation-progress.ts';

const familyPath=(id,query=new URLSearchParams())=>'notification-families/'+id+(query.size?'?'+query:'');
const action=(name,label,data='')=>`<button type="button" class="btn small" data-action="${name}" ${data}>${esc(label)}</button>`;
const author=(row)=>covered(row.regulatory_owner_unit_id,['AUTHOR']);
const relationTypes=['AMENDS','CLARIFIES','SUPERSEDES','REPEALS'].map(id=>({id,name:title(id)}));
const counted=(count,singular,plural=singular+'s')=>count+' '+(count===1?singular:plural);
const recordedScopes=(row)=>row.scopes.filter(scope=>scope.id);
const hasImplementation=(row)=>recordedScopes(row).length>0;

const familyStatusLabels = {
  NO_IMPACT: 'No impact',
  NOT_ASSESSED: 'Not assessed',
  IN_PROGRESS: 'In progress',
  UNDER_REVIEW: 'Under review',
  WITHIN_TIMELINE: 'Within timeline',
  NO_APPROVED_SOURCE: 'No approved source',
  NO_APPROVED_DEADLINE: 'No approved deadline',
  REASSESSMENT_REQUIRED: 'Reassessment required',
};

function familyStatus(value) {
  const label = familyStatusLabels[value];
  if (!label) return badge(value);
  const tone = value === 'NO_IMPACT' ? 'green' : value === 'REASSESSMENT_REQUIRED' ? 'red'
    : ['IN_PROGRESS', 'UNDER_REVIEW'].includes(value) ? 'amber' : 'neutral';
  return statusTag(label, tone);
}

function familyRegister(data, when, q, domain, filters) {
  const rows = data.families.map(({root, notification_count, latest_issued, obligation_count}) => {
    const path = familyPath(root.id, new URLSearchParams({as_of: when}));
    const obligations = familyPath(root.id, new URLSearchParams({as_of: when, show: 'obligations'}));
    const regulator = state.masters?.regulator?.find(row => row.id === root.regulator_id)?.code || root.regulator_name;
    return [
      `<span class="family-register-source"><code>${esc(root.code)}</code><strong>${esc(root.short_title || root.title)}</strong>${root.official_reference_number ? `<small>${esc(root.official_reference_number)}</small>` : ''}</span>`,
      `<span class="family-regulator">${esc(regulator)}</span><small>${esc(root.domain_name)}</small>`,
      `<strong>${notification_count}</strong><small>${root.restricted_parent ? 'Authorised branch' : notification_count > 1 ? counted(notification_count - 1, 'amendment') : 'Standalone'}</small>`,
      latest_issued ? `<code>${esc(latest_issued.code)}</code><small>${date(latest_issued.issue_date)}</small>` : '—',
      statusTag(title(root.materiality), root.materiality === 'CRITICAL' ? 'red' : root.materiality === 'HIGH' ? 'amber' : 'neutral'),
      `<a class="family-register-link" href="#${esc(obligations)}" aria-label="View ${counted(obligation_count, 'obligation')} for ${esc(root.short_title || root.title)}">${obligation_count}${icon('arrow')}</a>`,
      `<a class="family-register-link" href="#${esc(path)}">Open family${icon('arrow')}</a>`,
    ];
  });
  const total = data.pagination?.total ?? rows.length;
  return heading('Notification families','Original notifications and amendments, grouped by family.',link('repository','Regulatory library','btn'))+
    filters + `<p class="family-register-total">${counted(total,q||domain?'matching family':'authorised family',q||domain?'matching families':'authorised families')} · ${counted(data.authorised_instruments,'authorised library record')}</p>` +
    '<div class="family-register">' + tablePanel(table(['Original notification','Regulator / domain','Notifications','Latest issued','Materiality','Obligations','Family'], rows,{
      pageKey:'families', pagination:data.pagination, label:'families', caption:'Notification families',
      empty:q||domain ? 'No matching notification families' : 'No notification families are available in your scope',
    })) + '</div>';
}

function familyNotifications(data, selectedId, when, tab) {
  const parents = new Map(data.members.map(row => [row.id, row.code]));
  const members = data.members.map(row => {
    const selected = row.id === selectedId;
    const path = familyPath(data.root_id, new URLSearchParams({as_of: when, notification: row.id, tab}));
    const approved = row.versions.find(version => version.id === row.source_version_id);
    const obligationCount = data.member_obligation_counts?.[row.id];
    const relationship = row.restricted_parent ? 'Authorised branch' : row.relationship === 'AMENDS' ? 'Amendment' : title(row.relationship);
    const parent = parents.get(row.parent_id);
    const deadline = row.deadline.current?.due_date;
    return `<article class="family-notification${selected ? ' selected' : ''}" style="--depth:${row.depth}">
      <span class="family-notification-icon" aria-hidden="true">${row.depth ? '↳' : icon('org')}</span>
      <div class="family-notification-main"><code>${esc(row.code)}</code>
        <a class="family-node" href="#${esc(path)}"${selected ? ' aria-current="true"' : ''}>${esc(row.title)}</a>
        <div class="family-notification-meta">${statusTag(relationship, row.depth ? 'neutral' : 'green')}
          ${parent ? `<span>of ${esc(parent)}</span>` : ''}${row.official_reference_number ? `<span>${esc(row.official_reference_number)}</span>` : ''}
          <span>Issued ${date(row.issue_date)}</span><span>${esc(row.type_name)}</span>
        </div>
        <div class="family-notification-timeline"><span>Effective ${date(row.effective_date)}</span>
          ${deadline ? `<span>Regulatory deadline ${date(deadline)}${row.deadline.inherited ? ' · inherited from parent' : ''}</span>` : ''}
          ${familyStatus(row.timing)}
        </div>
      </div>
      <div class="family-notification-status">${badge(row.regulatory_status)}
        <span>${approved ? 'v' + esc(versionLabel(approved.version_number)) : 'No approved edition'}${typeof obligationCount === 'number' ? ' · ' + counted(obligationCount,'obligation') : ''}</span>
        <span>${familyStatus(row.implementation_status)}${row.scopes.length ? '<small>' + row.resolved_scopes + '/' + row.scopes.length + ' scopes resolved</small>' : ''}</span>
      </div>
    </article>`;
  });
  return panel('Notifications in this family', pagedCollection(members, {
    pageKey:'family-members', label:'notifications', className:'family-notifications', summary:false,
    revealIndex:data.members.findIndex(row => row.id === selectedId),
  }), {cls:'family-members', sub:'Select a notification to view its source, approved obligations and deadline history.'});
}

function familyProgress(data) {
  if (!data.implementation_progress) return renderImplementationProgress(undefined, '');
  const open = data.open_actions || [];
  const chips = [
    ['obligations', 'Obligations', data.implementation_progress.obligations.total],
    ['open_actions', 'Open actions', open.length],
    ['overdue_actions', 'Overdue actions', open.filter(row => row.overdue).length],
    ['evidence_accepted', 'Evidence accepted', data.implementation_progress.evidence.completed],
  ];
  return renderImplementationProgress(data.implementation_progress, `<div class="family-progress-counts">${chips.map(([key,label,count]) =>
    `<button type="button" data-action="family-progress-stage" data-stage="${key}" aria-haspopup="dialog">${esc(label)} <strong>${count}</strong></button>`,
  ).join('')}</div>`);
}

function proposalTable(data,when,focusedProposal) {
  if(!data.proposals.length)return '';
  const names={link:'Amendment / family link',clause:'Earlier-clause link',deadline:'Regulatory deadline',assessment:'Implementation assessment'};
  const tasks=new Map((when===localDate()?data.decision_tasks:[]).map(task=>[task.entity_id,task]));
  const priority=(row)=>row.id===focusedProposal?2:tasks.has(row.id)?1:0;
  const proposals=[...data.proposals].sort((a,b)=>priority(b)-priority(a));
  return `<div id="family-review-panel" class="family-review-panel" tabindex="-1">`+
    panel('Review and approval history',table(['Proposal','Notification','Proposed change / basis','Stage','Requested by','Decision'],proposals.map(row=>{
    const task:any=tasks.get(row.id);const active=['IN_REVIEW','REVIEWED'].includes(row.approval_status);
    const args=`data-kind="${esc(row.kind)}" data-id="${esc(row.id)}"`;
    const decide=(decision,label)=>workflowButton('family-decision',label,decision,args+` data-decision="${decision}"`);
    const review=task?.stage==='COMPLIANCE_REVIEW';
    const buttons=task?workflowActionGroup(decide(review?'REVIEW':'APPROVE',review?'Record review':'Approve')+
      decide('RETURN','Return for changes')+decide('REJECT','Reject'), 'Decision required', true):
      when===localDate()&&active&&row.created_by===state.identity.user.id?decide('WITHDRAW','Withdraw proposal'):'Retained history';
    const change=row.kind==='deadline'?date(row.due_date)+' from '+date(row.effective_from):row.kind==='assessment'?title(row.outcome)+' · revision '+row.revision:row.kind==='link'?title(row.relationship_type):title(row.relationship_type);
    let references=row.kind==='link'?link('notification-families/'+row.parent_id,row.parent_code||'Original notification','text-link')+' → '+link('repository/'+row.child_id,row.instrument_code,'text-link'):'';
    if(row.kind==='clause')references=['source','target'].map(side=>link('repository/'+row[side+'_instrument_id']+'?version='+row[side+'_version_id']+'&tab=clauses&clause='+row[side+'_clause_id'],row[side+'_clause_code'],'text-link')).join(' → ');
    if(row.source_version_id&&row.kind!=='clause')references=link('repository/'+row.source_instrument_id+'?version='+row.source_version_id+'&tab=clauses','Cited source v'+versionLabel(row.source_version_number),'text-link');
    if(row.scope_org_unit_id)references+='<small>Business scope: '+esc(ref('organisational_unit',row.scope_org_unit_id))+'</small>';
    return [esc(names[row.kind]||title(row.kind)),esc(data.members.find(member=>member.id===row.instrument_id)?.code||row.instrument_code),esc(change)+`<div>${references}</div><small>${esc(row.basis||row.rationale||row.description||'')}</small>`,
      task?statusTag(review?'Compliance review':'Awaiting final approval','amber'):badge(row.approval_status),esc(ref('user',row.created_by)),
      `<div data-family-proposal="${esc(row.id)}" tabindex="-1"${focusedProposal===row.id?' aria-current="true"':''}>${buttons}</div>`];
  }),{pageKey:'family-review',empty:'No proposals are recorded for this authorised family.'}),
    {sub:tasks.size?counted(tasks.size,'decision')+' assigned to you.':''})+'</div>';
}

export async function notificationFamiliesPage(id,query=new URLSearchParams()) {
  query=new URLSearchParams(query);
  if(query.has('tab')&&!['implementation','sources','deadlines','obligations'].includes(query.get('tab')))query.set('tab','sources');
  const when=query.get('as_of')||localDate();const q=query.get('q')||'';const domain=query.get('domain_id')||'';
  const filters=new URLSearchParams(query);
  filters.set('as_of',when);
  if (id) filters.set('include_implementation_progress','true');
  else filters.set('library','true');
  const data=await api('/notification-families'+(id?'/'+id:'')+'?'+(id?filters:apiPageQuery(filters,'families')));
  state.view.family=data;
  const domains = (state.masters?.regulatory_domain || [])
    .filter(row => data.domain_ids?.includes(row.id)).sort((a,b) => a.name.localeCompare(b.name));
  const dateForm=(route)=>`<form id="family-filters" class="family-filters ${id?'family-filters-date':'family-filters-register'}" data-route="${esc(route)}" aria-label="Notification family filters"><div class="family-filter-controls">
    ${id ? '' : field('Search notifications',input('q',q,'search','placeholder="Search any notification in the family"')) +
      field('Domain',select('domain_id',domains,domain,'name','aria-label="Domain"','All domains'))}
    ${field('As of date',input('as_of',when,'date','required'))}<button type="submit" class="btn primary family-filter-apply">Apply filters</button>
    </div>${id?`<input type="hidden" name="notification" value="${esc(query.get('notification')||id)}"><input type="hidden" name="tab" value="${esc(query.get('tab')||'sources')}">`:''}</form>`;
  if(!id) return familyRegister(data, when, q, domain, dateForm('notification-families'));
  const selected=data.members.find(row=>row.id===(query.get('notification')||id))||data.members[0];
  const root=data.members.find(row=>row.id===data.root_id);
  if(query.get('tab')==='implementation'&&!hasImplementation(selected))query.set('tab','sources');
  const tab=query.get('tab')||'sources';const current=when===localDate();
  const selectedQuery=new URLSearchParams({as_of:when,notification:selected.id});
  const canAuthor=current&&author(selected);
  const reviewHistory=proposalTable(data,when,query.get('proposal'));
  const showDecisionsFirst=current&&data.decision_tasks.length>0;
  let body='';
  if(tab==='obligations')body=panel('Approved linked obligations',table(['Obligation','Source citation','Accountable department','Criticality','Status'],(data.obligations?.[selected.id]||[]).map(o=>[
    link('obligations/'+o.id,o.code+' · '+o.title),o.citations.map(c=>esc(c.clause_code)+' · '+esc(title(c.role))).join('<br>'),esc(ref('organisational_unit',o.business_owner_unit_id)),badge(o.criticality),badge(o.record_status),
  ]),{empty:'No approved linked obligations in your scope.'}),{sub:'Includes primary and approved supporting citations in your authorised scope.',action:link('obligations?instrument='+selected.id,'Open obligation register','btn small')});
  else if(tab==='sources')body=panel('Source editions',table(['Edition','Effective from / to','Approval','Open source record'],selected.versions.map(v=>[
    esc(versionLabel(v.version_number)),date(v.effective_from)+(v.effective_to?' → '+date(v.effective_to)+' (exclusive)':''),badge(v.approval_status)+(v.effective_from>when?badge('UPCOMING'):v.id===selected.source_version_id?badge('CURRENT'):''),link('repository/'+selected.id+'?version='+v.id+'&tab=clauses','Open source edition','text-link')
  ])))+note('A source edition updates this notification. A separately issued amendment is a separate linked library record.');
  else if(tab==='deadlines')body=panel('Regulatory deadline history',table(['Notification','Approved source edition','Regulatory due date','Effective from','Decision','Basis'],data.deadlines.map(d=>[
    esc(data.members.find(r=>r.id===d.instrument_id)?.code),link('repository/'+data.members.find(r=>r.versions.some(v=>v.id===d.source_version_id))?.id+'?version='+d.source_version_id,'Open cited source','text-link'),date(d.due_date),date(d.effective_from),badge(d.approval_status),esc(d.basis)
  ])),{action:canAuthor?action('family-deadline','Propose regulatory deadline',`data-id="${esc(selected.id)}"`):''})+note('Approved source-cited events preserve the original date. Internal action extensions never change regulatory deadlines.');
  else body=panel('Business implementation',pagedCollection(recordedScopes(selected).map(scope=>`<article class="family-scope"><div class="row between"><div><h3>${esc(ref('organisational_unit',scope.org_unit_id))}</h3><p>Implementation owner: ${esc(ref('user',scope.owner_user_id))}</p></div>${badge(scope.status)}</div><p>Source: ${scope.source_version_id?esc(versionLabel(selected.versions.find(v=>v.id===scope.source_version_id)?.version_number)):'No effective approved source'} · ${scope.actions.length} source-specific actions · ${scope.assessments.length} retained assessment proposals</p>${current&&scope.id&&scope.owner_user_id===state.identity.user.id&&covered(scope.org_unit_id,['BUSINESS_OWNER'])?action('family-assessment','Assess implementation',`data-id="${esc(scope.id)}" data-instrument="${esc(selected.id)}" data-version="${esc(scope.source_version_id||'')}"`):''}${scope.last_approved?`<p>Last approved outcome: ${esc(title(scope.last_approved.outcome))} · revision ${scope.last_approved.revision}. A source or delivery change requires reassessment.</p>`:''}${table(['Action','Owner','Due','Status'],scope.actions.map(a=>[esc(a.code)+'<small>'+esc(a.description)+'</small>',esc(ref('user',a.owner_user_id)),date(a.current_due_date),badge(a.record_status)]),{summary:false,pageKey:'scope-actions-'+scope.id})}</article>`),{pageKey:'implementation-scopes',label:'departments'}));
  return pageHelp('Originals and amendments, together','Read each source, its separate business implementation and approved regulatory deadline history. Select a notification to inspect its own records.')+
    link('notification-families?' + new URLSearchParams({as_of:when}),'← Notification families','back-link')+
    heading(root.short_title || root.title,counted(data.members.length,'notification')+' in this family · Position on '+date(when),
      `<button type="button" id="family-obligations" class="btn" data-action="family-progress-stage" data-stage="obligations" aria-haspopup="dialog">Family obligations</button>`+
      (canAuthor?link('repository/new?family_parent='+selected.id,'Register amendment','btn primary')+action('family-link','Link existing notification',`data-id="${esc(selected.id)}"`):''))+
    (root.restricted_parent?note('This is your authorised branch of the notification family.'):'')+
    (showDecisionsFirst?reviewHistory:'')+
    familyProgress(data)+
    dateForm('notification-families/'+root.id)+
    (current?'':note('Family membership, source history and deadlines follow the selected date. Implementation progress uses current records for those notifications.'))+
    familyNotifications(data,selected.id,when,tab)+
    `<div class="family-selected-heading"><div><code>${esc(selected.code)}</code><h2 id="family-selected-notification" tabindex="-1">${esc(selected.title)}</h2><p>Official reference: ${esc(selected.official_reference_number||'Not recorded')}</p></div><div class="actions">${link('repository/'+selected.id,'Open library record','btn')}</div></div>`+
    tabs([['sources','Source editions',selected.versions.length],['obligations','Obligations',(data.obligations?.[selected.id]||[]).length],...(hasImplementation(selected)?[['implementation','Business implementation',recordedScopes(selected).length]]:[]),['deadlines','Regulatory deadline history',data.deadlines.length]],tab,'notification-families/'+root.id,selectedQuery)+body+(showDecisionsFirst?'':reviewHistory);
}

async function reviewers(unit,scope='') {
  const people=(role)=>scope?api('/notification-scopes/'+scope+'/assignees?role='+role):choosePeople(role,unit,[state.identity.user.id]);
  const [review,approve]=await Promise.all([people('REVIEWER'),people('APPROVER')]);
  return field('Compliance reviewer',select('reviewer_id',review,'','full_name','required'))+field('Final approver',select('approver_id',approve,'','full_name','required'));
}

export function notificationFamilyHandlers({render}) {
  const member=(id)=>state.view.family.members.find(row=>row.id===id);
  const setForm=(id,route)=>{document.querySelector<HTMLFormElement>('#'+id).dataset.route=route;};
  return {actions:{
    'family-progress-stage': (data, trigger) => openImplementationStage(data, trigger, state.view.family),
    'family-link':async({id})=>{
      const parent=member(id);const records=await api('/instruments');
      const candidates=records.filter(row=>!state.view.family.members.some(member=>member.id===row.id)&&row.regulator_id===parent.regulator_id&&author(row));
      modal('Link existing notification',`<div class="grid">${field('Existing notification',select('child_id',candidates.map(row=>({...row,name:row.code+' · '+row.title})),'','name','required'))}${field('Relationship',select('relationship_type',relationTypes,'AMENDS'))}${field('Effective from',input('effective_from',localDate(),'date','required'))}${field('Relationship basis',area('basis','','required minlength="10"'))}${await reviewers(parent.regulatory_owner_unit_id)}</div><p>Independent review and final approval are required. Existing source editions and implementation decisions are retained.</p>`,'family-proposal','Submit relationship for review');
      setForm('family-proposal','/notification-families/'+id+'/links');
      const form=document.querySelector<HTMLFormElement>('#family-proposal');
      form.querySelector('[name=child_id]').addEventListener('change',async()=>{
        const identifier=(form.elements.namedItem('child_id') as HTMLSelectElement).value;
        const child=candidates.find(row=>row.id===identifier);
        for(const name of ['reviewer_id','approver_id'])(form.elements.namedItem(name) as HTMLSelectElement).innerHTML=options([]);
        if(!child)return;
        (form.elements.namedItem('effective_from') as HTMLInputElement).value=child.effective_date||localDate();
        try{
          const [review,approve]=await Promise.all([choosePeople('REVIEWER',child.regulatory_owner_unit_id,[state.identity.user.id]),choosePeople('APPROVER',child.regulatory_owner_unit_id,[state.identity.user.id])]);
          if(!form.isConnected||(form.elements.namedItem('child_id') as HTMLSelectElement).value!==identifier)return;
          (form.elements.namedItem('reviewer_id') as HTMLSelectElement).innerHTML=options(review,'','full_name');
          (form.elements.namedItem('approver_id') as HTMLSelectElement).innerHTML=options(approve,'','full_name');
        }catch(error){message(error.message,true);}
      });
    },
    'family-deadline':async({id})=>{
      const row=member(id);const versions=state.view.family.members.flatMap(item=>item.versions.filter(v=>v.approval_status==='APPROVED').map(v=>({...v,name:item.code+' · v'+versionLabel(v.version_number)})));
      modal('Propose regulatory deadline',`<div class="grid">${field('Cited approved source edition',select('source_version_id',versions,'','name','required'))}${field('Regulatory due date',input('due_date','','date','required'))}${field('Effective from',input('effective_from',localDate(),'date','required'))}${field('Regulatory basis / source citation',area('basis','','required minlength="10"'))}${await reviewers(row.regulatory_owner_unit_id)}</div><p>Pending proposals leave the current deadline unchanged. This is separate from an internal action extension.</p>`,'family-proposal','Submit deadline for review');
      setForm('family-proposal','/notification-families/'+id+'/deadlines');
    },
    'family-assessment':async({id,instrument,version})=>{
      if(!version)throw new Error('An approved source edition must be effective today before assessment.');
      const row=member(instrument);
      modal('Assess notification implementation',`<input type="hidden" name="source_version_id" value="${esc(version)}"><div class="grid">${field('Outcome',select('outcome',[{id:'COMPLETED',name:'Completed'},{id:'NO_IMPACT',name:'No impact'}],'','name','required'))}${field('Source-specific rationale',area('rationale','','required minlength="10"'))}${await reviewers(row.regulatory_owner_unit_id,id)}</div><p>Completion requires every exact-source delivery action to be completed with accepted independent evidence. No impact is unavailable while those delivery actions exist.</p>`,'family-proposal','Submit assessment for review');
      setForm('family-proposal','/notification-scopes/'+id+'/assessments');
    },
    'family-decision':({id,kind,decision},trigger)=>{
      const label=({REVIEW:'Record review',APPROVE:'Approve proposal',RETURN:'Return for changes',REJECT:'Reject proposal',WITHDRAW:'Withdraw proposal'})[decision]||title(decision);
      modal(label,field('Decision rationale',area('comments','','required minlength="3"'))+(decision==='REVIEW'||decision==='APPROVE'?'<label class="check-label"><input type="checkbox" required>I am independent of the maker and reviewed the source-specific facts.</label>':''),'family-decision',workflowSubmit(label,decision),'',trigger);
      const form=document.querySelector<HTMLFormElement>('#family-decision');form.dataset.route='/family-proposals/'+kind+'/'+id+'/decision';form.dataset.decision=decision;
    },
    'link-earlier-clause':async({id,instrument})=>{
      const candidates=await api('/clauses/'+id+'/related-candidates');
      const record=await api('/instruments/'+instrument);
      if(!candidates.length){modal('Link an earlier clause','<p>No approved earlier clauses are available in this notification family. Choose a different source clause or register and approve the earlier source first.</p>');return;}
      modal('Link an earlier clause',`<div class="grid">${field('Related approved clause',select('target_clause_id',candidates.map(row=>({...row,name:row.instrument_code+' · '+row.code+' · '+(row.source_clause_reference||'')+' · v'+versionLabel(row.version_number)})),'','name','required'))}${field('Relationship',select('relationship_type',['AMENDS','SUPERSEDES','REFERS_TO','DEPENDS_ON','REPEALS'].map(value=>({id:value,name:title(value)})),'AMENDS'))}${field('Effective from',input('effective_from',localDate(),'date','required'))}${field('Regulatory relationship basis',area('description','','required minlength="10"'))}${await reviewers(record.instrument.regulatory_owner_unit_id)}</div><p>This preserves a governed relationship. It does not make a clause from another edition a structural parent.</p>`,'family-proposal','Submit relationship for review');
      setForm('family-proposal','/clauses/'+id+'/relationships');
    },
  },forms:{
    'family-filters':(form)=>{const data=new URLSearchParams(new FormData(form) as any);location.hash=form.dataset.route+'?'+data;},
    'family-proposal':async(form)=>{if(form.dataset.route.endsWith('/scopes'))throw new Error('Manual business-scope registration is deferred.');await api(form.dataset.route,'POST',Object.fromEntries(new FormData(form)));close();message('Saved. Submitted decisions remain pending until independent review and final approval.');await render();},
    'family-decision':async(form)=>{await api(form.dataset.route,'POST',{decision:form.dataset.decision,comments:form.elements.comments.value});close();message('Decision recorded; earlier history is retained.');await render();},
  }};
}
