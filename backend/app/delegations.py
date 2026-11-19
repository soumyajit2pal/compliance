"""Date-bound approved leave cover using existing effective role/scope grants.

An explicit request header selects one represented principal/role/department.
Authentication remains the actual person's session; no credential or role is copied.
"""
import json
from datetime import timedelta
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m,repository as repo
from .access import actor_for,READ_ROLES
from .events import audit,notify,now,new_id,history

ROLES={'AUTHOR','REVIEWER','APPROVER','BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','CCO','ZONE_VIEWER'}
HEADER='X-Delegation-ID'
def fail(ok,message,status=422):
    if not ok:raise HTTPException(status,message)
def today():
    from .delivery import today as day
    return day()
def ready(actor):return not any(actor.user.get(k) for k in ['must_change_password_flag','needs_email_confirmation_flag','needs_department_selection_flag'])
def within(units,child,parent):
    seen=set()
    while child and child not in seen:
        if child==parent:return True
        seen.add(child);child=units.get(child,{}).get('parent_org_unit_id')
    return False
def read(db,actor,identifier,lock=False):
    r=repo.one(db,m.leave_delegation,identifier)
    fail(actor.id in {r['principal_user_id'],r['delegate_user_id'],r['reviewer_user_id'],r['approver_user_id']} or actor.covers(r['scope_unit_id'],{'CCO'}),'Delegation not found in your authorised area.',404)
    if lock:
        for uid in sorted({r['principal_user_id'],r['delegate_user_id']}):repo.one(db,m.user,uid,True)
        r=repo.one(db,m.leave_delegation,identifier,True)
    return r
def eligible(db,r):
    principal=actor_for(db,r['principal_user_id']);delegate=actor_for(db,r['delegate_user_id'])
    for person in [principal,delegate]:
        fail(ready(person),'Both people must complete account onboarding.',409)
        person.require({r['role_code']},r['scope_unit_id'])
    return principal,delegate
def available(db,r):
    return r['approval_status']=='APPROVED' and not r['revoked_at'] and r['starts_on']<=today()<=r['ends_on']
