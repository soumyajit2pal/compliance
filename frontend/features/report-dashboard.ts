import { badge, button, date, esc, link, ref, statusTag, title } from '../ui/components.ts';
import { dashboardTiles } from '../ui/dashboard.ts';
import { icon } from '../ui/icons.ts';
import { panel, table } from '../ui/widgets.ts';
import { withoutPaging } from '../core/pagination.ts';
import { stageLabel } from '../core/obligation-detail.ts';
import { state } from '../core/state.ts';

interface ReportRecord {
  kind: string;
  id: string;
  path: string;
  title: string;
  department?: string;
  domain?: string;
  owner?: string;
  criticality?: string;
  status: string;
  date?: string;
  original_due_date?: string;
  overdue?: boolean;
  code?: string;
  active?: boolean;
  stage?: string;
}

interface Metric {
  label: string;
  definition: string;
  count: number;
  records: ReportRecord[];
}

const symbols:Record<string,string> = {
  instruments:'book', obligations:'layers', applicable:'target', high:'alert',
  owners:'users', content:'file', open:'checkSquare', overdue:'clock',
  due_30:'calendar', upcoming:'calendar', evidence:'folder', gaps:'alert', reviews:'calendar',
  control_coverage:'link', control_reviews:'shield', control_results:'activity',
  regulatory:'bell', approval:'shield', work_review:'check',
  portfolio_high:'alert', high_owner_validation:'users', escalated:'bell',
  no_business_owner:'users', no_evidence_definition:'file', no_linked_checks:'link',
  unapproved_non_applicability:'target', extended_due_date:'calendar',
};
const attention = new Set(['overdue','high','gaps','control_coverage','control_results','regulatory',
  'portfolio_high','high_owner_validation','escalated','no_business_owner','no_evidence_definition','no_linked_checks','unapproved_non_applicability']);
const workMeasures = new Set(['open','overdue','due_30','upcoming','work_review','control_results','regulatory','escalated','extended_due_date']);
const reviewStages = new Set(['COMPLIANCE_REVIEW','BUSINESS_VALIDATION','FINAL_APPROVAL']);
const identity = (row:ReportRecord) => row.kind+':'+row.id;

function metricPath(query:URLSearchParams, key:string, department?:string) {
  const next=withoutPaging(query);
  next.set('metric',key);
  if(department)next.set('department',department);
  return 'team?'+next;
}

export function reportTiles(metrics:Record<string,Metric>, keys:string[], selected:string, query:URLSearchParams) {
  return dashboardTiles('Dashboard measures',keys.map(key=>({
    title:metrics[key].label, count:metrics[key].count, symbol:symbols[key]||'chart',
    href:metricPath(query,key), selected:key===selected,
    tone:attention.has(key)&&metrics[key].count ? 'attention' : 'neutral',
    explanation:metrics[key].definition,
  })));
}

function departmentPanel(portfolio:Metric, query:URLSearchParams) {
  const departments=new Map<string,{active:number;review:number;other:number}>();
  for(const record of portfolio.records) {
    const department=record.department||'';
    const counts=departments.get(department)||{active:0,review:0,other:0};
    if(record.active)counts.active++;
    else if(reviewStages.has(record.stage||''))counts.review++;
    else counts.other++;
    departments.set(department,counts);
  }
  const groups=Array.from(departments,([id,counts])=>({id,...counts,total:counts.active+counts.review+counts.other}));
  groups.sort((a,b)=>b.total-a.total||ref('organisational_unit',a.id).localeCompare(ref('organisational_unit',b.id)));
  const max=groups[0]?.total||1;
  const rows=groups.slice(0,8).map(group=>{
    const label=group.id?ref('organisational_unit',group.id):'Department unspecified';
    const description=`${label}, ${group.active} active, ${group.review} pending review, ${group.other} other`;
    const attributes=group.id?`href="#${esc(metricPath(query,'portfolio',group.id))}" aria-label="${esc(description)}"`:`role="img" aria-label="${esc(description)}"`;
    const element=group.id?'a':'span';
    return `<li><${element} class="dashboard-department-row" ${attributes}>
      <span>${esc(label)}</span><span class="dashboard-department-track" aria-hidden="true">
      ${(['active','review','other'] as const).map(key=>`<span class="dashboard-department-${key}" style="width:${100*group[key]/max}%"></span>`).join('')}
      </span><strong>${group.total}</strong></${element}></li>`;
  }).join('');
  const legend='<div class="dashboard-chart-legend"><span style="--legend-marker:#789969">Active</span><span style="--legend-marker:#c0a262">Pending review</span><span style="--legend-marker:#b98273">Draft or other</span></div>';
  return panel('Obligations by department',rows
    ? '<ul class="dashboard-departments">'+rows+'</ul>'+legend+(groups.length>8?`<p class="muted small">Showing the eight largest groups of ${groups.length}.</p>`:'')
    : '<p class="muted">No obligations match these filters.</p>',
  {sub:'One count per obligation in its accountable department.',action:link(metricPath(query,'portfolio'),'View records','btn small'),cls:'dashboard-panel',
    explanation:'Shows how many obligations each accountable department has. The bars separate active obligations, those awaiting review and other current records.'});
}

