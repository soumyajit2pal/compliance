import { api } from '../core/api.ts';
import { state } from '../core/state.ts';
import { covered } from '../core/access.ts';
import { choosePeople } from '../core/assignees.ts';
import { esc, date, localDate, badge, title, link, field, input, select, options, area, versionLabel, ref, message } from '../ui/components.ts';
import { heading, pageHelp } from '../ui/layout.ts';
import { panel, table, tabs, note } from '../ui/widgets.ts';
import { modal, close } from '../ui/dialog.ts';

const familyPath=(id,query=new URLSearchParams())=>'notification-families/'+id+(query.size?'?'+query:'');
const resolved=(row)=>['COMPLETED','NO_IMPACT'].includes(row.implementation_status);
const action=(name,label,data='')=>`<button type="button" class="btn small" data-action="${name}" ${data}>${esc(label)}</button>`;
const stat=(name,value,detail)=>`<section class="panel family-stat"><div class="eyebrow">${esc(name)}</div><div class="family-value">${value}</div><p>${detail}</p></section>`;
const author=(row)=>covered(row.regulatory_owner_unit_id,['AUTHOR']);
const relationTypes=['AMENDS','CLARIFIES','SUPERSEDES','REPEALS'].map(id=>({id,name:title(id)}));
const counted=(count,singular,plural=singular+'s')=>count+' '+(count===1?singular:plural);

function proposalTable(data,when) {
  const tasks=new Map(data.decision_tasks.map(task=>[task.entity_id,task]));
  return panel('Independent proposals and decisions',table(['Proposal','Notification','Proposed change / basis','Stage','Requested by','Decision'],data.proposals.map(row=>{
    const task:any=tasks.get(row.id);const active=['IN_REVIEW','REVIEWED'].includes(row.approval_status);
    const args=`data-kind="${esc(row.kind)}" data-id="${esc(row.id)}"`;
    let buttons='';
    if(when===localDate()&&task)buttons=action('family-decision',task.stage==='COMPLIANCE_REVIEW'?'Record review':'Approve',args+` data-decision="${task.stage==='COMPLIANCE_REVIEW'?'REVIEW':'APPROVE'}"`)+action('family-decision','Return',args+' data-decision="RETURN"')+action('family-decision','Reject',args+' data-decision="REJECT"');
    if(when===localDate()&&active&&row.created_by===state.identity.user.id)buttons+=action('family-decision','Withdraw proposal',args+' data-decision="WITHDRAW"');
    const change=row.kind==='deadline'?date(row.due_date)+' from '+date(row.effective_from):row.kind==='assessment'?title(row.outcome)+' · revision '+row.revision:row.kind==='link'?title(row.relationship_type):title(row.relationship_type);
    let references=row.kind==='link'?link('notification-families/'+row.parent_id,row.parent_code||'Original notification','text-link')+' → '+link('repository/'+row.child_id,row.instrument_code,'text-link'):'';
    if(row.kind==='clause')references=['source','target'].map(side=>link('repository/'+row[side+'_instrument_id']+'?version='+row[side+'_version_id']+'&tab=clauses&clause='+row[side+'_clause_id'],row[side+'_clause_code'],'text-link')).join(' → ');
    if(row.source_version_id&&row.kind!=='clause')references=link('repository/'+row.source_instrument_id+'?version='+row.source_version_id+'&tab=clauses','Cited source v'+versionLabel(row.source_version_number),'text-link');
    if(row.scope_org_unit_id)references+='<small>Business scope: '+esc(ref('organisational_unit',row.scope_org_unit_id))+'</small>';
    return [esc(title(row.kind)),esc(data.members.find(member=>member.id===row.instrument_id)?.code||row.instrument_code),esc(change)+`<div>${references}</div><small>${esc(row.basis||row.rationale||row.description||'')}</small>`,badge(row.approval_status),esc(ref('user',row.created_by)),`<div class="actions">${buttons||'Retained history'}</div>`];
  }),{empty:'No proposals are recorded for this authorised family.'}),{cls:'mt24'});
}

