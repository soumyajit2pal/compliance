"""Real Week 5 services. Caller owns transaction, CSRF and private-file rollback.

Definition governance remains in obligations/repository. Delivery locks the continuing
obligation first, then the action, and rechecks named, effective authority on writes.
"""
import hashlib,json
from datetime import date,datetime,timedelta
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m,repository as repo,obligations as obl
from .access import actor_for,READ_ROLES,REGULATORY_ROLES
from .events import audit,history,notify,new_id,now,record_audit
from .source_documents import inspect_source,preserve_bytes
from .storage import stored_path

OWNER_ROLES={'BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','AUTHOR'}
OPEN={'OPEN','IN_PROGRESS','PENDING_VALIDATION'}
BLOCKING={'UNAPPROVED_SOURCE','SOURCE_PERIOD_MISMATCH','SOURCE_REASSESSMENT_REQUIRED','PROCESS_REASSESSMENT_REQUIRED','PRODUCT_REASSESSMENT_REQUIRED','OBLIGATION_REASSESSMENT_REQUIRED','CONTENT_VALIDATION_PENDING','INVALID_OWNER_ACCESS','MISSING_OR_UNAVAILABLE_CLAUSE','MISSING_EVIDENCE_STANDARD','UNAPPROVED_NON_APPLICABILITY'}
def today():return datetime.now(ZoneInfo('Asia/Kolkata')).date()
def fail(condition,message,status=422):
    if not condition:raise HTTPException(status,message)
def allrows(db,table,condition=None):
    q=sa.select(table)
    if condition is not None:q=q.where(condition)
    return [dict(x) for x in db.execute(q).mappings()]
def read(db,actor,identifier,lock=False):
    a=repo.one(db,m.action,identifier);o=obl.read(db,actor,a['obligation_id'],lock)
    fail(actor.covers(a['owner_unit_id'],READ_ROLES) or actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES),'Action not found in your authorised area.',404)
    if lock:a=repo.one(db,m.action,identifier,True)
    return a,o
def revision(a,p):fail(a['edit_revision']==p.expected_revision,'This work changed. Refresh and review the latest record before deciding.',409)
def update(db,actor,a,values,event,reason=''):
    before=dict(a);values={**values,'edit_revision':a['edit_revision']+1}
    db.execute(m.action.update().where(m.action.c.id==a['id']).values(**values))
    audit(db,actor,'action',a['id'],event,old=before,new={**before,**values},reason=reason)
    if 'record_status' in values and values['record_status']!=before['record_status']:history(db,actor,'action',a['id'],before['record_status'],values['record_status'],reason or event)
    a.update(values)
def require_owner(actor,a):
    fail(actor.id==a['owner_user_id'] and actor.covers(a['owner_unit_id'],OWNER_ROLES),'Only the current named owner can change this work.',403)
def require_reviewer(actor,a,o):
    fail(actor.id==a['reviewer_user_id'] and actor.id not in {a['owner_user_id'],a['created_by']} and actor.covers(o['regulatory_owner_unit_id'],{'REVIEWER'}),'Only the independent assigned Compliance reviewer can decide this work.',403)
def current_obligation(db,actor,o,unit):
    day=today();fail(o['record_status']=='ACTIVE' and o['approval_status']=='APPROVED' and o['effective_from']<=day and (not o['effective_to'] or o['effective_to']>day),'Use an effective Active approved obligation.',409)
    issues=set(obl.issues(db,actor,o))
    fail(not (issues&BLOCKING) and not any(i.startswith('MISSING_') or i.endswith('_REASSESSMENT_REQUIRED') for i in issues),'Source, ownership, process or content reassessment is required before delivery can complete.',409)
    apps=[x for x in obl.rows(db,m.obligation_applicability,o['id']) if x['org_unit_id']==unit and x['approval_status']=='APPROVED' and x['applicability_status']!='NOT_APPLICABLE' and x['effective_from']<=day and (not x['effective_to'] or x['effective_to']>day)]
    fail(apps and any(x['applicability_status']!='NOT_APPLICABLE' for x in apps),'The action department needs approved applicable or partial scope.',409)
    return apps[0]
def effective_deadline(db,actor,o):
    _,_,instrument=obl.source(db,actor,o['primary_clause_id'])
    rows=allrows(db,m.regulatory_deadline,sa.and_(m.regulatory_deadline.c.instrument_id==instrument['id'],m.regulatory_deadline.c.approval_status=='APPROVED',m.regulatory_deadline.c.effective_from<=today()))
    return max(rows,key=lambda x:(x['effective_from'],x['approved_at']),default=None)
def check_deadline(db,actor,o,due):
    record=effective_deadline(db,actor,o)
    fail(not record or due<=record['due_date'],'The internal target exceeds the independently approved regulatory deadline. Use the existing source-backed regulatory-deadline workflow.');return record

def eligible_owner(db,user,unit):
    candidate=actor_for(db,user);candidate.require(OWNER_ROLES,unit)
    fail(not any(candidate.user.get(k) for k in ['must_change_password_flag','needs_email_confirmation_flag','needs_department_selection_flag']),'The assigned owner must finish sign-in and onboarding.')
    return candidate

