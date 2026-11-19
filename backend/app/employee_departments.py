"""Source-aware department gate. Observations never grant home organisation/roles."""
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m
from .events import now,new_id,audit
from . import ldap_department as legacy


def blocked(user):
    return bool(user.get('emp_dept_managed_flag') and (
        user.get('emp_dept_status')!='VERIFIED' or not user.get('emp_dept_approved_code') or
        (user.get('emp_dept_approved_code'),user.get('emp_dept_approved_namespace'))!=
        (user.get('emp_dept_observed_code'),user.get('emp_dept_namespace'))))


def initialise(db,user,cfg):
    if user.get('emp_dept_managed_flag'):return dict(user)
    code=user.get('department_code');mapping=cfg.get('department_code_map',{})
    mapped=mapping.get(code,code) if code else None
    namespace='API' if code in mapping else 'LDAP'
    values=dict(emp_dept_managed_flag=1,emp_dept_approved_code=mapped,emp_dept_approved_namespace=namespace if code else None,
        emp_dept_status=user.get('ldap_department_status') if code else 'UNVERIFIED',
        emp_dept_observed_code=mapped if user.get('ldap_department_status')=='VERIFIED' else None,
        emp_dept_namespace=namespace if code and user.get('ldap_department_status')=='VERIFIED' else None)
    # Historical LDAP approvals remain as-is; their explicit canonical mapping is retained separately.
    db.execute(m.user.update().where(m.user.c.id==user['id']).values(**values))
    return {**user,**values}


def queue_review(db,user,reason=None,automatic=True):
    if user.get('emp_dept_status') not in {'UNVERIFIED','MISMATCH'} or not user.get('emp_dept_observed_code'):return None
    existing=legacy.pending(db,user['id'])
    if existing and existing['observation_id']==user.get('emp_dept_observation_id'):return existing['id']
    rejected=db.execute(sa.select(m.ldap_department_request).where(m.ldap_department_request.c.user_id==user['id'],
        m.ldap_department_request.c.observation_id==user['emp_dept_observation_id'],m.ldap_department_request.c.status=='REJECTED')
        .order_by(m.ldap_department_request.c.decided_at.desc())).mappings().first()
    if rejected:
        if automatic:return None
        if not reason or len(reason.strip())<3 or reason==rejected['request_reason']:
            raise HTTPException(409,'This department observation was rejected. Provide a new explanation for reconsideration.')
    if existing:legacy.retire_pending(db,user,'SUPERSEDED')
    identifier=new_id()
    db.execute(m.ldap_department_request.insert().values(id=identifier,user_id=user['id'],
        previous_code=user.get('emp_dept_approved_code'),proposed_code=user['emp_dept_observed_code'],
        previous_namespace=user.get('emp_dept_approved_namespace'),proposed_namespace=user['emp_dept_namespace'],
        previous_department_name=user.get('emp_dept_approved_name'),proposed_department_name=user.get('emp_dept_observed_name'),
        identity_source=user['emp_dept_source'],automatic_flag=int(automatic),
        observed_at=user['emp_dept_checked_at'],observation_id=user['emp_dept_observation_id'],
        requested_by=user['id'],requested_at=now(),request_reason=reason or 'Automatically submitted after a verified employee department observation.',status='PENDING'))
    audit(db,None,'ldap_department_request',identifier,'EMPLOYEE_DEPARTMENT_REVIEW_QUEUED',
        new={'user_id':user['id'],'source':user['emp_dept_source'],'previous_code':user.get('emp_dept_approved_code'),
             'proposed_code':user['emp_dept_observed_code'],'namespace':user['emp_dept_namespace'],'automatic':automatic})
    from .user_access import notify_administrators
    notify_administrators(db,user['id'],'EMPLOYEE_DEPARTMENT_APPROVAL_REQUIRED')
    return identifier


