"""Week 1–3 Oracle portal. Start after Alembic; no startup DDL or seed side effects."""
import csv,io,json,hashlib,re,logging
import ipaddress
import time
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from urllib.parse import urlparse
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError,DatabaseError
from fastapi import FastAPI,Depends,Request,Response,HTTPException,UploadFile,File,Form
from fastapi.responses import FileResponse,JSONResponse
from fastapi.staticfiles import StaticFiles
from .runtime import runtime_settings
from .config import ROOT
from .storage import prepare_storage, stored_path, write_private
from .logging_config import configure_logging, request_id as logging_request_id
from . import models as m,schemas as s,repository as repo,migration_service as migration
from . import authentication as auth
from .login_encryption import load_material, public_login_key, consume_challenge, encrypted_login_credentials
from .access import actor_for,READ_ROLES,REGULATORY_ROLES,DISCUSS_ROLES
from .events import new_id,now,audit
from .security import hash_password
from .directory import (load_directory, public_directory, prepare_directory, save_directory,
                        safe_directory_audit, authenticate_directory)
from .database import create_application_engine
from .demo_access import available_demo_users
from .import_template import csv_template
from .import_workbook import download_workbook
from .user_access import account_catalogue, current_access, notify_administrators
from . import clause_carry,notification_families as families
from . import ldap_department as departments
from . import master_data

logger=logging.getLogger('cbd.portal')


def get_db(request:Request):
    with request.app.state.engine.connect() as db:
        with db.begin(): yield db

def current(request:Request,db=Depends(get_db)):
    actor=auth.resolve(db,request,request.app.state.settings)[0]
    if not actor.roles:raise HTTPException(403,'Your profile is awaiting administrator-approved access.')
    return actor

def limited(request:Request,db=Depends(get_db)):
    return auth.resolve(db,request,request.app.state.settings,limited=True)

def menu(actor):
    common=[('home','Compliance at a Glance'),('tasks','My tasks'),('approvals','My approvals'),('help','Help')]
    if actor.roles & READ_ROLES:common[1:1]=[('repository','Regulatory library'),('notification-families','Notification families'),('clauses','Clauses / Paras')]
    if any(g['role_code'] in {'AUTHOR','REVIEWER'} and g['global_scope_flag'] for g in actor.grants):common.append(('migration','Import existing regulatory records'))
    if 'ADMIN' in actor.roles:common.extend([('masters','Reference masters'),('users','Users and access'),('ldap','LDAP settings')])
    common.extend([('baseline','Release baseline'),('applications','Retained applications')])
    return [{'id':key,'label':label} for key,label in common]

def safe_user(row):
    return {k:v for k,v in dict(row).items() if k not in {'password_hash'}}