export async function notificationFamiliesPage(id,query=new URLSearchParams()) {
  query=new URLSearchParams(query);
  if(query.has('tab')&&!['implementation','sources','deadlines'].includes(query.get('tab')))query.set('tab','implementation');
  const when=query.get('as_of')||localDate();const q=query.get('q')||'';
  const data=await api('/notification-families'+(id?'/'+id:'')+'?'+new URLSearchParams({as_of:when,...(!id?{q}:{})}));
  state.view.family=data;
  const dateForm=(route)=>`<form id="family-filters" class="family-filters ${id?'family-filters-date':'family-filters-register'}" data-route="${esc(route)}" aria-label="Notification family filters" aria-describedby="family-filter-help"><div class="family-filter-controls">${field('As of date',input('as_of',when,'date','required aria-describedby="family-filter-help"'))}${!id?field('Search notifications',input('q',q,'search','placeholder="Title or reference number" aria-describedby="family-filter-help"')):''}<button type="submit" class="btn primary family-filter-apply">Apply filters</button></div>${id?`<input type="hidden" name="notification" value="${esc(query.get('notification')||id)}"><input type="hidden" name="tab" value="${esc(query.get('tab')||'implementation')}">`:''}<p id="family-filter-help" class="family-filter-help">The date applies to approved source history and regulatory deadlines. Upcoming amendments remain visible.</p></form>`;
  if(!id) return pageHelp('Originals and amendments, together','Every authorised library record appears, including standalone notifications. Source editions remain within a record; separately issued amendments are linked records. Counts use retained decisions and registered business scopes.')+
    heading('Notification families','Original notifications, amendments and source-cited regulatory deadlines.',link('repository','Regulatory library','btn'))+
    dateForm('notification-families')+note(`${counted(data.families.length,q?'matching family':'authorised family',q?'matching families':'authorised families')} · ${counted(data.authorised_instruments,q?'authorised library record':'library record')}. Each notification retains its own source and implementation decisions.`)+
    `<div class="family-list">${data.families.map(f=>`<a class="panel family-card" href="#${esc(familyPath(f.root.id,new URLSearchParams({as_of:when})))}"><div class="row between"><code>${esc(f.root.code)}</code>${badge(f.overdue?'OVERDUE':f.root.implementation_status)}</div><h2>${esc(f.root.title)}</h2><p>${esc(f.root.official_reference_number||'Official reference not recorded')}</p><p>${f.root.restricted_parent?'Authorised branch':f.amendments?counted(f.amendments,'authorised amendment'):'Standalone notification'} · ${f.root.resolved_scopes}/${f.root.scopes.length} registered ${f.root.scopes.length===1?'scope':'scopes'} resolved</p><p>Regulatory deadline: ${date(f.root.deadline.current?.due_date)} · ${f.upcoming} upcoming</p></a>`).join('')||panel(q?'No matching notification families':'No notification families',q?'Change the search or as-of date and apply the filters.':'No records are available in your authorised library.')}</div>`;
  const selected=data.members.find(row=>row.id===(query.get('notification')||id))||data.members[0];
  const root=data.members.find(row=>row.id===data.root_id);const children=data.members.filter(row=>row.id!==root.id);
  const tab=query.get('tab')||'implementation';const current=when===localDate();
  const selectedQuery=new URLSearchParams({as_of:when,notification:selected.id});
  const pending=children.filter(row=>!resolved(row)&&row.timing!=='UPCOMING');
  const canAuthor=current&&author(selected);
  let body='';
  if(tab==='sources')body=panel('Source editions',table(['Edition','Effective from / to','Approval','Open source record'],selected.versions.map(v=>[
    esc(versionLabel(v.version_number)),date(v.effective_from)+(v.effective_to?' → '+date(v.effective_to)+' (exclusive)':''),badge(v.approval_status)+(v.effective_from>when?badge('UPCOMING'):v.id===selected.source_version_id?badge('CURRENT'):''),link('repository/'+selected.id+'?version='+v.id+'&tab=clauses','Open source edition','text-link')
  ])))+note('A source edition updates this notification. A separately issued amendment is a separate linked library record.');
  else if(tab==='deadlines')body=panel('Regulatory deadline history',table(['Notification','Approved source edition','Regulatory due date','Effective from','Decision','Basis'],data.deadlines.map(d=>[
    esc(data.members.find(r=>r.id===d.instrument_id)?.code),link('repository/'+data.members.find(r=>r.versions.some(v=>v.id===d.source_version_id))?.id+'?version='+d.source_version_id,'Open cited source','text-link'),date(d.due_date),date(d.effective_from),badge(d.approval_status),esc(d.basis)
  ])),{action:canAuthor?action('family-deadline','Propose regulatory deadline',`data-id="${esc(selected.id)}"`):''})+note('Approved source-cited events preserve the original date. Internal action extensions never change regulatory deadlines.');
  else body=panel('Business implementation scopes',selected.scopes.map(scope=>`<article class="family-scope"><div class="row between"><div><h3>${esc(ref('organisational_unit',scope.org_unit_id))}</h3><p>Implementation owner: ${esc(ref('user',scope.owner_user_id))}</p></div>${badge(scope.status)}</div><p>Source: ${scope.source_version_id?esc(versionLabel(selected.versions.find(v=>v.id===scope.source_version_id)?.version_number)):'No effective approved source'} · ${scope.actions.length} source-specific actions · ${scope.assessments.length} retained assessment proposals</p>${scope.inherited_pending?'<p>Inherited business scope is pending. Register it for this notification before assessment.</p>':''}${current&&scope.id&&scope.owner_user_id===state.identity.user.id&&covered(scope.org_unit_id,['BUSINESS_OWNER'])?action('family-assessment','Assess implementation',`data-id="${esc(scope.id)}" data-instrument="${esc(selected.id)}" data-version="${esc(scope.source_version_id||'')}"`):''}${scope.last_approved?`<p>Last approved outcome: ${esc(title(scope.last_approved.outcome))} · revision ${scope.last_approved.revision}. A source or delivery change requires reassessment.</p>`:''}${table(['Action','Owner','Due','Status'],scope.actions.map(a=>[esc(a.code)+'<small>'+esc(a.description)+'</small>',esc(ref('user',a.owner_user_id)),date(a.current_due_date),badge(a.record_status)]),{summary:false})}</article>`).join('')||'<p>No business scopes registered. An empty scope list is never treated as completed.</p>',{action:canAuthor?action('family-scope','Register business scope',`data-id="${esc(selected.id)}"`):''});
  return pageHelp('Originals and amendments, together','Read each source, its separate business implementation and approved regulatory deadline history. Select a notification to inspect its own records.')+
    link('notification-families','← Notification families','back-link')+
    heading(root.title,root.code+' · Position on '+date(when),link('repository','Regulatory library','btn')+(canAuthor?link('repository/new?family_parent='+selected.id,'Register amendment','btn primary')+action('family-link','Link existing notification',`data-id="${esc(selected.id)}"`):''))+
    `<div class="family-summary">${stat(root.restricted_parent?'Selected requirements':'Original requirements',badge(root.implementation_status),root.resolved_scopes+' of '+root.scopes.length+' registered business scopes resolved')}${stat('Amendment implementation',children.filter(resolved).length+' / '+children.length+' resolved',children.length?pending.length+' current notifications pending · '+children.filter(r=>r.timing==='UPCOMING').length+' upcoming · '+children.filter(r=>r.timing==='OVERDUE').length+' overdue':'No authorised amendments linked.')}${stat('Current parent regulatory deadline',date(root.deadline.current?.due_date),'Original approved date: '+date(root.deadline.original?.due_date)+(root.deadline.next?'<br>Next approved date: '+date(root.deadline.next.due_date)+' from '+date(root.deadline.next.effective_from):''))}</div>`+
    note((root.restricted_parent?'An ancestor is outside your access; this view covers your authorised branch only. ':'')+'All totals cover only authorised notifications and registered business scopes. Implementation does not assert compliance assurance. <strong>Assurance: Not assessed.</strong> Future-effective amendments remain visible as upcoming.')+
    dateForm('notification-families/'+root.id)+
    (current?'':note('Source and regulatory deadline histories follow the selected date. Delivery details use the latest retained records; later delivery changes can conservatively require reassessment.'))+
    panel('Notification family',table(['Notification / amendment','Official reference','Relationship','Effective from','Implementation','Regulatory deadline','Timeline','Related records'],data.members.map(row=>{
      const rowQuery=new URLSearchParams({as_of:when,notification:row.id,tab});
      return [`<a class="family-node ${row.id===selected.id?'selected':''}" style="--depth:${row.depth}" href="#${esc(familyPath(root.id,rowQuery))}"><code>${esc(row.code)}</code><strong>${row.depth?'↳ ':''}${esc(row.title)}</strong></a>`,esc(row.official_reference_number||'Not recorded'),esc(title(row.id===root.id&&root.restricted_parent?'AUTHORISED_BRANCH':row.relationship)),date(row.effective_date),badge(row.implementation_status)+`<small>${row.resolved_scopes}/${row.scopes.length} scopes resolved</small>`,date(row.deadline.current?.due_date)+(row.deadline.inherited?'<small>Inherited from parent</small>':''),badge(row.timing),link('repository/'+row.id,'Open library record','text-link')];
    })))+
    `<div class="family-selected-heading"><div><code>${esc(selected.code)}</code><h2>${esc(selected.title)}</h2><p>Official reference: ${esc(selected.official_reference_number||'Not recorded')}</p></div><div class="actions">${link('repository/'+selected.id,'Open library record','btn')}</div></div>`+
    tabs([['implementation','Business implementation',selected.scopes.length],['sources','Source editions',selected.versions.length],['deadlines','Regulatory deadline history',data.deadlines.length]],tab,'notification-families/'+root.id,selectedQuery)+body+proposalTable(data,when);
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
    'family-scope':async({id})=>{
      const units=state.masters.organisational_unit.filter(row=>row.active_flag);
      modal('Register business implementation scope',`<div class="grid">${field('Business organisation',select('org_unit_id',units,'','name','required'))}${field('Implementation owner',select('owner_user_id',[],'','full_name','required'))}${field('Effective from',input('effective_from',localDate(),'date','required'))}</div><p>The scope starts pending. Missing scopes appear as pending for authorised descendants; conclusions are never inherited.</p>`,'family-proposal','Register pending scope');
      setForm('family-proposal','/notification-families/'+id+'/scopes');
      const form=document.querySelector<HTMLFormElement>('#family-proposal');
      const refresh=async()=>{
        const unit=(form.elements.namedItem('org_unit_id') as HTMLSelectElement).value;
        const people=unit?await api('/notification-families/'+id+'/owners?unit_id='+encodeURIComponent(unit)):[];
        const owner=form.elements.namedItem('owner_user_id') as HTMLSelectElement;
        owner.innerHTML='<option value="">Choose an eligible owner</option>'+people.map(row=>`<option value="${esc(row.id)}">${esc(row.full_name)}</option>`).join('');
      };
      form.querySelector('[name=org_unit_id]').addEventListener('change',()=>refresh().catch(error=>message(error.message,true)));
      await refresh();
    },
    'family-assessment':async({id,instrument,version})=>{
      if(!version)throw new Error('An approved source edition must be effective today before assessment.');
      const row=member(instrument);
      modal('Assess notification implementation',`<input type="hidden" name="source_version_id" value="${esc(version)}"><div class="grid">${field('Outcome',select('outcome',[{id:'COMPLETED',name:'Completed'},{id:'NO_IMPACT',name:'No impact'}],'','name','required'))}${field('Source-specific rationale',area('rationale','','required minlength="10"'))}${await reviewers(row.regulatory_owner_unit_id,id)}</div><p>Completion requires every exact-source delivery action to be completed with accepted independent evidence. No impact is unavailable while those delivery actions exist.</p>`,'family-proposal','Submit assessment for review');
      setForm('family-proposal','/notification-scopes/'+id+'/assessments');
    },
    'family-decision':({id,kind,decision})=>{
      modal('Record '+title(decision),field('Decision rationale',area('comments','','required minlength="3"'))+(decision==='REVIEW'||decision==='APPROVE'?'<label class="check-label"><input type="checkbox" required>I am independent of the maker and reviewed the source-specific facts.</label>':''),'family-decision','Record '+title(decision));
      const form=document.querySelector<HTMLFormElement>('#family-decision');form.dataset.route='/family-proposals/'+kind+'/'+id+'/decision';form.dataset.decision=decision;
    },
    'link-earlier-clause':async({id,instrument})=>{
      const candidates=await api('/clauses/'+id+'/related-candidates');
      const record=await api('/instruments/'+instrument);
      modal('Link an earlier clause',`<div class="grid">${field('Related approved clause',select('target_clause_id',candidates.map(row=>({...row,name:row.instrument_code+' · '+row.code+' · '+(row.source_clause_reference||'')+' · v'+versionLabel(row.version_number)})),'','name','required'))}${field('Relationship',select('relationship_type',['AMENDS','SUPERSEDES','REFERS_TO','DEPENDS_ON','REPEALS'].map(value=>({id:value,name:title(value)})),'AMENDS'))}${field('Effective from',input('effective_from',localDate(),'date','required'))}${field('Regulatory relationship basis',area('description','','required minlength="10"'))}${await reviewers(record.instrument.regulatory_owner_unit_id)}</div><p>This preserves a governed relationship. It does not make a clause from another edition a structural parent.</p>`,'family-proposal','Submit relationship for review');
      setForm('family-proposal','/clauses/'+id+'/relationships');
    },
  },forms:{
    'family-filters':(form)=>{const data=new URLSearchParams(new FormData(form) as any);location.hash=form.dataset.route+'?'+data;},
    'family-proposal':async(form)=>{await api(form.dataset.route,'POST',Object.fromEntries(new FormData(form)));close();message('Saved. Submitted decisions remain pending until independent review and final approval.');await render();},
    'family-decision':async(form)=>{await api(form.dataset.route,'POST',{decision:form.dataset.decision,comments:form.elements.comments.value});close();message('Decision recorded; earlier history is retained.');await render();},
  }};
}