def overlaps(db,r,exclude=None):
    actor=actor_for(db,r['principal_user_id']);t=m.leave_delegation
    for old in db.execute(sa.select(t).where(t.c.principal_user_id==r['principal_user_id'],t.c.role_code==r['role_code'],t.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']),t.c.revoked_at.is_(None),t.c.starts_on<=r['ends_on'],t.c.ends_on>=r['starts_on'])).mappings():
        if old['id']==exclude:continue
        if within(actor.units,old['scope_unit_id'],r['scope_unit_id']) or within(actor.units,r['scope_unit_id'],old['scope_unit_id']):return True
    return False
def create(db,actor,p):
    fail(not actor.delegation,'Create leave cover from your own identity; represented authority cannot be re-delegated.',403)
    actor.require({p.role_code},p.scope_unit_id)
    for uid in sorted({actor.id,p.delegate_user_id}):repo.one(db,m.user,uid,True)
    fail(p.starts_on>=today(),'Leave cover cannot start retrospectively.')
    values=p.model_dump()|{'principal_user_id':actor.id,'created_by':actor.id}
    fail(actor.id not in {p.delegate_user_id,p.reviewer_user_id,p.approver_user_id},'The principal, delegate, reviewer and final approver must be different people.')
    eligible(db,values)
    for uid,role in [(p.reviewer_user_id,'REVIEWER'),(p.approver_user_id,'APPROVER')]:repo.eligible(db,uid,role,p.scope_unit_id,{actor.id,p.delegate_user_id})
    fail(not overlaps(db,values),'This role and department already have overlapping pending or approved cover.',409)
    # Opposing simultaneous cover cannot be used as a circular hand-off.
    reverse=db.execute(sa.select(m.leave_delegation.c.id).where(m.leave_delegation.c.principal_user_id==p.delegate_user_id,m.leave_delegation.c.delegate_user_id==actor.id,m.leave_delegation.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']),m.leave_delegation.c.revoked_at.is_(None),m.leave_delegation.c.starts_on<=p.ends_on,m.leave_delegation.c.ends_on>=p.starts_on)).first()
    fail(not reverse,'Circular overlapping leave cover is not permitted.',409)
    identifier=new_id();values.update(id=identifier,approval_status='IN_REVIEW',edit_revision=1)
    db.execute(m.leave_delegation.insert().values(**values));audit(db,actor,'leave_delegation',identifier,'REQUESTED',new=values,reason=p.reason)
    notify(db,'leave_delegation',identifier,p.reviewer_user_id,'LEAVE_COVER_REVIEW',identifier+':review')
    return {'id':identifier}
def decision(db,actor,identifier,p):
    fail(not actor.delegation,'Leave-cover decisions use your own identity.',403)
    r=read(db,actor,identifier,True);fail(r['edit_revision']==p.expected_revision,'This delegation changed. Refresh before deciding.',409)
    if p.decision=='REVOKE':
        fail(r['approval_status']=='APPROVED' and not r['revoked_at'],'Only unrevoked approved cover can be revoked.',409)
        fail(actor.id in {r['principal_user_id'],r['delegate_user_id']} or actor.id==r['approver_user_id'] and actor.covers(r['scope_unit_id'],{'APPROVER'}),'Only the principal, delegate or named in-scope final approver can revoke cover.',403)
        values={'revoked_by':actor.id,'revoked_at':now(),'revocation_reason':p.reason}
    elif p.decision=='WITHDRAW':
        fail(actor.id==r['principal_user_id'] and r['approval_status'] in {'IN_REVIEW','REVIEWED'},'Only the principal can withdraw a pending request.',403)
        values={'approval_status':'WITHDRAWN'}
    else:
        reviewing=r['approval_status']=='IN_REVIEW';role='REVIEWER' if reviewing else 'APPROVER'
        fail(r['approval_status'] in {'IN_REVIEW','REVIEWED'} and actor.id==r['reviewer_user_id' if reviewing else 'approver_user_id'],'Only the named person can decide the current stage.',403)
        actor.require({role},r['scope_unit_id'])
        fail(actor.id not in {r['principal_user_id'],r['delegate_user_id']} and (reviewing or actor.id!=r['reviewed_by']),'Independent review and final approval are required.',403)
        if p.decision=='REJECT':values={'approval_status':'REJECTED'}
        else:
            fail(p.decision==('REVIEW' if reviewing else 'APPROVE'),'Complete independent review before final approval.',409)
            eligible(db,r);fail(r['ends_on']>=today(),'This cover period has already ended.',409)
            fail(not overlaps(db,r,identifier),'Another cover now overlaps this role and scope.',409)
            values={'approval_status':'REVIEWED','reviewed_by':actor.id,'reviewed_at':now()} if reviewing else {'approval_status':'APPROVED','approved_by':actor.id,'approved_at':now()}
    values['edit_revision']=r['edit_revision']+1
    db.execute(m.leave_delegation.update().where(m.leave_delegation.c.id==identifier).values(**values));audit(db,actor,'leave_delegation',identifier,p.decision,old=r,new={**r,**values},reason=p.reason)
    history(db,actor,'leave_delegation',identifier,r['approval_status'],values.get('approval_status','REVOKED'),p.reason)
    recipients={r['principal_user_id'],r['delegate_user_id']}
    if values.get('approval_status')=='REVIEWED':recipients.add(r['approver_user_id'])
    for user in recipients:notify(db,'leave_delegation',identifier,user,'LEAVE_COVER_'+p.decision,identifier+':'+str(r['edit_revision'])+':'+p.decision)
    return {'ok':True}
def listing(db,actor):
    actor.require(READ_ROLES);result=[]
    for row in db.execute(sa.select(m.leave_delegation).order_by(m.leave_delegation.c.created_at.desc(),m.leave_delegation.c.id)).mappings():
        try:r=read(db,actor,row['id'])
        except HTTPException:continue
        r['available']=False
        if available(db,r):
            try:eligible(db,r);r['available']=True
            except HTTPException:pass
        r['display_status']='REVOKED' if r['revoked_at'] else 'EXPIRED' if r['approval_status']=='APPROVED' and r['ends_on']<today() else 'SCHEDULED' if r['approval_status']=='APPROVED' and r['starts_on']>today() else 'ACTIVE' if r['available'] else 'UNAVAILABLE' if r['approval_status']=='APPROVED' else r['approval_status']
        r['can_act']=r['available'] and actor.id==r['delegate_user_id']
        r['can_decide']=actor.id==r['reviewer_user_id'] and r['approval_status']=='IN_REVIEW' and actor.covers(r['scope_unit_id'],{'REVIEWER'}) or actor.id==r['approver_user_id'] and r['approval_status']=='REVIEWED' and actor.covers(r['scope_unit_id'],{'APPROVER'})
        r['can_revoke']=r['approval_status']=='APPROVED' and not r['revoked_at'] and (actor.id in {r['principal_user_id'],r['delegate_user_id']} or actor.id==r['approver_user_id'] and actor.covers(r['scope_unit_id'],{'APPROVER'}))
        result.append(r)
    return result
def tasks(db,actor):
    return [{'id':r['id'],'kind':'DECISION','workflow_kind':'LEAVE_DELEGATION','action_path':'delegations/'+r['id'],'code':'Leave cover','title':'Review leave cover · '+str(r['starts_on'])+' – '+str(r['ends_on']),'department_id':r['scope_unit_id'],'stage':r['approval_status'],'due_at':r['starts_on']} for r in listing(db,actor) if r['can_decide']]
def audit_visible(db,actor,event):
    try:
        kind=event['entity_type'];identifier=event['entity_id']
        if kind=='version':repo.read_version(db,actor,identifier)
        elif kind=='instrument':repo.read_instrument(db,actor,identifier)
        elif kind=='obligation':
            from .obligations import read as read_obligation
            read_obligation(db,actor,identifier)
        elif kind=='metadata_correction':repo.read_instrument(db,actor,repo.one(db,m.metadata_correction,identifier)['instrument_id'])
        elif kind in {'controls','control-mappings'}:
            from .controls import read as read_control
            read_control(db,actor,kind,identifier)
        elif kind in {'action','action_extension','action_validation','evidence','control_execution'}:
            from . import delivery as work
            if kind=='evidence':work.evidence_read(db,actor,identifier)
            else:
                if kind=='action_extension':identifier=repo.one(db,m.due_date_history,identifier)['action_id']
                if kind=='action_validation':identifier=repo.one(db,m.action_validation,identifier)['action_id']
                if kind=='control_execution':
                    result=db.execute(sa.select(m.action_control_result).where(m.action_control_result.c.execution_id==identifier)).mappings().first()
                    if not result:return False
                    identifier=repo.one(db,m.action_control_link,result['link_id'])['action_id']
                work.read(db,actor,identifier)
        elif kind.startswith('family_'):
            from . import notification_families as families
            if kind[7:] not in families.KINDS:return False
            families.proposal_context(db,actor,kind[7:],repo.one(db,families.KINDS[kind[7:]],identifier))
        else:return False
        return True
    except HTTPException:return False
def resolve_context(db,actual,request):
    identifier=request.headers.get(HEADER)
    if not identifier or request.url.path.startswith('/api/delegations'):return actual
    forbidden=('/api/admin','/api/ldap','/api/users','/api/migration','/api/import','/api/applications','/api/auth/')
    fail(request.url.path=='/api/auth/me' or not request.url.path.startswith(forbidden),'Use your own identity for administration, authentication and access settings.',403)
    try:
        r=read(db,actual,identifier,True);fail(actual.id==r['delegate_user_id'] and available(db,r),'Cover is not active.',403)
        principal,delegate=eligible(db,r)
        return actor_for(db,principal.id,(actual,principal,r))
    except HTTPException:
        raise HTTPException(403,{'code':'DELEGATION_UNAVAILABLE','message':'This leave cover is expired, revoked, outside scope or no longer eligible. Stop leave cover to return to your own workspace.'}) from None

# Audit-time checks execute inside the same caller transaction. A denied late
# decision rolls back its preceding row updates and transaction-bound file writes.
PREPARATION={
 'version':{'VERSION_CREATED','DRAFT_VERSION_UPDATED','CLAUSE_SAVED','CLAUSE_CHAIN_CARRIED','SUBMITTED'},
 'metadata_correction':{'CORRECTION_SUBMITTED'},
 'obligation':{'CREATED','IMPORTED_DRAFT','DRAFT_EDITED','OWNERS_UPDATED','SUBMITTED'},
 'controls':{'CREATED','REVISION_CREATED','DRAFT_EDITED','SUBMITTED'},
 'control-mappings':{'CREATED','REVISION_CREATED','DRAFT_EDITED','SUBMITTED'},
 'action':{'ASSIGNED','DRAFT_SAVED','STARTED','SUBMITTED','EVIDENCE_SUBMITTED','EVIDENCE_LINKED','CONTROL_RESULT_RECORDED','VALIDATION_RECORDED'},
 'evidence':{'SUBMITTED'},'control_execution':{'RESULT_RECORDED'},'action_extension':{'REQUESTED'},'action_validation':{'RECORDED'},
}
def event_independence(db,actor,entity,identifier,event,old=None,new=None):
    if not actor or entity in {'leave_delegation','user','system'}:return
    decision=event.removeprefix('OWNERSHIP_') if event.startswith('OWNERSHIP_') else event
    if decision not in {'REVIEW','APPROVE','ACCEPT','REJECT','RETURN','OBJECT','COMPLETE','CANCEL','TASK_DELEGATED'}:return
    if getattr(actor,'delegation',None) and decision=='TASK_DELEGATED':raise HTTPException(403,'Leave-cover authority cannot be re-delegated. Use your own identity for task hand-offs.')
    records=[dict(r) for r in db.execute(sa.select(m.audit_log).where(m.audit_log.c.entity_type==entity,m.audit_log.c.entity_id==identifier)).mappings()]
    if not getattr(actor,'delegation',None) and not any(r['delegation_id'] for r in records):return
    ownership=event.startswith('OWNERSHIP_');change_id=(new or {}).get('change_id') if ownership else None
    if ownership:records=[r for r in records if json.loads(r['new_value'] or '{}').get('change_id')==change_id]
    preparation={'OWNERSHIP_CHANGE_REQUESTED'} if ownership else {'SUBMITTED'} if entity.startswith('family_') else PREPARATION.get(entity,set())
    final=decision=='APPROVE' or decision in {'RETURN','REJECT'} and (old or {}).get('approval_status',(old or {}).get('status'))=='REVIEWED'
    blocked=set()
    for r in records:
        prior=r['action'];prior_decision=prior.removeprefix('OWNERSHIP_') if ownership else prior
        if prior in preparation or final and prior_decision in {'REVIEW','ACCEPT'}:
            blocked.update(x for x in [r['actor_user_id'],r['on_behalf_of_user_id']] if x)
    table={'version':m.instrument_version,'metadata_correction':m.metadata_correction,'obligation':m.compliance_obligation,'controls':m.control,'control-mappings':m.obligation_control_map,'action':m.action,'evidence':m.evidence_item,'control_execution':m.control_execution,'action_extension':m.due_date_history,'action_validation':m.action_validation}.get(entity)
    if ownership:table=m.obligation_owner_change
    if entity.startswith('family_'):
        from .notification_families import KINDS
        table=KINDS.get(entity[7:])
    record=repo.one(db,table,change_id or identifier) if table is not None else {}
    keys=['created_by','uploaded_by','recorded_by','performed_by','requested_by']
    if entity=='action':keys.append('owner_user_id')
    if final:keys.append('reviewed_by')
    # Reviewed_by can already contain this decision after its SQL update; use
    # the retained pre-change value and prior audit events instead.
    for key in keys:
        value=(old or {}).get(key,record.get(key)) if key=='reviewed_by' else record.get(key)
        if value:blocked.add(value)
    fail(not (getattr(actor,'parties',{actor.id})&blocked),'The actual actor and represented principal must both be independent of preparation, ownership and any earlier review required to be separate.',403)
    if getattr(actor,'delegation',None):
        role=actor.delegation['role_code']
        wanted='APPROVER' if final or decision=='CANCEL' else 'REVIEWER' if decision in {'REVIEW','COMPLETE','RETURN','REJECT'} or entity in {'evidence','control_execution','action_validation'} else None
        if decision in {'ACCEPT','OBJECT'} and entity=='obligation':fail(role in {'BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER'},'This leave cover does not include the ownership role required for this decision.',403)
        if wanted:fail(role==wanted,'This leave cover does not include the role required for this decision.',403)
        unit=record.get('regulatory_owner_unit_id') or record.get('governance_unit_id')
        if entity=='version':unit=repo.one(db,m.regulatory_instrument,record['instrument_id'])['regulatory_owner_unit_id']
        if entity=='metadata_correction':unit=repo.one(db,m.regulatory_instrument,record['instrument_id'])['regulatory_owner_unit_id']
        if wanted and unit:actor.require({wanted},unit)