def create_app(settings=None,engine=None):
    cfg=settings or runtime_settings()
    configure_logging(cfg)
    try:login_material=load_material(cfg.login_private_key_file)
    except Exception:
        logger.exception('Sign-in key initialization failed');raise
    @asynccontextmanager
    async def lifespan(app):
        configure_logging(cfg)
        try:
            prepare_storage(cfg.storage)
            if app.state.engine is None:app.state.engine=create_application_engine(cfg.database_url)
            logger.info('Application started environment=%s',cfg.environment)
            yield
        except Exception:
            logger.exception('Application lifecycle failed');raise
        finally:
            if engine is None and app.state.engine is not None:app.state.engine.dispose()
            logger.info('Application stopped environment=%s',cfg.environment)
    app=FastAPI(title='Compliance by Design',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    app.state.settings=cfg;app.state.engine=engine
    app.state.login_material=login_material
    app.state.consume_login_challenge=lambda claims:consume_challenge(app.state.engine,claims)

    @app.middleware('http')
    async def security(request,call_next):
        if request.url.path in {'/api/auth/login','/api/auth/login-key'} and request.url.scheme!='https':
            try:local_client=ipaddress.ip_address(request.client.host).is_loopback
            except (ValueError,AttributeError):local_client=False
            local=cfg.environment=='uat' and request.url.hostname in {'localhost','127.0.0.1','::1'} and local_client
            if not local:return JSONResponse({'detail':'Secure sign-in requires HTTPS.'},status_code=426)
        if request.method not in {'GET','HEAD','OPTIONS'}:
            origin=request.headers.get('Origin')
            if origin not in cfg.origins or request.headers.get('Sec-Fetch-Site')=='cross-site':
                return JSONResponse({'detail':'This request must come from the portal.'},status_code=403)
            maximum=(25*1024*1024 if request.url.path in {'/api/documents','/api/migration'} else
                     2*1024*1024 if request.url.path in {'/api/admin/ldap','/api/admin/ldap/test'} else 1024*1024)
            length=request.headers.get('Content-Length')
            try:valid=length is not None and 0<=int(length)<=maximum
            except ValueError:valid=False
            if not valid:return JSONResponse({'detail':'Request size is missing or exceeds the upload limit.'},status_code=413)
        response=await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='same-origin'
        preview_document=request.url.path.startswith('/api/documents/') and request.query_params.get('preview')=='true'
        frame_ancestors="'self'" if preview_document else "'none'"
        response.headers['Content-Security-Policy']=f"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors {frame_ancestors}"
        return response

    @app.middleware('http')
    async def operational_log(request,call_next):
        reference=new_id()
        request.state.request_id=reference
        token=logging_request_id.set(reference);started=time.perf_counter()
        def route_name():
            route=request.scope.get('route')
            return getattr(route,'path','[unmatched]')
        try:
            if cfg.deep_logging:logger.debug('Request started method=%s',request.method)
            try:
                response=await call_next(request)
            except Exception:
                logger.exception('Unhandled request failure method=%s route=%s',request.method,route_name())
                response=JSONResponse({'detail':'An unexpected server error occurred. Contact support with the request reference.',
                    'request_id':reference},status_code=500,headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
            elapsed=(time.perf_counter()-started)*1000
            log=logger.warning if elapsed>=cfg.slow_request_ms or response.status_code>=500 else logger.info
            log('Request completed method=%s route=%s status=%s duration_ms=%.2f',request.method,route_name(),response.status_code,elapsed)
            response.headers['X-Request-ID']=reference
            return response
        finally:
            logging_request_id.reset(token)

    @app.exception_handler(DatabaseError)
    async def db_error(request,exc):
        reference=request.state.request_id;logger.error('Database request rejected type=%s',type(exc).__name__,exc_info=True)
        return JSONResponse({'detail':'The change could not be saved. It may conflict with a protected record or a concurrent update. Refresh and try again. Reference '+reference},status_code=409 if isinstance(exc,IntegrityError) else 503)

    @app.get('/api/health')
    def health():return {'status':'ok','environment':cfg.environment,'release':'Weeks 1–3'}

    def require_demo_login():
        if cfg.environment != 'uat' or not cfg.demo_login_enabled:
            raise HTTPException(404, 'Demo sign-in is unavailable.')

    @app.get('/api/auth/demo-users', dependencies=[Depends(require_demo_login)])
    def demo_users(db=Depends(get_db)):
        return {'users': available_demo_users(db), 'ldap_demo': {
            'enabled': cfg.ldap_mock_enabled, 'username': cfg.ldap_mock_username_prefix+'01'
            if cfg.ldap_mock_enabled else '', 'prefix': cfg.ldap_mock_username_prefix if cfg.ldap_mock_enabled else ''}}

    @app.get('/api/auth/login-key')
    def login_key():return public_login_key(app.state.login_material,cfg.secret)

    @app.post('/api/auth/login')
    def login(request:Request,response:Response,payload=Depends(encrypted_login_credentials),db=Depends(get_db)):
        return auth.login(db,request,response,payload,cfg)

    @app.get('/api/auth/me')
    def me(identity=Depends(limited)):
        actor,session=identity
        result={'user':safe_user(actor.user),'roles':sorted(actor.roles),'grants':actor.grants,
            'csrf_token':session['csrf_token'],'menu':[] if departments.blocked(actor.user) else menu(actor),'environment':cfg.environment}
        return result

    @app.get('/api/auth/department')
    def department_status(db=Depends(get_db),identity=Depends(limited)):
        actor,_=identity
        if actor.user['login_type']!='LDAP':raise HTTPException(403,'This account does not use LDAP.')
        return departments.public_status(db,actor.user)

    @app.post('/api/auth/department/request')
    def department_request(payload:s.DepartmentRequest,db=Depends(get_db),identity=Depends(limited)):
        actor,session=identity
        return departments.request_update(db,actor,session,payload.reason)

    @app.post('/api/auth/logout')
    def logout(request:Request,response:Response,db=Depends(get_db)):
        raw=request.cookies.get(auth.COOKIE,'')
        if raw:
            try:actor,session=auth.resolve(db,request,cfg,limited=True)
            except HTTPException as exc:
                if exc.status_code!=401:raise
            else:
                db.execute(m.app_session.update().where(m.app_session.c.id==session['id']).values(revoked_flag=1))
                audit(db,actor,'user',actor.id,'LOGOUT')
        response.delete_cookie(auth.COOKIE,path='/');return {'ok':True}

    @app.post('/api/auth/password')
    def password(payload:s.Password,response:Response,db=Depends(get_db),identity=Depends(limited)):
        actor,session=identity;return auth.change_password(db,actor,payload,session,response,cfg)

    @app.get('/api/auth/departments')
    def onboarding_departments(db=Depends(get_db),identity=Depends(limited)):
        if not departments.can_onboard(identity[0].user):raise HTTPException(403,'Verify your LDAP department before confirming your work profile.')
        return [dict(r) for r in db.execute(sa.select(m.organisational_unit).where(m.organisational_unit.c.active_flag==1,m.organisational_unit.c.unit_type=='DEPARTMENT').order_by(m.organisational_unit.c.name)).mappings()]

    @app.post('/api/auth/onboarding')
    def onboard(payload:s.Onboard,db=Depends(get_db),identity=Depends(limited)):
        actor,_=identity
        if not departments.can_onboard(actor.user):raise HTTPException(403,'Verify your LDAP department before confirming your work profile.')
        if actor.user['login_type']!='LDAP' or not (actor.user['needs_email_confirmation_flag'] or actor.user['needs_department_selection_flag']):raise HTTPException(403,'Profile onboarding is already complete. Contact an administrator for access changes.')
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',payload.email):raise HTTPException(422,'Enter a valid work email address.')
        unit=repo.active(db,m.organisational_unit,payload.org_unit_id)
        if unit['unit_type']!='DEPARTMENT':raise HTTPException(422,'Select a department.')
        db.execute(m.user.update().where(m.user.c.id==actor.id).values(email=payload.email,org_unit_id=unit['id'],needs_email_confirmation_flag=0,needs_department_selection_flag=0))
        audit(db,actor,'user',actor.id,'LDAP_ACCESS_REQUESTED',new={'email':payload.email,'department':unit['code'],'roles':[]})
        access=current_access(db,actor.id)
        if actor.user['ldap_department_status']=='UNVERIFIED':
            departments.request_update(db,actor,identity[1],'Initial LDAP department verification after profile confirmation.')
        notify_administrators(db,actor.id,'ACCESS_APPROVAL_REQUIRED' if access['admin_action_required'] else 'LDAP_PROFILE_CONFIRMED')
        return {'ok':True,'message':'Profile confirmed. '+access['access_message']}

    @app.get('/api/masters')
    def masters(db=Depends(get_db),actor=Depends(current)):
        result={}
        for name in ['organisational_unit','regulator','regulatory_domain','instrument_type','confidentiality_class','frequency','evidence_type','obligation_category','role','process','taxonomy_scheme']:
            table=getattr(m,name);result[name]=[dict(r) for r in db.execute(sa.select(table)).mappings()]
        users=db.execute(sa.select(m.user.c.id,m.user.c.username,m.user.c.full_name,m.user.c.org_unit_id).where(m.user.c.active_flag==1)).mappings().all()
        result['user']=[dict(u) for u in users]
        return result

    @app.get('/api/masters/catalogue')
    def master_catalogue(actor=Depends(current)):
        actor.require({'ADMIN'})
        return master_data.catalogue()

    @app.post('/api/admin/masters/{key}')
    def create_master(key:str,payload:master_data.MasterChange,db=Depends(get_db),actor=Depends(current)):
        return master_data.save(db,actor,key,payload)

    @app.patch('/api/admin/masters/{key}/{identifier}')
    def edit_master(key:str,identifier:str,payload:master_data.MasterChange,db=Depends(get_db),actor=Depends(current)):
        return master_data.save(db,actor,key,payload,identifier)

    @app.get('/api/assignees')
    def assignees(role:str,unit_id:str,exclude:str='',db=Depends(get_db),actor=Depends(current)):
        if role not in {'AUTHOR','REVIEWER','APPROVER'}:raise HTTPException(422,'Choose a regulatory workflow role.')
        actor.require(REGULATORY_ROLES,unit_id)
        omitted=set(exclude.split(','));result=[]
        for row in db.execute(sa.select(m.user).where(m.user.c.active_flag==1)).mappings():
            if row['id'] in omitted:continue
            candidate=actor_for(db,row['id'])
            if candidate.covers(unit_id,{role}) and not row['needs_email_confirmation_flag'] and not row['needs_department_selection_flag']:
                result.append({'id':row['id'],'full_name':row['full_name'],'username':row['username']})
        return result

    @app.patch('/api/masters/domains/{identifier}')
    def update_domain(identifier:str,payload:s.DomainInput,db=Depends(get_db),actor=Depends(current)):
        master_data.save(db,actor,'regulatory_domain',master_data.MasterChange(values=payload.model_dump(),
            reason='Administrator records bank-approved domain ownership and review readiness.'),identifier)
        return {'ok':True}

    @app.get('/api/admin/users')
    def users(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        return account_catalogue(db)

    @app.get('/api/admin/access-summary')
    def access_summary(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'});return account_catalogue(db)['summary']

    @app.get('/api/admin/ldap-department-requests')
    def department_requests(user_id:str|None=None,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        query=sa.select(m.ldap_department_request,m.user.c.username,m.user.c.full_name,
            m.user.c.org_unit_id,m.organisational_unit.c.name.label('home_organisation')).join(m.user,
            m.ldap_department_request.c.user_id==m.user.c.id).outerjoin(m.organisational_unit,
            m.user.c.org_unit_id==m.organisational_unit.c.id)
        query=query.where(m.ldap_department_request.c.user_id==user_id) if user_id else query.where(m.ldap_department_request.c.status=='PENDING')
        return [dict(row) for row in db.execute(query.order_by(m.ldap_department_request.c.requested_at.desc())).mappings()]

    @app.post('/api/admin/ldap-department-requests/{identifier}/decision')
    def department_decision(identifier:str,payload:s.DepartmentDecision,db=Depends(get_db),actor=Depends(current)):
        return departments.decide(db,actor,identifier,payload.decision,payload.reason)

    def save_user(db,actor,payload,identifier=None):
        actor.require({'ADMIN'});values=payload.model_dump(exclude={'roles','password'});values['username']=values['username'].lower()
        if values['org_unit_id']:repo.active(db,m.organisational_unit,values['org_unit_id'])
        if payload.email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',payload.email):raise HTTPException(422,'Enter a valid email address.')
        if identifier==actor.id:raise HTTPException(403,'Use another authorised administrator to change your own access.')
        old=repo.one(db,m.user,identifier,lock=True) if identifier else None
        if old and (old['username']!=values['username'] or old['login_type']!=values['login_type']):raise HTTPException(422,'Username and login type are fixed. Create a separate identity for a changed authentication method.')
        if not old and db.execute(sa.select(m.user.c.id).where(sa.func.lower(m.user.c.username)==values['username'])).first():raise HTTPException(409,'This username already exists.')
        assignments=[];seen=set()
        for item in payload.roles:
            role=repo.active(db,m.role,item.role_id)
            if item.global_scope_flag:
                if item.scope_org_unit_id:raise HTTPException(422,'Global roles must not also specify a department.')
            elif not item.scope_org_unit_id:raise HTTPException(422,'Select the role scope department.')
            else:repo.active(db,m.organisational_unit,item.scope_org_unit_id)
            if role['code'] in {'BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','ZONE_VIEWER'} and item.global_scope_flag:raise HTTPException(422,'Owner and Zone Viewer roles require an explicit organisational scope.')
            signature=(item.role_id,item.scope_org_unit_id,item.global_scope_flag)
            if signature in seen:raise HTTPException(422,'Remove duplicate role assignments.')
            seen.add(signature);assignments.append(item.model_dump())
        if old and not values['active_flag']:
            # Refuse disabling the last active administrator.
            others=db.execute(sa.select(m.user.c.id).join(m.user_role,m.user_role.c.user_id==m.user.c.id).join(m.role,m.role.c.id==m.user_role.c.role_id)
                .where(m.user.c.id!=identifier,m.user.c.active_flag==1,m.role.c.code=='ADMIN',m.role.c.active_flag==1,m.user_role.c.effective_from<=date.today(),sa.or_(m.user_role.c.effective_to.is_(None),m.user_role.c.effective_to>date.today()))).first()
            if not others:raise HTTPException(409,'Keep at least one active administrator.')
        identifier=identifier or new_id()
        if not old:
            if payload.login_type=='STANDARD':
                if not payload.password or len(payload.password)<12 or len(payload.password.encode())>72:raise HTTPException(422,'Provide a temporary password of 12–72 UTF-8 bytes.')
                values.update(password_hash=hash_password(payload.password),must_change_password_flag=1)
            else:values.update(password_hash=None,must_change_password_flag=0,needs_email_confirmation_flag=1,needs_department_selection_flag=1)
            db.execute(m.user.insert().values(id=identifier,**values))
        else:
            if payload.password:
                if old['login_type']!='STANDARD' or len(payload.password)<12 or len(payload.password.encode())>72:raise HTTPException(422,'Only Standard accounts can receive a temporary 12–72 byte password.')
                values.update(password_hash=hash_password(payload.password),must_change_password_flag=1)
            db.execute(m.user.update().where(m.user.c.id==identifier).values(**values))
            db.execute(m.user_role.update().where(m.user_role.c.user_id==identifier,sa.or_(m.user_role.c.effective_to.is_(None),m.user_role.c.effective_to>date.today())).values(effective_to=date.today()))
            db.execute(m.app_session.update().where(m.app_session.c.user_id==identifier).values(revoked_flag=1))
        for assignment in assignments:db.execute(m.user_role.insert().values(id=new_id(),user_id=identifier,effective_from=date.today(),**assignment))
        audit(db,actor,'user',identifier,'ACCESS_UPDATED' if old else 'ACCOUNT_CREATED',new={**{k:v for k,v in values.items() if k!='password_hash'},'roles':assignments})
        access=current_access(db,identifier)
        kind=('ACCESS_APPROVAL_REQUIRED' if access['admin_action_required'] else
              'ACCESS_ROLES_ASSIGNED' if access['effective_role_count'] else 'USER_ACCESS_UPDATED')
        notify_administrators(db,identifier,kind,include_user=True)
        return {'id':identifier,**access,'message':'Account access saved. '+access['access_message']}

    @app.post('/api/admin/users')
    def create_user(payload:s.UserInput,db=Depends(get_db),actor=Depends(current)):return save_user(db,actor,payload)
    @app.put('/api/admin/users/{identifier}')
    def edit_user(identifier:str,payload:s.UserInput,db=Depends(get_db),actor=Depends(current)):return save_user(db,actor,payload,identifier)

    @app.get('/api/admin/ldap')
    def get_ldap(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        return {**public_directory(load_directory(db,cfg)), 'demo': {
            'enabled': cfg.environment=='uat' and cfg.ldap_mock_enabled,
            'prefix': cfg.ldap_mock_username_prefix if cfg.environment=='uat' and cfg.ldap_mock_enabled else ''}}
    @app.put('/api/admin/ldap')
    def put_ldap(payload:s.DirectoryInput,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'});previous=load_directory(db,cfg)
        saved=save_directory(db,cfg,prepare_directory(payload.model_dump(),previous))
        audit(db,actor,'system','LDAP','LDAP_CONFIGURED',new=safe_directory_audit(saved))
        return {'ok':True}

    @app.post('/api/admin/ldap/test')
    def test_ldap(payload:s.DirectoryTest,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        candidate=prepare_directory(payload.model_dump(exclude={'test_username','test_password'}),load_directory(db,cfg))
        if not candidate['enabled']:raise HTTPException(422,'Enable LDAP before testing the directory connection.')
        try:
            # A real connection test must never be satisfied by the UAT mock.
            profile=authenticate_directory(db,cfg,payload.test_username.strip().lower(),payload.test_password,
                                           config_override=candidate,allow_mock=False)
        except HTTPException as exc:
            detail=exc.detail if isinstance(exc.detail,dict) else {}
            audit(db,actor,'system','LDAP','LDAP_TESTED',new={'ok':False,'code':detail.get('code','LDAP_UNAVAILABLE')})
            db.commit();raise
        audit(db,actor,'system','LDAP','LDAP_TESTED',new={'ok':bool(profile)})
        if not profile:
            db.commit();raise HTTPException(400,'The directory rejected the test username or password.')
        return {'ok':True,'message':'LDAP connection and test-user authentication succeeded. Configuration has not been saved.'}

    @app.post('/api/documents')
    async def upload(request:Request,file:UploadFile=File(...),owner_unit_id:str=Form(...),confidentiality_class_id:str=Form(...),db=Depends(get_db),actor=Depends(current)):
        actor.require({'AUTHOR'},owner_unit_id);repo.active(db,m.organisational_unit,owner_unit_id);repo.active(db,m.confidentiality_class,confidentiality_class_id)
        data=await file.read(20*1024*1024+1)
        if not data or len(data)>20*1024*1024:raise HTTPException(422,'Choose a non-empty source file up to 20 MB.')
        name=Path(file.filename or 'source').name[:255];extension=Path(name).suffix.lower()
        types={'.pdf':'application/pdf','.txt':'text/plain','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
        if extension not in types or (extension=='.pdf' and not data.startswith(b'%PDF-')) or (extension=='.docx' and not data.startswith(b'PK')):raise HTTPException(422,'Upload a PDF, text or DOCX source file.')
        if extension=='.txt':
            try:data.decode('utf-8')
            except UnicodeError:raise HTTPException(422,'Text sources must use UTF-8.')
        identifier=new_id();path=stored_path(cfg.storage,identifier)
        write_private(path,data)
        db.execute(m.document.insert().values(id=identifier,file_name=name,storage_uri='portal://'+identifier,content_type=types[extension],file_size=len(data),file_hash=hashlib.sha256(data).hexdigest(),confidentiality_class_id=confidentiality_class_id,owner_unit_id=owner_unit_id,uploaded_by=actor.id,uploaded_at=now()))
        audit(db,actor,'document',identifier,'SOURCE_UPLOADED',new={'name':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
        return {'id':identifier,'file_name':name}

    @app.get('/api/documents/{identifier}')
    def download(identifier:str,preview:bool=False,db=Depends(get_db),actor=Depends(current)):
        document=repo.one(db,m.document,identifier)
        linked=db.execute(sa.select(m.regulatory_instrument.c.id).outerjoin(m.instrument_version,m.instrument_version.c.instrument_id==m.regulatory_instrument.c.id).where(sa.or_(m.regulatory_instrument.c.source_document_id==identifier,m.instrument_version.c.source_document_id==identifier))).scalars().all()
        permitted=False
        for instrument in linked:
            try:repo.read_instrument(db,actor,instrument);permitted=True;break
            except HTTPException:continue
        if not permitted and not (document['uploaded_by']==actor.id and actor.covers(document['owner_unit_id'],{'AUTHOR'})):
            raise HTTPException(404,'Document not found in your authorised area.')
        if document['storage_uri']!='portal://'+identifier or not re.fullmatch('[a-f0-9-]{32,36}',identifier):raise HTTPException(404,'This source is held in a separate approved repository.')
        path=stored_path(cfg.storage,identifier)
        if not path.is_file():raise HTTPException(404,'The source file is unavailable. Contact the repository administrator.')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=document['file_hash']:raise HTTPException(409,'The source integrity check failed. Contact the repository administrator.')
        audit(db,actor,'document',identifier,'SOURCE_PREVIEWED' if preview else 'SOURCE_DOWNLOADED')
        return FileResponse(path,filename=document['file_name'],media_type=document['content_type'],content_disposition_type='inline' if preview else 'attachment')

    @app.get('/api/instruments')
    def instruments(request:Request,db=Depends(get_db),actor=Depends(current)):
        return repo.listing(db,actor,dict(request.query_params))
    @app.get('/api/notification-families')
    def family_register(as_of:date|None=None,q:str='',db=Depends(get_db),actor=Depends(current)):
        return families.view(db,actor,when=as_of,search=q)
    @app.get('/api/notification-families/{identifier}')
    def family_detail(identifier:str,as_of:date|None=None,db=Depends(get_db),actor=Depends(current)):
        return families.view(db,actor,identifier,as_of)
    @app.post('/api/notification-families/{identifier}/links')
    def family_link(identifier:str,payload:s.FamilyLinkInput,db=Depends(get_db),actor=Depends(current)):
        return families.propose_link(db,actor,identifier,payload)
    @app.post('/api/notification-families/{identifier}/amendments')
    def family_amendment(identifier:str,payload:s.FamilyAmendmentInput,db=Depends(get_db),actor=Depends(current)):
        parent=repo.read_instrument(db,actor,identifier);actor.require({'AUTHOR'},parent['regulatory_owner_unit_id'])
        if payload.instrument.regulator_id!=parent['regulator_id']:raise HTTPException(422,'An amendment must use the original notification’s regulator.')
        result=repo.create_instrument(db,actor,payload.instrument)
        proposal=families.propose_link(db,actor,identifier,s.FamilyLinkInput(child_id=result['id'],**payload.model_dump(exclude={'instrument'})))
        return {**result,'family_link_id':proposal['id'],'family_parent_id':identifier}
    @app.post('/api/notification-families/{identifier}/deadlines')
    def family_deadline(identifier:str,payload:s.FamilyDeadlineInput,db=Depends(get_db),actor=Depends(current)):
        return families.propose_deadline(db,actor,identifier,payload)
    @app.post('/api/notification-families/{identifier}/scopes')
    def family_scope(identifier:str,payload:s.FamilyScopeInput,db=Depends(get_db),actor=Depends(current)):
        return families.register_scope(db,actor,identifier,payload)
    @app.get('/api/notification-families/{identifier}/owners')
    def family_owners(identifier:str,unit_id:str,db=Depends(get_db),actor=Depends(current)):
        instrument=repo.read_instrument(db,actor,identifier);actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
        repo.active(db,m.organisational_unit,unit_id);result=[]
        for user in db.execute(sa.select(m.user).where(m.user.c.active_flag==1)).mappings():
            candidate=actor_for(db,user['id'])
            if candidate.covers(unit_id,{'BUSINESS_OWNER'}) and not user['needs_email_confirmation_flag'] and not user['needs_department_selection_flag']:
                result.append({'id':user['id'],'full_name':user['full_name']})
        return result
    @app.post('/api/notification-scopes/{identifier}/assessments')
    def family_assessment(identifier:str,payload:s.FamilyAssessmentInput,db=Depends(get_db),actor=Depends(current)):
        return families.propose_assessment(db,actor,identifier,payload)
    @app.get('/api/notification-scopes/{identifier}/assignees')
    def assessment_assignees(identifier:str,role:str,db=Depends(get_db),actor=Depends(current)):
        scope=repo.one(db,m.notification_scope,identifier);instrument=repo.read_instrument(db,actor,scope['instrument_id'])
        actor.require({'BUSINESS_OWNER'},scope['org_unit_id'])
        if scope['owner_user_id']!=actor.id:raise HTTPException(403,'Only the named implementation owner can select assessment recipients.')
        if role not in {'REVIEWER','APPROVER'}:raise HTTPException(422,'Choose Reviewer or Approver.')
        result=[]
        for user in db.execute(sa.select(m.user).where(m.user.c.active_flag==1,m.user.c.id!=actor.id)).mappings():
            candidate=actor_for(db,user['id'])
            if candidate.covers(instrument['regulatory_owner_unit_id'],{role}) and not user['needs_email_confirmation_flag'] and not user['needs_department_selection_flag']:
                result.append({'id':user['id'],'full_name':user['full_name']})
        return result
    @app.post('/api/family-proposals/{kind}/{identifier}/decision')
    def family_decision(kind:str,identifier:str,payload:s.Decision,db=Depends(get_db),actor=Depends(current)):
        return families.decide(db,actor,kind,identifier,payload)
    @app.get('/api/clauses/{identifier}/related-candidates')
    def related_candidates(identifier:str,db=Depends(get_db),actor=Depends(current)):
        clause=repo.one(db,m.regulatory_clause,identifier);version,instrument=repo.read_version(db,actor,clause['instrument_version_id'])
        actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
        parents=families.parent_map(families.link_rows(db));root=families.family_key(instrument['id'],parents)
        return [row for row in repo.clause_listing(db,actor) if row['id']!=identifier and row['approval_status']=='APPROVED' and row['version_approval_status']=='APPROVED' and families.family_key(row['instrument_id'],parents)==root]
    @app.post('/api/clauses/{identifier}/relationships')
    def clause_relation(identifier:str,payload:s.ClauseRelationInput,db=Depends(get_db),actor=Depends(current)):
        return families.propose_clause_relation(db,actor,identifier,payload)
    @app.get('/api/clauses')
    def clauses(db=Depends(get_db),actor=Depends(current)):
        return repo.clause_listing(db,actor)
    @app.get('/api/source-editions')
    def source_editions(db=Depends(get_db),actor=Depends(current)):
        return repo.source_edition_listing(db,actor)
    @app.post('/api/instruments')
    def register(payload:s.InstrumentInput,db=Depends(get_db),actor=Depends(current)):return repo.create_instrument(db,actor,payload)
    @app.put('/api/instruments/{identifier}')
    def edit_instrument(identifier:str,payload:s.InstrumentInput,db=Depends(get_db),actor=Depends(current)):return repo.edit_instrument(db,actor,identifier,payload)
    @app.get('/api/instruments/{identifier}')
    def instrument(identifier:str,db=Depends(get_db),actor=Depends(current)):return repo.detail(db,actor,identifier)
    @app.post('/api/instruments/{identifier}/metadata-corrections')
    def metadata_correction(identifier:str,payload:s.MetadataCorrectionInput,db=Depends(get_db),actor=Depends(current)):
        return repo.request_metadata_correction(db,actor,identifier,payload)
    @app.post('/api/metadata-corrections/{identifier}/decision')
    def decide_metadata_correction(identifier:str,payload:s.Decision,db=Depends(get_db),actor=Depends(current)):
        return repo.decide_metadata_correction(db,actor,identifier,payload)
    @app.post('/api/instruments/{identifier}/versions')
    def version(identifier:str,payload:s.VersionInput,db=Depends(get_db),actor=Depends(current)):return repo.add_version(db,actor,identifier,payload)
    @app.put('/api/versions/{identifier}')
    def edit_version(identifier:str,payload:s.VersionInput,db=Depends(get_db),actor=Depends(current)):
        return repo.edit_version(db,actor,identifier,payload)
    @app.post('/api/versions/{identifier}/cancel')
    def cancel_draft(identifier:str,payload:s.CancelDraftInput,db=Depends(get_db),actor=Depends(current)):
        return repo.cancel_draft(db,actor,identifier,payload)
    @app.post('/api/versions/{identifier}/clauses')
    def clause(identifier:str,payload:s.ClauseInput,db=Depends(get_db),actor=Depends(current)):return repo.add_clause(db,actor,identifier,payload)
    @app.get('/api/versions/{identifier}/carry-candidates')
    def carry_candidates(identifier:str,db=Depends(get_db),actor=Depends(current)):
        return clause_carry.candidates(db,actor,identifier)
    @app.post('/api/versions/{identifier}/carry-clauses')
    def carry_clauses(identifier:str,payload:s.CarryClauseInput,db=Depends(get_db),actor=Depends(current)):
        return clause_carry.carry(db,actor,identifier,payload)
    @app.put('/api/versions/{identifier}/clauses/{clause_id}')
    def edit_clause(identifier:str,clause_id:str,payload:s.ClauseInput,db=Depends(get_db),actor=Depends(current)):return repo.add_clause(db,actor,identifier,payload,clause_id)
    @app.post('/api/versions/{identifier}/submit')
    def submit(identifier:str,payload:s.Submit,db=Depends(get_db),actor=Depends(current)):return repo.submit(db,actor,identifier,payload)
    @app.post('/api/versions/{identifier}/decision')
    def decide(identifier:str,payload:s.Decision,db=Depends(get_db),actor=Depends(current)):return repo.decide(db,actor,identifier,payload)
    @app.post('/api/versions/{identifier}/activate')
    def activate(identifier:str,db=Depends(get_db),actor=Depends(current)):return repo.activate(db,actor,identifier)
    @app.post('/api/instruments/{identifier}/comments')
    def comment(identifier:str,payload:s.CommentInput,db=Depends(get_db),actor=Depends(current)):
        row=repo.read_instrument(db,actor,identifier)
        actor.require(DISCUSS_ROLES,row['regulatory_owner_unit_id'])
        comment_id=new_id()
        db.execute(m.comment.insert().values(id=comment_id,entity_type='instrument',entity_id=identifier,comment_type='DISCUSSION',comment_text=payload.text,created_by=actor.id,confidentiality_class_id=row['confidentiality_class_id']))
        audit(db,actor,'instrument',identifier,'COMMENT_ADDED',new={'comment_id':comment_id});return {'id':comment_id}

    @app.get('/api/tasks')
    def tasks(db=Depends(get_db),actor=Depends(current)):
        visible={r['id']:r for r in repo.listing(db,actor,{})};result=[]
        for v in db.execute(sa.select(m.instrument_version).where(m.instrument_version.c.created_by==actor.id,m.instrument_version.c.approval_status=='DRAFT')).mappings():
            instrument=visible.get(v['instrument_id'])
            if instrument and actor.covers(instrument['regulatory_owner_unit_id'],{'AUTHOR'}):
                result.append({'kind':'DRAFT','instrument_id':v['instrument_id'],'version_id':v['id'],'title':'Complete version '+repo.source_version_label(v['version_number']),'due_at':None})
        for task in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.entity_id,m.workflow_instance.c.current_stage).join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id).where(m.workflow_instance.c.entity_type=='version',m.workflow_action.c.assignee_user_id==actor.id,m.workflow_action.c.decision.is_(None),m.workflow_instance.c.record_status=='OPEN',m.workflow_action.c.stage==m.workflow_instance.c.current_stage)).mappings():
            v=repo.one(db,m.instrument_version,task['entity_id']);instrument=visible.get(v['instrument_id'])
            role='REVIEWER' if task['stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
            valid_stage=v['approval_status']==('IN_REVIEW' if role=='REVIEWER' else 'REVIEWED')
            independent=actor.id!=v['created_by'] and (role!='APPROVER' or v['reviewed_by'] and actor.id!=v['reviewed_by'])
            if instrument and valid_stage and independent and actor.covers(instrument['regulatory_owner_unit_id'],{role}):
                result.append({**dict(task),'kind':'DECISION','instrument_id':v['instrument_id'],'version_id':v['id'],'title':task['stage'].replace('_',' ').title()})
        for task in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.entity_id,m.workflow_instance.c.current_stage)
            .join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id)
            .where(m.workflow_instance.c.entity_type=='metadata_correction',m.workflow_action.c.assignee_user_id==actor.id,
                m.workflow_action.c.decision.is_(None),m.workflow_instance.c.record_status=='OPEN',
                m.workflow_action.c.stage==m.workflow_instance.c.current_stage)).mappings():
            correction=repo.one(db,m.metadata_correction,task['entity_id'])
            instrument=visible.get(correction['instrument_id'])
            role='REVIEWER' if task['stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
            valid_stage=correction['correction_status']==('IN_REVIEW' if role=='REVIEWER' else 'REVIEWED')
            independent=actor.id!=correction['created_by'] and (role!='APPROVER' or correction['reviewed_by'] and actor.id!=correction['reviewed_by'])
            if instrument and valid_stage and independent and actor.covers(instrument['regulatory_owner_unit_id'],{role}):
                result.append({**dict(task),'kind':'DECISION','workflow_kind':'METADATA_CORRECTION',
                    'correction_id':correction['id'],'instrument_id':correction['instrument_id'],
                    'title':'Metadata correction · '+task['stage'].replace('_',' ').title()})
        result.extend(families.proposal_tasks(db,actor))
        return result

    @app.get('/api/notifications')
    def notifications(db=Depends(get_db),actor=Depends(current)):
        result=[]
        for row in db.execute(sa.select(m.notification).where(m.notification.c.recipient_user_id==actor.id).order_by(m.notification.c.triggered_at.desc())).mappings():
            item=dict(row)
            if item['entity_type']=='version':
                try:version,instrument=repo.read_version(db,actor,item['entity_id'])
                except HTTPException:pass
                else:item.update(instrument_id=instrument['id'],source_title=instrument['title'],version_number=version['version_number'])
            elif item['entity_type']=='metadata_correction':
                try:
                    correction=repo.one(db,m.metadata_correction,item['entity_id'])
                    instrument=repo.read_instrument(db,actor,correction['instrument_id'])
                except HTTPException:pass
                else:item.update(instrument_id=instrument['id'],source_title=instrument['title'])
            elif item['entity_type'].startswith('family_'):
                kind=item['entity_type'][7:]
                if kind not in families.KINDS:continue
                try:
                    proposal=repo.one(db,families.KINDS[kind],item['entity_id'])
                    instrument,_=families.proposal_context(db,actor,kind,proposal)
                except HTTPException:continue
                item.update(source_title=instrument['title'],action_path='notification-families/'+instrument['id']+'?proposal='+item['entity_id'],action_label='Open notification decision')
            elif item['entity_type']=='user':
                if 'ADMIN' not in actor.roles and item['entity_id']!=actor.id:continue
                target=repo.one(db,m.user,item['entity_id']);access=current_access(db,target['id'])
                item.update(source_title=target['full_name']+' · '+target['username'],
                    message=access['access_message'],access_status_label=access['access_status_label'],
                    action_path=('users?tab='+target['login_type']+'&user='+target['id']) if 'ADMIN' in actor.roles else 'home',
                    action_label='Review user access' if 'ADMIN' in actor.roles else 'Open workspace')
            result.append(item)
        return result
    @app.post('/api/notifications/{identifier}/read')
    def read_notification(identifier:str,db=Depends(get_db),actor=Depends(current)):
        db.execute(m.notification.update().where(m.notification.c.id==identifier,m.notification.c.recipient_user_id==actor.id).values(read_at=now()));return {'ok':True}

    @app.post('/api/migration')
    async def stage_source(file:UploadFile=File(...),source_system:str=Form(...),db=Depends(get_db),actor=Depends(current)):
        if not source_system.strip() or len(source_system)>100:raise HTTPException(422,'Enter a source system name up to 100 characters.')
        data=await file.read(20*1024*1024+1)
        if len(data)>20*1024*1024:raise HTTPException(422,'The source register must be at most 20 MB.')
        return migration.stage(db,actor,Path(file.filename or '').name[:500],data,source_system,cfg.storage)
    @app.get('/api/migration')
    def batches(db=Depends(get_db),actor=Depends(current)):
        migration.require_migration(actor)
        return [dict(r) for r in db.execute(sa.select(m.migration_batch).order_by(m.migration_batch.c.uploaded_at.desc())).mappings()]
    @app.get('/api/migration/{identifier}')
    def batch(identifier:str,db=Depends(get_db),actor=Depends(current)):return migration.batch_detail(db,actor,identifier)
    @app.get('/api/migration/{identifier}/report.csv')
    def migration_report(identifier:str,db=Depends(get_db),actor=Depends(current)):
        data=migration.batch_detail(db,actor,identifier);stream=io.StringIO();writer=csv.writer(stream)
        writer.writerow(['Source file','Sheet','Row','Source system','Readiness','Findings','Canonical mapped values','Target type','Target ID'])
        def cell(value):
            text=str(value or '')
            return "'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text
        for row in data['rows']:
            writer.writerow([cell(v) for v in [data['batch']['source_file'],row['sheet_name'],row['row_number'],row['source_system'],row['validation_status'],
                '; '.join(row['profile'].get('errors',[])),json.dumps(row['profile'].get('normalised',{})),row['target_entity_type'],row['target_entity_id']]])
        audit(db,actor,'migration',identifier,'PROFILE_REPORT_EXPORTED')
        return Response(stream.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="migration-profile.csv"'})
    @app.post('/api/migration/{identifier}/validate')
    def validate(identifier:str,db=Depends(get_db),actor=Depends(current)):return migration.validate_content(db,actor,identifier)
    @app.post('/api/migration/{identifier}/load')
    def load(identifier:str,db=Depends(get_db),actor=Depends(current)):return migration.load_batch(db,actor,identifier)
    @app.get('/api/migration-template')
    def template(format:str='csv',db=Depends(get_db),actor=Depends(current)):
        migration.require_migration(actor)
        headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Expires':'0'}
        if format=='xlsx':
            return Response(download_workbook(db,actor),
                media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                headers={**headers,'Content-Disposition':'attachment; filename="instrument-import-template.xlsx"'})
        if format!='csv':raise HTTPException(422,'Choose the Excel or CSV template.')
        return Response(csv_template(),media_type='text/csv',headers={**headers,'Content-Disposition':'attachment; filename="instrument-import-template.csv"'})

    @app.get('/api/applications')
    def applications(db=Depends(get_db),actor=Depends(current)):
        return [dict(r) for r in db.execute(sa.select(m.application_link)).mappings()]
    @app.patch('/api/applications/{identifier}')
    def update_application(identifier:str,payload:s.LinkInput,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'});old=repo.one(db,m.application_link,identifier);url=urlparse(payload.url)
        if url.scheme!='https' or not url.hostname or url.username or url.password:raise HTTPException(422,'Configure a bank-approved HTTPS URL without embedded credentials.')
        db.execute(m.application_link.update().where(m.application_link.c.id==identifier).values(**payload.model_dump()))
        audit(db,actor,'application_link',identifier,'LINK_CONFIGURED',old=old,new=payload.model_dump());return {'ok':True}

    @app.get('/api/baseline')
    def baseline(actor=Depends(current)):
        return json.loads((ROOT/'docs/release-baseline.json').read_text())

    frontend_dist=ROOT/'frontend'/'dist'
    @app.get('/')
    def index():
        page=frontend_dist/'index.html'
        if not page.is_file():
            return JSONResponse({'detail':'The web frontend has not been built. Run npm --prefix frontend run build.'},status_code=503)
        return FileResponse(page)
    app.mount('/assets',StaticFiles(directory=frontend_dist,check_dir=False),name='assets')
    return app

app=create_app()
