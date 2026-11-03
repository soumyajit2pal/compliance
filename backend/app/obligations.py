"""Week 4: clause-sourced obligations, temporal ownership and independent decisions.

All mutations use the continuing obligation's row lock and the caller transaction.
Approved wording is revised into a new version, never edited in place.
"""
from datetime import date,timedelta
import json
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m,repository as repo,business_ids
from .access import actor_for,READ_ROLES,REGULATORY_ROLES
from .events import audit,history,notify,new_id,now
from .obligation_schemas import ObligationInput

ROLE={'REGULATORY':'AUTHOR','BUSINESS':'BUSINESS_OWNER','CONTROL':'CONTROL_OWNER',
      'EVIDENCE':'EVIDENCE_OWNER','DATA':'BUSINESS_OWNER','COMPLIANCE_REVIEWER':'REVIEWER'}
CHILDREN=(m.obligation_owner,m.obligation_applicability)
PENDING=('DRAFT','IN_REVIEW','REVIEWED')


def rows(db,table,identifier,current=True):
    query=sa.select(table).where(table.c.obligation_id==identifier)
    if current and 'approval_status' in table.c:query=query.where(table.c.approval_status!='WITHDRAWN')
    if current and table is m.obligation_owner:query=query.where(table.c.ended_by_change_id.is_(None))
    return [dict(r) for r in db.execute(query.order_by(table.c.created_at,table.c.id)).mappings()]


def source(db,actor,clause_id):
    clause=repo.one(db,m.regulatory_clause,clause_id)
    version,instrument=repo.read_version(db,actor,clause['instrument_version_id'])
    return clause,version,instrument


def visible(db,actor,row):
    if row['id'] in actor.ownership_obligations:return True
    if actor.covers(row['regulatory_owner_unit_id'],REGULATORY_ROLES) or actor.covers(row['business_owner_unit_id'],READ_ROLES):return True
    return any(actor.covers(r['org_unit_id'],READ_ROLES) for table in CHILDREN for r in rows(db,table,row['id']))


def read(db,actor,identifier,lock=False):
    row=repo.one(db,m.compliance_obligation,identifier)
    if lock:
        root=db.execute(sa.select(m.compliance_obligation.c.id).where(m.compliance_obligation.c.code==row['code']).order_by(m.compliance_obligation.c.version_number).limit(1)).scalar_one()
        repo.one(db,m.compliance_obligation,root,True)
        row=repo.one(db,m.compliance_obligation,identifier,True)
    if not visible(db,actor,row):raise HTTPException(404,'Obligation not found in your authorised area.')
    source(db,actor,row['primary_clause_id'])
    return row


def eligible(db,user_id,role,unit,exclude=()):
    repo.active(db,m.organisational_unit,unit)
    candidate=repo.eligible(db,user_id,role,unit,exclude)
    if candidate.user['must_change_password_flag']:raise HTTPException(422,'The assigned user must first change their temporary password.')
    return candidate


def validate(db,actor,payload):
    clause,version,instrument=source(db,actor,payload.primary_clause_id)
    actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    if payload.regulatory_owner_unit_id!=instrument['regulatory_owner_unit_id']:
        raise HTTPException(422,'The lead regulatory department must match the primary source instrument.')
    for table,key in [(m.obligation_category,payload.category_id),(m.frequency,payload.frequency_id),(m.organisational_unit,payload.regulatory_owner_unit_id),
                      (m.regulatory_domain,payload.primary_domain_id),(m.organisational_unit,payload.business_owner_unit_id)]:repo.active(db,table,key)
    domains={instrument['primary_domain_id'],*db.execute(sa.select(m.instrument_domain_map.c.domain_id).where(
        m.instrument_domain_map.c.instrument_id==instrument['id'],m.instrument_domain_map.c.effective_to.is_(None))).scalars()}
    if payload.primary_domain_id not in domains:raise HTTPException(422,'Choose an affected regulatory domain from the primary instrument.')
    eligible(db,payload.compliance_reviewer_user_id,'REVIEWER',payload.regulatory_owner_unit_id,(actor.id,))
    for identifier in [payload.primary_clause_id,*payload.supporting_clause_ids]:
        c,v,_=source(db,actor,identifier)
        if c['approval_status']!='APPROVED' or c['interpretation_status']!='APPROVED' or v['approval_status']!='APPROVED':
            raise HTTPException(422,'Every cited clause and its source edition must have independently approved interpretation.')
        # Draft revisions may retain a historical citation while the maker maps
        # the replacement source. Submission/activation enforce source periods.
    for owner in payload.owners:
        repo.active(db,m.organisational_unit,owner.org_unit_id)
        eligible(db,owner.user_id,ROLE[owner.owner_role],owner.org_unit_id)
        if owner.owner_role=='REGULATORY' and owner.primary_owner_flag and owner.org_unit_id!=payload.regulatory_owner_unit_id:
            raise HTTPException(422,'The primary regulatory owner must belong to the lead regulatory department scope.')
        if owner.owner_role=='BUSINESS' and owner.primary_owner_flag and owner.org_unit_id!=payload.business_owner_unit_id:
            raise HTTPException(422,'The primary business owner must match the accountable business department.')
        if owner.owner_role=='COMPLIANCE_REVIEWER' and (owner.user_id!=payload.compliance_reviewer_user_id or owner.org_unit_id!=payload.regulatory_owner_unit_id):
            raise HTTPException(422,'The reviewer ownership row must match the named Compliance reviewer and lead department.')
    for role in ['REGULATORY','BUSINESS']:
        if sum(o.owner_role==role and o.primary_owner_flag for o in payload.owners)>1:
            raise HTTPException(422,'Choose at most one primary '+role.lower()+' owner.')
    for assessment in payload.applicability:
        repo.active(db,m.legal_entity,assessment.legal_entity_id);repo.active(db,m.organisational_unit,assessment.org_unit_id)
        for field in ['product_id','process_id','channel_id','customer_segment_id','geography_id']:
            identifier=getattr(assessment,field)
            if identifier:
                reference=repo.active(db,getattr(m,field[:-3]),identifier)
                if field=='product_id' and (reference['launch_date']>payload.effective_from or reference['retirement_date'] and reference['retirement_date']<=payload.effective_from):
                    raise HTTPException(422,'The product must be available during the obligation period.')
    for process in payload.processes:repo.active(db,m.process,process.process_id)
    return instrument


