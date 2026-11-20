"""Separate LDAP/API baselines, immutable profile versions and one independent review gate."""
import hashlib,json
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m
from .events import audit,now,new_id

API_FIELDS=('employee_name','designation','branch_code','branch_name','current_branch_code','zone_code','zone_name','department_code','department_name','employee_status')
FIELDS=('ldap_department_code',*API_FIELDS)


def locked_user(db,identifier):
    return dict(db.execute(sa.select(m.user).where(m.user.c.id==identifier).with_for_update()).mappings().one())


def profile(db,identifier):
    row=db.execute(sa.select(m.employee_profile).where(m.employee_profile.c.user_id==identifier)).mappings().first()
    return dict(row) if row else None


def version(db,identifier):
    if not identifier:return None
    row=db.execute(sa.select(m.employee_profile_version).where(m.employee_profile_version.c.id==identifier)).mappings().first()
    return dict(row) if row else None


def payload(row):return {key:row.get(key) if row else None for key in FIELDS}


def changes(approved,current):
    return [{'field':key,'old':(approved or {}).get(key),'new':(current or {}).get(key)} for key in FIELDS if (approved or {}).get(key)!=(current or {}).get(key)]


def decorate(db,user):
    user=dict(user);row=profile(db,user['id'])
    required=bool(row or user['login_type']=='LDAP')
    user.update(employee_profile_required=required,employee_profile_status=row['status'] if row else 'UNVERIFIED' if required else None,
        employee_approved_version_id=row['approved_version_id'] if row else None,
        employee_latest_version_id=row['latest_version_id'] if row else None,
        employee_warning=row['warning'] if row else None)
    if row:
        user['employee_approved']=payload(version(db,row['approved_version_id']))
        user['employee_observed']=payload(version(db,row['latest_version_id']))
    return user


def blocked(user):
    return bool(user.get('employee_profile_required',user.get('login_type')=='LDAP') and
        (user.get('employee_profile_status')!='VERIFIED' or not user.get('employee_approved_version_id') or user.get('employee_latest_version_id')!=user.get('employee_approved_version_id')))


def can_onboard(user):return user['login_type']=='LDAP'


def ensure(db,user,pf=None,account=None):
    row=profile(db,user['id'])
    if row:return row
    at=now();identifier=new_id()
    db.execute(m.employee_profile.insert().values(id=identifier,user_id=user['id'],pf_no=pf,account_name=account or user['username'],
        status='UNVERIFIED',sync_status='FAILED',last_error_code='AWAITING_API',last_attempt_at=at,attempt_started_at=at))
    return profile(db,user['id'])


def revoke(db,user_id):db.execute(m.app_session.update().where(m.app_session.c.user_id==user_id).values(revoked_flag=1))


def retire(db,row,status):
    records=db.execute(sa.select(m.employee_profile_review).where(m.employee_profile_review.c.profile_id==row['id'],m.employee_profile_review.c.status=='PENDING')).mappings().all()
    for record in records:
        db.execute(m.employee_profile_review.update().where(m.employee_profile_review.c.id==record['id']).values(status=status))
        audit(db,None,'employee_profile_review',record['id'],'EMPLOYEE_REVIEW_'+status,new={'version_id':record['version_id']})