function readinessPanel(portfolio:Metric) {
  const active=portfolio.records.filter(record=>record.active).length;
  const percent=portfolio.count?Math.round(active*100/portfolio.count):0;
  return panel('Obligation readiness',
    `<div class="dashboard-readiness">
      <div class="dashboard-readiness-gauge" style="--active-share:${percent}%" aria-hidden="true"><span>${portfolio.count?percent+'%':'—'}<small>Active</small></span></div>
      <p>${active} of ${portfolio.count} obligations are active${portfolio.count?` (${percent}%)`:''}.</p>
    </div>`,{cls:'dashboard-panel',explanation:'The percentage of current obligations that are approved and in effect today. The total includes drafts and obligations under review, with one revision per obligation.'});
}

function workRows(records:ReportRecord[]) {
  return records.map(record=>[
    link(record.path,record.title)+(record.code?`<small>${esc(record.code)}</small>`:''),
    esc(record.owner?ref('user',record.owner):'Unassigned'),
    date(record.date)+(record.original_due_date&&record.original_due_date!==record.date
      ?`<small class="dashboard-original-date">Originally ${date(record.original_due_date)}</small>`:''),
    badge(record.overdue?'OVERDUE':record.status),
  ]);
}

function attentionPanel(metrics:Record<string,Metric>, excluded:Set<string>, operational:boolean) {
  const queue:[string,string][]=[
    ['owners','Owner validation pending'],
    ['evidence','Evidence awaiting review'],
    ['approval','Final approval pending'],
    ['control_reviews','Check review due'],
    ['content','Content validation pending'],
  ];
  if(operational)queue.unshift(['overdue','Overdue action'],['control_results','Check result needs correction']);
  const items:{record:ReportRecord;reason:string;symbol:string}[]=[];
  const seen=new Set(excluded);
  for(const [key,reason] of queue) {
    for(const record of metrics[key]?.records||[]) {
      const id=identity(record);
      if(seen.has(id))continue;
      seen.add(id);items.push({record,reason,symbol:symbols[key]});
      if(items.length===4)break;
    }
    if(items.length===4)break;
  }
  const explanation='Up to four authorised records that need follow-up, such as owner validation or evidence review. Records already listed in the dashboard tables are skipped.';
  if(!items.length){
    if(!operational)return '';
    const message=queue.some(([key])=>metrics[key]?.count)
      ? 'The records that need follow-up are already shown in the dashboard’s record lists.'
      : 'No records need follow-up for these filters.';
    return panel('Needs your attention',`<p class="muted">${message}</p>`,{cls:'dashboard-panel',explanation});
  }
  return panel('Needs your attention',`<ul class="dashboard-followup">${items.map(({record,reason,symbol})=>`
    <li><a href="#${esc(record.path)}"><span class="dashboard-tile-icon">${icon(symbol)}</span>
      <span><strong>${esc(record.title)}</strong><small>${esc(reason)}</small></span>${icon('chevron')}</a></li>`).join('')}</ul>`,
    {sub:'Open a record to see its next step.',cls:'dashboard-panel',explanation});
}

function insightRow(content:string) {
  return content?'<div class="dashboard-insights">'+content+'</div>':'';
}

const evidenceStatuses = [
  ['SUBMITTED','#b87921'], ['ACCEPTED','#21835f'], ['REJECTED','#b93332'],
  ['SUPERSEDED','#95a3b8'], ['EXPIRED','#65748b'],
] as const;
const criticalityLevels = [['CRITICAL','red'],['HIGH','amber'],['MEDIUM','amber'],['LOW','neutral']] as const;