def scalar_values(payload):
    return payload.model_dump(exclude={'owners','applicability','processes','supporting_clause_ids','expected_revision','change_reason'})


def save_owners(db,actor,row,payload):
    identifier=row['id'];period={'effective_from':payload.effective_from,'effective_to':payload.effective_to}
    db.execute(m.obligation_owner.update().where(m.obligation_owner.c.obligation_id==identifier,m.obligation_owner.c.approval_status.in_(PENDING)).values(approval_status='WITHDRAWN'))
    owners=list(payload.owners)
    from .obligation_schemas import Owner
    if not any(o.owner_role=='COMPLIANCE_REVIEWER' for o in owners):
        owners.append(Owner(org_unit_id=payload.regulatory_owner_unit_id,user_id=payload.compliance_reviewer_user_id,owner_role='COMPLIANCE_REVIEWER'))
    for owner in owners:
        db.execute(m.obligation_owner.insert().values(id=new_id(),obligation_id=identifier,**owner.model_dump(),**period,created_by=actor.id))


def save_children(db,actor,row,payload):
    identifier=row['id'];period={'effective_from':payload.effective_from,'effective_to':payload.effective_to}
    save_owners(db,actor,row,payload)
    db.execute(m.obligation_applicability.update().where(m.obligation_applicability.c.obligation_id==identifier,m.obligation_applicability.c.approval_status.in_(PENDING)).values(approval_status='WITHDRAWN'))
    for table in [m.obligation_clause_map,m.obligation_process_map]:db.execute(table.delete().where(table.c.obligation_id==identifier))
    for assessment in payload.applicability:
        db.execute(m.obligation_applicability.insert().values(id=new_id(),obligation_id=identifier,**assessment.model_dump(),**period,
            assessed_by=actor.id,assessed_date=date.today(),created_by=actor.id))
    for process in payload.processes:
        db.execute(m.obligation_process_map.insert().values(id=new_id(),obligation_id=identifier,**process.model_dump(),**period))
    for clause_id in [payload.primary_clause_id,*payload.supporting_clause_ids]:
        db.execute(m.obligation_clause_map.insert().values(id=new_id(),obligation_id=identifier,clause_id=clause_id,
            link_type='PRIMARY' if clause_id==payload.primary_clause_id else 'SUPPORTING',**period))


def create(db,actor,payload,*,imported=False,code=None,version=1,supersedes=None):
    validate(db,actor,payload)
    identifier=new_id()
    primary=repo.one(db,m.regulatory_clause,payload.primary_clause_id)
    values=dict(id=identifier,code=code or business_ids.obligation(db,primary['code']),version_number=version,
        supersedes_obligation_id=supersedes,created_by=actor.id,**scalar_values(payload),
        content_validation_status='PENDING',edit_revision=1)
    db.execute(m.compliance_obligation.insert().values(**values))
    if code:
        previous=db.execute(sa.select(m.business_code_alias.c.legacy_code).where(m.business_code_alias.c.obligation_id.is_not(None),m.business_code_alias.c.canonical_code==code).distinct()).scalars().all()
        for old in previous:business_ids.retain_alias(db,'obligation',identifier,old,code)
    save_children(db,actor,values,payload)
    history(db,actor,'obligation',identifier,None,'DRAFT',payload.change_reason)
    audit(db,actor,'obligation',identifier,'IMPORTED_DRAFT' if imported else 'CREATED',new=payload.model_dump(),reason=payload.change_reason)
    return {'id':identifier,'code':values['code'],'version_number':version,'edit_revision':1}


def edit(db,actor,identifier,payload):
    row=read(db,actor,identifier,True);actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
    if row['created_by']!=actor.id or row['approval_status']!='DRAFT':raise HTTPException(409,'Only the Draft maker can edit. Approved content requires a new revision.')
    if payload.expected_revision!=row['edit_revision']:raise HTTPException(409,'This Draft changed. Refresh before saving your edits.')
    validate(db,actor,payload)
    save_children(db,actor,row,payload)
    db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(
        **scalar_values(payload),edit_revision=row['edit_revision']+1,content_validation_status='PENDING'))
    audit(db,actor,'obligation',identifier,'DRAFT_EDITED',old=row,new=payload.model_dump(),reason=payload.change_reason)
    return {'id':identifier,'edit_revision':row['edit_revision']+1}


def input_for(db,row):
    names=set(ObligationInput.model_fields)
    payload={k:v for k,v in row.items() if k in names}
    payload['owners']=[{k:r[k] for k in ['org_unit_id','user_id','owner_role','primary_owner_flag']} for r in rows(db,m.obligation_owner,row['id']) if r['user_id']]
    payload['applicability']=[{k:r[k] for k in ['legal_entity_id','org_unit_id','product_id','process_id','channel_id','customer_segment_id','geography_id','applicability_status','basis','conditions','next_review_date']} for r in rows(db,m.obligation_applicability,row['id'])]
    payload['processes']=[{k:r[k] for k in ['process_id','relevance_type','criticality']} for r in rows(db,m.obligation_process_map,row['id'])]
    payload['supporting_clause_ids']=[r['clause_id'] for r in rows(db,m.obligation_clause_map,row['id']) if r['link_type']!='PRIMARY']
    payload['expected_revision']=row['edit_revision']
    return payload