def create(db,actor,p):
    o=obl.read(db,actor,p.obligation_id,True)
    fail(actor.covers(o['regulatory_owner_unit_id'],{'AUTHOR'}) or actor.covers(p.owner_unit_id,{'BUSINESS_OWNER'}),'Your role cannot assign this work.',403)
    app=current_obligation(db,actor,o,p.owner_unit_id);candidate=eligible_owner(db,p.owner_user_id,p.owner_unit_id)
    obl.read(db,candidate,o['id']);obl.require_citations(db,candidate,o['id'])
    reviewer=obl.eligible(db,p.reviewer_user_id,'REVIEWER',o['regulatory_owner_unit_id'],exclude={actor.id,p.owner_user_id});obl.read(db,reviewer,o['id']);obl.require_citations(db,reviewer,o['id'])
    escalation=actor_for(db,p.escalation_user_id);fail(escalation.covers(p.owner_unit_id,{'BUSINESS_OWNER'}) or escalation.covers(o['regulatory_owner_unit_id'],{'APPROVER','CCO'}),'Choose an eligible escalation authority.');obl.read(db,escalation,o['id'])
    repo.active(db,m.evidence_type,p.evidence_type_id);check_deadline(db,actor,o,p.due_date)
    duplicates=db.execute(sa.select(m.action.c.id).where(m.action.c.obligation_id==o['id'],m.action.c.owner_unit_id==p.owner_unit_id,m.action.c.action_type==p.action_type,m.action.c.period_from==p.period_from,m.action.c.period_to==p.period_to,m.action.c.record_status!='CANCELLED')).first()
    fail(not duplicates,'An assignment already exists for this obligation, department, type and period.',409)
    from . import controls
    mappings=controls.prepare_links(db,actor,o,p)
    identifier=new_id();values=p.model_dump(exclude={'due_date','control_mapping_ids','custom_fields'});values.update(id=identifier,code=repo.next_code(db,'action'),applicability_id=app['id'],original_due_date=p.due_date,current_due_date=p.due_date,record_status='OPEN',created_by=actor.id,retained_validation_required_flag=int(p.retained_validation_required_flag or o['testing_required_flag'] or o['certification_required_flag']))
    db.execute(m.action.insert().values(**values));controls.link_action(db,actor,values,mappings);audit(db,actor,'action',identifier,'ASSIGNED',new={**values,'control_mapping_ids':p.control_mapping_ids});history(db,actor,'action',identifier,None,'OPEN','Period-specific work assigned from an Active obligation.')
    from .dropdowns import save_answers
    save_answers(db,actor,'action',identifier,p.custom_fields)
    notify(db,'action',identifier,p.owner_user_id,'ACTION_ASSIGNED',identifier+':assigned')
    return {'id':identifier,'code':values['code']}

def evidence_read(db,actor,identifier,*,action_id=None):
    e=repo.one(db,m.evidence_item,identifier);permitted=False
    for link in allrows(db,m.evidence_link,m.evidence_link.c.evidence_id==identifier):
        if not link['action_id'] or (action_id and link['action_id']!=action_id):continue
        try:a,o=read(db,actor,link['action_id'])
        except HTTPException:continue
        rank=repo.one(db,m.confidentiality_class,e['confidentiality_class_id'])['rank_number']
        role=actor.delegation['role_code'] if actor.delegation else None
        personal=actor.id in {a['owner_user_id'],e['uploaded_by']} and (role is None or role in OWNER_ROLES) or actor.id==a['reviewer_user_id'] and (role is None or role=='REVIEWER')
        if rank<2 or personal or actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES):permitted=True;break
    fail(permitted,'Evidence not found in your authorised area.',404);return e

def current_links(db,a):
    links=allrows(db,m.evidence_link,m.evidence_link.c.action_id==a['id']);docs={l['evidence_id']:repo.one(db,m.evidence_item,l['evidence_id']) for l in links}
    superseded={e['supersedes_evidence_id'] for e in docs.values() if e['supersedes_evidence_id']}
    return [(l,docs[l['evidence_id']]) for l in links if l['evidence_id'] not in superseded and docs[l['evidence_id']]['evidence_status'] not in {'REJECTED','SUPERSEDED'}]
def evidence_valid(a,e):
    fail(e['evidence_type_id']==a['evidence_type_id'],'The evidence type does not match this assignment.')
    fail(e['period_from']==a['period_from'] and e['period_to']==a['period_to'],'Evidence must cover this exact reporting period.')
    fail(e['retention_end_date']>=today() and e['retention_end_date']>=a['period_to'],'Evidence is expired or its retention period is insufficient.')
    fail(e['evidence_status'] not in {'EXPIRED','REJECTED','SUPERSEDED'},'Use current evidence or create a corrected version.')
def latest(db,a):
    return db.execute(sa.select(m.action_submission).where(m.action_submission.c.action_id==a['id']).order_by(m.action_submission.c.submission_number.desc())).mappings().first()
