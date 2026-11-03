"""Independent ownership requests. The obligation and its current owners remain operative until approval."""
from datetime import date,timedelta
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m,repository as repo,obligations as obl
from .access import actor_for
from .events import audit,history,notify,new_id,now
from .obligation_schemas import ObligationInput

ENTITY='obligation_ownership'
PENDING=('IN_REVIEW','REVIEWED')


def pending(db,identifier):
    return db.execute(sa.select(m.obligation_owner_change.c.id).where(
        m.obligation_owner_change.c.obligation_id==identifier,m.obligation_owner_change.c.approval_status.in_(PENDING))).scalar()


def guard_parent(db,row):
    if row['approval_status']!='APPROVED' or row['record_status'] not in {'ACTIVE','DRAFT'}:
        raise HTTPException(409,'Owner change requests require the current Approved or Active obligation.')
    if row['effective_to'] and row['effective_to']<=date.today():raise HTTPException(409,'The obligation period has ended. Create a governed revision before assigning new owners.')
    siblings=[dict(r) for r in db.execute(sa.select(m.compliance_obligation).where(m.compliance_obligation.c.code==row['code']).with_for_update()).mappings()]
    if any(r['approval_status'] in {'DRAFT','IN_REVIEW','REVIEWED'} for r in siblings):
        raise HTTPException(409,'An obligation revision is pending. Complete or cancel it before requesting an ownership change.')
    approved=[r for r in siblings if r['approval_status']=='APPROVED' and r['record_status'] in {'DRAFT','ACTIVE'}]
    if not approved or max(approved,key=lambda r:r['version_number'])['id']!=row['id']:
        raise HTTPException(409,'Open the latest operative or future-approved obligation to change its owners.')


def items(db,identifier):
    return [dict(r) for r in db.execute(sa.select(m.owner_change_assignment).where(m.owner_change_assignment.c.change_id==identifier)
        .order_by(m.owner_change_assignment.c.created_at,m.owner_change_assignment.c.id)).mappings()]


def signature(owner):return (owner['owner_role'],owner['org_unit_id'],owner['user_id'],bool(owner['primary_owner_flag']))


def proposal_input(db,row,proposal,assignments):
    value=obl.input_for(db,row)
    value.update(business_owner_unit_id=proposal['business_owner_unit_id'],compliance_reviewer_user_id=proposal['compliance_reviewer_user_id'],
        owners=[{key:item[key] for key in ['owner_role','org_unit_id','user_id','primary_owner_flag']} for item in assignments])
    return ObligationInput(**value)


def validators(assignments,maker):
    selected=[item for item in assignments if not item.get('previous_owner_id') and not(item['owner_role']=='REGULATORY' and item['user_id']==maker)]
    # A removal/reviewer-only change still has an independent Business-owner acknowledgement.
    return selected or [next(item for item in assignments if item['owner_role']=='BUSINESS' and item['primary_owner_flag'])]


def validate(db,row,proposal,assignments):
    maker=actor_for(db,proposal['created_by'])
    obl.validate(db,maker,proposal_input(db,row,proposal,assignments))
    for role in ['REGULATORY','BUSINESS','CONTROL']:
        if not any(item['owner_role']==role and (role=='CONTROL' or item['primary_owner_flag']) for item in assignments):
            raise HTTPException(422,'The proposed assignments require primary Regulatory and Business owners and at least one Control owner.')
    responders={item['user_id'] for item in validators(assignments,proposal['created_by'])}
    operational={item['user_id'] for item in assignments if item['owner_role']!='REGULATORY' or item['user_id']!=proposal['created_by']}
    if proposal['created_by'] in responders or proposal['compliance_reviewer_user_id'] in operational:
        raise HTTPException(422,'Owner acceptance must be independent of the request author and Compliance reviewer.')
    obl.eligible(db,proposal['compliance_reviewer_user_id'],'REVIEWER',row['regulatory_owner_unit_id'],(proposal['created_by'],))
    excluded={row['created_by'],proposal['created_by'],proposal['compliance_reviewer_user_id'],*[i['user_id'] for i in assignments],
        *[o['user_id'] for o in obl.rows(db,m.obligation_owner,row['id']) if o['user_id']]}
    obl.eligible(db,proposal['approver_user_id'],'APPROVER',row['regulatory_owner_unit_id'],excluded)