def issues(db,actor,row,eligibility=None,stage=None):
    result=[];owners=rows(db,m.obligation_owner,row['id']);apps=rows(db,m.obligation_applicability,row['id'])
    for role in ['REGULATORY','BUSINESS','CONTROL','COMPLIANCE_REVIEWER']:
        selected=[o for o in owners if o['owner_role']==role and (role not in {'REGULATORY','BUSINESS'} or o['primary_owner_flag'])]
        if not selected or any(not o['user_id'] for o in selected):result.append('MISSING_'+role+'_OWNER')
    for owner in owners:
        if not owner['user_id']:continue
        key=(owner['user_id'],ROLE[owner['owner_role']],owner['org_unit_id'])
        if eligibility is None:eligibility={}
        if key not in eligibility:
            try:eligible(db,*key);eligibility[key]=True
            except HTTPException:eligibility[key]=False
        if not eligibility[key]:result.append('INVALID_OWNER_ACCESS');break
    if not apps:result.append('MISSING_APPLICABILITY')
    if not rows(db,m.obligation_process_map,row['id']):result.append('MISSING_PROCESS_MAPPING')
    if row['content_validation_status']!='VALIDATED':result.append('CONTENT_VALIDATION_PENDING')
    if not row['evidence_standard'] or not row['evidence_standard'].strip():result.append('MISSING_EVIDENCE_STANDARD')
    try:
        for mapping in rows(db,m.obligation_clause_map,row['id']):
            clause,edition,instrument=source(db,actor,mapping['clause_id'])
            if clause['approval_status']!='APPROVED' or clause['interpretation_status']!='APPROVED' or edition['approval_status']!='APPROVED':result.append('UNAPPROVED_SOURCE')
            if edition['effective_from']>row['effective_from'] or edition['effective_to'] and edition['effective_to']<=row['effective_from']:result.append('SOURCE_PERIOD_MISMATCH')
            if edition['effective_to'] and edition['effective_to']<=date.today():result.append('SOURCE_REASSESSMENT_REQUIRED')
    except HTTPException:result.append('MISSING_OR_UNAVAILABLE_CLAUSE')
    if any(a['applicability_status']=='PARTIALLY_APPLICABLE' for a in apps):result.append('PARTIAL_APPLICABILITY')
    if any(a['applicability_status']=='NOT_APPLICABLE' and a['approval_status']!='APPROVED' for a in apps):result.append('UNAPPROVED_NON_APPLICABILITY')
    if any(a['next_review_date']<date.today() for a in apps) or row['next_review_date']<date.today():result.append('REVIEW_OVERDUE')
    if row['criticality'] in {'CRITICAL','HIGH'}:result.append('HIGH_CRITICAL')
    if stage is None:stage=db.execute(sa.select(m.workflow_instance.c.current_stage).where(m.workflow_instance.c.entity_type=='obligation',m.workflow_instance.c.entity_id==row['id'],m.workflow_instance.c.record_status=='OPEN')).scalar()
    if stage=='BUSINESS_VALIDATION':result.append('PENDING_BUSINESS_VALIDATION')
    anchor=row['approved_at'] or row['reviewed_at']
    if anchor:
        processes={p['process_id'] for p in rows(db,m.obligation_process_map,row['id'])}|{a['process_id'] for a in apps if a['process_id']}
        products={a['product_id'] for a in apps if a['product_id']}
        for kind,identifiers in [('process',processes),('product',products)]:
            if identifiers and db.execute(sa.select(m.audit_log.c.id).where(m.audit_log.c.entity_type==kind,m.audit_log.c.entity_id.in_(identifiers),m.audit_log.c.event_at>anchor)).first():
                result.append(kind.upper()+'_REASSESSMENT_REQUIRED')
    return list(dict.fromkeys(result))


def validation_owners(owners,maker):
    return {o['user_id'] for o in owners if o['owner_role']!='COMPLIANCE_REVIEWER' and not(o['owner_role']=='REGULATORY' and o['user_id']==maker)}


def require_citations(db,actor,identifier):
    try:
        for mapping in rows(db,m.obligation_clause_map,identifier):source(db,actor,mapping['clause_id'])
    except HTTPException as exc:
        raise HTTPException(403,'Every named participant must have authorised access to all cited sources, including confidentiality restrictions.') from exc