def snapshot(db,a):
    result=[]
    for link,e in current_links(db,a):
        evidence_valid(a,e);result.append({'link_id':link['id'],'evidence_id':e['id'],'code':e['code'],'title':e['title'],'sha256':e['file_hash'],'period_from':str(e['period_from']),'period_to':str(e['period_to']),'source_system':e['source_system'],'source_record':e['source_record'],'repository_uri':e['repository_uri'],'document_id':e['document_id'],'confidentiality_class_id':e['confidentiality_class_id'],'retention_end_date':str(e['retention_end_date'])})
    fail(result,'Link suitable current evidence before submission.');return result

def return_reason(db,a):
    if a['record_status'] not in {'OPEN','IN_PROGRESS'}:return None
    events=allrows(db,m.audit_log,sa.and_(m.audit_log.c.entity_type=='action',m.audit_log.c.entity_id==a['id'],m.audit_log.c.action.in_(['RETURN','SUBMITTED'])))
    # Oracle DATE event timestamps can tie within one second. Action revisions
    # serialise these events under the same root/action lock without ambiguity.
    event=max(events,key=lambda e:(json.loads(e['new_value'] or '{}').get('edit_revision',0),e['event_at']),default=None)
    return event['reason'] if event and event['action']=='RETURN' else None

def ordered_validations(db,identifier):
    checks=allrows(db,m.action_validation,m.action_validation.c.action_id==identifier)
    ids=[v['id'] for v in checks]
    events=allrows(db,m.audit_log,sa.and_(m.audit_log.c.entity_type=='action_validation',m.audit_log.c.entity_id.in_(ids),m.audit_log.c.action=='RECORDED')) if ids else []
    ranks={e['entity_id']:json.loads(e['new_value'] or '{}').get('expected_revision') for e in events}
    return sorted(checks,key=lambda v:(ranks.get(v['id']) or -1,v['recorded_at'])),ranks

def detail(db,actor,identifier):
    a,o=read(db,actor,identifier)
    links=allrows(db,m.evidence_link,m.evidence_link.c.action_id==identifier);evidence=[]
    for l in links:
        try:e=evidence_read(db,actor,l['evidence_id'])
        except HTTPException:continue
        evidence.append({**e,'link_id':l['id']})
    submissions=allrows(db,m.action_submission,m.action_submission.c.action_id==identifier);submissions.sort(key=lambda x:x['submission_number'])
    subids=[s['id'] for s in submissions]
    decisions=allrows(db,m.action_evidence_decision,m.action_evidence_decision.c.submission_id.in_(subids)) if subids else []
    extensions=allrows(db,m.due_date_history,m.due_date_history.c.action_id==identifier)
    workflows=[]
    for ext in extensions:
        instance=db.execute(sa.select(m.workflow_instance).where(m.workflow_instance.c.entity_type=='action_extension',m.workflow_instance.c.entity_id==ext['id']).order_by(m.workflow_instance.c.started_at.desc())).mappings().first()
        if instance:workflows.extend(allrows(db,m.workflow_action,m.workflow_action.c.instance_id==instance['id']))
    _,edition,instrument=obl.source(db,actor,o['primary_clause_id'])
    from . import controls
    from .dropdowns import read_answers
    return {'action':{**a,'custom_answers':read_answers(db,'action',identifier)},'obligation':o,'return_reason':return_reason(db,a),'controls':controls.action_context(db,actor,a),'source':{'id':instrument['id'],'title':instrument['title'],'version_id':edition['id'],'version_number':edition['version_number'],'clause_id':o['primary_clause_id']},'evidence':evidence,'submissions':submissions,'evidence_decisions':decisions,'extensions':extensions,'extension_tasks':workflows,'validations':ordered_validations(db,identifier)[0],'regulatory_deadline':effective_deadline(db,actor,o),'history':allrows(db,m.status_history,sa.and_(m.status_history.c.entity_type=='action',m.status_history.c.entity_id==identifier)),'audit':record_audit(db,sa.and_(m.audit_log.c.entity_type=='action',m.audit_log.c.entity_id==identifier)),'permissions':{'can_work':actor.id==a['owner_user_id'] and actor.covers(a['owner_unit_id'],OWNER_ROLES),'can_review':actor.id==a['reviewer_user_id'] and actor.covers(o['regulatory_owner_unit_id'],{'REVIEWER'}),'can_validate':actor.covers(o['regulatory_owner_unit_id'],{'AUTHOR'}),'can_cancel':actor.covers(o['regulatory_owner_unit_id'],{'APPROVER'})}}

