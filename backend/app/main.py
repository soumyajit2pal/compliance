"""Weeks 1–5 Oracle portal. Start after Alembic; no startup DDL."""
import asyncio
import os
import csv,io,json,hashlib,re,logging
import ipaddress
import time
from collections import Counter
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError,DatabaseError
from fastapi import FastAPI,Depends,Request,Response,HTTPException,UploadFile,File,Form,Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse,JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi.staticfiles import StaticFiles
from .bank_time import today as bank_today
from .runtime import runtime_settings
from .pagination import page_query, paginate
from .table_filters import column_choices, column_query, fields, filter_rows, label, version as version_label
from .config import ROOT
from .storage import prepare_storage, stored_path
from .logging_config import configure_logging, request_id as logging_request_id, client_ip as logging_client_ip, client_ip_from_scope, database_error_code
from . import models as m,schemas as s,repository as repo,migration_service as migration
from . import authentication as auth
from .login_encryption import load_material, public_login_key, consume_challenge, encrypted_login_credentials
from .access import actor_for,READ_ROLES,REGULATORY_ROLES,DISCUSS_ROLES
from .events import NOTIFICATION_WAKE,new_id,now,audit
from .request_audit import RequestAuditWriter, access_event, insert_request, request_context
from .security import hash_password
from .directory import (load_directory, public_directory, prepare_directory, save_directory,
                        safe_directory_audit, authenticate_directory)
from .database import create_application_engine
from .demo_access import available_demo_users
from .import_template import csv_template
from .import_workbook import download_workbook
from .user_access import account_catalogue, current_access, notify_administrators
from . import clause_carry,clause_interpretations,notification_families as families
from .source_documents import file_transaction, save_document
from . import upload_policy
from .upload_formats import INLINE_TYPES, validate_workbook
from . import employee_identity as employees
from . import applications as connected_apps, master_data, dropdowns, organisation_import
from .dropdown_cache import DropdownCache
from .api_docs import install_uat_docs
from .notification_context import resolve_notification
from .task_queue import list_tasks
from . import mail_admin
from .notification_worker import NotificationWorker, WakeSignal

logger=logging.getLogger('cbd.portal')


def get_db(request:Request):
    with request.app.state.engine.connect() as db:
        try:
            with file_transaction(db), db.begin(): yield db
            if db.info.get(NOTIFICATION_WAKE):
                request.app.state.notification_wake.send()
        finally:
            db.info.pop(NOTIFICATION_WAKE, None)

def current(request:Request,db=Depends(get_db)):
    actor=auth.resolve(db,request,request.app.state.settings)[0]
    if not actor.roles:raise HTTPException(403,'Your profile is awaiting administrator-approved access.')
    from .delegations import resolve_context
    actor = resolve_context(db,actor,request)
    request.state.audit_actor = actor
    return actor

def limited(request:Request,db=Depends(get_db)):
    return auth.resolve(db,request,request.app.state.settings,limited=True)

def menu(actor):
    common=[('home','Compliance at a Glance'),('tasks','My tasks'),('approvals','My approvals'),('help','Help')]
    if actor.roles & READ_ROLES:common[1:1]=[('repository','Regulatory library'),('notification-families','Notification families'),('clauses','Clauses / Para'),('clause-relationships','Clause / Para relationships'),('obligations','Obligations'),('applicability','Applicability'),('accountability','Accountability')]
    if any(g['role_code'] in {'AUTHOR','REVIEWER'} and g['global_scope_flag'] for g in actor.grants):common.append(('migration','Import existing regulatory records'))
    if 'ADMIN' in actor.roles:common.extend([('masters','Reference masters'),('dropdowns','Dropdowns'),('users','Users and access'),('ldap','LDAP settings'),('employee-api','Employee profile API'),('email-settings','Email settings'),('upload-settings','Upload settings')])
    if actor.roles & READ_ROLES:common.extend([('controls','Checks and procedures'),('control-mappings','Obligation links'),('actions','Assigned actions'),('evidence','Evidence vault'),('delegations','Delegation'),('team','Team overview'),('library','Compliance library')])
    common.append(('approval-workflow-log','Approval Workflow Log'))
    if 'ADMIN' in actor.roles:common.append(('audit-trail','Audit Log'))
    common.append(('applications','Retained applications'))
    return [{'id':key,'label':label} for key,label in common]

def safe_user(row):
    return {k:v for k,v in dict(row).items() if k not in {'password_hash'}}