function evidenceStatusPanel(counts:Record<string,number>) {
  const statuses=evidenceStatuses.map(([key,color])=>({label:title(key),color,count:counts[key]||0}));
  const total=statuses.reduce((sum,status)=>sum+status.count,0);
  const segments=total?statuses.filter(status=>status.count).map(status=>
    `<span style="flex-grow:${status.count};background:${status.color}"></span>`).join(''):'';
  const legend=statuses.map(({label,color,count})=>
    `<li style="--legend-marker:${color}">${esc(label)} <strong>${count}</strong></li>`).join('');
  return panel('Evidence status',
    `<div class="dashboard-evidence-track" aria-hidden="true">${segments}</div>
    <ul class="dashboard-evidence-legend">${legend}</ul>
    ${total?'':'<p class="muted small">No evidence matches these filters.</p>'}`,
    {cls:'dashboard-panel',explanation:'Counts visible evidence linked to work in the current filters. An item reused in several work records counts once in its recorded status.'});
}

function obligationStatusPanel(portfolio:Metric) {
  const byStatus=new Map<string,Map<string,number>>();
  for(const record of portfolio.records) {
    const status=record.active?'ACTIVE':record.stage||record.status;
    const criticality=record.criticality||'';
    const counts=byStatus.get(status)||new Map<string,number>();
    counts.set(criticality,(counts.get(criticality)||0)+1);
    byStatus.set(status,counts);
  }
  const heading='Obligations by criticality and status';
  const options={cls:'dashboard-panel',explanation:'Shows how many current obligations fall into each criticality rating and workflow stage. Each obligation counts once.'};
  if(!byStatus.size)return panel(heading,'<p class="muted">No obligations match these filters.</p>',options);
  const label=(status:string)=>status==='BUSINESS_VALIDATION'?'Business validation':stageLabel(status);
  const columns=[...byStatus.keys()].sort((left,right)=>label(left).localeCompare(label(right)));
  const rows=criticalityLevels.map(([level,tone])=>[statusTag(title(level),tone),...columns.map(status=>{
    const count=byStatus.get(status)?.get(level)||0;
    return count ? String(count) : '<span aria-label="0">·</span>';
  })]);
  return panel(heading, table(['Criticality',...columns.map(label)],rows,{
    caption:heading, cardLayout:false, tableClass:'dashboard-criticality-table', rowHeaders:true,
  }), options);
}

export function departmentOverview(portfolio:Metric, evidenceCounts?:Record<string,number>) {
  return '<div class="dashboard-insights department-overview">'+
    evidenceStatusPanel(evidenceCounts||{})+obligationStatusPanel(portfolio)+'</div>';
}

function oversightTable(heading:string, headers:string[], rows:string[][], empty:string, sub:string, explanation:string) {
  const body=table(headers,rows,{
    caption:heading, empty, cardLayout:false, tableClass:'dashboard-breakdown-table', rowHeaders:true,
  });
  return panel(heading,body,{sub,cls:'dashboard-panel',explanation});
}

function departmentPendency(metrics:Record<string,Metric>, query:URLSearchParams) {
  const keys=['open','overdue','work_review'] as const;
  const departments=new Map<string,Record<typeof keys[number],number>>();
  for(const key of keys) {
    for(const record of metrics[key]?.records||[]) {
      const department=record.department||'';
      const counts=departments.get(department)||{open:0,overdue:0,work_review:0};
      counts[key]++;
      departments.set(department,counts);
    }
  }
  const rows=Array.from(departments,([id,counts])=>({
    id,counts,label:id?ref('organisational_unit',id):'Department unspecified',
  })).sort((a,b)=>a.label.localeCompare(b.label)).map(({id,counts,label})=>[
    esc(label),
    ...keys.map(key=>counts[key]&&id?link(metricPath(query,key,id),String(counts[key])):esc(counts[key])),
  ]);
  return oversightTable('Department-wise pendency',['Department','Open actions','Overdue','Awaiting validation'],rows,
    'No open actions match these filters.','Open actions include overdue work and work awaiting validation.',
    'Shows which departments have open work, missed targets or submissions waiting for review. Select a count to open those records.');
}