def listing(db,actor,filters=None):
    actor.require(READ_ROLES);filters=filters or {};result=[]
    for raw in allrows(db,m.action):
        try:a,o=read(db,actor,raw['id'])
        except HTTPException:continue
        if filters.get('mine')=='1' and actor.id not in {a['owner_user_id'],a['reviewer_user_id']}:continue
        data={**a,'obligation_code':o['code'],'obligation_title':o['title'],'domain_id':o['primary_domain_id'],'criticality':o['criticality'],'overdue':a['record_status'] in OPEN and a['current_due_date']<today(),'path':'actions/'+a['id']}
        if filters.get('obligation') and o['id']!=filters['obligation']:continue
        if filters.get('department') and a['owner_unit_id']!=filters['department']:continue
        if filters.get('owner') and a['owner_user_id']!=filters['owner']:continue
        if filters.get('domain') and o['primary_domain_id']!=filters['domain']:continue
        if filters.get('criticality') and o['criticality']!=filters['criticality']:continue
        if filters.get('status') and a['record_status']!=filters['status']:continue
        if filters.get('from') and str(a['current_due_date'])<filters['from'] or filters.get('to') and str(a['current_due_date'])>filters['to']:continue
        if filters.get('q') and filters['q'].lower() not in (a['description']+' '+a['code']+' '+o['title']).lower():continue
        result.append(data)
    return sorted(result,key=lambda x:(x['current_due_date'],x['code']))

def start(db,actor,identifier,p):
    a,o=read(db,actor,identifier,True);revision(a,p);require_owner(actor,a)
    fail(a['record_status']=='OPEN' and a['period_from'] and a['period_from']<=today(),'Only current assigned work can start.',409)
    update(db,actor,a,{'record_status':'IN_PROGRESS'},'STARTED');return {'ok':True}

def save_result(db,actor,identifier,p,submit=False):
    a,o=read(db,actor,identifier,True);revision(a,p);require_owner(actor,a);fail(a['record_status'] in {'OPEN','IN_PROGRESS'},'Submitted or completed work cannot be overwritten.',409)
    values={'result_notes':p.notes,'record_status':'IN_PROGRESS'}
    if submit:
        fail(a['period_to'] and a['period_to']<=today(),'The reporting period must finish before submission.');current_obligation(db,actor,o,a['owner_unit_id'])
        proof=snapshot(db,a);previous=latest(db,a);sid=new_id()
        db.execute(m.action_submission.insert().values(id=sid,action_id=identifier,submission_number=previous['submission_number']+1 if previous else 1,result_notes=p.notes,evidence_snapshot=json.dumps(proof),submitted_by=actor.id,submitted_at=now()))
        from . import controls
        controls.bind_submission(db,actor,a,sid,proof)
        values.update(record_status='PENDING_VALIDATION',evidence_status='SUBMITTED');notify(db,'action',identifier,a['reviewer_user_id'],'ACTION_REVIEW_REQUIRED',sid+':review')
    update(db,actor,a,values,'SUBMITTED' if submit else 'DRAFT_SAVED');return {'ok':True}

def attach(db,actor,identifier,p):
    a,o=read(db,actor,identifier,True);revision(a,p);require_owner(actor,a);fail(a['record_status'] in {'OPEN','IN_PROGRESS'},'Evidence links are locked during review.',409)
    e=evidence_read(db,actor,p.evidence_id);evidence_valid(a,e)
    doc=repo.one(db,m.document,e['document_id']) if e['document_id'] else None
    fail(not doc or doc['owner_unit_id']==a['owner_unit_id'],'Evidence belongs to a different department.')
    origins=allrows(db,m.evidence_link,m.evidence_link.c.evidence_id==e['id'])
    fail(any(l['action_id'] and repo.one(db,m.action,l['action_id'])['owner_unit_id']==a['owner_unit_id'] for l in origins),'Reuse evidence only within its original authorised department.')
    fail(not db.execute(sa.select(m.evidence_link.c.id).where(m.evidence_link.c.action_id==identifier,m.evidence_link.c.evidence_id==e['id'])).first(),'This evidence is already linked.',409)
    linkid=new_id();db.execute(m.evidence_link.insert().values(id=linkid,evidence_id=e['id'],action_id=identifier,link_purpose='EXECUTION',primary_evidence_flag=0,linked_by=actor.id,linked_at=now()))
    update(db,actor,a,{},'EVIDENCE_LINKED',p.reason);return {'id':linkid}

