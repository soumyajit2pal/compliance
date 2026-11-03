/** Navigation entry points reuse the existing source-link and obligation workflows. */
import { api } from '../core/api.ts';
import { state } from '../core/state.ts';
import { has,covered } from '../core/access.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { ownerRoles } from '../core/obligation-detail.ts';
import { esc,title,link,input,field,select,fixedSelect,button,badge,date,localDate } from '../ui/components.ts';
import { heading } from '../ui/layout.ts';
import { table,tablePanel } from '../ui/widgets.ts';
import { modal,close } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { applicabilityChoices } from './applicability-register.ts';
import { obligationCoverageCards,coverageResponseStats } from './obligation-coverage.ts';
import { notificationFamilyHandlers } from './notification-families.ts';

const approvals=['DRAFT','IN_REVIEW','REVIEWED','APPROVED','REJECTED','WITHDRAWN'];
const relationTypes=['AMENDS','SUPERSEDES','REFERS_TO','DEPENDS_ON','REPEALS'];
const config={
  'clause-relationships':{name:'Clause / Para relationships',sub:'Earlier-clause links with independent review and approval. Parent hierarchy stays within each source edition.'},
  applicability:{name:'Departments & owners',sub:'See the departments and people responsible for each obligation.'},
  accountability:{name:'Departments & owners',sub:'See the departments and people responsible for each obligation.'},
};
const active=(key)=>(state.masters[key]||[]).filter(r=>r.active_flag!==0);
function filters(kind,query){
  const selected=(name,rows,label,blank)=>field(label,select(name,rows,query.get(name)||'','name','',blank));
  if(kind!=='clause-relationships'){
    const selectedApproval=(name,legacy)=>query.get(name)||(kind===legacy?query.get('approval'):'')||'';
    const approvalOptions=approvals.map(id=>({id,name:({DRAFT:'Draft proposal',IN_REVIEW:'In review',REVIEWED:'Awaiting final approval'})[id]||title(id)}));
    const more=['assessment','legal_entity','owner','assignment_approval','assessment_approval','approval','history'].filter(key=>query.get(key)).length;
    return `<form id="view-filter" class="applicability-filters" aria-label="Departments and owners filters">
      <div class="coverage-filter-main"><div class="search-field">${icon('search')}${input('q',query.get('q')||'','search','placeholder="Search obligation, reference or person" aria-label="Search obligations"')}</div>${selected('role',Object.entries(ownerRoles).map(([id,name])=>({id,name})),'Owner role','All owner roles')}${selected('response',[{id:'PENDING',name:'Awaiting response'},{id:'ACCEPT',name:'Accepted'},{id:'OBJECT',name:'Changes requested'}],'Owner response','All responses')}${selected('department',active('organisational_unit'),'Department','All departments')}<div class="coverage-filter-actions"><button type="submit" class="btn primary">Apply</button>${link(kind,'Clear','btn')}</div></div>
      <div class="coverage-filter-secondary"><label class="check-row"><input type="checkbox" name="mine" value="1" ${query.get('mine')==='1'?'checked':''}>Assigned to me</label><details class="applicability-more-filters" ${more?'open':''}><summary>More filters${more?' · '+more+' applied':''}</summary><div class="applicability-filter-fields">${selected('assessment',applicabilityChoices,'Does it apply?','All decisions')}${selected('legal_entity',active('legal_entity'),'Legal entity','All legal entities')}${selected('owner',active('user').map(r=>({...r,name:r.full_name})),'Named owner','All owners')}${field('Assessment approval',select('assessment_approval',approvalOptions,selectedApproval('assessment_approval','applicability'),'name','','All assessment states'))}${field('Owner assignment approval',select('assignment_approval',approvalOptions,selectedApproval('assignment_approval','accountability'),'name','','All assignment states'))}</div><label class="check-row"><input type="checkbox" name="history" value="1" ${query.get('history')==='1'?'checked':''}>Include earlier revisions and withdrawn or rejected records</label></details></div>
    </form>`;
  }
  let extra='';
  if(kind==='clause-relationships')extra=selected('type',relationTypes.map(id=>({id,name:title(id)})),'Relationship','All relationships');
  return `<form id="view-filter" class="filters obligation-filters regulation-register-filters" aria-label="${esc(config[kind].name)} filters"><div class="search-field">${icon('search')}${input('q',query.get('q')||'','search','placeholder="Search references, titles or names" aria-label="Search '+esc(config[kind].name)+'"')}</div>${extra}${selected('approval',approvals.map(id=>({id,name:title(id)})),'Approval','All approvals')}<label class="check-row"><input type="checkbox" name="history" value="1" ${query.get('history')==='1'?'checked':''}>Include retained records</label><button type="submit" class="btn primary">Apply filters</button>${link(kind,'Clear','btn')}</form>`;
}
function clauseCell(source){return link('clauses?'+new URLSearchParams({instrument:source.instrument_id,edition:source.edition_id,clause:source.id}),source.code,'text-link')+`<small>${esc(source.source_clause_reference||'Unnumbered')} · ${esc(source.heading)}</small><small>${esc(source.instrument_title)} · Edition ${esc(source.edition_number)} · ${esc(title(source.edition_approval))}</small>`;}
function relationActions(row,tasks){
  const task=tasks.find(t=>t.entity_id===row.id);const args=`data-id="${esc(row.id)}" data-kind="clause"`;
  let result='';
  if(task){const choice=task.stage==='COMPLIANCE_REVIEW'?'REVIEW':'APPROVE';result+=button('family-decision',choice==='REVIEW'?'Record review':'Approve',args+` data-decision="${choice}"`,'small primary')+['RETURN','REJECT'].map(decision=>button('family-decision',title(decision),args+` data-decision="${decision}"`,'small')).join('');}
  if(row.created_by===state.identity.user.id&&['IN_REVIEW','REVIEWED'].includes(row.approval_status)&&covered(row.regulatory_owner_unit_id,['AUTHOR']))result+=button('family-decision','Withdraw proposal',args+' data-decision="WITHDRAW"','small');
  return result||'No decision required from you';
}
export async function regulationRegistersPage(kind,query=new URLSearchParams()){
  const request=apiPageQuery(query,kind);
  const grouped=kind!=='clause-relationships';
  if(grouped)request.set('view','obligations');
  const data=await api('/'+kind+'?'+request);
  const options={pageKey:kind,pagination:data.pagination,empty:'No '+(kind==='accountability'?'owner assignments':kind==='applicability'?'applicability assessments':'clause relationships')+' match this view.'};
  let content='';
  if(grouped)content=obligationCoverageCards(data.items,options,kind+(query.size?'?'+query:''));
  if(kind==='clause-relationships')content=table(['Source clause / para','Relationship','Related earlier clause / para','Effective period','Basis','Approval','Decision'],data.items.map(row=>[
    clauseCell(row.source),esc(title(row.relationship_type)),clauseCell(row.target),date(row.effective_from)+`<small>${row.effective_to?'Ends before '+date(row.effective_to):'No end date'}</small>`,esc(row.description),badge(row.approval_status),`<div class="actions">${relationActions(row,data.decision_tasks||[])}</div>`
  ]),options);
  return `<div class="regulation-register ${grouped?'coverage-register':''}">${heading(config[kind].name,config[kind].sub,kind==='clause-relationships'&&has('AUTHOR')?button('relationship-choose-source','Link earlier clause','','primary'):link('obligations','Obligation register','btn'))}${grouped?coverageResponseStats(data):''}${filters(kind,query)}${grouped?`<section aria-label="Obligations by department"><div class="coverage-results-heading"><h2>${esc(data.pagination.total)} obligation${data.pagination.total===1?'':'s'}</h2><p>Expand an obligation to see its departments and owners.</p></div><div class="coverage-list-heading" aria-hidden="true"><span>Obligation</span><span>Departments covered</span><span>Primary Business owner</span><span>Status</span><span></span></div>${content}</section>`:tablePanel(content)}</div>`;
}
export function regulationRegisterHandlers(context){
  const existing=notificationFamilyHandlers(context);
  return {actions:{
    'relationship-choose-source':async()=>{
      const candidates=await api('/clause-relationships/sources');
      if(!candidates.length){modal('Link earlier clause','<p>No editable or approved source clauses are available in your Author scope.</p>');return;}
      state.view.relationshipSources=candidates;
      modal('Choose a source clause / para',field('Source clause / para',select('source_clause_id',candidates.map(c=>({...c,name:c.instrument_title+' · '+(c.source_clause_reference||c.code)+' · '+c.heading+' · edition '+c.version_number})),'','name','required')),'relationship-source-form','Continue');
    },
  },forms:{
    'relationship-source-form':async form=>{
      const source=state.view.relationshipSources.find(r=>r.id===form.elements.source_clause_id.value);if(!source)throw new Error('Choose a listed source clause.');
      close();await existing.actions['link-earlier-clause']({id:source.id,instrument:source.instrument_id});
    },
  }};
}