def submit(db,actor,row,payload):
    guard_parent(db,row)
    if pending(db,row['id']):raise HTTPException(409,'An ownership change is already pending for this obligation.')
    if not payload.approver_id:raise HTTPException(422,'Choose an independent final Approver for the ownership change.')
    current={signature(owner):owner for owner in obl.rows(db,m.obligation_owner,row['id'])}
    assignments=[]
    for owner in payload.owners:
        value=owner.model_dump();previous=current.get(signature(value))
        assignments.append({**value,'id':new_id(),'previous_owner_id':previous['id'] if previous else None})
    proposal={'id':new_id(),'obligation_id':row['id'],'created_by':actor.id,'baseline_revision':row['edit_revision'],
        'business_owner_unit_id':payload.business_owner_unit_id,'compliance_reviewer_user_id':payload.compliance_reviewer_user_id,
        'approver_user_id':payload.approver_id,'reason':payload.reason,'approval_status':'IN_REVIEW'}
    validate(db,row,proposal,assignments)
    db.execute(m.obligation_owner_change.insert().values(**proposal))
    for item in assignments:db.execute(m.owner_change_assignment.insert().values(**item,change_id=proposal['id']))
    workflow=new_id();at=now()
    db.execute(m.workflow_instance.insert().values(id=workflow,workflow_type='OBLIGATION_OWNERSHIP',entity_type=ENTITY,entity_id=proposal['id'],
        current_stage='COMPLIANCE_REVIEW',started_by=actor.id,started_at=at))
    for stage,recipient,days in [('COMPLIANCE_REVIEW',proposal['compliance_reviewer_user_id'],3),('FINAL_APPROVAL',proposal['approver_user_id'],9)]:
        db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow,stage=stage,assignee_user_id=recipient,due_at=at+timedelta(days=days)))
    notify(db,'obligation',row['id'],proposal['compliance_reviewer_user_id'],'OWNERSHIP_REVIEW_ASSIGNED',workflow+':REVIEW')
    history(db,actor,ENTITY,proposal['id'],None,'COMPLIANCE_REVIEW',payload.reason)
    audit(db,actor,'obligation',row['id'],'OWNERSHIP_CHANGE_REQUESTED',new={'change_id':proposal['id'],'owners':assignments,
        'business_owner_unit_id':payload.business_owner_unit_id,'compliance_reviewer_user_id':payload.compliance_reviewer_user_id},reason=payload.reason)
    return {'id':row['id'],'change_id':proposal['id'],'edit_revision':row['edit_revision'],'created_revision':False,'changed':True,'submitted_for_review':True}


def check_task(db,actor,row,proposal,task,assignments):
    if task['assignee_user_id']!=actor.id:raise HTTPException(403,'Only the named task recipient may decide this ownership request.')
    obl.require_citations(db,actor,row['id'])
    stage=task['stage']
    if stage=='BUSINESS_VALIDATION':
        item=next((i for i in assignments if i.get('task_id')==task['id']),None)
        if not item:raise HTTPException(409,'The ownership acceptance task is unavailable.')
        obl.eligible(db,actor.id,obl.ROLE[item['owner_role']],item['org_unit_id'],(proposal['created_by'],proposal['compliance_reviewer_user_id']))
    else:
        role='REVIEWER' if stage=='COMPLIANCE_REVIEW' else 'APPROVER'
        excluded={proposal['created_by'],*[i['user_id'] for i in assignments if i['owner_role']!='REGULATORY' or i['user_id']!=proposal['created_by']]}
        if role=='APPROVER':excluded.update([row['created_by'],proposal['compliance_reviewer_user_id'],*[i['user_id'] for i in assignments],
            *[o['user_id'] for o in obl.rows(db,m.obligation_owner,row['id']) if o['user_id']]])
        obl.eligible(db,actor.id,role,row['regulatory_owner_unit_id'],excluded)