def add_evidence(db,actor,identifier,p,storage,filename=None,data=None):
    a,o=read(db,actor,identifier,True);revision(a,p);require_owner(actor,a);fail(a['record_status'] in {'OPEN','IN_PROGRESS'},'Evidence can be submitted only with editable work.',409)
    repo.active(db,m.evidence_type,p.evidence_type_id);repo.active(db,m.confidentiality_class,p.confidentiality_class_id)
    fail(a['period_from'] and a['period_to'],'Legacy work needs validated reporting-period migration before evidence can be submitted.')
    fail(p.retention_end_date>=max(today(),a['period_to']),'Choose a retention date covering the reporting period and current date.')
    document_id=None;digest=None
    if data is not None:
        details=inspect_source(filename,data);document_id=new_id();preserve_bytes(db,storage,document_id,details['file_name'],data);digest=details['file_hash']
        db.execute(m.document.insert().values(id=document_id,storage_uri='portal://'+document_id,owner_unit_id=a['owner_unit_id'],confidentiality_class_id=p.confidentiality_class_id,uploaded_by=actor.id,uploaded_at=now(),**details))
    else:
        uri=urlparse(p.repository_uri or '');fail(uri.scheme=='https' and uri.hostname and not uri.username and not uri.password and bool(p.file_hash),'For an existing repository, provide an HTTPS reference and the source record SHA-256. No remote content is fetched.');digest=p.file_hash.lower()
    old=None
    if p.supersedes_evidence_id:
        old=evidence_read(db,actor,p.supersedes_evidence_id);fail(old['uploaded_by']==actor.id and any(e['id']==old['id'] for _,e in current_links(db,a)) or old['uploaded_by']==actor.id and db.execute(sa.select(m.evidence_link.c.id).where(m.evidence_link.c.action_id==a['id'],m.evidence_link.c.evidence_id==old['id'])).first(),'Correct only your evidence already linked to this work.',403)
        old=repo.one(db,m.evidence_item,old['id'],True)
        fail(old['period_from']==a['period_from'] and old['period_to']==a['period_to'],'A correction must preserve the exact reporting period.')
        fail(not db.execute(sa.select(m.evidence_item.c.id).where(m.evidence_item.c.supersedes_evidence_id==old['id'])).first(),'A correction already exists for this evidence version.',409)
    identifier=new_id();values=p.model_dump(exclude={'expected_revision'});values['repository_uri']=p.repository_uri if document_id is None else None
    values.update(id=identifier,code=repo.next_code(db,'evidence'),document_id=document_id,file_hash=digest,period_from=a['period_from'],period_to=a['period_to'],uploaded_by=actor.id,uploaded_at=now(),evidence_status='SUBMITTED')
    evidence_valid(a,values);db.execute(m.evidence_item.insert().values(**values));linkid=new_id()
    db.execute(m.evidence_link.insert().values(id=linkid,evidence_id=identifier,action_id=a['id'],link_purpose='EXECUTION',primary_evidence_flag=1,linked_by=actor.id,linked_at=now()))
    audit(db,actor,'evidence',identifier,'SUBMITTED',new=values);update(db,actor,a,{},'EVIDENCE_SUBMITTED');return {'id':identifier,'code':values['code']}

def integrity(db,e,storage):
    if not e['document_id']:return # Source hash is independently confirmed for an external repository reference.
    doc=repo.one(db,m.document,e['document_id']);fail(doc['file_hash']==e['file_hash'],'Stored evidence/document hashes disagree.',409)
    path=stored_path(storage,doc['id'],doc['file_name']);fail(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest()==e['file_hash'],'Evidence bytes failed integrity verification.',409)

def decide_evidence(db,actor,identifier,p,storage):
    a,o=read(db,actor,identifier,True);revision(a,p);require_reviewer(actor,a,o);fail(a['record_status']=='PENDING_VALIDATION','Only the current submitted work can be reviewed.',409)
    sub=latest(db,a);fail(sub and sub['id']==p.submission_id,'A newer submission exists. Refresh the review.',409)
    proof=json.loads(sub['evidence_snapshot']);target=next((x for x in proof if x['link_id']==p.evidence_link_id),None);fail(target,'Choose evidence in the current submission.')
    e=repo.one(db,m.evidence_item,target['evidence_id'],True);evidence_read(db,actor,e['id']);evidence_valid(a,e);fail(e['uploaded_by']!=actor.id,'An uploader cannot verify their own evidence.',403);fail(target['sha256']==e['file_hash'],'Evidence changed since submission.',409);integrity(db,e,storage)
    fail(not db.execute(sa.select(m.action_evidence_decision.c.id).where(m.action_evidence_decision.c.submission_id==sub['id'],m.action_evidence_decision.c.evidence_link_id==p.evidence_link_id)).first(),'This evidence decision is already recorded. Return the work for a new submission.',409)
    values=dict(id=new_id(),submission_id=sub['id'],evidence_link_id=p.evidence_link_id,decision=p.decision,reason=p.reason,reviewed_by=actor.id,reviewed_at=now());db.execute(m.action_evidence_decision.insert().values(**values))
    if e['evidence_status']=='SUBMITTED':
        db.execute(m.evidence_item.update().where(m.evidence_item.c.id==e['id']).values(evidence_status='ACCEPTED' if p.decision=='ACCEPT' else 'REJECTED',verified_by=actor.id,verified_at=now(),rejection_reason=p.reason if p.decision=='REJECT' else None))
    if p.decision=='ACCEPT' and e['supersedes_evidence_id']:
        old=repo.one(db,m.evidence_item,e['supersedes_evidence_id'],True)
        if old['evidence_status']=='ACCEPTED':db.execute(m.evidence_item.update().where(m.evidence_item.c.id==old['id']).values(evidence_status='SUPERSEDED'))
    audit(db,actor,'evidence',e['id'],p.decision,new=values,reason=p.reason)
    notify(db,'action',a['id'],a['owner_user_id'],'EVIDENCE_'+p.decision,sub['id']+':'+p.evidence_link_id+':'+p.decision)
    update(db,actor,a,{},'EVIDENCE_'+p.decision,p.reason);return {'ok':True}

