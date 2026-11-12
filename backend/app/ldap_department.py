"""Approved LDAP department identity, with a separate immutable request history.

Never writes org_unit_id or role assignments. Only authenticated LDAP results
may supply proposed values. User-row locks serialize logins, requests and admin
decisions; the observation id prevents an older session proposing newer data.
"""
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m
from .events import new_id,now,audit

# Public key, approved user column, observed user column, maximum characters.
IDENTITY_FIELDS = (
    ('code','department_code','ldap_last_seen_department_code',100),
    ('division','ldap_division','ldap_last_seen_division',250),
    ('info','ldap_info','ldap_last_seen_info',2000),
)


def identity(user, *, current=False):
    return {key:user.get(observed if current else approved)
            for key,approved,observed,_ in IDENTITY_FIELDS}


def blocked(user):
    return user['login_type']=='LDAP' and (user.get('ldap_department_status')!='VERIFIED'
        or not user.get('department_code')
        or identity(user)!=identity(user,current=True))


def can_onboard(user):
    return user['login_type']=='LDAP' and (not blocked(user) or
        (not user.get('department_code') and user.get('ldap_department_status')=='UNVERIFIED'))


def clean_value(value, maximum):
    # Codes are opaque strings: never trim, casefold or parse them as numbers.
    if not isinstance(value,str) or not value.strip() or len(value)>maximum:
        return None
    if any(ord(char)<32 or ord(char)==127 for char in value):return None
    return value


def observation(profile):
    values={};valid=profile.get('comparison_attributes_valid',True)
    for key,_,_,maximum in IDENTITY_FIELDS:
        value=profile.get('department_code' if key=='code' else key)
        # Division/info may be absent. Their removal still differs from an
        # approved nonempty value and needs approval. Never truncate evidence.
        absent=value is None or (isinstance(value,str) and len(value)<=maximum and not value.strip()
                                and not any(ord(char)<32 or ord(char)==127 for char in value))
        values[key]=None if key!='code' and absent else clean_value(value,maximum)
        if (key=='code' or not absent) and values[key] is None:valid=False
    return values,valid


def user_locked(db,identifier):
    user=db.execute(sa.select(m.user).where(m.user.c.id==identifier).with_for_update()).mappings().first()
    if not user:raise HTTPException(404,'User not found.')
    return dict(user)


def pending(db,identifier):
    return db.execute(sa.select(m.ldap_department_request).where(
        m.ldap_department_request.c.user_id==identifier,m.ldap_department_request.c.status=='PENDING')).mappings().first()


def retire_pending(db,user,status):
    request=pending(db,user['id'])
    if request:
        db.execute(m.ldap_department_request.update().where(m.ldap_department_request.c.id==request['id']).values(
            status=status,decided_at=now()))
        audit(db,None,'ldap_department_request',request['id'],'LDAP_DEPARTMENT_'+status,
              new={'user_id':user['id'],'status':status})


def observe(db,user,profile):
    """Called with the user row locked, after successful LDAP authentication."""
    current,valid=observation(profile);at=now()
    approved=identity(user)
    status=('UNAVAILABLE' if not valid else
            'UNVERIFIED' if not user.get('department_code') else
            'VERIFIED' if current==approved else 'MISMATCH')
    changed=(identity(user,current=True)!=current or not user.get('ldap_observation_id')
             or (status=='UNAVAILABLE' and user.get('ldap_department_status')!='UNAVAILABLE'))
    values={observed:current[key] for key,_,observed,_ in IDENTITY_FIELDS}
    values.update({
        'ldap_department_checked_at':at,'ldap_department_status':status,
        'ldap_observation_id':new_id() if changed else user['ldap_observation_id']})
    if status=='VERIFIED':
        retire_pending(db,user,'OBSOLETE')
    elif changed:retire_pending(db,user,'SUPERSEDED')
    if status!='VERIFIED' or user.get('ldap_department_status')!='VERIFIED':
        db.execute(m.app_session.update().where(m.app_session.c.user_id==user['id']).values(revoked_flag=1))
    if changed or user.get('ldap_department_status')!=status:
        audit(db,None,'user',user['id'],'LDAP_DEPARTMENT_OBSERVED',
              old=approved,
              new={**current,'status':status,'source':profile.get('source','ldap')})
    db.execute(m.user.update().where(m.user.c.id==user['id']).values(**values))
    return {**user,**values}


def public_status(db,user):
    history=[dict(row) for row in db.execute(sa.select(m.ldap_department_request).where(
        m.ldap_department_request.c.user_id==user['id']).order_by(m.ldap_department_request.c.requested_at.desc())).mappings()]
    status=user.get('ldap_department_status','UNVERIFIED')
    messages={
        'UNVERIFIED':'Your LDAP department needs initial administrator verification.',
        'MISMATCH':'Your LDAP department code, division or info has changed. Application access is blocked until an administrator approves the change.',
        'UNAVAILABLE':'Your LDAP department details could not be verified. A valid department code and single valid division/info values, when present, are required.',
        'RECHECK_REQUIRED':'Your department update was approved. Sign out and sign in with LDAP again to verify the approved details.',
        'VERIFIED':'Your current LDAP department code, division and info match the approved details.'}
    rejected=bool(history and history[0]['status']=='REJECTED' and history[0]['observation_id']==user.get('ldap_observation_id'))
    home=db.execute(sa.select(m.organisational_unit.c.name).where(m.organisational_unit.c.id==user.get('org_unit_id'))).scalar_one_or_none() if user.get('org_unit_id') else None
    return {'status':status,'blocked':blocked(user),'message':messages[status],
        'approved':identity(user),
        'current':identity(user,current=True),
        'checked_at':user.get('ldap_department_checked_at'),
        'home_organisation':home,'can_request':status in {'UNVERIFIED','MISMATCH'},
        'resubmission_explanation_required':rejected,'requests':history}