def apply(db,actor,row,proposal,assignments):
    at=now();effective=max(date.today(),row['effective_from']);current=obl.rows(db,m.obligation_owner,row['id'])
    retained={i['previous_owner_id'] for i in assignments if i['previous_owner_id']}
    reviewer=next((o for o in current if o['owner_role']=='COMPLIANCE_REVIEWER' and o['user_id']==proposal['compliance_reviewer_user_id'] and o['org_unit_id']==row['regulatory_owner_unit_id']),None)
    if reviewer:retained.add(reviewer['id'])
    db.execute(m.obligation_owner_change.update().where(m.obligation_owner_change.c.id==proposal['id']).values(
        approval_status='APPROVED',approved_by=actor.id,approved_at=at,effective_from=effective))
    ending=[o['id'] for o in current if o['id'] not in retained]
    for owner_id in ending:db.execute(m.obligation_owner.update().where(m.obligation_owner.c.id==owner_id).values(ended_by_change_id=proposal['id']))
    approval={'created_by':proposal['created_by'],'reviewed_by':proposal['reviewed_by'],'reviewed_at':proposal['reviewed_at'],
        'approved_by':actor.id,'approved_at':at,'approval_status':'APPROVED'}
    for item in assignments:
        owner_id=item['previous_owner_id']
        if not owner_id:
            owner_id=new_id();db.execute(m.obligation_owner.insert().values(id=owner_id,obligation_id=row['id'],
                **{key:item[key] for key in ['org_unit_id','user_id','owner_role','primary_owner_flag']},
                effective_from=effective,effective_to=row['effective_to'],**approval))
            if item['task_id']:db.execute(m.obligation_validation_task.insert().values(id=new_id(),owner_id=owner_id,task_id=item['task_id']))
        db.execute(m.owner_change_assignment.update().where(m.owner_change_assignment.c.id==item['id']).values(applied_owner_id=owner_id))
    if not reviewer:
        db.execute(m.obligation_owner.insert().values(id=new_id(),obligation_id=row['id'],org_unit_id=row['regulatory_owner_unit_id'],
            user_id=proposal['compliance_reviewer_user_id'],owner_role='COMPLIANCE_REVIEWER',primary_owner_flag=0,
            effective_from=effective,effective_to=row['effective_to'],**approval))
    db.execute(m.compliance_obligation.update().where(m.compliance_obligation.c.id==row['id']).values(
        business_owner_unit_id=proposal['business_owner_unit_id'],compliance_reviewer_user_id=proposal['compliance_reviewer_user_id'],edit_revision=row['edit_revision']+1))
    db.execute(m.obligation_owner_change.update().where(m.obligation_owner_change.c.id==proposal['id']).values(applied_at=at))
    audit(db,actor,'obligation',row['id'],'OWNERSHIP_CHANGE_APPLIED',old={'owners':current},new={'change_id':proposal['id'],'ended_owner_ids':ending,'effective_from':effective},reason=proposal['reason'])
    for recipient in {proposal['created_by'],*[o['user_id'] for o in current if o['user_id']],*[i['user_id'] for i in assignments]}:
        notify(db,'obligation',row['id'],recipient,'OWNERSHIP_CHANGE_APPROVED',proposal['id']+':APPLIED')


def decide(db,actor,identifier,change_id,payload):
    row=obl.read(db,actor,identifier,True)
    proposal=repo.one(db,m.obligation_owner_change,change_id,True)
    if proposal['obligation_id']!=identifier:raise HTTPException(404,'Ownership change not found on this obligation.')
    workflow=db.execute(sa.select(m.workflow_instance).where(m.workflow_instance.c.entity_type==ENTITY,m.workflow_instance.c.entity_id==change_id,
        m.workflow_instance.c.record_status=='OPEN').with_for_update()).mappings().first()
    if not workflow:raise HTTPException(409,'This ownership request has already been closed.')
    stage=workflow['current_stage'];decision=payload.decision;assignments=items(db,change_id)
    task=None
    if decision=='WITHDRAW':
        actor.require({'AUTHOR'},row['regulatory_owner_unit_id'])
        if actor.id!=proposal['created_by']:raise HTTPException(403,'Only the request author may withdraw this ownership change.')
    else:
        task=db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.id==payload.task_id,m.workflow_action.c.instance_id==workflow['id'],
            m.workflow_action.c.stage==stage,m.workflow_action.c.decision.is_(None)).with_for_update()).mappings().first()
        if not task:raise HTTPException(403,'Choose your current named ownership-change task.')
        check_task(db,actor,row,proposal,task,assignments)
    allowed={'COMPLIANCE_REVIEW':{'REVIEW','RETURN','REJECT'},'BUSINESS_VALIDATION':{'ACCEPT','OBJECT'},'FINAL_APPROVAL':{'APPROVE','RETURN','REJECT'}}
    if decision!='WITHDRAW' and decision not in allowed[stage]:raise HTTPException(409,'This decision does not match the ownership request stage.')
    if decision in {'REVIEW','APPROVE'}:
        guard_parent(db,row)
        if row['edit_revision']!=proposal['baseline_revision']:raise HTTPException(409,'The obligation changed. Withdraw this request and submit a refreshed proposal.')
        validate(db,row,proposal,assignments)
    at=now()
    if task:db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision=decision,comments=payload.comments,acted_by=actor.id,acted_at=at))
    next_stage=None;closed=None
    if decision in {'RETURN','OBJECT','REJECT','WITHDRAW'}:
        closed='REJECTED' if decision=='REJECT' else 'WITHDRAWN' if decision=='WITHDRAW' else 'RETURNED'
        db.execute(m.obligation_owner_change.update().where(m.obligation_owner_change.c.id==change_id).values(approval_status='REJECTED' if decision=='REJECT' else 'WITHDRAWN'))
    elif decision=='REVIEW':
        db.execute(m.obligation_owner_change.update().where(m.obligation_owner_change.c.id==change_id).values(approval_status='REVIEWED',reviewed_by=actor.id,reviewed_at=at))
        for item in validators(assignments,proposal['created_by']):
            task_id=new_id();db.execute(m.workflow_action.insert().values(id=task_id,instance_id=workflow['id'],stage='BUSINESS_VALIDATION',assignee_user_id=item['user_id'],due_at=at+timedelta(days=3)))
            db.execute(m.owner_change_assignment.update().where(m.owner_change_assignment.c.id==item['id']).values(task_id=task_id))
        next_stage='BUSINESS_VALIDATION'
    elif decision=='ACCEPT':
        remaining=db.execute(sa.select(m.workflow_action.c.id).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage==stage,m.workflow_action.c.decision.is_(None))).first()
        if not remaining:next_stage='FINAL_APPROVAL'
    elif decision=='APPROVE':
        responses=list(db.execute(sa.select(m.workflow_action.c.decision).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage=='BUSINESS_VALIDATION')).scalars())
        if not responses or any(choice!='ACCEPT' for choice in responses):raise HTTPException(409,'Every required ownership-change response must be accepted before final approval.')
        apply(db,actor,row,proposal,assignments);closed='APPROVED'
    if next_stage:
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(current_stage=next_stage))
        recipients=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage==next_stage,m.workflow_action.c.decision.is_(None))).scalars()
        for recipient in set(recipients):notify(db,'obligation',identifier,recipient,'OWNERSHIP_DECISION_ASSIGNED',workflow['id']+':'+next_stage+':'+recipient)
    if closed:
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(record_status=closed,current_stage='CLOSED',completed_at=at))
        notify(db,'obligation',identifier,proposal['created_by'],'OWNERSHIP_'+closed,workflow['id']+':'+closed)
    history(db,actor,ENTITY,change_id,stage,next_stage or closed or stage,payload.comments)
    audit(db,actor,'obligation',identifier,'OWNERSHIP_'+decision,new={'change_id':change_id,'task_id':task['id'] if task else None},reason=payload.comments)
    return {'id':identifier,'change_id':change_id,'status':next_stage or closed or stage,'created_revision':False}


