"""QA-style Standard/LDAP identity routing, opaque cookies and server-side roles."""
from datetime import timedelta, date
import hashlib, hmac, secrets, re
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m
from .access import actor_for
from .security import hash_password, verify_password
from .events import now,new_id,audit
from .directory import authenticate_directory, directory_email
from .user_access import notify_administrators
from . import employee_identity, employee_profiles

COOKIE='cbd_session'
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def key(settings,value): return hmac.new(settings.secret.encode(),value.encode(),hashlib.sha256).hexdigest()

def set_cookie(response,raw,settings):
    response.set_cookie(COOKIE,raw,max_age=settings.max_minutes*60,httponly=True,
        secure=settings.secure_cookie,samesite='lax',path='/')

def establish(db,user,settings,response,request=None):
    raw=secrets.token_urlsafe(48);csrf=secrets.token_urlsafe(32);at=now()
    db.execute(m.app_session.insert().values(id=new_id(),user_id=user['id'],token_hash=digest(raw),
        csrf_token=csrf,expires_at=at+timedelta(minutes=settings.max_minutes),last_seen_at=at,
        employee_version_id=user.get('employee_latest_version_id')))
    set_cookie(response,raw,settings)
    actor = actor_for(db, user['id'])
    if request is not None:
        request.state.audit_actor = actor
    audit(db,actor,'user',user['id'],'LOGIN_SUCCESS',new={'login_type':user['login_type'],
        'employee_profile_status':user.get('employee_profile_status')})
    return {'ok':True}

def resolve(db,request,settings,limited=False):
    raw=request.cookies.get(COOKIE,'');at=now()
    session=db.execute(sa.select(m.app_session).where(m.app_session.c.token_hash==digest(raw),
        m.app_session.c.revoked_flag==0)).mappings().first() if raw else None
    if not session or session['expires_at']<=at or session['last_seen_at']+timedelta(minutes=settings.idle_minutes)<=at:
        raise HTTPException(401,'Your session has ended. Please sign in again.')
    actor=actor_for(db,session['user_id'])
    request.state.audit_actor = actor
    if request.method not in {'GET','HEAD','OPTIONS'} and not hmac.compare_digest(request.headers.get('X-CSRF-Token',''),session['csrf_token']):
        raise HTTPException(403,'The form has expired. Refresh and try again.')
    if not limited and (actor.user['must_change_password_flag'] or actor.user['needs_email_confirmation_flag'] or actor.user['needs_department_selection_flag']):
        raise HTTPException(403,'Complete the first-sign-in steps before opening the workspace.')
    if not limited and employee_identity.blocked(actor.user):
        raise HTTPException(403,{'code':'EMPLOYEE_PROFILE_REVIEW_REQUIRED',
            'message':'Your employee profile requires review. Open the profile review screen or sign in again.'})
    db.execute(m.app_session.update().where(m.app_session.c.id==session['id']).values(last_seen_at=at))
    return actor,dict(session)

