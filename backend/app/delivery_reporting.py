"""One authorised population per measure; export uses its exact fingerprint."""
import csv,hashlib,io,json
from datetime import timedelta
from . import delivery as d,models as m,obligations as obl,repository as repo
from .access import REGULATORY_ROLES,READ_ROLES
from .events import now

DEFINITIONS={
 'instruments':('Current instruments','Approved, current effective instruments in your source scope.'),
 'obligations':('Active approved obligations','Effective Active obligations; this is an approval count, not a compliance conclusion.'),
 'applicable':('Applicable obligations','Active obligations with effective, approved Applicable or Partially applicable assessments in the selected authorised department.'),
 'high':('High / critical obligations','Active records rated HIGH or CRITICAL.'),
 'owners':('Pending owner validation','Current obligation workflow at BUSINESS_VALIDATION.'),
 'content':('Content validation pending','Nonterminal records without validated regulatory content.'),
 'open':('Open actions','OPEN, IN_PROGRESS or PENDING_VALIDATION; future periods shown separately.'),
 'overdue':('Overdue actions','Open current-period actions with approved internal targets before the bank business date.'),
 'upcoming':('Upcoming periods','Open assignments whose reporting period starts in the future.'),
 'evidence':('Evidence awaiting review','Distinct evidence items with an undecided link in a current submission, including reuse.'),
 'gaps':('Record / evidence gaps','Missing source/ownership/evidence definitions or completed work with stale evidence.'),
 'reviews':('Obligation reviews due','Active obligations due for review in the next seven days or already overdue.'),
 'control_coverage':('Control coverage needs review','One record per authorised active obligation and applicable department with no current approved implemented control mapping, or with Partial/Compensating coverage. Estimates are not summed or treated as compliance scores.'),
 'control_reviews':('Control reviews due','Current approved controls due for review within seven days or already overdue.'),
 'control_results':('Control results needing correction','Actions whose latest submitted control result is failed, exceptional or rejected. Prior failed attempts remain in retained history.'),
 'regulatory':('Recorded regulatory delays','Audited regulatory-deadline escalations, retained after task completion.')}

def build(db,actor,filters=None):
 actor.require(READ_ROLES);filters=filters or {};day=d.today()
 for key in ['from','to']:
  if filters.get(key):
   try:d.date.fromisoformat(filters[key])
   except ValueError:raise d.HTTPException(422,'Use YYYY-MM-DD report dates.') from None
 d.fail(not filters.get('from') or not filters.get('to') or filters['from']<=filters['to'],'The date range is reversed.')
 obls=obl.listing(db,actor);actions=d.listing(db,actor);sources=repo.listing(db,actor,{})
 def row(kind,r,title,department,owner,domain,criticality,status,when,path):return dict(kind=kind,id=r['id'],title=title,department=department,owner=owner,domain=domain,criticality=criticality,status=status,date=str(when or ''),path=path)
 def ar(a):return row('Action',a,a['description'],a['owner_unit_id'],a['owner_user_id'],a['domain_id'],a['criticality'],a['record_status'],a['current_due_date'],'actions/'+a['id'])
 def orow(o):
  owners=obl.rows(db,m.obligation_owner,o['id']);primary=next((x['user_id'] for x in owners if x['owner_role']=='BUSINESS' and x['primary_owner_flag']),None)
  return row('Obligation',o,o['title'],o['business_owner_unit_id'],primary,o['primary_domain_id'],o['criticality'],o['record_status'],o['next_review_date'],'obligations/'+o['id'])
 def active(o):return o['record_status']=='ACTIVE' and o['approval_status']=='APPROVED' and o['effective_from']<=day and (not o['effective_to'] or o['effective_to']>day)
 effective=[o for o in obls if active(o)]
 openrows=[a for a in actions if a['record_status'] in d.OPEN and (not a['period_from'] or a['period_from']<=day)]
 result={key:[] for key in DEFINITIONS}
 result['instruments']=[row('Instrument',r,r['title'],r['regulatory_owner_unit_id'],r['interpretation_owner_user_id'],r['primary_domain_id'],r['materiality'],r['regulatory_status'],r['effective_date'],'repository/'+r['id']) for r in sources if r['approval_status']=='APPROVED' and r['regulatory_status']=='CURRENT' and r['current_version_id'] and r['effective_date']<=day]
 result['obligations']=[orow(o) for o in effective];result['high']=[orow(o) for o in effective if o['criticality'] in {'HIGH','CRITICAL'}]
 for o in effective:
  assessments=[x for x in obl.rows(db,m.obligation_applicability,o['id']) if x['approval_status']=='APPROVED' and x['applicability_status']!='NOT_APPLICABLE' and x['effective_from']<=day and (not x['effective_to'] or x['effective_to']>day) and (actor.covers(x['org_unit_id'],READ_ROLES) or actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES)) and (not filters.get('department') or filters['department']==x['org_unit_id'])]
  if assessments:
   r=orow(o)
   if filters.get('department'):r['department']=filters['department']
   result['applicable'].append(r)
 result['owners']=[orow(o) for o in obls if o['stage']=='BUSINESS_VALIDATION'];result['content']=[orow(o) for o in obls if o['content_validation_status']!='VALIDATED' and o['record_status'] not in {'SUPERSEDED','RETIRED'}]
 result['open']=[ar(a) for a in openrows];result['overdue']=[ar(a) for a in openrows if a['current_due_date']<day]
 result['upcoming']=[ar(a) for a in actions if a['record_status'] in d.OPEN and a['period_from'] and a['period_from']>day]
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
 def match(r):
  return all(not filters.get(k) or str(r.get(k,''))==filters[k] for k in ['domain','department','owner','criticality','status']) and (not filters.get('from') or r['date']>=filters['from']) and (not filters.get('to') or r['date']<=filters['to'])
 metrics={}
 for key,rows in result.items():
  rows=sorted((r for r in rows if match(r)),key=lambda r:(r['date'],r['id']))
  metrics[key]={'label':DEFINITIONS[key][0],'definition':DEFINITIONS[key][1],'count':len(rows),'records':rows,'population_hash':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()}
 return {'generated_at':now().isoformat()+'Z','business_date':day,'timezone':'Asia/Kolkata','filters':{k:filters[k] for k in ['domain','department','owner','criticality','status','from','to'] if filters.get(k)},'metrics':metrics,'date_semantics':'Source effective date; obligation next-review date; action internal target; evidence period end. Current operational snapshot, not historical reconstruction.'}

def export(report,metric,expected_hash):
 d.fail(metric in report['metrics'],'Choose a report measure.');data=report['metrics'][metric]
 d.fail(expected_hash and data['population_hash']==expected_hash,'The record population changed. Refresh the dashboard before exporting.',409)
 output=io.StringIO();writer=csv.writer(output);fields=['kind','id','title','department','owner','domain','criticality','status','date','path']
 writer.writerow(fields)
 for row in data['records']:
  values=[]
  for field in fields:
   text=str(row.get(field,'') or '');values.append("'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text)
  writer.writerow(values)
 return '\ufeff'+output.getvalue(),data['count']