def details(db,actor,identifiers):
    result=[]
    for raw in db.execute(sa.select(m.obligation_owner_change).where(m.obligation_owner_change.c.obligation_id.in_(identifiers)).order_by(m.obligation_owner_change.c.created_at.desc(),m.obligation_owner_change.c.id)).mappings():
        proposal=dict(raw);assignments=items(db,proposal['id'])
        tasks=[dict(r) for r in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.current_stage,m.workflow_instance.c.record_status.label('workflow_status'))
            .join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id).where(m.workflow_instance.c.entity_type==ENTITY,m.workflow_instance.c.entity_id==proposal['id']).order_by(m.workflow_action.c.created_at,m.workflow_action.c.id)).mappings()]
        row=repo.one(db,m.compliance_obligation,proposal['obligation_id']);mine=[]
        for task in tasks:
            if task['workflow_status']!='OPEN' or task['stage']!=task['current_stage'] or task['decision']:continue
            try:check_task(db,actor,row,proposal,task,assignments)
            except HTTPException:continue
            mine.append(task['id'])
        proposal.update(assignments=assignments,tasks=tasks,actionable_task_ids=mine,
            stage=tasks[-1]['current_stage'] if tasks else proposal['approval_status'],workflow_status=tasks[-1]['workflow_status'] if tasks else None)
        result.append(proposal)
    return result


def tasks(db,actor):
    result=[]
    for task in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.entity_id).join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id)
        .where(m.workflow_instance.c.entity_type==ENTITY,m.workflow_instance.c.record_status=='OPEN',m.workflow_action.c.stage==m.workflow_instance.c.current_stage,
            m.workflow_action.c.assignee_user_id==actor.id,m.workflow_action.c.decision.is_(None))).mappings():
        proposal=repo.one(db,m.obligation_owner_change,task['entity_id'])
        try:
            row=obl.read(db,actor,proposal['obligation_id']);check_task(db,actor,row,proposal,task,items(db,proposal['id']))
            _,_,instrument=obl.source(db,actor,row['primary_clause_id'])
        except HTTPException:continue
        result.append({**dict(task),'kind':'DECISION','workflow_kind':'OWNERSHIP_CHANGE','ownership_change_id':proposal['id'],'obligation_id':row['id'],
            'instrument_id':instrument['id'],'title':row['title']+' · Ownership change','code':row['code'],'department_id':proposal['business_owner_unit_id']})
    return result