def submit(db,actor,identifier,payload):
    row=read(db,actor,identifier,True);actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
    if row['created_by']!=actor.id or row['approval_status']!='DRAFT':raise HTTPException(409,'Only the maker can submit an editable Draft.')
    if payload.expected_revision!=row['edit_revision']:raise HTTPException(409,'This Draft changed. Refresh before submitting.')
    blocking=set(issues(db,actor,row))-{'CONTENT_VALIDATION_PENDING','PARTIAL_APPLICABILITY','UNAPPROVED_NON_APPLICABILITY','HIGH_CRITICAL'}
    if blocking:raise HTTPException(422,'Resolve before submission: '+', '.join(sorted(blocking)).replace('_',' ').lower()+'.')
    validate(db,actor,ObligationInput(**input_for(db,row)))
    owners=rows(db,m.obligation_owner,identifier)
    operational=validation_owners(owners,row['created_by'])
    if row['created_by'] in operational or row['compliance_reviewer_user_id'] in operational:
        raise HTTPException(422,'Business/control/evidence validation must be independent of the maker and Compliance reviewer.')
    eligible(db,row['compliance_reviewer_user_id'],'REVIEWER',row['regulatory_owner_unit_id'],(row['created_by'],))
    eligible(db,payload.approver_id,'APPROVER',row['regulatory_owner_unit_id'],(row['created_by'],row['compliance_reviewer_user_id'],*operational))
    for participant in {row['compliance_reviewer_user_id'],payload.approver_id,*[o['user_id'] for o in owners]}:
        require_citations(db,actor_for(db,participant),identifier)
    workflow=new_id();at=now()
    db.execute(m.workflow_instance.insert().values(id=workflow,workflow_type='OBLIGATION',entity_type='obligation',entity_id=identifier,
        current_stage='COMPLIANCE_REVIEW',started_by=actor.id,started_at=at))
    for stage,recipient,days in [('COMPLIANCE_REVIEW',row['compliance_reviewer_user_id'],3),('FINAL_APPROVAL',payload.approver_id,9)]:
        db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow,stage=stage,assignee_user_id=recipient,due_at=at+timedelta(days=days)))
    db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(approval_status='IN_REVIEW'))
    for table in CHILDREN:db.execute(table.update().where(table.c.obligation_id==identifier,table.c.approval_status=='DRAFT').values(approval_status='IN_REVIEW'))
    notify(db,'obligation',identifier,row['compliance_reviewer_user_id'],'OBLIGATION_REVIEW_ASSIGNED',workflow+':REVIEW')
    history(db,actor,'obligation',identifier,'DRAFT','COMPLIANCE_REVIEW',payload.comments)
    audit(db,actor,'obligation',identifier,'SUBMITTED',new={'workflow_id':workflow,'revision':row['edit_revision']},reason=payload.comments)
    return {'id':workflow}


def make_owner_tasks(db,row,workflow):
    for owner in rows(db,m.obligation_owner,row['id']):
        if owner['owner_role']=='COMPLIANCE_REVIEWER' or owner['owner_role']=='REGULATORY' and owner['user_id']==row['created_by']:continue
        task=new_id()
        db.execute(m.workflow_action.insert().values(id=task,instance_id=workflow['id'],stage='BUSINESS_VALIDATION',assignee_user_id=owner['user_id'],due_at=now()+timedelta(days=3)))
        db.execute(m.obligation_validation_task.insert().values(id=new_id(),owner_id=owner['id'],task_id=task))
        notify(db,'obligation',row['id'],owner['user_id'],'OBLIGATION_OWNER_VALIDATION',workflow['id']+':OWNER:'+owner['id'])


def owner_for_task(db,task):
    owner_id=db.execute(sa.select(m.obligation_validation_task.c.owner_id).where(m.obligation_validation_task.c.task_id==task['id'])).scalar_one()
    return repo.one(db,m.obligation_owner,owner_id)


def check_task(db,actor,row,task,stage):
    if task['assignee_user_id']!=actor.id:raise HTTPException(403,'Only the named task recipient may decide.')
    require_citations(db,actor,row['id'])
    if stage=='BUSINESS_VALIDATION':
        owner=owner_for_task(db,task)
        eligible(db,actor.id,ROLE[owner['owner_role']],owner['org_unit_id'])
    else:
        owners=rows(db,m.obligation_owner,row['id'])
        operational=validation_owners(owners,row['created_by'])
        excluded=(row['created_by'],*operational,*([row['reviewed_by']] if stage=='FINAL_APPROVAL' else []))
        eligible(db,actor.id,'REVIEWER' if stage=='COMPLIANCE_REVIEW' else 'APPROVER',row['regulatory_owner_unit_id'],excluded)