def create_app(settings=None,engine=None):
    cfg=settings or runtime_settings()
    configure_logging(cfg)
    wake = WakeSignal(cfg)
    dropdown_cache=DropdownCache(cfg.redis_url,cfg.database_url,cfg.environment) if cfg.redis_url else None
    published_dropdowns=dropdown_cache.configuration if dropdown_cache else dropdowns.configuration
    try:login_material=load_material(cfg.login_private_key_file)
    except Exception:
        logger.exception('Sign-in key initialization failed');raise
    @asynccontextmanager
    async def lifespan(app):
        configure_logging(cfg)
        notification_task=None;notification_worker=None;employee_task=None
        try:
            prepare_storage(cfg.storage)
            if app.state.engine is None:app.state.engine=create_application_engine(cfg.database_url)
            # Supplied engines belong to rollback-bound tests, never a scheduler.
            if engine is None and cfg.notification_worker_mode == 'embedded':
                notification_worker = NotificationWorker(app.state.engine, cfg, wake)
                notification_task = asyncio.create_task(asyncio.to_thread(notification_worker.run))
            if engine is None:
                from .employee_profiles import worker as employee_worker
                employee_task=asyncio.create_task(employee_worker(app.state.engine,cfg))
            logger.info('Application started environment=%s',cfg.environment)
            yield
        except Exception:
            logger.exception('Application lifecycle failed');raise
        finally:
            if employee_task:
                employee_task.cancel()
                try:await employee_task
                except asyncio.CancelledError:pass
            if notification_task:
                notification_worker.stop.set()
                await notification_task
            if engine is None and app.state.engine is not None:app.state.engine.dispose()
            if dropdown_cache:dropdown_cache.close()
            wake.close()
            logger.info('Application stopped environment=%s',cfg.environment)
    app=FastAPI(title='Compliance by Design',lifespan=lifespan,docs_url=None,redoc_url=None,
                openapi_url='/openapi.json' if cfg.environment=='uat' else None)
    install_uat_docs(app,cfg.environment)
    app.state.settings=cfg;app.state.engine=engine
    app.state.notification_wake = wake
    app.state.login_material=login_material
    app.state.consume_login_challenge=lambda claims:consume_challenge(app.state.engine,claims)
    def persist_access(event):
        with app.state.engine.begin() as db:
            insert_request(db, event)
    # An injected engine belongs to tests and supplies its own rollback-bound writer.
    app.state.write_request_audit = persist_access if engine is None else None

    @app.middleware('http')
    async def security(request,call_next):
        if request.url.path in {'/api/auth/login','/api/auth/login-key'} and request.url.scheme!='https':
            try:local_client=ipaddress.ip_address(request.client.host).is_loopback
            except (ValueError,AttributeError):local_client=False
            local=cfg.environment=='uat' and not cfg.secure_cookie and request.url.hostname in {'localhost','127.0.0.1','::1'} and local_client
            if not local:return JSONResponse({'detail':'Secure sign-in requires HTTPS.'},status_code=426)
        if request.method not in {'GET','HEAD','OPTIONS'}:
            path=request.url.path.rstrip('/')
            file_upload=(path in {'/api/migration','/api/obligation-imports','/api/documents',
                organisation_import.IMPORT_PATH, organisation_import.IMPORT_PATH+'/preview'}
                or path.startswith('/api/actions/') and path.endswith('/evidence'))
            maximum=(upload_policy.MAX_REQUEST_BYTES if file_upload else
                     2*1024*1024 if request.url.path in {'/api/admin/ldap','/api/admin/ldap/test','/api/admin/employee-api','/api/admin/employee-api/test'} else 1024*1024)
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
        if cfg.environment=='uat' and request.url.path in {'/docs','/docs/'}:
            # Swagger's React layout uses style attributes; scripts stay external/self-only.
            response.headers['Content-Security-Policy']+="; style-src-attr 'unsafe-inline'"
        return response

    @app.middleware('http')
    async def operational_log(request,call_next):
        reference=new_id()
        request.state.request_id=reference
        token=logging_request_id.set(reference);started=time.perf_counter()
        client_token=logging_client_ip.set(client_ip_from_scope(request.scope))
        audit_token=request_context.set(request)
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
            if app.state.write_request_audit:
                request.state.access_audit_event = access_event(request, response.status_code, elapsed, now())
            log=logger.warning if elapsed>=cfg.slow_request_ms or response.status_code>=500 else logger.info
            log('Request completed method=%s route=%s status=%s duration_ms=%.2f',request.method,route_name(),response.status_code,elapsed)
            response.headers['X-Request-ID']=reference
            return response
        finally:
            request_context.reset(audit_token)
            logging_client_ip.reset(client_token)
            logging_request_id.reset(token)

    app.add_middleware(RequestAuditWriter)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, exc):
        # Validation errors can carry the complete submitted model, including credentials.
        detail = [
            {'loc': error['loc'][:-1] if error['type'] == 'extra_forbidden' else error['loc'],
             'msg': error['msg'], 'type': error['type']}
            for error in exc.errors()
        ]
        return JSONResponse({'detail': detail}, status_code=422)

    @app.exception_handler(DatabaseError)
    async def db_error(request,exc):
        reference=request.state.request_id
        logger.error('Database request rejected type=%s code=%s',type(exc).__name__,database_error_code(exc),exc_info=True)
        conflict=isinstance(exc,IntegrityError)
        detail=('The change could not be saved. It may conflict with a protected record or a concurrent update. Refresh and try again. Reference '
                if conflict else 'The database request could not be completed. Try again or contact support. Reference ')
        return JSONResponse({'detail':detail+reference},status_code=409 if conflict else 503)

    @app.get('/api/health')
    def health():
        return {'status':'ok', 'environment':cfg.environment, 'release':os.getenv('PORTAL_RELEASE', '2026.11.25-r5')}

    @app.get('/api/ready')
    def ready(request: Request):
        try:
            with request.app.state.engine.connect() as db:
                oracle_ready = db.execute(sa.text('SELECT 1 FROM DUAL')).scalar_one() == 1
        except sa.exc.SQLAlchemyError as exc:
            logger.warning('Oracle readiness probe failed code=%s', database_error_code(exc))
            oracle_ready = False
        if not oracle_ready:
            return JSONResponse({'status': 'degraded', 'database': 'unavailable'}, status_code=503)
        return {'status': 'ok', 'database': 'ok'}

    def require_demo_login():
        if cfg.environment != 'uat' or not cfg.demo_login_enabled:
            raise HTTPException(404, 'Demo sign-in is unavailable.')

    @app.get('/api/auth/demo-users', dependencies=[Depends(require_demo_login)])
    def demo_users(db=Depends(get_db)):
        return {'dropdown_presentation':dropdowns.demo_presentation(db,published_dropdowns),'users': available_demo_users(db), 'ldap_demo': {
            'enabled': cfg.ldap_mock_enabled, 'username': cfg.ldap_mock_username_prefix+'01'
            if cfg.ldap_mock_enabled else '', 'prefix': cfg.ldap_mock_username_prefix if cfg.ldap_mock_enabled else ''}}

    @app.get('/api/auth/login-key')
    def login_key():return public_login_key(app.state.login_material,cfg.secret)

    @app.post('/api/auth/login')
    def login(request:Request,response:Response,payload=Depends(encrypted_login_credentials),db=Depends(get_db)):
        return auth.login(db,request,response,payload,cfg)

    @app.get('/api/auth/me')
    def me(request:Request,db=Depends(get_db),identity=Depends(limited)):
        actual,session=identity
        from .delegations import resolve_context
        actor=resolve_context(db,actual,request)
        result={'user':safe_user(actor.user),'roles':sorted(actor.roles),'grants':actor.grants,
            'csrf_token':session['csrf_token'],'menu':[] if employees.blocked(actor.user) else menu(actor),'environment':cfg.environment}
        if result['menu']:
            result['upload_policy']=upload_policy.public(upload_policy.configuration(db)[0])
        from .employee_profiles import public_profile
        presentation=published_dropdowns(db)[1]['presentation']
        result['dropdown_presentation']=presentation if actor.roles else {
            k:v for k,v in presentation.items() if k=='org_unit_id'}
        result['employee_profile']=public_profile(db,actual.id,cfg)
        user=actual.user
        needs_review_screen=employees.blocked(user) or user['needs_email_confirmation_flag'] or user['needs_department_selection_flag']
        result['employee_review']=(employees.public_status(db,user,current_review_only=True)
            if not actor.delegation and user['employee_profile_required'] and not user['must_change_password_flag'] and needs_review_screen else None)
        if actor.delegation:
            # Represented employee metadata must not be disclosed in session annotations.
            for key in ('employee_approved','employee_observed','employee_warning'):result['user'].pop(key,None)
            result.update(actual_user=safe_user(actual.user),acting_for={**actor.delegation,'actual_user_name':actual.user['full_name'],'principal_name':actor.user['full_name']})
        return result

    @app.get('/api/auth/employee-profile')
    def department_status(db=Depends(get_db),identity=Depends(limited)):
        actor,_=identity
        if not actor.user.get('employee_profile_required'):raise HTTPException(403,'This account has no employee department check.')
        return employees.public_status(db,actor.user)

    @app.post('/api/auth/employee-profile/request')
    def department_request(payload:s.DepartmentRequest,db=Depends(get_db),identity=Depends(limited)):
        actor,session=identity
        return employees.request_update(db,actor.user,session,payload.reason)

    @app.post('/api/auth/logout')
    def logout(request:Request,response:Response,db=Depends(get_db)):
        # A request without a session cookie has nothing to sign out or clear.
        if not request.cookies.get(auth.COOKIE):
            return {'ok':True}
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
        if not employees.can_onboard(identity[0].user):raise HTTPException(403,'Complete employee profile setup before opening the workspace.')
        unit=m.organisational_unit.c;today=bank_today()
        return [dict(r) for r in db.execute(sa.select(m.organisational_unit).where(
            unit.active_flag==1,unit.unit_type=='DEPARTMENT',unit.effective_from<=today,
            sa.or_(unit.effective_to.is_(None),unit.effective_to>today)).order_by(unit.name)).mappings()]

    @app.post('/api/auth/onboarding')
    def onboard(payload:s.Onboard,db=Depends(get_db),identity=Depends(limited)):
        actor,_=identity
        if not employees.can_onboard(actor.user):raise HTTPException(403,'Complete employee profile setup before opening the workspace.')
        if actor.user['login_type']!='LDAP' or not (actor.user['needs_email_confirmation_flag'] or actor.user['needs_department_selection_flag']):raise HTTPException(403,'Profile onboarding is already complete. Contact an administrator for access changes.')
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',payload.email):raise HTTPException(422,'Enter a valid work email address.')
        unit=repo.active(db,m.organisational_unit,payload.org_unit_id,lock=True)
        if unit['unit_type']!='DEPARTMENT':raise HTTPException(422,'Select a Department for your home organisation.')
        db.execute(m.user.update().where(m.user.c.id==actor.id).values(email=payload.email,org_unit_id=unit['id'],needs_email_confirmation_flag=0,needs_department_selection_flag=0))
        audit(db,actor,'user',actor.id,'LDAP_ACCESS_REQUESTED',new={'email':payload.email,'department':unit['code'],'roles':[]})
        access=current_access(db,actor.id)
        notify_administrators(db,actor.id,'ACCESS_APPROVAL_REQUIRED' if access['admin_action_required'] else 'LDAP_PROFILE_CONFIRMED')
        return {'ok':True,'message':'Profile confirmed. '+access['access_message']}

    dropdowns.install(app,get_db,current,published_dropdowns)
    organisation_import.install(app,get_db,current)
    mail_admin.install(app,get_db,current,cfg)
    upload_policy.install(app,get_db,current)

    @app.get('/api/masters')
    def masters(db=Depends(get_db),actor=Depends(current)):
        revision,config=published_dropdowns(db)
        if dropdown_cache:
            result=dropdown_cache.reference_options(db,revision)
            result.update(master_data.reference_rows(db,master_data.LIVE_REFERENCE_MASTERS))
        else:
            result=master_data.reference_rows(db,master_data.PORTAL_REFERENCE_MASTERS)
        users=db.execute(sa.select(m.user.c.id,m.user.c.username,m.user.c.full_name,m.user.c.org_unit_id).where(m.user.c.active_flag==1)).mappings().all()
        result['user']=[dict(u) for u in users]
        result['dropdown_configuration']=[{**config,'revision':revision}]
        return result

    @app.get('/api/masters/catalogue')
    def master_catalogue(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        return master_data.catalogue(db)

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

    @app.get('/api/admin/employee-profile-reviews')
    def employee_reviews(user_id:str|None=None,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        return employees.review_rows(db,user_id)

    @app.get('/api/admin/employee-profile-archive/{user_id}')
    def employee_archive(user_id:str,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        return [dict(row) for row in db.execute(sa.select(m.employee_legacy_record).where(m.employee_legacy_record.c.user_id==user_id).order_by(m.employee_legacy_record.c.created_at)).mappings()]

    @app.post('/api/admin/employee-profile-reviews/{identifier}/decision')
    def employee_review_decision(identifier:str,payload:s.DepartmentDecision,db=Depends(get_db),actor=Depends(current)):
        return employees.decide(db,actor,identifier,payload.decision,payload.reason)

    def save_user(db,actor,payload,identifier=None):
        actor.require({'ADMIN'});values=payload.model_dump(exclude={'roles','password'});values['username']=values['username'].lower()
        if payload.email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',payload.email):raise HTTPException(422,'Enter a valid email address.')
        if identifier==actor.id:raise HTTPException(403,'Use another authorised administrator to change your own access.')
        home_id=values['org_unit_id']
        selected_units={home_id,*(item.scope_org_unit_id for item in payload.roles if not item.global_scope_flag)}
        # Coordinate with hierarchy edits before saving any home or role scope reference.
        units={key:repo.active(db,m.organisational_unit,key,lock=True) for key in sorted(filter(None,selected_units))}
        old=repo.one(db,m.user,identifier,lock=True) if identifier else None
        if home_id:
            unit_type=units[home_id]['unit_type']
            retained=old and old['org_unit_id']==home_id and unit_type!='SUB_DEPARTMENT'
            if unit_type!='DEPARTMENT' and not retained:
                raise HTTPException(422,'Select a Department as the home organisation.')
        if old and (old['username']!=values['username'] or old['login_type']!=values['login_type']):raise HTTPException(422,'Username and login type are fixed. Create a separate identity for a changed authentication method.')
        if not old and db.execute(sa.select(m.user.c.id).where(sa.func.lower(m.user.c.username)==values['username'])).first():raise HTTPException(409,'This username already exists.')
        assignments=[];seen=set()
        for item in payload.roles:
            role=repo.active(db,m.role,item.role_id)
            if item.global_scope_flag:
                if item.scope_org_unit_id:raise HTTPException(422,'Global roles must not also specify a department.')
            elif not item.scope_org_unit_id:raise HTTPException(422,'Select the role scope department.')
            elif units[item.scope_org_unit_id]['unit_type']=='SUB_DEPARTMENT':
                raise HTTPException(422,'Select the parent Department to grant access to its Sub-departments.')
            if role['code'] in {'BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','ZONE_VIEWER'} and item.global_scope_flag:raise HTTPException(422,'Owner and Zone Viewer roles require an explicit organisational scope.')
            signature=(item.role_id,item.scope_org_unit_id,item.global_scope_flag)
            if signature in seen:raise HTTPException(422,'Remove duplicate role assignments.')
            seen.add(signature);assignments.append(item.model_dump())
        if old and not values['active_flag']:
            # Refuse disabling the last active administrator.
            others=db.execute(sa.select(m.user.c.id).join(m.user_role,m.user_role.c.user_id==m.user.c.id).join(m.role,m.role.c.id==m.user_role.c.role_id)
                .where(m.user.c.id!=identifier,m.user.c.active_flag==1,m.role.c.code=='ADMIN',m.role.c.active_flag==1,m.user_role.c.effective_from<=bank_today(),sa.or_(m.user_role.c.effective_to.is_(None),m.user_role.c.effective_to>bank_today()))).first()
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
            db.execute(m.user_role.update().where(m.user_role.c.user_id==identifier,sa.or_(m.user_role.c.effective_to.is_(None),m.user_role.c.effective_to>bank_today())).values(effective_to=bank_today()))
            db.execute(m.app_session.update().where(m.app_session.c.user_id==identifier).values(revoked_flag=1))
        for assignment in assignments:db.execute(m.user_role.insert().values(id=new_id(),user_id=identifier,effective_from=bank_today(),**assignment))
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
        return {'ok':True,'email_available':bool(profile.get('email')),
            'message':'LDAP connection and test-user authentication succeeded. Configuration has not been saved.'}

    @app.post('/api/documents')
    async def upload(request:Request,file:UploadFile=File(...),owner_unit_id:str=Form(...),confidentiality_class_id:str=Form(...),db=Depends(get_db),actor=Depends(current)):
        actor.require({'AUTHOR'},owner_unit_id)
        limits,_=upload_policy.configuration(db)
        return save_document(db,actor,cfg.storage,file.filename or 'source',
            await upload_policy.read_upload(file,limits.source_mib),owner_unit_id,confidentiality_class_id)

    @app.get('/api/documents/{identifier}')
    def download(identifier:str,preview:bool=False,db=Depends(get_db),actor=Depends(current)):
        document=repo.one(db,m.document,identifier)
        linked=db.execute(sa.select(m.regulatory_instrument.c.id).outerjoin(m.instrument_version,m.instrument_version.c.instrument_id==m.regulatory_instrument.c.id).where(sa.or_(m.regulatory_instrument.c.source_document_id==identifier,m.instrument_version.c.source_document_id==identifier))).scalars().all()
        permitted=False
        for instrument in linked:
            try:repo.read_instrument(db,actor,instrument);permitted=True;break
            except HTTPException:continue
        if not permitted and not linked:
            from .delivery_api import document_visible
            permitted=document_visible(db,actor,identifier)
        if not permitted and not (document['uploaded_by']==actor.id and actor.covers(document['owner_unit_id'],{'AUTHOR'})):
            raise HTTPException(404,'Document not found in your authorised area.')
        if document['storage_uri']!='portal://'+identifier or not re.fullmatch('[a-f0-9-]{32,36}',identifier):raise HTTPException(404,'This source is held in a separate approved repository.')
        path=stored_path(cfg.storage,identifier,document['file_name'])
        if not path.is_file():raise HTTPException(404,'The source file is unavailable. Contact the repository administrator.')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=document['file_hash']:raise HTTPException(409,'The source integrity check failed. Contact the repository administrator.')
        inline=preview and document['content_type'] in INLINE_TYPES
        audit(db,actor,'document',identifier,'SOURCE_PREVIEWED' if inline else 'SOURCE_DOWNLOADED')
        return FileResponse(path,filename=document['file_name'],media_type=document['content_type'],content_disposition_type='inline' if inline else 'attachment')

    @app.get('/api/instruments')
    def instruments(request:Request,paging=Depends(page_query),columns=Depends(column_query),db=Depends(get_db),actor=Depends(current)):
        filters=dict(request.query_params)
        rows=repo.listing(db,actor,filters)
        repo.add_approved_edition_summaries(db, rows)
        def instrument_status(row):
            position = row['regulatory_status']
            status = position if position in {'CURRENT','SUPERSEDED','WITHDRAWN'} else row['approval_status'] or position
            return label(status), 'Not current' if status == 'APPROVED' and not row['current_version_id'] else '', 'Open notification family'

        def instrument_version(row):
            if row['current_version_number']:
                return version_label(row['current_version_number'])
            edition = row.get('approved_edition')
            if edition:
                effective = edition['effective_from']
                return version_label(edition['version_number']), 'Upcoming' if edition['upcoming'] else None, f'Effective {effective.day} {effective:%b %Y}'
            return None

        projections={
            'instrument':lambda row:(row['code'],row['title'],'Quick view'),
            'official_reference_number':lambda row:row['official_reference_number'] or 'Not provided by regulator',
            'regulator_domain':fields('regulator_name','regulator_code','domain_name','secondary_domain_names'),
            'current_version':instrument_version,
            'materiality':lambda row:label(row['materiality']),
            'status':instrument_status,
        }
        rows=filter_rows(rows,columns,projections)
        selected=filters.get('library_stage')
        if columns.options_for:
            return column_choices((row for row in rows if not selected or repo.library_stage(row)==selected),
                                  columns.options_for,projections)
        if not any(paging.values()):
            return [row for row in rows if not selected or repo.library_stage(row)==selected]
        stages=[(repo.library_stage(row),row) for row in rows]
        counts=Counter(stage for stage,_ in stages)
        rows=[row for stage,row in stages if not selected or stage==selected]
        return {**paginate(rows,**paging),'library_counts':dict(counts)}
    @app.get('/api/notification-families')
    def family_register(as_of:date|None=None,q:str='',library:bool=False,domain_id:str='',paging=Depends(page_query),columns=Depends(column_query),db=Depends(get_db),actor=Depends(current)):
        if library:return families.library(db,actor,as_of,q,domain_id,paging,columns)
        data=families.view(db,actor,when=as_of,search=q)
        paged=paginate(data['families'],**paging)
        if isinstance(paged,dict):data.update(families=paged['items'],pagination=paged['pagination'])
        return data
    @app.get('/api/notification-families/{identifier}')
    def family_detail(identifier:str,as_of:date|None=None,include_implementation_progress:bool=False,db=Depends(get_db),actor=Depends(current)):
        return families.view(db,actor,identifier,as_of,include_implementation_progress=include_implementation_progress)
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
    @app.get('/api/clauses/{identifier}/interpretation-requests')
    def interpretation_requests(identifier:str,db=Depends(get_db),actor=Depends(current)):
        return clause_interpretations.register(db,actor,identifier)
    @app.post('/api/clauses/{identifier}/interpretation-requests')
    def submit_interpretation(identifier:str,payload:s.ClauseInterpretationSubmit,db=Depends(get_db),actor=Depends(current)):
        return clause_interpretations.submit(db,actor,identifier,payload)
    @app.post('/api/clause-interpretation-requests/{identifier}/decision')
    def decide_interpretation(identifier:str,payload:s.Decision,db=Depends(get_db),actor=Depends(current)):
        return clause_interpretations.decide(db,actor,identifier,payload)
    @app.get('/api/source-editions')
    def source_editions(instrument:str|None=Query(None,max_length=36),db=Depends(get_db),actor=Depends(current)):
        return repo.source_edition_listing(db,actor,instrument)
    @app.post('/api/instruments')
    def register(payload:s.InstrumentInput,db=Depends(get_db),actor=Depends(current)):return repo.create_instrument(db,actor,payload)
    @app.put('/api/instruments/{identifier}')
    def edit_instrument(identifier:str,payload:s.InstrumentInput,db=Depends(get_db),actor=Depends(current)):return repo.edit_instrument(db,actor,identifier,payload)
    @app.get('/api/instruments/{identifier}')
    def instrument(identifier:str,include_implementation_progress:bool=False,db=Depends(get_db),actor=Depends(current)):
        return repo.detail(db,actor,identifier,include_implementation_progress)
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
    def submit(identifier:str,payload:s.VersionSubmit,db=Depends(get_db),actor=Depends(current)):return repo.submit(db,actor,identifier,payload)
    @app.post('/api/versions/{identifier}/decision')
    def decide(identifier:str,payload:s.VersionDecision,db=Depends(get_db),actor=Depends(current)):return repo.decide(db,actor,identifier,payload)
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
    def tasks(response:Response,db=Depends(get_db),actor=Depends(current)):
        response.headers['X-Dropdown-Revision']=str(dropdowns.configuration_revision(db))
        return list_tasks(db, actor)

    @app.get('/api/notifications')
    def notifications(db=Depends(get_db),actor=Depends(current)):
        result=[]
        for row in db.execute(sa.select(m.notification).where(m.notification.c.recipient_user_id==actor.id).order_by(m.notification.c.triggered_at.desc())).mappings():
            item=dict(row)
            if actor.delegation:
                from .delegations import audit_visible
                if not audit_visible(db,actor,item):continue
            item = resolve_notification(db, actor, item)
            if item is None:continue
            result.append(item)
        return result
    @app.post('/api/notifications/{identifier}/read')
    def read_notification(identifier:str,db=Depends(get_db),actor=Depends(current)):
        if actor.delegation:
            from .delegations import audit_visible
            item=repo.one(db,m.notification,identifier)
            if item['recipient_user_id']!=actor.id or not audit_visible(db,actor,item):raise HTTPException(404,'Notification not found in this leave-cover scope.')
        db.execute(m.notification.update().where(m.notification.c.id==identifier,m.notification.c.recipient_user_id==actor.id).values(read_at=now()));return {'ok':True}

    @app.post('/api/migration')
    async def stage_source(file:UploadFile=File(...),source_system:str=Form(...),source_files:list[UploadFile]|None=File(default=None),db=Depends(get_db),actor=Depends(current)):
        if not source_system.strip() or len(source_system)>100:raise HTTPException(422,'Enter a source system name up to 100 characters.')
        migration.require_migration(actor,{'AUTHOR'})
        limits,_=upload_policy.configuration(db)
        data=await upload_policy.read_upload(file,limits.workbook_mib)
        filename=Path((file.filename or '').replace('\\','/')).name[:500]
        if filename.lower().endswith('.xlsx'):validate_workbook(data)
        if len(source_files or [])>upload_policy.MAX_ATTACHMENTS:raise HTTPException(422,'Attach at most 50 source files.')
        attachments=[];total=len(data)
        for source in source_files or []:
            if not source.filename:continue
            content=await upload_policy.read_upload(source,limits.source_mib);total+=len(content)
            if total>upload_policy.MAX_BUNDLE_MIB*upload_policy.MIB:raise HTTPException(413,'The workbook and source files must total at most 100 MiB.')
            attachments.append((source.filename,content))
        return migration.stage(db,actor,filename,data,source_system,cfg.storage,attachments)
    @app.get('/api/migration')
    def batches(q:str='',paging=Depends(page_query),columns=Depends(column_query),db=Depends(get_db),actor=Depends(current)):
        migration.require_migration(actor)
        rows=[dict(r) for r in db.execute(sa.select(m.migration_batch).where(~m.migration_batch.c.record_status.like('OBL_%')).order_by(m.migration_batch.c.uploaded_at.desc(),m.migration_batch.c.id)).mappings()]
        if paging['page'] is None and paging['page_size'] is None and not columns.options_for:return rows
        summary={key:sum(row[key] or 0 for row in rows) for key in ('source_count','loaded_count','pending_count')}
        summary['batches']=len(rows)
        matched=[row for row in rows if q.casefold() in json.dumps(jsonable_encoder(row),ensure_ascii=False).casefold()]
        projections={
            'source_batch':fields('code'),'source_file':fields('source_file'),'source_rows':fields('source_count'),
            'loaded':fields('loaded_count'),'pending':fields('pending_count'),'actions':lambda row:'Source profile',
        }
        matched=filter_rows(matched,columns,projections)
        if columns.options_for:
            return column_choices(matched,columns.options_for,projections)
        return {**paginate(matched,**paging),'summary':summary}
    @app.get('/api/migration/{identifier}')
    def batch(identifier:str,db=Depends(get_db),actor=Depends(current)):return migration.batch_detail(db,actor,identifier)
    @app.get('/api/migration/{identifier}/sources/{source_id}')
    def imported_source(identifier:str,source_id:str,db=Depends(get_db),actor=Depends(current)):
        from . import combined_import
        migration.require_migration(actor)
        source_data=migration.batch_detail(db,actor,identifier)
        source=next((s for s in source_data.get('sources',[]) if s['id']==source_id),None)
        if not source:raise HTTPException(404,'Source file not found in this import.')
        path,_=combined_import.read_attachment(cfg.storage,source)
        audit(db,actor,'migration',identifier,'IMPORT_SOURCE_DOWNLOADED',new={'source_id':source_id,'sha256':source['file_hash']})
        return FileResponse(path,filename=source['file_name'],media_type=source['content_type'])
    @app.post('/api/migration/{identifier}/reprofile')
    def reprofile_import(identifier:str,db=Depends(get_db),actor=Depends(current)):
        from . import combined_import
        migration.require_migration(actor,{'AUTHOR'})
        source_batch=repo.one(db,m.migration_batch,identifier,lock=True)
        if not combined_import.manifest(source_batch):raise HTTPException(422,'Refresh preview is available for combined imports.')
        return combined_import.reprofile(db,actor,source_batch,cfg.storage)
    @app.get('/api/migration/{identifier}/report.csv')
    def migration_report(identifier:str,db=Depends(get_db),actor=Depends(current)):
        data=migration.batch_detail(db,actor,identifier);stream=io.StringIO();writer=csv.writer(stream)
        writer.writerow(['Source file','Sheet','Row','Source system','Readiness','Findings','Canonical mapped values','Target type','Target ID',
            'Import reference','Source edition','Clause import reference','Parent clause reference','Target edition ID','Loaded source document ID',
            'Parent notification','Relationship','Relationship effective date','Relationship proposal ID'])
        def cell(value):
            text=str(value or '')
            return "'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text
        for row in data['rows']:
            family = row['profile'].get('family_link') or {}
            writer.writerow([cell(v) for v in [data['batch']['source_file'],row['sheet_name'],row['row_number'],row['source_system'],row['validation_status'],
                '; '.join(row['profile'].get('errors',[])),json.dumps(row['profile'].get('normalised',{})),row['target_entity_type'],row['target_entity_id'],
                row['profile'].get('group_reference'),row['profile'].get('edition_number'),row['profile'].get('clause_reference'),
                row['profile'].get('parent_reference'),row['profile'].get('target_version_id'),row['profile'].get('loaded_source_document_id'),
                family.get('parent_reference'),family.get('relationship_type'),family.get('effective_from'),
                (row['profile'].get('family_proposal') or {}).get('id')]])
        audit(db,actor,'migration',identifier,'PROFILE_REPORT_EXPORTED')
        return Response(stream.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="migration-profile.csv"'})
    @app.post('/api/migration/{identifier}/validate')
    def validate(identifier:str,db=Depends(get_db),actor=Depends(current)):return migration.validate_content(db,actor,identifier,cfg.storage)
    @app.post('/api/migration/{identifier}/load')
    def load(identifier:str,payload:s.MigrationLoadInput|None=None,db=Depends(get_db),actor=Depends(current)):
        return migration.load_batch(db,actor,identifier,cfg.storage,payload)
    @app.get('/api/migration/{identifier}/family-assignees')
    def import_family_assignees(identifier:str,db=Depends(get_db),actor=Depends(current)):
        from . import combined_import, combined_family_links
        migration.require_migration(actor,{'AUTHOR'})
        batch=repo.one(db,m.migration_batch,identifier)
        if not combined_import.manifest(batch) or batch['uploaded_by']!=actor.id:
            raise HTTPException(404,'The notification proposal assignments are unavailable.')
        return combined_family_links.assignees(db,actor,combined_import.batch_rows(db,identifier))
    @app.get('/api/migration-template')
    def template(format:str='csv',db=Depends(get_db),actor=Depends(current)):
        migration.require_migration(actor)
        headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Expires':'0'}
        if format=='xlsx':
            return Response(download_workbook(db,actor),
                media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                headers={**headers,'Content-Disposition':'attachment; filename="regulatory-records-and-clauses-template.xlsx"'})
        if format!='csv':raise HTTPException(422,'Choose the Excel or CSV template.')
        return Response(csv_template(),media_type='text/csv',headers={**headers,'Content-Disposition':'attachment; filename="instrument-import-template.csv"'})

    @app.get('/api/applications')
    def applications(db=Depends(get_db),actor=Depends(current)):
        return connected_apps.list_links(db, actor)

    @app.post('/api/applications', status_code=201)
    def create_application(payload: s.NewLinkInput, db=Depends(get_db), actor=Depends(current)):
        return connected_apps.create(db, actor, payload)

    @app.patch('/api/applications/{identifier}')
    def update_application(identifier:str,payload:s.LinkInput,db=Depends(get_db),actor=Depends(current)):
        return connected_apps.update(db, actor, identifier, payload)

    from .employee_api import install as install_employee_api
    install_employee_api(app,get_db,current,cfg)
    from .delivery_api import install as install_delivery
    install_delivery(app,get_db,current)
    from .control_api import install as install_controls
    install_controls(app,get_db,current)
    from .delegation_api import install as install_delegations
    install_delegations(app,get_db,current)
    from .obligation_api import install as install_obligations
    install_obligations(app,get_db,current)
    from .regulation_registers import install as install_regulation_registers
    install_regulation_registers(app,get_db,current)
    from .clause_browser import install as install_clause_browser
    install_clause_browser(app,get_db,current)
    from .audit_trail import install as install_audit_trail
    install_audit_trail(app,get_db,current)
    from .workflow_log import install as install_workflow_log
    install_workflow_log(app,get_db,current)
    if os.getenv('PORTAL_SERVE_FRONTEND', 'true').lower() == 'true':
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
