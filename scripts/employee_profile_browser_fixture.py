"""Opt-in employee browser QA: real HTTP/Oracle, synthetic LDAP/API, outer rollback."""
import os,sys,json,secrets,threading,tempfile
from pathlib import Path
from datetime import date
from dataclasses import replace
from contextlib import contextmanager
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import sqlalchemy as sa
from sqlalchemy.orm import Session
import httpx,uvicorn
from fastapi import HTTPException
from backend.app.runtime import runtime_settings
from backend.app.main import create_app,get_db
from backend.app import authentication as auth,employee_profiles as ep,models as m
from backend.app.security import hash_password
from backend.app.events import now,new_id
from backend.app.login_encryption import record_challenge,INVALID


def main():
    cfg=runtime_settings()
    if cfg.environment!='uat' or os.getenv('CBD_RUN_ORACLE_TESTS')!='1':raise RuntimeError('Explicit rollback-only UAT opt-in required')
    # FastAPI may enter/exit a yield dependency on different pool threads.
    auth.COOKIE='cbd_employee_fixture';lock=threading.Lock();stop=threading.Event()
    credential_path=ROOT/'var/employee-browser-secrets.json';control_path=ROOT/'var/employee-browser-api.json'
    engine=sa.create_engine(cfg.database_url,hide_parameters=True)
    with tempfile.TemporaryDirectory(prefix='cbd-employee-browser-') as folder,engine.connect() as conn:
        transaction=conn.begin();password=secrets.token_urlsafe(24);credentials={}
        def insert(table,**values):
            identifier=new_id();conn.execute(table.insert().values(id=identifier,**values));return identifier
        lookup=lambda table,code:conn.execute(sa.select(table.c.id).where(table.c.code==code)).scalar_one()
        try:
            ep.save_config(conn,cfg,{**ep.DEFAULTS,'secret':''})
            for name,role,username in [('employee','AUTHOR','b0'+str(int(new_id().replace('-','')[:9],16))),('admin','ADMIN','browser.employee.admin.'+new_id()[:8])]:
                values=dict(username=username,full_name='TEST ONLY '+name,login_type='LDAP' if name=='employee' else 'STANDARD',must_change_password_flag=0,password_hash=None if name=='employee' else hash_password(password))
                if name=='employee':values.update(needs_email_confirmation_flag=1,needs_department_selection_flag=1)
                identifier=insert(m.user,**values);insert(m.user_role,user_id=identifier,role_id=lookup(m.role,role),global_scope_flag=1,effective_from=date.today())
                credentials[name]={'username':username,'password':password,'id':identifier}
            def write_private(path,value):
                descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
                with os.fdopen(descriptor,'w') as output:json.dump(value,output)
            write_private(credential_path,credentials);write_private(control_path,{'mode':'failure'})
            def directory(db,settings,username,supplied):
                if username!=credentials['employee']['username'] or supplied!=password:return None
                control=json.loads(control_path.read_text())
                return dict(username=username,source='ldap',ldap_department_code=control.get('ldap_department','LDAP-054'))
            auth.authenticate_directory=directory
            original_lookup=ep.lookup
            def mock_lookup(configuration,pf,settings):
                def respond(request):
                    control=json.loads(control_path.read_text())
                    if control['mode']=='failure':return httpx.Response(503)
                    return httpx.Response(200,json=dict(pfNo=pf,empName=control.get('employee_name','TEST ONLY employee'),designation=control.get('designation','Synthetic Manager'),branchCode='0001',branchName='Registered branch',currBranch='0002',zoneCode='0099',zoneName='Example zone',deptCode=control.get('department_code','0054-QA'),deptName=control.get('department_name','QA Team'),status='Active'))
                return original_lookup(configuration,pf,settings,httpx.MockTransport(respond))
            ep.lookup=mock_lookup
            fixture_cfg=replace(cfg,secure_cookie=False,storage=Path(folder)/'files',log_dir=Path(folder)/'logs',origins=(*cfg.origins,'http://127.0.0.1:8011'))
            app=create_app(fixture_cfg,engine)
            def db_override():
                with lock,Session(bind=conn,join_transaction_mode='create_savepoint') as session:
                    try:yield session;session.commit()
                    except Exception:session.rollback();raise
            app.dependency_overrides[get_db]=db_override
            def consume(claims):
                with lock,conn.begin_nested():record_challenge(conn,claims)
            app.state.consume_login_challenge=consume
            class FixtureEngine:
                @contextmanager
                def begin(self):
                    with lock,conn.begin_nested():yield conn
            def retry():
                while not stop.wait(.5):ep.retry_batch(FixtureEngine(),fixture_cfg)
            thread=threading.Thread(target=retry,daemon=True);thread.start()
            print('Rollback-only employee browser fixture ready on 8011.',flush=True)
            uvicorn.run(app,host='127.0.0.1',port=8011,log_level='warning')
        finally:
            stop.set()
            if 'thread' in locals():thread.join(15)
            transaction.rollback()
            for path in [credential_path,control_path]:path.unlink(missing_ok=True)
    engine.dispose()

if __name__=='__main__':main()