def decide(db,actor,identifier,payload):
    row=read(db,actor,identifier,True)
    workflow=db.execute(sa.select(m.workflow_instance).where(m.workflow_instance.c.entity_type=='obligation',
        m.workflow_instance.c.entity_id==identifier,m.workflow_instance.c.record_status=='OPEN').with_for_update()).mappings().first()
    if not workflow:raise HTTPException(409,'No open obligation workflow remains.')
    stage=workflow['current_stage'];decision=payload.decision;at=now()
    tasks=[dict(t) for t in db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.instance_id==workflow['id'],
        m.workflow_action.c.stage==stage,m.workflow_action.c.decision.is_(None)).with_for_update()).mappings()]
    task=next((t for t in tasks if t['assignee_user_id']==actor.id and (not payload.task_id or payload.task_id==t['id'])),None)
    if decision=='WITHDRAW':
        actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
        if actor.id!=row['created_by']:raise HTTPException(403,'Only the maker can withdraw this proposal.')
    else:
        if not task:raise HTTPException(403,'No current decision task is assigned to you. Refresh the record.')
        check_task(db,actor,row,task,stage)
    if decision=='DELEGATE':
        if stage=='BUSINESS_VALIDATION':raise HTTPException(422,'Accountable ownership changes require a returned Draft or a governed revision, not task delegation.')
        role='REVIEWER' if stage=='COMPLIANCE_REVIEW' else 'APPROVER'
        if not payload.delegate_user_id:raise HTTPException(422,'Choose a delegate.')
        participants=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==workflow['id'])).scalars().all()
        operational=validation_owners(rows(db,m.obligation_owner,identifier),row['created_by'])
        candidate=eligible(db,payload.delegate_user_id,role,row['regulatory_owner_unit_id'],(row['created_by'],*participants,*operational))
        require_citations(db,candidate,identifier)
        db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision='DELEGATED',comments=payload.comments,acted_by=actor.id,acted_at=at))
        db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow['id'],stage=stage,assignee_user_id=payload.delegate_user_id,due_at=task['due_at']))
        if stage=='COMPLIANCE_REVIEW':
            old=[o for o in rows(db,m.obligation_owner,identifier) if o['owner_role']=='COMPLIANCE_REVIEWER']
            for owner in old:db.execute(m.obligation_owner.update().where(m.obligation_owner.c.id==owner['id']).values(approval_status='WITHDRAWN'))
            db.execute(m.obligation_owner.insert().values(id=new_id(),obligation_id=identifier,org_unit_id=row['regulatory_owner_unit_id'],
                user_id=payload.delegate_user_id,owner_role='COMPLIANCE_REVIEWER',primary_owner_flag=0,effective_from=row['effective_from'],
                effective_to=row['effective_to'],created_by=row['created_by'],approval_status='IN_REVIEW'))
            db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(compliance_reviewer_user_id=payload.delegate_user_id))
        notify(db,'obligation',identifier,payload.delegate_user_id,'TASK_DELEGATED',workflow['id']+':DELEGATE:'+new_id())
        audit(db,actor,'obligation',identifier,'TASK_DELEGATED',old={'recipient':actor.id},new={'recipient':payload.delegate_user_id},reason=payload.comments)
        return {'status':stage}
    allowed={'COMPLIANCE_REVIEW':{'REVIEW','RETURN','REJECT'},'BUSINESS_VALIDATION':{'ACCEPT','OBJECT'},'FINAL_APPROVAL':{'APPROVE','RETURN','REJECT'}}
    if decision!='WITHDRAW' and decision not in allowed.get(stage,set()):raise HTTPException(409,'This decision does not match the current stage.')
    if task and decision!='WITHDRAW':db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision=decision,comments=payload.comments,acted_by=actor.id,acted_at=at))
    values={};next_stage=None;closed=None
    if decision in {'RETURN','OBJECT','WITHDRAW','REJECT'}:
        target='REJECTED' if decision=='REJECT' else 'DRAFT'
        values.update(approval_status=target,reviewed_by=None,reviewed_at=None,approved_by=None,approved_at=None,content_validation_status='PENDING')
        for table in CHILDREN:db.execute(table.update().where(table.c.obligation_id==identifier,table.c.approval_status.in_(PENDING)).values(
            approval_status=target,reviewed_by=None,reviewed_at=None,approved_by=None,approved_at=None))
        closed='REJECTED' if decision=='REJECT' else 'WITHDRAWN' if decision=='WITHDRAW' else 'RETURNED'
    elif decision=='REVIEW':
        # Explicit compliance review validates wording, interpretations, citations and assessments.
        validate(db,actor_for(db,row['created_by']),ObligationInput(**input_for(db,row)))
        values.update(approval_status='REVIEWED',reviewed_by=actor.id,reviewed_at=at,content_validation_status='VALIDATED')
        for table in CHILDREN:db.execute(table.update().where(table.c.obligation_id==identifier,table.c.approval_status=='IN_REVIEW').values(
            approval_status='REVIEWED',reviewed_by=actor.id,reviewed_at=at))
        make_owner_tasks(db,row,workflow);next_stage='BUSINESS_VALIDATION'
    elif decision=='ACCEPT':
        if len(tasks)==1:next_stage='FINAL_APPROVAL'
    elif decision=='APPROVE':
        # Recheck current identities/source validity, not just submission-time eligibility.
        validate(db,actor_for(db,row['created_by']),ObligationInput(**input_for(db,row)))
        blocking=set(issues(db,actor,row))-{'PARTIAL_APPLICABILITY','HIGH_CRITICAL','UNAPPROVED_NON_APPLICABILITY'}
        if blocking:raise HTTPException(422,'Activation prerequisites changed: '+', '.join(sorted(blocking)))
        owner_tasks=db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage=='BUSINESS_VALIDATION')).mappings().all()
        if not owner_tasks or any(t['decision']!='ACCEPT' for t in owner_tasks):raise HTTPException(409,'Every named owner must accept the proposed ownership and applicability.')
        values.update(approval_status='APPROVED',approved_by=actor.id,approved_at=at)
        for table in CHILDREN:db.execute(table.update().where(table.c.obligation_id==identifier,table.c.approval_status=='REVIEWED').values(
            approval_status='APPROVED',approved_by=actor.id,approved_at=at))
        closed='APPROVED'
    if values:db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(**values))
    if next_stage:
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(current_stage=next_stage))
        recipients=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage==next_stage,m.workflow_action.c.decision.is_(None))).scalars().all()
        for recipient in set(recipients):notify(db,'obligation',identifier,recipient,'OBLIGATION_DECISION_ASSIGNED',workflow['id']+':'+next_stage+':'+recipient)
    if closed:
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(current_stage='CLOSED',record_status=closed,completed_at=at))
        notify(db,'obligation',identifier,row['created_by'],'OBLIGATION_'+decision,workflow['id']+':'+decision)
    history(db,actor,'obligation',identifier,stage,next_stage or closed or stage,payload.comments)
    audit(db,actor,'obligation',identifier,decision,new={'task_id':task['id'] if task else None,'workflow_id':workflow['id']},reason=payload.comments)
    if decision=='APPROVE' and row['effective_from']<=date.today():activate(db,actor,identifier)
    return {'status':next_stage or closed or stage}