def queue(db,row,current,*,reason=None,automatic=True):
    if not current or not current['ldap_valid_flag'] or not current['api_complete_flag']:return None
    t=m.employee_profile_review
    pending=db.execute(sa.select(t).where(t.c.profile_id==row['id'],t.c.status=='PENDING')).mappings().first()
    if pending and pending['version_id']==current['id']:return pending['id']
    rejected=db.execute(sa.select(t).where(t.c.profile_id==row['id'],t.c.version_id==current['id'],t.c.previous_version_id==row['approved_version_id'] if row['approved_version_id'] else t.c.previous_version_id.is_(None),t.c.status=='REJECTED').order_by(t.c.decided_at.desc())).mappings().first()
    if rejected:
        if automatic:return None
        if not reason or len(reason.strip())<3 or reason.strip()==rejected['request_reason']:raise HTTPException(409,'Provide a new explanation for reconsidering this rejected profile.')
    if pending:retire(db,row,'SUPERSEDED')
    identifier=new_id()
    db.execute(t.insert().values(id=identifier,profile_id=row['id'],version_id=current['id'],previous_version_id=row['approved_version_id'],
        requested_by=row['user_id'],requested_at=now(),request_reason=reason or 'Automatically submitted after an employee profile observation.',status='PENDING'))
    audit(db,None,'employee_profile_review',identifier,'EMPLOYEE_PROFILE_REVIEW_QUEUED',new={'user_id':row['user_id'],'version_id':current['id'],'automatic':automatic,'changed_fields':[r['field'] for r in changes(version(db,row['approved_version_id']),current)]})
    from .user_access import notify_administrators
    notify_administrators(db,row['user_id'],'EMPLOYEE_PROFILE_APPROVAL_REQUIRED')
    return identifier


def observe(db,user,row,outcome,*,from_login=False,ldap=None,enabled=True):
    """The caller holds the user lock and has discarded stale HTTP completions."""
    prior_status=row['status'];prior_warning=row['warning']
    latest=version(db,row['latest_version_id']);approved=version(db,row['approved_version_id'])
    values=payload(latest);ldap_valid=bool(latest and latest['ldap_valid_flag'])
    if from_login:
        if user['login_type']=='LDAP':
            code=(ldap or {}).get('ldap_department_code')
            ldap_valid=isinstance(code,str) and bool(code.strip()) and len(code)<=100 and not any(ord(c)<32 or ord(c)==127 for c in code)
            # A missing/invalid observation is not a deletion of previously retained data.
            if ldap_valid:values['ldap_department_code']=code
        else:ldap_valid=True
    api_complete=bool(latest and latest['api_complete_flag']);api_at=latest['api_observed_at'] if latest else None
    if not outcome['error']:
        values.update({k:v for k,v in outcome['values'].items() if k in API_FIELDS})
        if not outcome['missing'] and all(values.get(k) for k in API_FIELDS):api_complete=True;api_at=outcome['started']
    canonical={**values,'ldap_valid_flag':int(ldap_valid),'api_complete_flag':int(api_complete)}
    digest=hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    existing=db.execute(sa.select(m.employee_profile_version).where(m.employee_profile_version.c.profile_id==row['id'],m.employee_profile_version.c.fingerprint==digest)).mappings().first()
    if existing:current=dict(existing)
    else:
        identifier=new_id()
        db.execute(m.employee_profile_version.insert().values(id=identifier,profile_id=row['id'],fingerprint=digest,**canonical,
            observation_source='LOGIN' if from_login else 'API_RETRY',observed_at=now(),api_observed_at=api_at))
        current=version(db,identifier)
        audit(db,None,'employee_profile_version',identifier,'EMPLOYEE_PROFILE_OBSERVED',new={'user_id':user['id'],'profile_id':row['id'],'source':current['observation_source'],'fingerprint':digest,'changed_fields':[c['field'] for c in changes(approved,current)]})
    matching=bool(approved and approved['id']==current['id'])
    if not ldap_valid:status='UNAVAILABLE'
    elif matching:
        status='RECHECK_REQUIRED' if row['status']=='RECHECK_REQUIRED' and not from_login else 'VERIFIED'
        retire(db,row,'OBSOLETE')
    elif not api_complete:status='UNVERIFIED'
    else:
        rejected=db.execute(sa.select(m.employee_profile_review.c.id).where(m.employee_profile_review.c.profile_id==row['id'],m.employee_profile_review.c.version_id==current['id'],m.employee_profile_review.c.previous_version_id==row['approved_version_id'] if row['approved_version_id'] else m.employee_profile_review.c.previous_version_id.is_(None),m.employee_profile_review.c.status=='REJECTED')).first()
        status='REJECTED' if rejected else 'PENDING'
        if row['latest_version_id']!=current['id']:retire(db,row,'SUPERSEDED')
    unavailable=bool(outcome['error'] or outcome['missing'] or not enabled)
    if not ldap_valid:warning='LDAP did not return a valid department code. Approved data is retained; business access remains restricted.'
    elif unavailable and status=='VERIFIED':warning='Employee API details could not be refreshed. You can continue with your approved employee data. Automatic retries continue.'
    elif unavailable and not approved:warning='Employee API details could not be fully refreshed. Complete your work profile while we retry; business access requires complete employee details and administrator approval.'
    elif unavailable:warning='Employee API details could not be refreshed. Approved data is retained; existing approval and access restrictions remain. Automatic retries continue.'
    else:warning=None
    if not enabled:warning='Employee API refresh is disabled. Approved data and existing restrictions are retained. Contact an administrator.'
    if from_login and not row['pf_no'] and enabled:warning='The account cannot be mapped to an employee PF number. Contact an administrator; employee approval remains required.'
    updates=dict(latest_version_id=current['id'],status=status,warning=warning)
    if from_login:updates['ldap_checked_at']=now()
    db.execute(m.employee_profile.update().where(m.employee_profile.c.id==row['id']).values(**updates));row={**row,**updates}
    if status!='VERIFIED' or row['latest_version_id']!=(approved or {}).get('id'):revoke(db,user['id'])
    if status=='PENDING':queue(db,row,current)
    if status!=prior_status or warning!=prior_warning:
        audit(db,None,'employee_profile',row['id'],'EMPLOYEE_PROFILE_ACCESS_CHECKED',new={'status':status,'api_unavailable':unavailable,'approved_version_id':row['approved_version_id'],'latest_version_id':current['id'],'fresh_login':from_login})
    return row