def decide_work(db,actor,identifier,p,storage):
    a,o=read(db,actor,identifier,True);revision(a,p)
    if p.decision=='CANCEL':
        actor.require({'APPROVER'},o['regulatory_owner_unit_id']);fail(actor.id not in {a['created_by'],a['owner_user_id']},'Cancellation needs an independent authority.',403);fail(a['record_status'] in OPEN,'Closed work cannot be cancelled.',409)
        values={'record_status':'CANCELLED'}
    else:
        require_reviewer(actor,a,o);fail(a['record_status']=='PENDING_VALIDATION','Only submitted work can be decided.',409)
        if p.decision=='RETURN':values={'record_status':'IN_PROGRESS','evidence_status':'CHANGES_REQUIRED'}
        else:
            current_obligation(db,actor,o,a['owner_unit_id']);fail(a['period_to'] and a['period_to']<=today(),'A future reporting period cannot complete.')
            sub=latest(db,a);fail(sub,'A retained submission is required.',409);proof=json.loads(sub['evidence_snapshot']);fail(proof,'Supporting evidence is required.')
            decisions={x['evidence_link_id']:x for x in allrows(db,m.action_evidence_decision,m.action_evidence_decision.c.submission_id==sub['id'])}
            for item in proof:
                e=repo.one(db,m.evidence_item,item['evidence_id'],True);evidence_valid(a,e);integrity(db,e,storage);d=decisions.get(item['link_id']);fail(d and d['decision']=='ACCEPT' and d['reviewed_by']==actor.id and e['evidence_status']=='ACCEPTED' and e['file_hash']==item['sha256'],'Every submitted evidence link needs accepted independent review.',409)
            if a['retained_validation_required_flag']:
                checks,ranks=ordered_validations(db,a['id']);test=checks[-1] if checks else None
                fail(all(ranks.get(v['id']) is not None for v in checks),'Retained validation is missing its transactional audit record.',409)
                fail(test and test['decision']=='ACCEPT' and test['result']=='PASS' and test['reviewed_by']!=test['recorded_by'],'Required retained-process/testing/certification validation is missing, rejected or failed.',409)
                doc=repo.one(db,m.document,test['document_id']);integrity(db,{'document_id':doc['id'],'file_hash':doc['file_hash']},storage)
            from . import controls
            controls.closure(db,actor,a,sub)
            values={'record_status':'COMPLETED','completed_at':now(),'completed_by':actor.id,'evidence_status':'ACCEPTED'}
    update(db,actor,a,values,p.decision,p.reason);notify(db,'action',a['id'],a['owner_user_id'],'ACTION_'+p.decision,a['id']+':'+str(a['edit_revision'])+':'+p.decision)
    if p.decision in {'COMPLETE','CANCEL'}:
        for ext in allrows(db,m.due_date_history,sa.and_(m.due_date_history.c.action_id==a['id'],m.due_date_history.c.approval_status.in_(['IN_REVIEW','REVIEWED']))):
            db.execute(m.due_date_history.update().where(m.due_date_history.c.id==ext['id']).values(approval_status='WITHDRAWN'))
            for wf in allrows(db,m.workflow_instance,sa.and_(m.workflow_instance.c.entity_type=='action_extension',m.workflow_instance.c.entity_id==ext['id'],m.workflow_instance.c.record_status=='OPEN')):db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==wf['id']).values(record_status='WITHDRAWN',completed_at=now()))
            audit(db,actor,'action_extension',ext['id'],'CLOSED_WITH_WORK',reason='Work completed/cancelled before a date-change decision; no extension applied.')
    return {'ok':True}

def extend(db,actor,identifier,p):
    a,o=read(db,actor,identifier,True);revision(a,p);require_owner(actor,a);fail(a['record_status'] in OPEN,'Closed work cannot be extended.',409)
    fail(p.due_date>a['current_due_date'] and p.due_date>=today(),'Request a later internal target on or after today.');check_deadline(db,actor,o,p.due_date)
    fail(not db.execute(sa.select(m.due_date_history.c.id).where(m.due_date_history.c.action_id==identifier,m.due_date_history.c.approval_status.in_(['DRAFT','IN_REVIEW','REVIEWED']))).first(),'A date-change request is already pending.',409)
    reviewer=obl.eligible(db,a['reviewer_user_id'],'REVIEWER',o['regulatory_owner_unit_id'],{actor.id});approver=obl.eligible(db,p.approver_id,'APPROVER',o['regulatory_owner_unit_id'],{actor.id,reviewer.id})
    for candidate in [reviewer,approver]:obl.read(db,candidate,o['id']);obl.require_citations(db,candidate,o['id'])
    identifier=new_id();db.execute(m.due_date_history.insert().values(id=identifier,action_id=a['id'],previous_due_date=a['current_due_date'],revised_due_date=p.due_date,reason=p.reason,requested_by=actor.id,requested_at=now(),created_by=actor.id,approval_status='IN_REVIEW'))
    wf=new_id();db.execute(m.workflow_instance.insert().values(id=wf,workflow_type='ACTION_EXTENSION',entity_type='action_extension',entity_id=identifier,current_stage='COMPLIANCE_REVIEW',started_by=actor.id,started_at=now()))
    for role,user in [('COMPLIANCE_REVIEW',reviewer.id),('FINAL_APPROVAL',approver.id)]:db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=wf,stage=role,assignee_user_id=user,due_at=now()+timedelta(days=2)))
    notify(db,'action_extension',identifier,reviewer.id,'EXTENSION_REVIEW',identifier+':review');update(db,actor,a,{},'EXTENSION_REQUESTED',p.reason)
    audit(db,actor,'action_extension',identifier,'REQUESTED',new={'action_id':a['id'],'previous_due_date':a['current_due_date'],'revised_due_date':p.due_date},reason=p.reason);return {'id':identifier}