function domainStatus(portfolio:Metric) {
  const domains=new Map<string,{current:number;active:number;workflow:number;draft:number;approved:number}>();
  for(const obligation of portfolio.records) {
    const domain=obligation.domain||'';
    const counts=domains.get(domain)||{current:0,active:0,workflow:0,draft:0,approved:0};
    counts.current++;
    if(obligation.active)counts.active++;
    else if(reviewStages.has(obligation.stage||''))counts.workflow++;
    else if(obligation.stage==='APPROVED')counts.approved++;
    else counts.draft++;
    domains.set(domain,counts);
  }
  const showApproved=[...domains.values()].some(row=>row.approved>0);
  const headers=['Domain','Current','Active','In workflow','Draft / returned'];
  if(showApproved)headers.push('Other approved');
  const rows=Array.from(domains,([id,counts])=>({id,counts,label:id?ref('regulatory_domain',id):'Domain unspecified'}))
    .sort((a,b)=>a.label.localeCompare(b.label)).map(({id,counts,label})=>{
      const code=state.masters?.regulatory_domain?.find(domain=>domain.id===id)?.code;
      return [esc(label)+(code?`<small>${esc(code)}</small>`:''),...[
        counts.current,counts.active,counts.workflow,counts.draft,...(showApproved?[counts.approved]:[]),
      ].map(esc)];
    });
  return oversightTable('Domain-wise status',headers,rows,'No obligations match these filters.',
    'Each current obligation is counted once in its primary regulatory domain.',
    'Shows the current obligations in each regulatory domain, grouped by stage. The Current total includes drafts and obligations in review.');
}

type SourceCounts = Record<'instruments'|'obligations'|'actions'|'evidence',number>;
export function ccoOverview(metrics:Record<string,Metric>, query:URLSearchParams, sourceCounts?:SourceCounts) {
  const sources=sourceCounts?'<p class="muted dashboard-source-counts">Source records in your scope · '+
    ([[sourceCounts.instruments,'instrument'],[sourceCounts.obligations,'obligation'],
      [sourceCounts.actions,'action'],[sourceCounts.evidence,'evidence item']] as const)
      .map(([count,unit])=>`${count.toLocaleString('en-IN')} ${unit}${count===1?'':'s'}`).join(' · ')+'.</p>':'';
  return sources+'<div class="dashboard-insights cco-overview">'+
    departmentPendency(metrics,query)+domainStatus(metrics.portfolio)+'</div>';
}

export function reportInsights(metrics:Record<string,Metric>, selection:string, query:URLSearchParams) {
  const audience=query.get('audience');
  const operational=audience==='operational';
  const showReadiness=audience==='department'||audience==='cco';
  const selected=metrics[selection].records;
  const used=new Set(selected.map(identity));
  let work='';
  if(!workMeasures.has(selection)&&!selected.some(record=>record.kind==='Action')){
    const due=[...(metrics.open?.records||[]),...(metrics.upcoming?.records||[])]
      .filter(record=>record.date).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||a.id.localeCompare(b.id)).slice(0,4);
    if(due.length){
      for(const record of due)used.add(identity(record));
      work=panel('Upcoming and overdue work',
        table(['Work','Accountable owner','Current target','Status'],workRows(due),{caption:'Upcoming and overdue work'}),
        {sub:'Earliest current internal targets.',action:link(metricPath(query,'open'),'View open work','btn small'),cls:'dashboard-panel',
          explanation:'Shows up to four authorised work items from open and future periods, ordered by their current due dates.'});
    }
  }
  const followup=attentionPanel(metrics,used,operational);
  const portfolio=metrics.portfolio;
  const departments=(operational||showReadiness)&&portfolio?departmentPanel(portfolio,query):'';
  const readiness=showReadiness&&portfolio?readinessPanel(portfolio):'';
  return operational
    ? insightRow(departments+followup)+insightRow(work)
    : insightRow(departments+readiness)+insightRow(work+followup);
}

export function reportRecords(metric:Metric, key:string) {
  const work=workMeasures.has(key);
  const label=key==='open'?'Upcoming and overdue work':metric.label;
  const headers=work?['Work','Accountable owner','Current target','Status']:['Record','Department','Owner','Criticality','Status','Relevant date'];
  const rows=work?workRows(metric.records):metric.records.map(record=>[
    link(record.path,record.title),esc(ref('organisational_unit',record.department)),
    esc(ref('user',record.owner)),esc(record.criticality||'—'),
    badge(reviewStages.has(record.stage||'')?record.stage:record.status),date(record.date),
  ]);
  return '<div id="dashboard-records" role="region" tabindex="-1" aria-label="Dashboard records">'+panel(label,table(headers,rows,{caption:metric.label,pageKey:'team-'+key}),{
    sub:metric.definition, action:button('delivery-export','Export these records',`data-metric="${esc(key)}"`,'small'), cls:'dashboard-panel',
  })+'</div>';
}