def review_rows(db,user_id=None):
    t=m.employee_profile_review
    query=sa.select(t,m.employee_profile.c.user_id,m.user.c.username,m.user.c.full_name,m.user.c.org_unit_id,m.employee_profile.c.warning,m.employee_profile.c.sync_status,m.organisational_unit.c.name.label('home_organisation')).join(m.employee_profile,t.c.profile_id==m.employee_profile.c.id).join(m.user,m.employee_profile.c.user_id==m.user.c.id).outerjoin(m.organisational_unit,m.user.c.org_unit_id==m.organisational_unit.c.id)
    query=query.where(m.employee_profile.c.user_id==user_id) if user_id else query.where(t.c.status=='PENDING')
    rows=[]
    for r in db.execute(query.order_by(t.c.requested_at.desc())).mappings():
        item=dict(r);observed=version(db,item['version_id']);item['approved']=payload(version(db,item['previous_version_id']));item['current']=payload(observed);item['observed_at']=observed['observed_at'];item['api_observed_at']=observed['api_observed_at'];item['using_cached_api']=item['sync_status']!='SUCCESS';item['changes']=changes(item['approved'],item['current']);rows.append(item)
    return rows


def public_status(db,user):
    row=profile(db,user['id']);approved=version(db,row['approved_version_id']) if row else None;latest=version(db,row['latest_version_id']) if row else None
    state=row['status'] if row else 'UNVERIFIED'
    messages={'VERIFIED':'Your employee profile is approved.','RECHECK_REQUIRED':'Your employee profile was approved. Sign out and sign in again.',
        'PENDING':'Your employee details require administrator approval.','REJECTED':'Your employee profile change was rejected. Existing access restrictions remain.',
        'UNAVAILABLE':'LDAP department details are unavailable. Business access remains restricted.','UNVERIFIED':'Complete employee details are awaited before independent approval.'}
    requests=review_rows(db,user['id'])
    home=db.execute(sa.select(m.organisational_unit.c.name).where(m.organisational_unit.c.id==user.get('org_unit_id'))).scalar_one_or_none() if user.get('org_unit_id') else None
    return {'managed':True,'status':state,'blocked':state!='VERIFIED','message':messages[state],'approved':payload(approved),'current':payload(latest),
        'warning':row['warning'] if row else None,'checked_at':row['last_attempt_at'] if row else None,'home_organisation':home,
        'approved_version_id':row['approved_version_id'] if row else None,'latest_version_id':row['latest_version_id'] if row else None,
        'changes':changes(approved,latest),'can_request':state=='REJECTED' and bool(latest and latest['ldap_valid_flag'] and latest['api_complete_flag']),
        'resubmission_explanation_required':state=='REJECTED','requests':requests}