def decide_extension(db,actor,identifier,p):
    ext=repo.one(db,m.due_date_history,identifier);fail(ext['action_id'],'This request is not an action extension.',404)
    a,o=read(db,actor,ext['action_id'],True);ext=repo.one(db,m.due_date_history,identifier,True)
    fail(a['record_status'] in OPEN and ext['approval_status'] in {'IN_REVIEW','REVIEWED'},'The request is no longer pending.',409)
    wf=db.execute(sa.select(m.workflow_instance).where(m.workflow_instance.c.entity_type=='action_extension',m.workflow_instance.c.entity_id==identifier,m.workflow_instance.c.record_status=='OPEN').with_for_update()).mappings().one()
    task=db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.instance_id==wf['id'],m.workflow_action.c.stage==wf['current_stage'],m.workflow_action.c.assignee_user_id==actor.id,m.workflow_action.c.decision.is_(None)).with_for_update()).mappings().first()
    fail(task and actor.id!=ext['requested_by'],'Only the independent named recipient can decide the current stage.',403)
    is_review=wf['current_stage']=='COMPLIANCE_REVIEW';actor.require({'REVIEWER' if is_review else 'APPROVER'},o['regulatory_owner_unit_id'])
    fail(p.decision in ({'REVIEW','RETURN','REJECT'} if is_review else {'APPROVE','RETURN','REJECT'}),'Choose a decision for the current stage.')
    if not is_review:fail(actor.id!=ext['reviewed_by'],'Final authority must differ from the reviewer.',403)
    db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision=p.decision,acted_by=actor.id,acted_at=now(),comments=p.reason))
    if p.decision=='REVIEW':
        db.execute(m.due_date_history.update().where(m.due_date_history.c.id==identifier).values(approval_status='REVIEWED',reviewed_by=actor.id,reviewed_at=now()))
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==wf['id']).values(current_stage='FINAL_APPROVAL'))
        final=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==wf['id'],m.workflow_action.c.stage=='FINAL_APPROVAL')).scalar_one();notify(db,'action_extension',identifier,final,'EXTENSION_APPROVAL',identifier+':approval')
    elif p.decision=='APPROVE':
        fail(a['current_due_date']==ext['previous_due_date'],'The original request is stale; raise a new request.',409);check_deadline(db,actor,o,ext['revised_due_date'])
        db.execute(m.due_date_history.update().where(m.due_date_history.c.id==identifier).values(approval_status='APPROVED',approved_by=actor.id,approved_at=now()))
        update(db,actor,a,{'current_due_date':ext['revised_due_date'],'extension_count':a['extension_count']+1,'extension_reason':ext['reason']},'DUE_DATE_CHANGED',p.reason)
        # Oracle's existing date trigger consumes this exact approval atomically.
        if (db.get_bind().dialect if hasattr(db,'get_bind') else db.dialect).name!='oracle':db.execute(m.due_date_history.update().where(m.due_date_history.c.id==identifier).values(applied_at=now()))
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==wf['id']).values(record_status='APPROVED',completed_at=now()))
        notify(db,'action',a['id'],a['owner_user_id'],'EXTENSION_APPROVED',identifier+':approved')
    else:
        db.execute(m.due_date_history.update().where(m.due_date_history.c.id==identifier).values(approval_status='WITHDRAWN' if p.decision=='RETURN' else 'REJECTED'))
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==wf['id']).values(record_status='RETURNED' if p.decision=='RETURN' else 'REJECTED',completed_at=now()))
        notify(db,'action',a['id'],a['owner_user_id'],'EXTENSION_'+p.decision,identifier+':'+p.decision)
    audit(db,actor,'action_extension',identifier,p.decision,old=ext,new={'decision':p.decision},reason=p.reason);return {'ok':True}

def record_validation(db,actor,identifier,p):
    a,o=read(db,actor,identifier,True);revision(a,p);actor.require({'AUTHOR'},o['regulatory_owner_unit_id']);fail(a['record_status'] in OPEN,'Closed work cannot receive a new closure validation.',409)
    doc=repo.one(db,m.document,p.document_id);fail(doc['uploaded_by']==actor.id,'Upload the retained-process result as its recorder before proposing validation.',403)
    identifier=new_id();db.execute(m.action_validation.insert().values(id=identifier,action_id=a['id'],reference=p.reference,procedure_text=p.procedure_text,result=p.result,document_id=p.document_id,recorded_by=actor.id,recorded_at=now()))
    audit(db,actor,'action_validation',identifier,'RECORDED',new=p.model_dump());notify(db,'action',a['id'],a['reviewer_user_id'],'RETAINED_VALIDATION_REQUIRED',identifier+':review');update(db,actor,a,{},'VALIDATION_RECORDED',p.reason);return {'id':identifier}