def request_update(db,actor,session,reason=''):
    user=user_locked(db,actor.id)
    if user['login_type']!='LDAP':raise HTTPException(403,'Only LDAP users can request a directory department update.')
    if session.get('ldap_observation_id')!=user.get('ldap_observation_id'):
        raise HTTPException(409,'LDAP details changed after this sign-in. Sign out and sign in again before requesting an update.')
    if user['ldap_department_status'] not in {'UNVERIFIED','MISMATCH'}:
        raise HTTPException(409,'A valid changed or unverified LDAP department is required. Sign in again to check the directory.')
    existing=pending(db,user['id'])
    if existing:return {'id':existing['id'],'status':'PENDING','message':'Your department update request is already pending.'}
    latest=db.execute(sa.select(m.ldap_department_request).where(m.ldap_department_request.c.user_id==user['id'])
        .order_by(m.ldap_department_request.c.requested_at.desc())).mappings().first()
    if latest and latest['status']=='REJECTED' and latest['observation_id']==user['ldap_observation_id'] and (
        len(reason.strip())<3 or reason==latest['request_reason']):
        raise HTTPException(409,'This department update was rejected. Provide a new e' \
        'xplanation to request reconsideration.')
    identifier=new_id()
    db.execute(m.ldap_department_request.insert().values(id=identifier,user_id=user['id'],
        previous_code=user['department_code'],proposed_code=user['ldap_last_seen_department_code'],
        previous_division=user.get('ldap_division'),proposed_division=user.get('ldap_last_seen_division'),
        previous_info=user.get('ldap_info'),proposed_info=user.get('ldap_last_seen_info'),
        observed_at=user['ldap_department_checked_at'],observation_id=user['ldap_observation_id'],
        requested_by=user['id'],requested_at=now(),request_reason=reason or None,status='PENDING'))
    audit(db,actor,'ldap_department_request',identifier,'LDAP_DEPARTMENT_UPDATE_REQUESTED',
          new={'user_id':user['id'],**{'previous_'+key:value for key,value in identity(user).items()},
               **{'proposed_'+key:value for key,value in identity(user,current=True).items()}})
    from .user_access import notify_administrators
    notify_administrators(db,user['id'],'LDAP_DEPARTMENT_APPROVAL_REQUIRED')
    return {'id':identifier,'status':'PENDING','message':'Your LDAP department update request was sent to the administrators.'}


def decide(db,actor,identifier,decision,reason):
    actor.require({'ADMIN'})
    request=db.execute(sa.select(m.ldap_department_request).where(m.ldap_department_request.c.id==identifier)).mappings().first()
    if not request:raise HTTPException(404,'Department request not found.')
    if request['user_id']==actor.id:raise HTTPException(403,'Another administrator must decide your own department request.')
    user=user_locked(db,request['user_id'])
    request=db.execute(sa.select(m.ldap_department_request).where(m.ldap_department_request.c.id==identifier).with_for_update()).mappings().one()
    if request['status']!='PENDING':raise HTTPException(409,'This department request has already been decided or superseded.')
    if not user['active_flag'] or user['login_type']!='LDAP':raise HTTPException(409,'Only an enabled LDAP account can receive this approval.')
    if (request['observation_id']!=user['ldap_observation_id']
            or any(request['previous_'+key]!=user.get(approved) or request['proposed_'+key]!=user.get(observed)
                   for key,approved,observed,_ in IDENTITY_FIELDS)
            or user['ldap_department_status'] not in {'UNVERIFIED','MISMATCH'}):
        raise HTTPException(409,'The observed LDAP department changed. Refresh and review the latest request.')
    if decision=='APPROVE':
        values={approved:request['proposed_'+key] for key,approved,_,_ in IDENTITY_FIELDS}
        db.execute(m.user.update().where(m.user.c.id==user['id']).values(**values,
            ldap_department_status='RECHECK_REQUIRED'))
    db.execute(m.app_session.update().where(m.app_session.c.user_id==user['id']).values(revoked_flag=1))
    status='APPROVED' if decision=='APPROVE' else 'REJECTED'
    db.execute(m.ldap_department_request.update().where(m.ldap_department_request.c.id==identifier).values(
        status=status,decided_by=actor.id,decided_at=now(),decision_reason=reason))
    audit(db,actor,'ldap_department_request',identifier,'LDAP_DEPARTMENT_'+status,
          old={key:request['previous_'+key] for key,_,_,_ in IDENTITY_FIELDS},
          new={**{key:request['proposed_'+key] for key,_,_,_ in IDENTITY_FIELDS},'status':status},reason=reason)
    from .user_access import notify_administrators
    notify_administrators(db,user['id'],'LDAP_DEPARTMENT_'+status,include_user=True)
    return {'ok':True,'status':status,'message':('Department approved. The user must sign in with LDAP again. Home organisation and roles are unchanged.'
            if decision=='APPROVE' else 'Request rejected. The approved LDAP department remains unchanged.')}