def request_update(db,user,session,reason):
    user=locked_user(db,user['id'])
    if not user['active_flag']:raise HTTPException(401,'Please sign in again.')
    row=profile(db,user['id'])
    if not row or session.get('employee_version_id')!=row['latest_version_id']:raise HTTPException(409,'Employee details changed after sign-in. Sign out and sign in again.')
    if row['status']!='REJECTED':raise HTTPException(409,'Only a rejected current profile needs a reconsideration request.')
    identifier=queue(db,row,version(db,row['latest_version_id']),reason=reason,automatic=False)
    if not identifier:raise HTTPException(409,'Complete current employee details are required.')
    db.execute(m.employee_profile.update().where(m.employee_profile.c.id==row['id']).values(status='PENDING'))
    return {'id':identifier,'status':'PENDING','message':'Your employee profile is pending independent review.'}


def decide(db,actor,identifier,decision,reason):
    actor.require({'ADMIN'})
    request=db.execute(sa.select(m.employee_profile_review).where(m.employee_profile_review.c.id==identifier)).mappings().first()
    if not request:raise HTTPException(404,'Employee profile review not found.')
    row=db.execute(sa.select(m.employee_profile).where(m.employee_profile.c.id==request['profile_id'])).mappings().one()
    if row['user_id'] in actor.parties:raise HTTPException(403,'An administrator cannot decide their own employee profile.')
    user=locked_user(db,row['user_id']);row=profile(db,user['id'])
    request=db.execute(sa.select(m.employee_profile_review).where(m.employee_profile_review.c.id==identifier).with_for_update()).mappings().one()
    current=version(db,request['version_id'])
    if not user['active_flag'] or request['status']!='PENDING' or row['latest_version_id']!=request['version_id'] or row['approved_version_id']!=request['previous_version_id'] or row['status']!='PENDING':raise HTTPException(409,'This employee profile review is stale. Refresh the latest observation.')
    if not current['ldap_valid_flag'] or not current['api_complete_flag'] or not all(current[k] for k in API_FIELDS) or (user['login_type']=='LDAP' and not current['ldap_department_code']):raise HTTPException(409,'Complete valid employee details are required.')
    if user['needs_email_confirmation_flag'] or user['needs_department_selection_flag']:raise HTTPException(409,'The employee must confirm work email and Home organisation before approval.')
    status='APPROVED' if decision=='APPROVE' else 'REJECTED'
    db.execute(m.employee_profile_review.update().where(m.employee_profile_review.c.id==identifier).values(status=status,decided_by=actor.id,decided_at=now(),decision_reason=reason))
    updates={'status':'RECHECK_REQUIRED' if decision=='APPROVE' else 'REJECTED'}
    if decision=='APPROVE':
        updates['approved_version_id']=request['version_id']
        db.execute(m.user.update().where(m.user.c.id==user['id']).values(full_name=current['employee_name']))
    db.execute(m.employee_profile.update().where(m.employee_profile.c.id==row['id']).values(**updates));revoke(db,user['id'])
    audit(db,actor,'employee_profile_review',identifier,'EMPLOYEE_PROFILE_'+status,new={'user_id':user['id'],'version_id':request['version_id'],'previous_version_id':request['previous_version_id']},reason=reason)
    from .user_access import notify_administrators
    notify_administrators(db,user['id'],'EMPLOYEE_PROFILE_'+status,include_user=True)
    return {'ok':True,'status':status,'message':'Employee profile approved. Fresh sign-in required. Home organisation, roles and scopes remain separately administered.' if decision=='APPROVE' else 'Employee profile rejected. Approved data and existing restrictions are retained.'}