def activate(db,actor,identifier):
    row=read(db,actor,identifier,True);actor.require({'APPROVER'},row['regulatory_owner_unit_id'])
    if row['approval_status']!='APPROVED' or row['effective_from']>date.today() or row['effective_to'] and row['effective_to']<=date.today():
        raise HTTPException(409,'Only a currently effective approved obligation can be activated.')
    if row['record_status']=='ACTIVE':return {'status':'ACTIVE'}
    if row['record_status']!='DRAFT':raise HTTPException(409,'A superseded or retired version cannot be activated again.')
    blocking=set(issues(db,actor,row))-{'PARTIAL_APPLICABILITY','HIGH_CRITICAL'}
    if blocking:raise HTTPException(422,'Activation blocked: '+', '.join(sorted(blocking)))
    for table in CHILDREN:
        if any(r['approval_status']!='APPROVED' for r in rows(db,table,identifier)):raise HTTPException(409,'All ownership and applicability decisions require independent approval.')
    predecessors=[];previous=row['supersedes_obligation_id'];seen={identifier}
    while previous:
        if previous in seen:raise HTTPException(409,'The obligation predecessor chain is inconsistent.')
        seen.add(previous);old=repo.one(db,m.compliance_obligation,previous,True)
        if old['code']!=row['code'] or old['record_status']!='ACTIVE' and not(old['record_status']=='DRAFT' and old['approval_status']=='APPROVED'):
            raise HTTPException(409,'The predecessor changed. Resolve the competing revision before activation.')
        predecessors.append(old)
        if old['record_status']=='ACTIVE':break
        previous=old['supersedes_obligation_id']
    active_ids=set(db.execute(sa.select(m.compliance_obligation.c.id).where(m.compliance_obligation.c.code==row['code'],m.compliance_obligation.c.record_status=='ACTIVE')).scalars())
    if not active_ids.issubset({old['id'] for old in predecessors}):raise HTTPException(409,'Activate a revision of the currently operative obligation.')
    for old in predecessors:
        db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==old['id']).values(record_status='SUPERSEDED',effective_to=row['effective_from']))
        history(db,actor,'obligation',old['id'],old['record_status'],'SUPERSEDED','Replaced by approved revision '+identifier)
    db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(record_status='ACTIVE'))
    history(db,actor,'obligation',identifier,'APPROVED','ACTIVE','Approved effective obligation activated')
    audit(db,actor,'obligation',identifier,'ACTIVATED')
    return {'status':'ACTIVE'}


def revision_input(db,row,reason):
    siblings=[dict(r) for r in db.execute(sa.select(m.compliance_obligation).where(m.compliance_obligation.c.code==row['code']).with_for_update()).mappings()]
    if db.execute(sa.select(m.obligation_owner_change.c.id).where(m.obligation_owner_change.c.obligation_id.in_([r['id'] for r in siblings]),m.obligation_owner_change.c.approval_status.in_(['IN_REVIEW','REVIEWED']))).first():
        raise HTTPException(409,'An ownership change is pending. Complete or withdraw it before creating an obligation revision.')
    if any(r['record_status']=='DRAFT' and r['approval_status'] in {'DRAFT','IN_REVIEW','REVIEWED'} for r in siblings):
        raise HTTPException(409,'An obligation revision is already pending. Open it before starting another.')
    if row['approval_status'] not in {'APPROVED','REJECTED'}:raise HTTPException(409,'Revise an approved obligation or a rejected proposal.')
    approved=[r for r in siblings if r['approval_status']=='APPROVED' and r['record_status'] in {'ACTIVE','DRAFT'}]
    latest=max(approved,key=lambda r:r['version_number'])['id'] if approved else None
    if row['approval_status']=='APPROVED' and row['id']!=latest or row['approval_status']=='REJECTED' and row['supersedes_obligation_id']!=latest:
        raise HTTPException(409,'Start the revision from the latest operative or future-approved version, or its rejected replacement.')
    data=input_for(db,row);data.update(effective_from=max(date.today(),row['effective_from']),effective_to=None,change_reason=reason,expected_revision=None)
    data['next_review_date']=max(data['next_review_date'],data['effective_from'])
    for assessment in data['applicability']:assessment['next_review_date']=max(assessment['next_review_date'],data['effective_from'])
    predecessor=row['id'] if row['approval_status']=='APPROVED' else row['supersedes_obligation_id']
    return data,max(r['version_number'] for r in siblings)+1,predecessor


def revise(db,actor,identifier,payload):
    row=read(db,actor,identifier,True);actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
    data,version,predecessor=revision_input(db,row,payload.reason)
    return create(db,actor,ObligationInput(**data),code=row['code'],version=version,supersedes=predecessor)


def assign_owners(db,actor,identifier,payload):
    """Edit a Draft or request an independently governed change on the same approved revision."""
    row=read(db,actor,identifier,True);actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
    if payload.expected_revision!=row['edit_revision']:
        raise HTTPException(409,'This obligation changed. Close the popup and reopen it before saving.')
    draft=row['approval_status']=='DRAFT' and row['record_status']=='DRAFT'
    if draft:
        if row['created_by']!=actor.id:raise HTTPException(409,'Only the Draft maker can change owner assignments.')
        data=input_for(db,row)
    else:
        from . import ownership_changes
        ownership_changes.guard_parent(db,row)
        if ownership_changes.pending(db,identifier):raise HTTPException(409,'An ownership change is already pending for this obligation.')
    old=input_for(db,row)
    change={key:getattr(payload,key) for key in ['business_owner_unit_id','compliance_reviewer_user_id']}
    change['owners']=[o.model_dump() for o in payload.owners]
    def signature(value):
        return (value['business_owner_unit_id'],value['compliance_reviewer_user_id'],sorted(
            (o['owner_role'],o['org_unit_id'],o['user_id'],bool(o['primary_owner_flag']))
            for o in value['owners'] if o['owner_role']!='COMPLIANCE_REVIEWER'))
    if signature(old)==signature(change):return {'id':identifier,'edit_revision':row['edit_revision'],'created_revision':False,'changed':False}
    if not draft:return ownership_changes.submit(db,actor,row,payload)
    data.update(change,change_reason=payload.reason)
    value=ObligationInput(**data)
    validate(db,actor,value)
    if draft:
        save_owners(db,actor,row,value)
        db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(
            **{key:change[key] for key in ['business_owner_unit_id','compliance_reviewer_user_id']},
            edit_revision=row['edit_revision']+1,content_validation_status='PENDING'))
        result={'id':identifier,'edit_revision':row['edit_revision']+1}
    audit(db,actor,'obligation',result['id'],'OWNERS_UPDATED',old={key:old[key] for key in change},new=change,reason=payload.reason)
    return {**result,'created_revision':False,'changed':True}