def observe(db,user,cfg,code,name,namespace,source,at,*,from_login=False,source_code=None):
    if user.get('emp_dept_checked_at') and user['emp_dept_checked_at']>at:return dict(user)
    user=initialise(db,user,cfg)
    approved=user.get('emp_dept_approved_code');approved_ns=user.get('emp_dept_approved_namespace')
    # Equal opaque codes, or an explicit administrator mapping, can carry an existing
    # approved LDAP baseline into the API namespace. Never infer a prefix/suffix match.
    baseline={}
    if source=='EMPLOYEE_API' and approved_ns=='LDAP' and (approved==code or cfg.get('department_code_map',{}).get(approved)==code):
        baseline=dict(emp_dept_approved_namespace='API',emp_dept_approved_code=code)
        approved_ns='API';approved=code
    status='UNVERIFIED' if not approved else 'VERIFIED' if (approved,approved_ns)==(code,namespace) else 'MISMATCH'
    if status=='VERIFIED' and user.get('emp_dept_status')=='RECHECK_REQUIRED' and not from_login:status='RECHECK_REQUIRED'
    changed=(user.get('emp_dept_observed_code'),user.get('emp_dept_namespace'),user.get('emp_dept_source'))!=(code,namespace,source) or not user.get('emp_dept_observation_id')
    values={**baseline,'emp_dept_observed_code':code,'emp_dept_observed_name':name,'emp_dept_namespace':namespace,
        'emp_dept_source':source,'emp_dept_status':status,'emp_dept_observation_id':new_id() if changed else user['emp_dept_observation_id'],
        'emp_dept_checked_at':at,'emp_dept_warning':None if source=='EMPLOYEE_API' else 'The employee API is unavailable. Department verification used authenticated LDAP fallback. Automatic retries continue.'}
    if status=='VERIFIED':legacy.retire_pending(db,user,'OBSOLETE')
    elif changed:legacy.retire_pending(db,user,'SUPERSEDED')
    if status!='VERIFIED' or user.get('emp_dept_status')!='VERIFIED':
        db.execute(m.app_session.update().where(m.app_session.c.user_id==user['id']).values(revoked_flag=1))
    if changed or status!=user.get('emp_dept_status') or baseline:
        audit(db,None,'user',user['id'],'EMPLOYEE_DEPARTMENT_OBSERVED',
            old={'code':user.get('emp_dept_approved_code'),'namespace':user.get('emp_dept_approved_namespace')},
            new={'code':code,'name':name,'namespace':namespace,'source':source,'source_code':source_code or code,'configuration_revision':cfg['revision'],'status':status})
    db.execute(m.user.update().where(m.user.c.id==user['id']).values(**values));user={**user,**values}
    queue_review(db,user,reason=f'Automatic department review. Source: {source}; observed source code: {source_code or code}; configuration revision: {cfg["revision"]}.')
    return user


def observe_api(db,user,cfg,outcome,*,from_login=False):
    values=outcome['values']
    if not outcome['error'] and values.get('department_code') and values.get('department_name'):
        return observe(db,user,cfg,values['department_code'],values['department_name'],'API','EMPLOYEE_API',outcome['started'],from_login=from_login)
    return dict(user)


def observe_fallback(db,user,cfg,profile,at):
    if user.get('emp_dept_checked_at') and user['emp_dept_checked_at']>=at:return dict(user)
    # A Standard employee with no prior department observation gains no new gate
    # merely because the optional API is down; existing access rules still apply.
    if not user.get('emp_dept_managed_flag') and user['login_type']!='LDAP' and not profile:return dict(user)
    user=initialise(db,user,cfg)
    warning='Employee department details could not be refreshed. Approved details and any pending access restriction are retained. Automatic retries continue.'
    sticky=(user.get('emp_dept_source')=='EMPLOYEE_API' and user.get('emp_dept_status') in {'UNVERIFIED','MISMATCH'})
    current,valid=legacy.observation(profile or {})
    if valid and not sticky:
        raw=current['code'];mapping=cfg.get('department_code_map',{})
        if user.get('emp_dept_approved_namespace')!='API' or raw in mapping or raw==user.get('emp_dept_approved_code'):
            namespace='API' if raw in mapping or user.get('emp_dept_approved_namespace')=='API' else 'LDAP'
            code=mapping.get(raw,raw)
            if user.get('emp_dept_source')=='EMPLOYEE_API' and code!=user.get('emp_dept_observed_code') and raw==user.get('ldap_last_seen_department_code'):
                warning='LDAP still reports a department that conflicted with the last verified employee API result. Approved details and any pending restriction are retained until fresh comparable evidence is available.'
            else:return observe(db,user,cfg,code,None,namespace,'LDAP_FALLBACK',at,from_login=True,source_code=raw)
        else:warning='The employee API is unavailable and the LDAP department code needs an administrator mapping. Approved details and any pending restriction are retained.'
    elif sticky:warning='An employee API department change is awaiting administrator review. LDAP fallback cannot clear this pending change. Automatic retries continue.'
    db.execute(m.user.update().where(m.user.c.id==user['id']).values(emp_dept_warning=warning,emp_dept_checked_at=at))
    return {**user,'emp_dept_warning':warning,'emp_dept_checked_at':at}


