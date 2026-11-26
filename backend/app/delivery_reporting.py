"""One authorised population per measure; export uses its exact fingerprint."""
import csv,hashlib,io,json
from datetime import date, timedelta
from .bank_time import TIME_ZONE, to_ist
import sqlalchemy as sa
from . import delivery as d,models as m,obligations as obl,repository as repo
from .access import REGULATORY_ROLES,READ_ROLES
from .events import now

DEFINITIONS={
 'instruments':('Current instruments','Approved, current effective instruments in your source scope.'),
 'obligations':('Active approved obligations','Effective Active obligations; this is an approval count, not a compliance conclusion.'),
 'portfolio':('Current obligation records','One authorised revision per obligation. The effective Active revision takes priority, followed by the latest matching revision.'),
 'approval':('Awaiting final approval','Obligations at final approval and instruments awaiting approval of their initial edition.'),
 'applicable':('Applicable obligations','Active obligations with effective, approved Applicable or Partially applicable assessments in the selected authorised department.'),
 'high':('High / critical obligations','Active obligations rated high or critical.'),
 'owners':('Pending owner validation','Obligations awaiting confirmation of ownership and applicability from the assigned owners.'),
 'content':('Content validation pending','Nonterminal records without validated regulatory content.'),
 'open':('Open actions','Shows work that is open, in progress or awaiting review. Work for future periods is listed separately.'),
 'overdue':('Overdue actions','Open current-period actions with approved internal targets before the bank business date.'),
 'due_30':('Actions due in 30 days','Shows work that is open, in progress or awaiting review, with a current target due today or within the next 30 days.'),
 'upcoming':('Upcoming periods','Open assignments whose reporting period starts in the future.'),
 'work_review':('Work awaiting review','Current-period assignments submitted for independent validation. One record per assignment.'),
 'evidence':('Evidence awaiting review','Distinct evidence items with an undecided link in a current submission, including reuse.'),
 'gaps':('Record / evidence gaps','Missing source/ownership/evidence definitions or completed work with stale evidence.'),
 'reviews':('Obligation reviews due','Active obligations due for review in the next seven days or already overdue.'),
 'control_coverage':('Check coverage needs review','One record per authorised active obligation and applicable department with no current approved link to an implemented check, or with a link that has incomplete coverage or a check awaiting implementation. Coverage estimates are assessed per link.'),
 'control_reviews':('Check reviews due','Current approved checks due for review within seven days or already overdue.'),
 'control_results':('Check results needing correction','Work whose latest submission has a failed, exceptional or rejected check result. Earlier attempts remain in history.'),
 'regulatory':('Recorded regulatory delays','Audited regulatory-deadline escalations, retained after task completion.')}

CCO_DEFINITIONS={
 'portfolio_high':('Current high or critical obligations','Current obligations rated high or critical, including drafts and proposals under review. Each obligation counts once.'),
 'high_owner_validation':('High or critical obligations awaiting owner validation','High or critical obligations waiting for assigned owners to confirm ownership and applicability.'),
 'escalated':('Escalated actions','Open actions with a recorded CCO escalation or an audited regulatory delay. Each action counts once.'),
 'no_business_owner':('Obligations without a business owner','Current obligation records missing a named primary business owner.'),
 'no_evidence_definition':('Obligations without an evidence definition','Current obligation records missing a description of the evidence required.'),
 'no_linked_checks':('Active obligations without linked checks','Active, approved and effective obligations without a current approved obligation link.'),
 'unapproved_non_applicability':('Unapproved non-applicability','Current obligation records with at least one non-applicability assessment that lacks approval.'),
 'extended_due_date':('Actions with extended due dates','Actions whose current approved internal target is later than the original target, including retained work.'),
}


