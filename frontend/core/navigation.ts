/** Sidebar destinations reuse existing menu permissions and governed routes. */
type Identity={menu:Array<{id:string}>,roles:string[]};
export type NavItem={id:string,label:string,href:string,icon:string,permission:string,roles?:string[]};
const item=(id,label,href,icon,permission,roles?):NavItem=>({id,label,href,icon,permission,roles});
const primary=[item('home','Compliance at a glance','home','home','home')];
const groups=[
 {id:'regulations',label:'Regulations',icon:'book',items:[
  item('repository','Regulatory library','repository','book','repository'),
  item('notification-families','Notification families','notification-families','org','notification-families'),
  item('clauses','Clauses','clauses','layers','clauses'),
  item('clause-relationships','Clause relationships','clause-relationships','link','clause-relationships'),
  item('obligations','Obligations','obligations','file','obligations'),
  item('applicability','Applicability','obligations?view=applicability','target','applicability'),
  item('accountability','Accountability','obligations?view=accountability','users','accountability'),
 ]},
 {id:'work',label:'Work and evidence',icon:'checkSquare',items:[
  item('tasks','My tasks','tasks','checkSquare','tasks'),
  item('actions','Compliance work tracker','actions','clock','actions'),
  item('evidence','Evidence','evidence','folder','evidence'),
  item('controls','Checks and procedures','controls','shield','controls'),
  item('rbi-workflow','RBI notification workflow','tasks?queue=rbi','org','repository'),
  item('delegation','Delegation','delegations','arrowRightLeft','delegations'),
 ]},
 {id:'reports',label:'Reports and history',icon:'chart',items:[
  item('operational','Operational dashboard','team?audience=operational','activity','team'),
  item('department','Department dashboard','team?audience=department','org','team'),
  item('cco','CCO dashboard','team?audience=cco','grid','team',['CCO']),
  item('exceptions','Exception reports','obligations?tab=reports','alert','obligations'),
  item('notifications','Notifications','notifications','bell','tasks'),
 ]},
 {id:'administration',label:'Administration',icon:'settings',items:[
  item('users','Users & access','users','users','users'),
  item('masters','Master data','masters','settings','masters'),
  item('organisation','Organisation hierarchy','masters?tab=organisation','org','masters'),
  item('ldap','LDAP settings','ldap','lock','ldap'),
  item('employee-api','Employee profile API','employee-api','users','employee-api'),
  item('migration','Import existing regulatory records','migration','upload','migration'),
  item('applications','Connected applications','applications','external','applications'),
 ]},
];
export function navigationSelection(page:string,query=new URLSearchParams()){
 if(page==='applicability'||page==='accountability')return page;
 if(page==='obligations')return ['applicability','accountability'].includes(query.get('view'))?query.get('view'):query.get('tab')==='reports'?'exceptions':'obligations';
 if(page==='library')return 'repository';
 if(page==='control-mappings')return 'controls';
 if(page==='approvals')return 'tasks';
 if(page==='delegations')return 'delegation';
 if(page==='tasks')return query.get('queue')==='rbi'?'rbi-workflow':'tasks';
 if(page==='team')return query.get('audience')==='cco'?'cco':query.get('audience')==='department'?'department':'operational';
 if(page==='masters'&&query.get('tab')==='organisation')return 'organisation';
 return page;
}
export function navigationModel(identity:Identity,page:string,query=new URLSearchParams()){
 const permissions=new Set(identity.menu.map(m=>m.id));
 const allowed=(i:NavItem)=>permissions.has(i.permission)&&(!i.roles||i.roles.some(r=>identity.roles.includes(r)))&&
  (i.id!=='rbi-workflow'||permissions.has('tasks'))&&
  (!['applicability','accountability'].includes(i.id)||permissions.has('obligations'));
 return {selected:navigationSelection(page,query),primary:primary.filter(allowed),groups:groups.map(g=>({...g,items:g.items.filter(allowed)})).filter(g=>g.items.length)};
}
export function navigationLabel(page:string,query=new URLSearchParams()){
 const selected=navigationSelection(page,query);
 if(page==='approvals')return 'My decisions';
 if(page==='control-mappings')return 'Obligation links';
 if(page==='team'&&!query.get('audience'))return 'Team overview';
 return [...primary,...groups.flatMap(g=>g.items)].find(i=>i.id===selected)?.label;
}

export const reportViews={
 operational:{label:'Operational dashboard',description:'Assigned activity, due dates, proof review and operational exceptions in your authorised area.',defaultMetric:'open',metrics:['open','overdue','upcoming','evidence','reviews','control_reviews','control_results']},
 department:{label:'Department dashboard',description:'Choose a department to inspect its authorised requirements, ownership, work and control coverage.',defaultMetric:'applicable',metrics:['applicable','high','owners','open','overdue','evidence','control_coverage','control_reviews','control_results']},
 cco:{label:'CCO dashboard',description:'Consolidated oversight within your approved role and organisation scope. Every measure opens its source records.',defaultMetric:'obligations',metrics:null},
};
export function reportView(query:URLSearchParams){return reportViews[query.get('audience')]||{label:'Team overview',description:'Current records in your approved area. Select a count to inspect exactly what it includes.',defaultMetric:'open',metrics:null};}
export function ccoViewAllowed(roles:string[],query:URLSearchParams){return query.get('audience')!=='cco'||roles.includes('CCO');}