def login(db,request,response,payload,settings):
    # A new identity attempt always revokes the presented previous identity.
    raw=request.cookies.get(COOKIE)
    if raw: db.execute(m.app_session.update().where(m.app_session.c.token_hash==digest(raw)).values(revoked_flag=1))
    username=payload.username.strip().lower()
    ident=key(settings,username);addr=key(settings,request.client.host if request.client else 'unknown');at=now()
    recent=m.login_attempt.c.attempted_at>at-timedelta(minutes=15)
    failures=db.execute(sa.select(sa.func.count()).select_from(m.login_attempt).where(recent,m.login_attempt.c.succeeded_flag==0,
        sa.or_(m.login_attempt.c.identity_hash==ident,m.login_attempt.c.address_hash==addr))).scalar_one()
    if failures>=10:
        db.commit();raise HTTPException(429,'Too many sign-in attempts. Wait 15 minutes and try again.')
    user=db.execute(sa.select(m.user).where(sa.func.lower(m.user.c.username)==username)).mappings().first()
    profile=None;authenticated=False
    try:
        if user and user['login_type']=='STANDARD':
            authenticated=verify_password(payload.password,user['password_hash'])
        else:
            profile=authenticate_directory(db,settings,username,payload.password)
            authenticated=bool(profile)
            if authenticated and profile.get('username'):
                canonical=profile['username'].strip().lower()
                if canonical!=username:
                    username=canonical
                    user=db.execute(sa.select(m.user).where(sa.func.lower(m.user.c.username)==canonical)).mappings().first()
                    # A directory alias cannot authenticate or recreate a Standard principal.
                    if user and user['login_type']!='LDAP':authenticated=False
    except HTTPException:
        db.execute(m.login_attempt.insert().values(id=new_id(),identity_hash=ident,address_hash=addr,succeeded_flag=0,attempted_at=at))
        db.commit();raise
    success=authenticated and (not user or bool(user['active_flag']))
    db.execute(m.login_attempt.insert().values(id=new_id(),identity_hash=ident,address_hash=addr,succeeded_flag=int(success),attempted_at=at))
    if not success:
        audit(db,None,'authentication',ident[:36],'LOGIN_FAILED',reason='Authentication rejected')
        db.commit();raise HTTPException(401,'The username or password could not be verified.')
    # Enrichment follows credential verification, before acquiring the user lock.
    # It neither replaces authentication nor changes approved LDAP/access fields.
    employee_lookup=employee_profiles.prepare_login(db,settings,username,profile)
    suggested_email = directory_email((profile or {}).get('email'))
    if not user:
        identifier=new_id()
        db.execute(m.user.insert().values(id=identifier,username=username,full_name=username[:250],
            email=suggested_email,login_type='LDAP',password_hash=None,active_flag=1,must_change_password_flag=0,
            needs_email_confirmation_flag=1,needs_department_selection_flag=1))
        user=db.execute(sa.select(m.user).where(m.user.c.id==identifier)).mappings().one()
        audit(db,None,'user',identifier,'LDAP_ACCOUNT_REQUESTED',new={'username':username,'roles':[]})
        notify_administrators(db,identifier,'LDAP_PROFILE_CONFIRMATION_PENDING')
    user=employee_identity.locked_user(db,user['id'])
    if not user['active_flag']:raise HTTPException(401,'The username or password could not be verified.')
    if suggested_email and user['login_type']=='LDAP' and user['needs_email_confirmation_flag'] and not user['email']:
        db.execute(m.user.update().where(m.user.c.id==user['id']).values(email=suggested_email))
    employee_profiles.complete_login(db,settings,user,employee_lookup,profile)
    user=employee_identity.decorate(db,employee_identity.locked_user(db,user['id']))
    result=establish(db,user,settings,response,request)
    if user.get('employee_profile_required'):
        result['employee_profile']=employee_profiles.public_profile(db,user['id'],settings)
        result['employee_review']=employee_identity.public_status(db,user)
    return result

def change_password(db,actor,payload,session,response,settings):
    if actor.user['login_type']!='STANDARD': 
        raise HTTPException(403,'Change your LDAP password through the bank directory service.')
    if not verify_password(payload.current_password,actor.user['password_hash']): 
        raise HTTPException(400,'Current password is incorrect.')
    password=payload.new_password
    if len(password)<12 or len(password.encode())>72 or not re.search('[A-Z]',password) or not re.search('[a-z]',password) or not re.search('[0-9]',password) or not re.search('[^A-Za-z0-9]',password):
        raise HTTPException(422,'Use 12–72 bytes with upper/lowercase letters, a number and a symbol.')
    if verify_password(password,actor.user['password_hash']): raise HTTPException(422,'Choose a different password.')
    db.execute(m.user.update().where(m.user.c.id==actor.id).values(password_hash=hash_password(password),must_change_password_flag=0))
    db.execute(m.app_session.update().where(m.app_session.c.user_id==actor.id).values(revoked_flag=1))
    audit(db,actor,'user',actor.id,'PASSWORD_CHANGED')
    return establish(db,actor.user,settings,response)