def cancel(db,actor,identifier,payload):
    row=read(db,actor,identifier,True);actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
    if row['created_by']!=actor.id or row['approval_status']!='DRAFT':raise HTTPException(409,'Only the maker may cancel an editable, unapproved Draft.')
    db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==identifier).values(approval_status='WITHDRAWN'))
    for table in CHILDREN:db.execute(table.update().where(table.c.obligation_id==identifier,table.c.approval_status=='DRAFT').values(approval_status='WITHDRAWN'))
    history(db,actor,'obligation',identifier,'DRAFT','WITHDRAWN',payload.reason)
    audit(db,actor,'obligation',identifier,'DRAFT_CANCELLED',reason=payload.reason)
    return {'id':identifier,'status':'WITHDRAWN'}


def ownership_period(owner,parent_end):
    # Display the retained parent interval without rewriting the recorded owner dates.
    owner['recorded_effective_to']=owner['effective_to']
    ends=[end for end in [parent_end,owner.get('replacement_effective_from'),owner['effective_to']] if end]
    if ends:owner['effective_to']=min(ends)


def owner_validation(owner,tasks,maker):
    decisions=[task for task in tasks if task.get('owner_id')==owner['id']]
    return (decisions[-1]['decision'] or 'PENDING') if decisions else (
        'PROPOSED_BY_MAKER' if owner['owner_role']=='REGULATORY' and owner['user_id']==(owner.get('created_by') or maker) else
        'REVIEW_ACCEPTED' if owner['owner_role']=='COMPLIANCE_REVIEWER' and owner['approval_status'] in {'REVIEWED','APPROVED'} else 'NOT_STARTED')


def detail(db,actor,identifier):
    row=read(db,actor,identifier)
    clause,edition,instrument=source(db,actor,row['primary_clause_id'])
    versions=[dict(r) for r in db.execute(sa.select(m.compliance_obligation).where(m.compliance_obligation.c.code==row['code']).order_by(m.compliance_obligation.c.version_number.desc())).mappings()]
    versions=[v for v in versions if visible(db,actor,v)]
    version_ids=[v['id'] for v in versions]
    from . import ownership_changes
    changes=ownership_changes.details(db,actor,version_ids)
    tasks=[dict(r) for r in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.current_stage,m.workflow_instance.c.record_status.label('workflow_status'),
        m.workflow_instance.c.entity_id).join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id).where(
            m.workflow_instance.c.entity_type=='obligation',m.workflow_instance.c.entity_id.in_(version_ids)).order_by(m.workflow_action.c.created_at,m.workflow_action.c.id)).mappings()]
    for task in tasks:
        if task['stage']=='BUSINESS_VALIDATION':
            owner=owner_for_task(db,task);task.update(owner_id=owner['id'],owner_role=owner['owner_role'])
    applied_ids={i['task_id']:i['applied_owner_id'] for change in changes for i in change['assignments'] if i['task_id'] and i['applied_owner_id'] and not i['previous_owner_id']}
    for change in changes:
        for task in change['tasks']:
            if task['id'] in applied_ids:
                owner=repo.one(db,m.obligation_owner,applied_ids[task['id']]);tasks.append({**task,'owner_id':owner['id'],'owner_role':owner['owner_role'],'entity_id':change['obligation_id'],'ownership_change_id':change['id']})
    current_owners=rows(db,m.obligation_owner,identifier)
    for owner in current_owners:owner['validation_decision']=owner_validation(owner,tasks,row['created_by'])
    own=[dict(r) for r in db.execute(sa.select(m.obligation_owner).where(m.obligation_owner.c.obligation_id.in_(version_ids))).mappings()]
    periods={v['id']:v['effective_to'] for v in versions}
    # The operative ownership interval is bounded by its retained obligation
    # version. Keep the originally recorded end separately; do not rewrite it.
    for owner in [*own,*current_owners]:
        owner['validation_decision']=owner_validation(owner,tasks,row['created_by'])
        if owner.get('ended_by_change_id'):
            owner['replacement_effective_from']=next(c['effective_from'] for c in changes if c['id']==owner['ended_by_change_id'])
        ownership_period(owner,periods.get(owner['obligation_id']))
    citations=[]
    for mapping in rows(db,m.obligation_clause_map,identifier):
        try:
            c,v,i=source(db,actor,mapping['clause_id'])
            citations.append({**mapping,'clause':c,'edition':v,'instrument':i})
        except HTTPException:citations.append({'id':mapping['id'],'link_type':mapping['link_type'],'restricted':True})
    return {'obligation':row,'instrument':instrument,'clause':clause,'edition':edition,'citations':citations,
        'owners':current_owners,'ownership_history':own,'applicability':rows(db,m.obligation_applicability,identifier),
        'applicability_history':rows(db,m.obligation_applicability,identifier,False),'processes':rows(db,m.obligation_process_map,identifier),
        'versions':versions,'tasks':tasks,'owner_changes':changes,'input':input_for(db,row),'issues':issues(db,actor,row),
        'history':[dict(r) for r in db.execute(sa.select(m.status_history).where(m.status_history.c.entity_type=='obligation',m.status_history.c.entity_id.in_(version_ids)).order_by(m.status_history.c.changed_at.desc())).mappings()],
        'audit':[dict(r) for r in db.execute(sa.select(m.audit_log).where(m.audit_log.c.entity_type=='obligation',m.audit_log.c.entity_id.in_(version_ids)).order_by(m.audit_log.c.event_at.desc())).mappings()]}