def public_status(db,user):
    rows=[dict(r) for r in db.execute(sa.select(m.ldap_department_request).where(m.ldap_department_request.c.user_id==user['id'])
        .order_by(m.ldap_department_request.c.requested_at.desc())).mappings()]
    status=user.get('emp_dept_status') or 'UNVERIFIED'
    rejected=any(r['status']=='REJECTED' and r['observation_id']==user.get('emp_dept_observation_id') for r in rows)
    home=db.execute(sa.select(m.organisational_unit.c.name).where(m.organisational_unit.c.id==user.get('org_unit_id'))).scalar_one_or_none() if user.get('org_unit_id') else None
    messages={'VERIFIED':'Your current department matches the approved department.',
        'MISMATCH':'Your department has changed. An administrator is reviewing your access.',
        'UNVERIFIED':'Your department has been sent for initial administrator verification.',
        'UNAVAILABLE':'Current department details are unavailable. No department change has been assumed.',
        'RECHECK_REQUIRED':'Your department was approved. Sign out and sign in again to verify the current details.'}
    if not user.get('emp_dept_observed_code'):messages[status]='Current employee department details are unavailable. Review will be queued when valid details arrive; no department transfer has been assumed.'
    return {'managed':True,'status':status,'blocked':blocked(user),'message':messages[status],
        'approved':{'code':user.get('emp_dept_approved_code'),'name':user.get('emp_dept_approved_name'),'namespace':user.get('emp_dept_approved_namespace')},
        'current':{'code':user.get('emp_dept_observed_code'),'name':user.get('emp_dept_observed_name'),'namespace':user.get('emp_dept_namespace')},
        'source':user.get('emp_dept_source'),'warning':user.get('emp_dept_warning'),'checked_at':user.get('emp_dept_checked_at'),
        'home_organisation':home,'can_request':bool(rejected and status in {'MISMATCH','UNVERIFIED'}),
        'resubmission_explanation_required':rejected,'requests':rows}


def request_update(db,user,session,reason):
    if session.get('ldap_observation_id')!=user.get('emp_dept_observation_id'):
        raise HTTPException(409,'Department details changed after sign-in. Sign out and sign in again before requesting reconsideration.')
    identifier=queue_review(db,user,reason,automatic=False)
    if not identifier:raise HTTPException(409,'There is no current department change to submit.')
    return {'id':identifier,'status':'PENDING','message':'Your department observation is pending independent administrator review.'}


def decide(db,actor,user,request,decision,reason):
    if not user['active_flag'] or not user.get('emp_dept_managed_flag'):raise HTTPException(409,'This employee department observation is no longer current.')
    if (request['observation_id']!=user.get('emp_dept_observation_id') or
        (request['previous_code'],request['previous_namespace'])!=(user.get('emp_dept_approved_code'),user.get('emp_dept_approved_namespace')) or
        (request['proposed_code'],request['proposed_namespace'])!=(user.get('emp_dept_observed_code'),user.get('emp_dept_namespace')) or
        user.get('emp_dept_status') not in {'UNVERIFIED','MISMATCH'}):
        raise HTTPException(409,'The employee department observation changed. Refresh and review the latest request.')
    if decision=='APPROVE':
        db.execute(m.user.update().where(m.user.c.id==user['id']).values(emp_dept_approved_code=request['proposed_code'],
            emp_dept_approved_name=request['proposed_department_name'],emp_dept_approved_namespace=request['proposed_namespace'],emp_dept_status='RECHECK_REQUIRED'))
    db.execute(m.app_session.update().where(m.app_session.c.user_id==user['id']).values(revoked_flag=1))
    status='APPROVED' if decision=='APPROVE' else 'REJECTED'
    db.execute(m.ldap_department_request.update().where(m.ldap_department_request.c.id==request['id']).values(status=status,decided_by=actor.id,decided_at=now(),decision_reason=reason))
    audit(db,actor,'ldap_department_request',request['id'],'EMPLOYEE_DEPARTMENT_'+status,
        old={'code':request['previous_code'],'namespace':request['previous_namespace']},
        new={'code':request['proposed_code'],'namespace':request['proposed_namespace'],'source':request['identity_source'],'status':status},reason=reason)
    from .user_access import notify_administrators
    notify_administrators(db,user['id'],'EMPLOYEE_DEPARTMENT_'+status,include_user=True)
    return {'ok':True,'status':status,'message':'Department approved. A fresh sign-in is required. Home organisation, roles and scope remain separately administered.' if decision=='APPROVE' else 'Request rejected. The approved department and access restriction remain unchanged.'}
