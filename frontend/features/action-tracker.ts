import { bankTimeZone, localDate as bankToday } from '../core/bank-time.ts';
import { referenceSelect } from '../ui/reference-options.ts';
/** Read-only projections of the authenticated action register. */
import {workRelationshipExplanation} from './work-context.ts';
import { api } from '../core/api.ts';
import { has } from '../core/access.ts';
import { withoutPaging } from '../core/pagination.ts';
import { esc,title,ref,badge,statusTag,link,input,select } from '../ui/components.ts';
import { heading, pageHelp } from '../ui/layout.ts';
import { table,tablePanel } from '../ui/widgets.ts';
import { icon } from '../ui/icons.ts';

const stages=[['OPEN','Open'],['IN_PROGRESS','In progress'],['PENDING_VALIDATION','In review'],['COMPLETED','Completed']];
const statuses=[...stages,['DRAFT','Draft'],['CANCELLED','Cancelled']];
const filters=['department','criticality','status','obligation','owner','domain','from','to','mine'];
const dayFormat=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:bankTimeZone});
const monthFormat=new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric',timeZone:bankTimeZone});
function dateValue(value){
 const iso=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;
 const date=new Date(iso+'T12:00:00Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===iso?date:null;
}
const dueDate=(value)=>{const day=dateValue(value);return day?dayFormat.format(day):'No target date';};
const statusLabel=(status)=>statuses.find(([key])=>key===status)?.[1]||title(status);
const stateBadge=(status)=>statusTag(statusLabel(status),status==='COMPLETED'?'green':status==='PENDING_VALIDATION'?'amber':'neutral');
function validMonth(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')&&!value.startsWith('0000')?value:bankToday().slice(0,7);}
function monthStep(month,delta){const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+delta);return date.getUTCFullYear()>0&&date.getUTCFullYear()<10000?date.toISOString().slice(0,7):month;}
function href(query,changes={}){const q=withoutPaging(new URLSearchParams(query));for(const [key,value] of Object.entries(changes))value===null?q.delete(key):q.set(key,String(value));return 'actions?'+q.toString();}
function actionHref(action,query){return 'actions/'+encodeURIComponent(action.id)+'?tracker='+encodeURIComponent(withoutPaging(new URLSearchParams(query)).toString());}
function initials(name){return String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase();}
function criticality(action){return String(action.criticality||action.priority||'MEDIUM');}
function criticalTag(action){const level=criticality(action);return `<span class="at-criticality" data-level="${esc(level)}" title="Obligation criticality: ${esc(title(level))}"><span aria-hidden="true">◆</span>${esc(title(level))}</span>`;}
function stageRail(status){const position={OPEN:0,IN_PROGRESS:1,PENDING_VALIDATION:2,COMPLETED:3}[status]||0;return `<div class="at-stage-rail" aria-hidden="true">${[1,2,3].map(step=>`<span class="${step<=position?'reached':''}"></span>`).join('')}</div><span class="sr-only">Workflow stage: ${esc(statusLabel(status))}</span>`;}
function card(action,query,showStatus=false){
 const owner=ref('user',action.owner_user_id),department=ref('organisational_unit',action.owner_unit_id);
 return `<a class="at-card" href="#${esc(actionHref(action,query))}" data-action-id="${esc(action.id)}" title="${esc(action.description)}"><div class="at-card-top"><span class="at-code">${esc(action.code)}</span>${criticalTag(action)}</div><h3>${esc(action.description)}</h3><p class="at-obligation" title="${esc(action.obligation_title)}">${esc(action.obligation_code||'Obligation')} · ${esc(action.obligation_title)}</p>${showStatus?`<div class="at-card-status">${stateBadge(action.record_status)}</div>`:''}<div class="at-card-bottom"><span class="at-owner" title="${esc(owner+' · '+department)}"><span class="at-avatar" aria-hidden="true">${esc(initials(owner))}</span><span><strong>${esc(owner)}</strong><small>${esc(department)}</small></span></span><span class="at-due ${action.overdue?'is-overdue':''}">${icon('calendar')}<span><time datetime="${esc(action.current_due_date||'')}">${esc(dueDate(action.current_due_date))}</time>${action.overdue?'<small>Overdue</small>':''}</span></span></div>${action.original_due_date!==action.current_due_date?`<p class="at-original">Original target ${esc(dueDate(action.original_due_date))}</p>`:''}${stageRail(action.record_status)}</a>`;
}
function board(rows,query){
 const extra=[...new Set([...rows.map(a=>a.record_status),...(query.get('status')?[query.get('status')]:[])])].filter(status=>!stages.some(([key])=>key===status));
 const columns=query.get('status')?[[query.get('status'),statusLabel(query.get('status'))]]:[...stages,...extra.map(status=>[status,statusLabel(status)])];
 return `<div class="at-board-scroll" role="region" aria-label="Compliance work by workflow stage" tabindex="0"><div class="at-board ${query.get('status')?'at-board-filtered':''}">${columns.map(([status,label])=>{const items=rows.filter(a=>a.record_status===status);return `<section class="at-column" data-status="${esc(status)}" aria-label="${esc(label)} work items"><header><h2>${esc(label)}</h2><span class="at-count" aria-label="${items.length} work items">${items.length}</span></header><div class="at-cards">${items.length?items.map(a=>card(a,query)).join(''):'<p class="at-column-empty">No work items in this stage</p>'}</div></section>`;}).join('')}</div></div>`;
}
function list(rows,query){return tablePanel(table(['Work item / obligation','Owner / department','Criticality','Priority','Internal target','Status'],rows.map(a=>[
 link(actionHref(a,query),a.description)+`<small>${esc(a.code)} · ${esc(a.obligation_title)}</small>`,esc(ref('user',a.owner_user_id))+`<small>${esc(ref('organisational_unit',a.owner_unit_id))}</small>`,criticalTag(a),esc(title(a.priority)),esc(dueDate(a.current_due_date))+(a.overdue?' '+badge('OVERDUE'):'')+(a.original_due_date!==a.current_due_date?`<small>Original ${esc(dueDate(a.original_due_date))}</small>`:''),stateBadge(a.record_status),
 ]),{caption:'Authorised work items matching the shared tracker filters',pageKey:'action-tracker'}));}
function calendar(rows,query,month){
 const first=new Date(month+'-01T12:00:00Z'),label=monthFormat.format(first),offset=(first.getUTCDay()+6)%7;
 const inMonth=rows.filter(a=>dateValue(a.current_due_date)&&String(a.current_due_date).startsWith(month+'-'));
 const byDay=new Map<string,any[]>();for(const a of inMonth){const day=String(a.current_due_date).slice(0,10);byDay.set(day,[...(byDay.get(day)||[]),a]);}
 const event=(a)=>`<a href="#${esc(actionHref(a,query))}" class="at-event" data-status="${esc(a.record_status)}" data-action-id="${esc(a.id)}" title="${esc(a.code+' · '+a.description+' · '+ref('user',a.owner_user_id)+' · '+statusLabel(a.record_status))}"><span class="at-event-code">${esc(a.code)} · ${esc(statusLabel(a.record_status))}</span><strong>${esc(a.description)}</strong></a>`;
 const cells=Array.from({length:42},(_,i)=>{const date=new Date(first);date.setUTCDate(1-offset+i);const iso=date.toISOString().slice(0,10),inside=iso.startsWith(month+'-');return `<td class="${inside?'':'outside-month'} ${iso===bankToday()?'at-today':''}"><time datetime="${iso}" aria-label="${esc(dayFormat.format(date))}">${date.getUTCDate()}</time>${inside?(byDay.get(iso)||[]).map(event).join(''):''}</td>`;});
 const agenda=[...byDay].sort(([a],[b])=>a.localeCompare(b)).map(([day,actions])=>`<section class="at-agenda-day"><h3>${esc(dueDate(day))}<span>${actions.length}</span></h3>${actions.map(a=>card(a,query,true)).join('')}</section>`).join('');
 return `<section class="at-calendar-view" aria-label="${esc(label)} compliance work calendar"><div class="at-calendar-toolbar"><div class="actions">${link(href(query,{month:monthStep(month,-1)}),'← Previous','btn small')}${link(href(query,{month:bankToday().slice(0,7)}),'This month','btn small')}${link(href(query,{month:monthStep(month,1)}),'Next →','btn small')}</div><form id="action-tracker-month"><label for="at-month">Month</label><input id="at-month" name="month" type="month" value="${month}" required><button class="btn small" type="submit">Go</button></form></div><p class="at-calendar-summary">${inMonth.length} work item${inMonth.length===1?'':'s'} due in ${esc(label)} · ${rows.length} matching all filters</p><div class="at-calendar-scroll" role="region" aria-label="Monthly targets" tabindex="0"><table class="at-calendar"><caption class="sr-only">Current internal target dates in ${esc(label)}</caption><thead><tr>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${Array.from({length:6},(_,week)=>'<tr>'+cells.slice(week*7,week*7+7).join('')+'</tr>').join('')}</tbody></table></div><div class="at-agenda">${agenda||`<p class="at-empty">No work items are due in ${esc(label)} with these filters.</p>`}</div></section>`;
}
export async function actionTrackerPage(query=new URLSearchParams()){
 const view=['list','board','calendar'].includes(query.get('view'))?query.get('view'):'board',month=validMonth(query.get('month'));
 const normal=withoutPaging(new URLSearchParams(query));normal.set('view',view);normal.set('month',month);
 const server=new URLSearchParams();for(const key of filters)if(query.get(key))server.set(key,query.get(key));
 const response=await api('/actions?'+server);if(!Array.isArray(response))throw new Error('The compliance work register returned an unexpected record format.');
 const q=(query.get('q')||'').trim().toLocaleLowerCase();
 const rows=response.filter(a=>!q||[a.code,a.description,a.obligation_code,a.obligation_title,ref('user',a.owner_user_id),ref('organisational_unit',a.owner_unit_id)].join(' ').toLocaleLowerCase().includes(q));
 const clear=new URLSearchParams({view,month});if(query.get('obligation'))clear.set('obligation',query.get('obligation'));
 const scope=query.get('obligation')?`<div class="at-scope">Obligation: ${esc(rows[0]?.obligation_title||'Selected obligation')}${link(href(normal,{obligation:null}),'View all obligations','text-link')}</div>`:'';
 const assignWork = has('AUTHOR','BUSINESS_OWNER')
   ? `<a class="btn primary" href="#actions/new">${icon('plus')} Assign work</a>`
   : '';
 return `<div class="action-tracker">
   ${pageHelp('Track assigned work', workRelationshipExplanation, 'work-evidence')}
   ${heading('Compliance work tracker', 'Assign and follow work linked to obligations, checks and supporting evidence. Each work item has its own owner, due dates and independent review.', assignWork)}
   <nav class="at-tabs" aria-label="Compliance work tracker views">${[['list','List view'],['board','Board view'],['calendar','Calendar · '+monthFormat.format(new Date(month+'-01T12:00:00Z'))]].map(([key,label])=>`<a href="#${esc(href(normal,{view:key}))}" class="${view===key?'active':''}" ${view===key?'aria-current="page"':''}>${esc(label)}</a>`).join('')}</nav>${scope}<form id="view-filter" class="at-filters" aria-label="Compliance work tracker filters"><div class="at-search">${icon('search')}${input('q',query.get('q')||'','search','placeholder="Search work, obligation or owner…" aria-label="Search work, obligation or owner"')}</div>${referenceSelect('department','organisational_unit',query.get('department')||'','aria-label="Department"','All departments',{historical:true})}${select('criticality',['CRITICAL','HIGH','MEDIUM','LOW'].map(id=>({id,name:title(id)})),query.get('criticality'),'name','aria-label="Criticality"','All criticalities')}${select('status',statuses.map(([id,name])=>({id,name})),query.get('status'),'name','aria-label="Status"','All statuses')}${input('view',view,'hidden')}${input('month',month,'hidden')}<div class="at-filter-actions"><button class="btn" type="submit">Apply</button>${link('actions?'+clear,'Clear','text-link')}</div></form><div class="at-results" role="status">${rows.length} work item${rows.length===1?'':'s'}${q?' matching your search':''}${query.get('status')?' · '+esc(statusLabel(query.get('status'))):''}</div>${view==='board'?board(rows,normal):view==='list'?list(rows,normal):calendar(rows,normal,month)}</div>`;
}

export function trackerMonthChange(form:HTMLFormElement){const query=withoutPaging(new URLSearchParams(location.hash.split('?')[1]||''));query.set('view','calendar');query.set('month',validMonth(String(new FormData(form).get('month')||'')));location.hash=href(query);}
export function trackerBack(query:URLSearchParams){return query.has('tracker')?'actions?'+new URLSearchParams(query.get('tracker')||'').toString():null;}