def decide_validation(db,actor,identifier,p,storage):
    v=repo.one(db,m.action_validation,identifier);a,o=read(db,actor,v['action_id'],True);v=repo.one(db,m.action_validation,identifier,True);require_reviewer(actor,a,o)
    fail(v['decision']=='PENDING' and v['recorded_by']!=actor.id,'Only independently recorded pending validation can be decided.',409)
    doc=repo.one(db,m.document,v['document_id']);integrity(db,{'document_id':doc['id'],'file_hash':doc['file_hash']},storage)
    values={'decision':p.decision,'decision_reason':p.reason,'reviewed_by':actor.id,'reviewed_at':now()};db.execute(m.action_validation.update().where(m.action_validation.c.id==identifier).values(**values))
    audit(db,actor,'action_validation',identifier,p.decision,old=v,new=values,reason=p.reason);update(db,actor,a,{},'VALIDATION_'+p.decision,p.reason);return {'ok':True}

def tasks(db,actor):
    result=[]
    for a in listing(db,actor):
        if a['period_from'] and a['period_from']>today():continue
        owner=a['owner_user_id']==actor.id and a['record_status'] in {'OPEN','IN_PROGRESS'} and actor.covers(a['owner_unit_id'],OWNER_ROLES)
        review=a['reviewer_user_id']==actor.id and a['record_status']=='PENDING_VALIDATION'
        if owner or review:
            _,o=read(db,actor,a['id'])
            if review and not actor.covers(o['regulatory_owner_unit_id'],{'REVIEWER'}):continue
            result.append({'id':a['id'],'action_id':a['id'],'kind':'DECISION' if review else 'WORK','return_reason':return_reason(db,a),'workflow_kind':'ACTION','title':a['description'],'code':a['code'],'department_id':a['owner_unit_id'],'stage':'EVIDENCE_REVIEW' if review else 'ACTION_DELIVERY','due_at':a['current_due_date'].isoformat(),'action_path':a['path']})
    for ext in allrows(db,m.due_date_history,sa.and_(m.due_date_history.c.action_id.is_not(None),m.due_date_history.c.approval_status.in_(['IN_REVIEW','REVIEWED']))):
        try:a,o=read(db,actor,ext['action_id'])
        except HTTPException:continue
        for wf in allrows(db,m.workflow_instance,sa.and_(m.workflow_instance.c.entity_type=='action_extension',m.workflow_instance.c.entity_id==ext['id'],m.workflow_instance.c.record_status=='OPEN')):
            role='REVIEWER' if wf['current_stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
            if not actor.covers(o['regulatory_owner_unit_id'],{role}) or actor.id in {ext['requested_by'],ext['reviewed_by'] if role=='APPROVER' else None}:continue
            for task in allrows(db,m.workflow_action,sa.and_(m.workflow_action.c.instance_id==wf['id'],m.workflow_action.c.stage==wf['current_stage'],m.workflow_action.c.assignee_user_id==actor.id,m.workflow_action.c.decision.is_(None))):
                result.append({**task,'workflow_kind':'ACTION_EXTENSION','kind':'DECISION','title':'Internal target change · '+a['description'],'code':a['code'],'action_id':a['id'],'extension_id':ext['id'],'department_id':a['owner_unit_id'],'action_path':'actions/'+a['id']+'?extension='+ext['id']})
    return result

def notification_context(db,actor,record):
    kind=record['entity_type'];identifier=record['entity_id']
    if kind=='action_extension':identifier=repo.one(db,m.due_date_history,identifier)['action_id']
    a,o=read(db,actor,identifier)
    return {'source_title':a['code']+' · '+a['description'],'action_path':'actions/'+a['id']+('?extension='+record['entity_id'] if kind=='action_extension' else ''),'action_label':'Open assigned work'}

def assignees(db,actor,obligation_id,role,unit):
    o=obl.read(db,actor,obligation_id);fail(role in {'OWNER','REVIEWER','APPROVER','ESCALATION'},'Choose a delivery responsibility.')
    # Read permission does not grant mutation. Eligible identities are rechecked at write time.
    result=[]
    for u in allrows(db,m.user,m.user.c.active_flag==1):
        try:
            if role=='OWNER':candidate=eligible_owner(db,u['id'],unit)
            elif role in {'REVIEWER','APPROVER'}:candidate=obl.eligible(db,u['id'],role,o['regulatory_owner_unit_id'])
            else:
                candidate=actor_for(db,u['id']);fail(candidate.covers(unit,{'BUSINESS_OWNER'}) or candidate.covers(o['regulatory_owner_unit_id'],{'APPROVER','CCO'}),'Ineligible.')
            obl.read(db,candidate,o['id']);obl.require_citations(db,candidate,o['id'])
        except HTTPException:continue
        result.append({k:u[k] for k in ['id','full_name','username']})
    return result