def evidence_status_counts(db, actor, actions, filters):
    """Count each authorised proof item once across matching work links."""
    counts = dict.fromkeys(('SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'EXPIRED'), 0)
    action_fields = {'department': 'owner_unit_id', 'domain': 'domain_id', 'criticality': 'criticality'}
    action_ids = [action['id'] for action in actions
                  if all(not filters.get(key) or action[field] == filters[key] for key, field in action_fields.items())]
    evidence = m.evidence_item.c
    status_filters = {'owner': evidence.uploaded_by, 'status': evidence.evidence_status}
    conditions = [column == filters[key] for key, column in status_filters.items() if filters.get(key)]
    if filters.get('from'):
        conditions.append(evidence.period_to >= date.fromisoformat(filters['from']))
    if filters.get('to'):
        conditions.append(evidence.period_to <= date.fromisoformat(filters['to']))

    link = m.evidence_link.c
    candidates = sa.select(evidence.id, evidence.evidence_status).join(
        m.evidence_link, link.evidence_id == evidence.id).where(*conditions).distinct()
    seen = set()
    for start in range(0, len(action_ids), 900):
        for identifier, status in db.execute(candidates.where(link.action_id.in_(action_ids[start:start + 900]))):
            if identifier in seen:
                continue
            seen.add(identifier)
            try:
                d.evidence_read(db, actor, identifier)
            except d.HTTPException:
                continue
            counts[status] += 1
    return counts


def build(db,actor,filters=None):
 actor.require(READ_ROLES);filters=filters or {};day=d.today()
 cco_view=filters.get('audience')=='cco'
 cco_measures=cco_view or filters.get('metric') in CCO_DEFINITIONS
 if cco_measures:actor.require({'CCO'})
 for key in ['from','to']:
  if filters.get(key):
   try:date.fromisoformat(filters[key])
   except ValueError:raise d.HTTPException(422,'Use YYYY-MM-DD report dates.') from None
 d.fail(not filters.get('from') or not filters.get('to') or filters['from']<=filters['to'],'The date range is reversed.')
 obls=obl.listing(db,actor);actions=d.listing(db,actor);sources=repo.listing(db,actor,{})
 def row(kind,r,title,department,owner,domain,criticality,status,when,path):return dict(kind=kind,id=r['id'],title=title,department=department,owner=owner,domain=domain,criticality=criticality,status=status,date=str(when or ''),path=path)
 def irow(r,status):
  return row('Instrument',r,r['title'],r['regulatory_owner_unit_id'],r['interpretation_owner_user_id'],r['primary_domain_id'],r['materiality'],status,r['effective_date'],'repository/'+r['id'])
 def ar(a):
  record=row('Action',a,a['description'],a['owner_unit_id'],a['owner_user_id'],a['domain_id'],a['criticality'],a['record_status'],a['current_due_date'],'actions/'+a['id'])
  return {**record,'code':a['code'],'original_due_date':str(a['original_due_date'] or ''),'overdue':a['overdue']}
 primary_owners={}
 def orow(o):
  if o['id'] not in primary_owners:
   owners=obl.rows(db,m.obligation_owner,o['id'])
   primary_owners[o['id']]=next((x['user_id'] for x in owners if x['owner_role']=='BUSINESS' and x['primary_owner_flag']),None)
  return row('Obligation',o,o['title'],o['business_owner_unit_id'],primary_owners[o['id']],o['primary_domain_id'],o['criticality'],o['record_status'],o['next_review_date'],'obligations/'+o['id'])
 def active(o):return o['record_status']=='ACTIVE' and o['approval_status']=='APPROVED' and o['effective_from']<=day and (not o['effective_to'] or o['effective_to']>day)
 effective=[o for o in obls if active(o)]
 current_obligations=[o for o in obls if o['record_status'] not in {'SUPERSEDED','RETIRED'}
                      and o['approval_status'] not in {'REJECTED','WITHDRAWN'}]
 openrows=[a for a in actions if a['record_status'] in d.OPEN and (not a['period_from'] or a['period_from']<=day)]
 result={key:[] for key in DEFINITIONS}
 result['instruments']=[irow(r,r['regulatory_status']) for r in sources if r['approval_status']=='APPROVED' and r['regulatory_status']=='CURRENT' and r['current_version_id'] and r['effective_date']<=day]
 result['obligations']=[orow(o) for o in effective];result['high']=[orow(o) for o in effective if o['criticality'] in {'HIGH','CRITICAL'}]
 result['portfolio']=[{**orow(o),'stage':o['stage'],'active':active(o),'code':o['code'],'revision':o['version_number']}
                      for o in current_obligations]
 result['approval']=[{**orow(o),'stage':o['stage']} for o in current_obligations if o['stage']=='FINAL_APPROVAL']
 result['approval'].extend(irow(source,source['approval_status']) for source in sources
  if source['approval_status']=='REVIEWED' and not source['current_version_id'])
 for o in effective:
  assessments=[x for x in obl.rows(db,m.obligation_applicability,o['id']) if x['approval_status']=='APPROVED' and x['applicability_status']!='NOT_APPLICABLE' and x['effective_from']<=day and (not x['effective_to'] or x['effective_to']>day) and (actor.covers(x['org_unit_id'],READ_ROLES) or actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES)) and (not filters.get('department') or filters['department']==x['org_unit_id'])]
  if assessments:
   r=orow(o)
   if filters.get('department'):r['department']=filters['department']
   result['applicable'].append(r)
 result['owners']=[orow(o) for o in obls if o['stage']=='BUSINESS_VALIDATION'];result['content']=[orow(o) for o in obls if o['content_validation_status']!='VALIDATED' and o['record_status'] not in {'SUPERSEDED','RETIRED'}]
 result['open']=[ar(a) for a in openrows];result['overdue']=[ar(a) for a in openrows if a['current_due_date']<day]
 due_end=day+timedelta(days=30)
 result['due_30']=[ar(a) for a in actions if a['record_status'] in d.OPEN and day<=a['current_due_date']<=due_end]
 result['upcoming']=[ar(a) for a in actions if a['record_status'] in d.OPEN and a['period_from'] and a['period_from']>day]
 result['work_review']=[ar(a) for a in openrows if a['record_status']=='PENDING_VALIDATION']
 result['reviews']=[orow(o) for o in effective if o['next_review_date']<=day+timedelta(days=7)]
 gapcodes={'MISSING_BUSINESS_OWNER','MISSING_CONTROL_OWNER','MISSING_EVIDENCE_STANDARD','MISSING_OR_UNAVAILABLE_CLAUSE','SOURCE_REASSESSMENT_REQUIRED','PROCESS_REASSESSMENT_REQUIRED','PRODUCT_REASSESSMENT_REQUIRED','UNAPPROVED_NON_APPLICABILITY'}
 result['gaps']=[orow(o) for o in obls if (set(o['issues'])&gapcodes or any(i.startswith('MISSING_') or i.endswith('_REASSESSMENT_REQUIRED') for i in o['issues'])) and o['record_status'] not in {'SUPERSEDED','RETIRED'}]+[ar(a) for a in actions if not a['reviewer_user_id'] or not a['period_from'] or not a['evidence_requirement']]
 seen=set()
 for a in actions:
  sub=d.latest(db,a)
  if a['record_status']=='PENDING_VALIDATION' and sub:
   decisions={x['evidence_link_id'] for x in d.allrows(db,m.action_evidence_decision,m.action_evidence_decision.c.submission_id==sub['id'])}
   for proof in json.loads(sub['evidence_snapshot']):
    if proof['link_id'] in decisions or proof['evidence_id'] in seen:continue
    try:e=d.evidence_read(db,actor,proof['evidence_id'])
    except d.HTTPException:continue
    seen.add(e['id']);result['evidence'].append(row('Evidence',e,e['title'],a['owner_unit_id'],e['uploaded_by'],a['domain_id'],a['criticality'],e['evidence_status'],e['period_to'],'actions/'+a['id']+'?evidence='+e['id']))
  if a['record_status']=='COMPLETED' and sub:
   invalid=False
   for proof in json.loads(sub['evidence_snapshot']):
    e=repo.one(db,m.evidence_item,proof['evidence_id'])
    if e['evidence_status']!='ACCEPTED' or e['retention_end_date']<day or e['file_hash']!=proof['sha256']:invalid=True
   if invalid:result['gaps'].append(ar(a))
  if db.execute(d.sa.select(m.audit_log.c.id).where(m.audit_log.c.entity_type=='action',m.audit_log.c.entity_id==a['id'],m.audit_log.c.action=='REGULATORY_DELAY')).first():result['regulatory'].append(ar(a))
 from . import controls
 for o in effective:
  assessments=[x for x in obl.rows(db,m.obligation_applicability,o['id']) if x['approval_status']=='APPROVED' and x['applicability_status']!='NOT_APPLICABLE' and x['effective_from']<=day and (not x['effective_to'] or x['effective_to']>day)]
  for unit in {x['org_unit_id'] for x in assessments if x['org_unit_id']}:
   if not actor.covers(unit,READ_ROLES) and not actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES):continue
   maps=controls.action_mappings(db,actor,o['id'],unit)
   if not maps or any(x['coverage_type']!='FULL' or x['control_status']!='IMPLEMENTED' for x in maps):
    r=orow(o);r.update(id=o['id']+':'+unit,department=unit,status='COVERAGE_REVIEW',path='control-mappings?obligation='+o['id']+'&department='+unit);result['control_coverage'].append(r)
 for c in controls.listing(db,actor,'controls',{'current':'true'}):
  if c['review_date']<=day+timedelta(days=7):result['control_reviews'].append(row('Control',c,c['title'],c['owner_unit_id'],c['owner_user_id'],'','',c['control_status'],c['review_date'],'controls/'+c['id']))
 for a in actions:
  sub=d.latest(db,a)
  if sub and any(any(r['submission_id']==sub['id'] and (r['proposed_result']!='EFFECTIVE' or r['decision']=='REJECT') for r in x['results']) for x in controls.action_context(db,actor,a)):result['control_results'].append(ar(a))
 def match(r,fields):
  return all(not filters.get(k) or str(r.get(k,''))==filters[k] for k in fields) and (not filters.get('from') or r['date']>=filters['from']) and (not filters.get('to') or r['date']<=filters['to'])
 report_fields=('domain','owner','criticality','status')
 scoped_fields=(*report_fields,'department')
 def metric_data(definition,rows):
  rows.sort(key=lambda r:(r['date'],r['id']))
  return {'label':definition[0],'definition':definition[1],'count':len(rows),'records':rows,
          'population_hash':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}
 metrics={}
 for key,rows in result.items():
  fields=report_fields if key=='portfolio' else scoped_fields
  rows=[r for r in rows if match(r,fields)]
  if key=='portfolio':
   by_obligation={}
   for record in rows:
    previous=by_obligation.get(record['code'])
    if previous is None or (record['active'],record['revision'])>(previous['active'],previous['revision']):
     by_obligation[record['code']]=record
   rows=[record for record in by_obligation.values() if not filters.get('department') or record['department']==filters['department']]
  metrics[key]=metric_data(DEFINITIONS[key],rows)
 if cco_measures:
  escalations=set(db.execute(sa.select(m.notification.c.entity_id).where(
   m.notification.c.entity_type=='action',m.notification.c.notification_type=='ACTION_CCO_ESCALATION').distinct()).scalars())
  escalations.update(record['id'] for record in result['regulatory'])
  linked=controls.obligations_with_current_check_links(db,actor) if effective else set()
  current_gaps={'no_business_owner':'MISSING_BUSINESS_OWNER','no_evidence_definition':'MISSING_EVIDENCE_STANDARD',
                'unapproved_non_applicability':'UNAPPROVED_NON_APPLICABILITY'}
  cco_rows={
   'portfolio_high':[r for r in metrics['portfolio']['records'] if r['criticality'] in {'HIGH','CRITICAL'}],
   'high_owner_validation':[r for r in result['owners'] if r['criticality'] in {'HIGH','CRITICAL'}],
   'escalated':[ar(a) for a in openrows if a['id'] in escalations],
   'no_linked_checks':[orow(o) for o in effective if o['id'] not in linked],
   'extended_due_date':[ar(a) for a in actions if a['current_due_date']>a['original_due_date']],
   **{key:[orow(o) for o in current_obligations if issue in o['issues']] for key,issue in current_gaps.items()},
  }
  for key,rows in cco_rows.items():
   metrics[key]=metric_data(CCO_DEFINITIONS[key],[r for r in rows if match(r,scoped_fields)])
 report={'generated_at':to_ist(now()).isoformat(),'business_date':day,'timezone':TIME_ZONE,'filters':{k:filters[k] for k in ['domain','department','owner','criticality','status','from','to'] if filters.get(k)},'metrics':metrics,'date_semantics':'Source effective date; obligation next-review date; action internal target; evidence period end. Current operational snapshot, not historical reconstruction.'}
 if filters.get('audience')=='department':
  report['evidence_status']=evidence_status_counts(db,actor,actions,filters)
 if cco_view:
  report['scope_counts']={
   'instruments':sum(match(irow(r,r['regulatory_status']),scoped_fields) for r in sources),
   'obligations':metrics['portfolio']['count'],
   'actions':sum(match(ar(a),scoped_fields) for a in actions),
   'evidence':sum(evidence_status_counts(db,actor,actions,filters).values()),
  }
 return report

def export(report,metric,expected_hash):
 d.fail(metric in report['metrics'],'Choose a report measure.');data=report['metrics'][metric]
 d.fail(expected_hash and data['population_hash']==expected_hash,'The record population changed. Refresh the dashboard before exporting.',409)
 output=io.StringIO();writer=csv.writer(output);fields=['kind','id','title','department','owner','domain','criticality','status','date','path']
 writer.writerow(fields)
 for row in data['records']:
  values=[]
  for field in fields:
   text='Check' if field=='kind' and row['kind']=='Control' else str(row.get(field,'') or '')
   values.append("'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text)
  writer.writerow(values)
 return '\ufeff'+output.getvalue(),data['count']