def listing(db,actor,filters=None):
    filters=filters or {};result=[];eligibility={};legacy=business_ids.aliases(db,'obligation')
    all_rows=db.execute(sa.select(m.compliance_obligation).order_by(m.compliance_obligation.c.created_at.desc(),m.compliance_obligation.c.id)).mappings()
    for value in all_rows:
        row=dict(value)
        row['legacy_codes']=legacy.get(row['id'],[])
        if filters.get('tab')=='reports' and not filters.get('status') and (row['record_status'] in {'SUPERSEDED','RETIRED'} or row['approval_status'] in {'REJECTED','WITHDRAWN'}):continue
        if not visible(db,actor,row):continue
        try:clause,edition,instrument=source(db,actor,row['primary_clause_id'])
        except HTTPException:continue
        workflow=db.execute(sa.select(m.workflow_instance.c.current_stage).where(m.workflow_instance.c.entity_type=='obligation',m.workflow_instance.c.entity_id==row['id'],m.workflow_instance.c.record_status=='OPEN')).scalar()
        row.update(instrument_id=instrument['id'],instrument_code=instrument['code'],instrument_title=instrument['title'],clause_code=clause['code'],
            source_clause_reference=clause.get('source_clause_reference'),source_version=edition['version_number'],stage=workflow or row['approval_status'],issues=issues(db,actor,row,eligibility,workflow or 'CLOSED'))
        if filters.get('domain') and row['primary_domain_id']!=filters['domain']:continue
        if filters.get('department') and filters['department'] not in {row['regulatory_owner_unit_id'],row['business_owner_unit_id'],
                *[r['org_unit_id'] for table in CHILDREN for r in rows(db,table,row['id'])]}:continue
        if filters.get('status') and filters['status'] not in {row['stage'],row['record_status']}:continue
        if filters.get('criticality') and row['criticality']!=filters['criticality']:continue
        if filters.get('instrument') and row['instrument_id']!=filters['instrument']:continue
        if filters.get('clause') and not any(r['clause_id']==filters['clause'] for r in rows(db,m.obligation_clause_map,row['id'])):continue
        if filters.get('owner') and not any(r['user_id']==filters['owner'] for r in rows(db,m.obligation_owner,row['id'])):continue
        if filters.get('exception') and filters['exception'] not in row['issues']:continue
        if filters.get('q') and filters['q'].casefold() not in json.dumps(row,default=str).casefold():continue
        result.append(row)
    return result


def notify_reassessment(db,actor,kind,identifier):
    """Signal a retained assessment for reassessment; never overwrite its decision."""
    if kind=='source':
        affected=sa.select(m.compliance_obligation).join(m.obligation_clause_map,m.obligation_clause_map.c.obligation_id==m.compliance_obligation.c.id).join(
            m.regulatory_clause,m.regulatory_clause.c.id==m.obligation_clause_map.c.clause_id).join(
            m.instrument_version,m.instrument_version.c.id==m.regulatory_clause.c.instrument_version_id).where(m.instrument_version.c.instrument_id==identifier)
    elif kind=='process':
        affected=sa.select(m.compliance_obligation).where(m.compliance_obligation.c.id.in_(sa.select(m.obligation_process_map.c.obligation_id).where(m.obligation_process_map.c.process_id==identifier)))
    else:
        affected=sa.select(m.compliance_obligation).where(m.compliance_obligation.c.id.in_(sa.select(m.obligation_applicability.c.obligation_id).where(m.obligation_applicability.c.product_id==identifier)))
    for row in {r['id']:dict(r) for r in db.execute(affected.where(m.compliance_obligation.c.record_status=='ACTIVE')).mappings()}.values():
        recipients={row['created_by'],row['compliance_reviewer_user_id'],*[o['user_id'] for o in rows(db,m.obligation_owner,row['id']) if o['user_id']]}
        for recipient in recipients:notify(db,'obligation',row['id'],recipient,'OBLIGATION_REASSESSMENT_REQUIRED',kind+':'+identifier+':'+new_id())
        audit(db,actor,'obligation',row['id'],'REASSESSMENT_TRIGGERED',new={'trigger':kind,'source_id':identifier})


def tasks(db,actor):
    result=[]
    for raw in db.execute(sa.select(m.compliance_obligation).where(m.compliance_obligation.c.created_by==actor.id,m.compliance_obligation.c.approval_status=='DRAFT')).mappings():
        row=dict(raw)
        if actor.covers(row['regulatory_owner_unit_id'],{'AUTHOR'}):
            try:clause,edition,instrument=source(db,actor,row['primary_clause_id'])
            except HTTPException:continue
            result.append({'kind':'DRAFT','workflow_kind':'OBLIGATION','obligation_id':row['id'],'instrument_id':instrument['id'],
                'title':row['title'],'code':row['code'],'department_id':row['business_owner_unit_id'],'due_at':None})
    query=sa.select(m.workflow_action,m.workflow_instance.c.entity_id,m.workflow_instance.c.current_stage).join(m.workflow_instance,
        m.workflow_instance.c.id==m.workflow_action.c.instance_id).where(m.workflow_instance.c.entity_type=='obligation',m.workflow_instance.c.record_status=='OPEN',
        m.workflow_action.c.assignee_user_id==actor.id,m.workflow_action.c.decision.is_(None),m.workflow_action.c.stage==m.workflow_instance.c.current_stage)
    for item in db.execute(query).mappings():
        task=dict(item)
        try:row=read(db,actor,task['entity_id']);check_task(db,actor,row,task,task['current_stage'])
        except HTTPException:continue
        clause,version,instrument=source(db,actor,row['primary_clause_id'])
        result.append({**task,'kind':'DECISION','workflow_kind':'OBLIGATION','obligation_id':row['id'],'instrument_id':instrument['id'],
            'title':row['title'],'code':row['code'],'department_id':row['business_owner_unit_id']})
    from . import ownership_changes
    return result+ownership_changes.tasks(db,actor)
