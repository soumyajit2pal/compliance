"""Temporary browser QA server on 8011; all database rows roll back on exit.

Explicit UAT opt-in only. No seed identity is changed and no bank content is
created. The regular portal remains on 8010. Delete no real history for cleanup.
"""
import sys,os,secrets,json,tempfile,threading
from pathlib import Path
from datetime import date,timedelta
from dataclasses import replace
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import sqlalchemy as sa
from sqlalchemy.orm import Session
import uvicorn
from backend.app.runtime import runtime_settings
from backend.app.main import create_app,get_db
from backend.app import models as m,repository as repo
from backend.app import authentication as fixture_auth
from backend.app.login_encryption import record_challenge, INVALID
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from backend.app.schemas import InstrumentInput,ClauseInput,VersionInput,Submit,Decision
from backend.app.security import hash_password
from backend.app.access import actor_for
from backend.app.events import new_id,now
from backend.app.source_documents import file_transaction

def main():
    cfg=runtime_settings()
    if os.getenv('CBD_RUN_ORACLE_TESTS')!='1' or cfg.environment!='uat':raise RuntimeError('Explicit UAT rollback-only opt-in required')
    # Cookies are scoped to the host, not the port. Keep the disposable preview
    # separate from the real portal's session on 8010 (this process only).
    fixture_auth.COOKIE='cbd_browser_fixture'
    engine=sa.create_engine(cfg.database_url,hide_parameters=True)
    lock=threading.Lock()
    secrets_path=ROOT/'var/browser-fixture-secrets.json'
    department_profile=ROOT/'var/browser-ldap-department.json'
    with tempfile.TemporaryDirectory(prefix='cbd-browser-qa-') as folder,engine.connect() as conn:
        transaction=conn.begin()
        def insert(table,**values):
            identifier=new_id();conn.execute(table.insert().values(id=identifier,**values));return identifier
        def lookup(table,code):return conn.execute(sa.select(table.c.id).where(table.c.code==code)).scalar_one()
        try:
            unit=insert(m.organisational_unit,code='BROWSER-'+new_id()[:8],name='TEST ONLY — Browser QA department',unit_type='DEPARTMENT',level_number=1,effective_from=date.today(),parent_org_unit_id=lookup(m.organisational_unit,'BANK'))
            domain=insert(m.regulatory_domain,code='TEST-'+new_id()[:8],name='TEST ONLY — browser domain',description='Rollback-only browser testing',scheme_id=lookup(m.taxonomy_scheme,'REGULATORY'),display_sequence=100,domain_owner_unit_id=unit,effective_from=date.today(),active_flag=1)
            credentials={};ids={}
            password=secrets.token_urlsafe(24)
            password_hash=hash_password(password)
            for name,role in [('author','AUTHOR'),('reviewer','REVIEWER'),('approver','APPROVER'),('admin','ADMIN'),('business','BUSINESS_OWNER'),('control','CONTROL_OWNER'),('evidence','EVIDENCE_OWNER'),('cco','CCO'),('zone','ZONE_VIEWER')]:
                username='browser.'+name+'.'+new_id()[:8]
                identifier=insert(m.user,username=username,full_name='Browser QA '+name.title(),password_hash=password_hash,org_unit_id=unit,must_change_password_flag=0)
                insert(m.user_role,user_id=identifier,role_id=lookup(m.role,role),global_scope_flag=int(name in {'author','reviewer','approver','admin','cco'}),scope_org_unit_id=None if name in {'author','reviewer','approver','admin','cco'} else unit,effective_from=date.today())
                ids[name]=identifier;credentials[name]={'username':username,'password':password}
            leave_fixture={}
            if os.getenv('CBD_LEAVE_BROWSER_QA')=='1':
                for name,role in [('authorcover','AUTHOR'),('reviewcover','REVIEWER')]:
                    username='browser.'+name+'.'+new_id()[:8]
                    identifier=insert(m.user,username=username,full_name='TEST ONLY '+name,password_hash=password_hash,org_unit_id=unit,must_change_password_flag=0)
                    insert(m.user_role,user_id=identifier,role_id=lookup(m.role,role),global_scope_flag=0,scope_org_unit_id=unit,effective_from=date.today())
                    ids[name]=identifier;credentials[name]={'username':username,'password':password}
                leave_fixture={'unit':unit,'users':ids}
            if os.getenv('CBD_DEPARTMENT_BROWSER_QA')=='1':
                # Isolated, authenticated LDAP subject with a mutable synthetic
                # directory observation. Never installed on the regular API.
                username='browser.ldap.'+new_id()[:8]
                identifier=insert(m.user,username=username,full_name='TEST ONLY LDAP department user',
                    login_type='LDAP',email='department@example.invalid',org_unit_id=unit,must_change_password_flag=0,
                    department_code='OLD-001',
                    ldap_last_seen_department_code='OLD-001',
                    ldap_department_status='VERIFIED',ldap_observation_id=new_id())
                insert(m.user_role,user_id=identifier,role_id=lookup(m.role,'BUSINESS_OWNER'),
                    global_scope_flag=0,scope_org_unit_id=unit,effective_from=date.today())
                ids['ldap']=identifier;credentials['ldap']={'username':username,'password':password}
                fd=os.open(department_profile,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
                with os.fdopen(fd,'w') as file:json.dump({'department_code':'OLD-001'},file)
                previous_directory=fixture_auth.authenticate_directory
                def fixture_directory(db,settings,name,supplied):
                    if name!=username:return previous_directory(db,settings,name,supplied)
                    if supplied!=password:return None
                    current=json.loads(department_profile.read_text())
                    return {'full_name':'TEST ONLY LDAP department user','email':'department@example.invalid',
                        'department_code':current.get('department_code'),'division':current.get('division'),'info':current.get('info'),'source':'uat_mock',
                        'attributes_available':True,'attributes':{'uid':[username],
                            'department':[current.get('department_code')],'division':[current.get('division')],
                            'info':[current.get('info')],**current.get('attributes',{})}}
                fixture_auth.authenticate_directory=fixture_directory
            if os.getenv('CBD_DEMO_BROWSER_QA')=='1':
                # Exercise demo states using disposable identities only. The real
                # ten reserved users and their passwords remain untouched.
                from backend.app import demo_access as demo
                demo.ROLE_SEED_USERS=[(item['username'],name,'',None,False)
                    for name,item in credentials.items()]
                for name,first_login in [('author',1),('admin',0)]:
                    conn.execute(m.user.update().where(m.user.c.id==ids[name]).values(
                        password_hash=hash_password(demo.DEMO_PASSWORD),must_change_password_flag=first_login))
                    credentials[name]['password']=demo.DEMO_PASSWORD
            storage=Path(folder)/'documents';storage.mkdir()
            document=new_id();raw=b'TEST ONLY. Browser QA fixture. This is not an RBI notification.'
            (storage/document).write_bytes(raw)
            import hashlib
            conn.execute(m.document.insert().values(id=document,file_name='TEST-ONLY-source.txt',storage_uri='portal://'+document,content_type='text/plain',file_size=len(raw),file_hash=hashlib.sha256(raw).hexdigest(),owner_unit_id=unit,confidentiality_class_id=lookup(m.confidentiality_class,'INTERNAL'),uploaded_by=ids['author'],uploaded_at=now()))
            author=actor_for(conn,ids['author'])
            fixture_regulator=lookup(m.regulator,'RBI')
            if os.getenv('CBD_NOTIFICATION_BROWSER_QA')=='1':
                fixture_regulator=insert(m.regulator,code='QAF'+new_id()[:8],name='TEST ONLY — family QA regulator',regulator_type='TEST',jurisdiction='TEST ONLY',effective_from=date.today())
            record=repo.create_instrument(conn,author,InstrumentInput(regulator_id=fixture_regulator,instrument_type_id=lookup(m.instrument_type,'MD'),primary_domain_id=domain,official_reference_number='TEST-BROWSER-'+new_id()[:8],title='TEST ONLY — Browser regulatory lifecycle',issue_date=date.today()-timedelta(days=30),effective_date=date.today()-timedelta(days=20),materiality='HIGH',regulatory_owner_unit_id=unit,interpretation_owner_user_id=ids['author'],source_document_id=document,confidentiality_class_id=lookup(m.confidentiality_class,'INTERNAL')))
            repo.add_clause(conn,author,record['version_id'],ClauseInput(code='QA-C1',heading='TEST ONLY source clause',clause_text='Synthetic original wording for browser testing.',internal_interpretation='A separate synthetic interpretation.',source_clause_reference='1'),imported=True)
            editions={}
            families_fixture={}
            obligations_fixture={}
            delivery_fixture={}
            if os.getenv('CBD_DELIVERY_BROWSER_QA')=='1':os.environ['CBD_OBLIGATION_BROWSER_QA']='1'
            if os.getenv('CBD_OBLIGATION_BROWSER_QA')=='1':
                from backend.app import obligations
                from backend.app.obligation_schemas import ObligationInput
                if os.getenv('CBD_OWNER_POPUP_BROWSER_QA')=='1':
                    username='browser.business2.'+new_id()[:8]
                    identifier=insert(m.user,username=username,full_name='TEST ONLY Replacement Business Owner',password_hash=password_hash,org_unit_id=unit,must_change_password_flag=0)
                    insert(m.user_role,user_id=identifier,role_id=lookup(m.role,'BUSINESS_OWNER'),global_scope_flag=0,scope_org_unit_id=unit,effective_from=date.today())
                    ids['business2']=identifier;credentials['business2']={'username':username,'password':password}
                repo.submit(conn,author,record['version_id'],Submit(reviewer_id=ids['reviewer'],approver_id=ids['approver'],comments='TEST ONLY Week 4 source submission'))
                repo.decide(conn,actor_for(conn,ids['reviewer']),record['version_id'],Decision(decision='REVIEW',comments='TEST ONLY independent source review'))
                repo.decide(conn,actor_for(conn,ids['approver']),record['version_id'],Decision(decision='APPROVE',comments='TEST ONLY independent source approval'))
                cid=conn.execute(sa.select(m.regulatory_clause.c.id).where(m.regulatory_clause.c.instrument_version_id==record['version_id'])).scalar_one()
                legal=insert(m.legal_entity,code='BROWSER-'+new_id()[:8],name='TEST ONLY legal entity')
                process=insert(m.process,code='BROWSER-'+new_id()[:8],name='TEST ONLY onboarding process',owner_unit_id=unit,criticality='HIGH')
                payload=dict(primary_clause_id=cid,title='TEST ONLY browser obligation',statement='Perform the synthetic customer identification requirement.',
                    internal_interpretation='Maintain the independent internal interpretation separately.',category_id=conn.execute(sa.select(m.obligation_category.c.id)).scalars().first(),
                    frequency_id=lookup(m.frequency,'MONTHLY'),primary_domain_id=domain,criticality='HIGH',breach_consequence='TEST ONLY material regulatory exposure.',
                    evidence_standard='Retain a dated review log and independent checker sign-off.',regulatory_owner_unit_id=unit,business_owner_unit_id=unit,
                    compliance_reviewer_user_id=ids['reviewer'],effective_from=date.today(),next_review_date=date.today()+timedelta(days=100),
                    owners=[dict(owner_role=role,user_id=ids[name],org_unit_id=unit,primary_owner_flag=primary) for role,name,primary in [('REGULATORY','author',True),('BUSINESS','business',True),('CONTROL','control',False)]],
                    applicability=[dict(legal_entity_id=legal,org_unit_id=unit,applicability_status='APPLICABLE',basis='TEST ONLY source-based applicability assessment.',next_review_date=date.today()+timedelta(days=100))],
                    processes=[dict(process_id=process,relevance_type='PRIMARY',criticality='HIGH')])
                coverage_units={}
                if os.getenv('CBD_COVERAGE_BROWSER_QA')=='1':
                    # Optional multi-department data for the grouped reader; all
                    # units, assignments and assessments share this rollback.
                    coverage_units['compliance']=unit
                    conn.execute(m.organisational_unit.update().where(m.organisational_unit.c.id==unit).values(name='TEST ONLY — Compliance'))
                    for code,label in [('retail','Retail Banking'),('operations','Operations')]:
                        coverage_units[code]=insert(m.organisational_unit,code='BROWSER-'+new_id()[:8],name='TEST ONLY — '+label,
                            unit_type='DEPARTMENT',level_number=2,effective_from=date.today(),parent_org_unit_id=unit)
                    payload.update(regulatory_owner_unit_id=coverage_units['compliance'],business_owner_unit_id=coverage_units['retail'],
                        owners=[dict(owner_role=role,user_id=ids[name],org_unit_id=coverage_units[department],primary_owner_flag=primary)
                            for role,name,department,primary in [('REGULATORY','author','compliance',True),('BUSINESS','business','retail',True),('CONTROL','control','retail',False),('EVIDENCE','evidence','operations',False)]],
                        applicability=[dict(legal_entity_id=legal,org_unit_id=coverage_units[department],applicability_status='APPLICABLE',
                            basis='TEST ONLY this department performs the stated onboarding activity.',next_review_date=date.today()+timedelta(days=100)) for department in ['retail','operations']])
                draft=obligations.create(conn,author,ObligationInput(**payload))
                if os.getenv('CBD_DELIVERY_BROWSER_QA')=='1':
                    from backend.app.obligation_schemas import Submission,ObligationDecision
                    obligations.submit(conn,author,draft['id'],Submission(approver_id=ids['approver'],comments='TEST ONLY real browser delivery fixture.',expected_revision=1))
                    for name,choice in [('reviewer','REVIEW'),('business','ACCEPT'),('control','ACCEPT'),('approver','APPROVE')]:
                        obligations.decide(conn,actor_for(conn,ids[name]),draft['id'],ObligationDecision(decision=choice,comments='TEST ONLY independent fixture decision.'))
                    delivery_fixture={'obligation_id':draft['id'],'unit':unit,'users':ids}
                legacy_scope=None
                if coverage_units:
                    legacy_scope=obligations.create(conn,author,ObligationInput(**{**payload,'title':'TEST ONLY — Retained entity scope without a department','applicability':payload['applicability'][:1]}))
                    # Read compatibility for a historical nullable model field;
                    # the current create API still requires a department.
                    conn.execute(m.obligation_applicability.update().where(m.obligation_applicability.c.obligation_id==legacy_scope['id']).values(org_unit_id=None))
                obligations_fixture={'draft':draft['id'],'payload':payload,'clause_id':cid,'legal_entity':legal,'process':process,'unit':unit,'users':ids,'coverage_units':coverage_units,'legacy_scope':legacy_scope}
            if os.getenv('CBD_NOTIFICATION_BROWSER_QA')=='1':
                root_clause=repo.add_clause(conn,author,record['version_id'],ClauseInput(heading='TEST ONLY parent five',clause_text='TEST ONLY original section five.',source_clause_reference='5',source_page_reference='Old page 5'))['id']
                parent_clause=repo.add_clause(conn,author,record['version_id'],ClauseInput(heading='TEST ONLY parent five point one',clause_text='TEST ONLY original paragraph five point one.',source_clause_reference='5.1',source_page_reference='Old page 6',parent_clause_id=root_clause))['id']
            if os.getenv('CBD_EDITION_BROWSER_QA')=='1' or os.getenv('CBD_NOTIFICATION_BROWSER_QA')=='1':
                def approve(version):
                    repo.submit(conn,author,version,Submit(reviewer_id=ids['reviewer'],approver_id=ids['approver'],comments='TEST ONLY fixture review'))
                    repo.decide(conn,actor_for(conn,ids['reviewer']),version,Decision(decision='REVIEW',comments='TEST ONLY independent fixture review'))
                    repo.decide(conn,actor_for(conn,ids['approver']),version,Decision(decision='APPROVE',comments='TEST ONLY independent fixture approval'))
                approve(record['version_id'])
                future=repo.add_version(conn,author,record['id'],VersionInput(version_number='3.0',version_date=date.today(),
                    effective_from=date.today()+timedelta(days=30),source_document_id=document,supersedes_version_id=record['version_id'],change_summary='TEST ONLY future-approved source'))
                repo.add_clause(conn,author,future['id'],ClauseInput(heading='TEST ONLY future clause',clause_text='TEST ONLY future source wording.',source_clause_reference='3'))
                approve(future['id'])
                draft=repo.add_version(conn,author,record['id'],VersionInput(version_number='2.0',version_date=date.today(),
                    effective_from=date.today(),source_document_id=document,supersedes_version_id=record['version_id'],change_summary='TEST ONLY draft replacement source'))
                repo.add_clause(conn,author,draft['id'],ClauseInput(heading='TEST ONLY draft clause',clause_text='TEST ONLY draft source wording.',
                    internal_interpretation='TEST ONLY draft interpretation.',source_clause_reference='2'))
                draft_only=repo.create_instrument(conn,author,InstrumentInput(regulator_id=fixture_regulator,instrument_type_id=lookup(m.instrument_type,'MD'),primary_domain_id=domain,
                    official_reference_number='TEST-DRAFT-ONLY-'+new_id()[:8],title='TEST ONLY — Draft-only source',issue_date=date.today(),effective_date=date.today(),materiality='MEDIUM',
                    regulatory_owner_unit_id=unit,interpretation_owner_user_id=ids['author'],source_document_id=document,confidentiality_class_id=lookup(m.confidentiality_class,'INTERNAL')))
                editions={'approved':record['version_id'],'draft':draft['id'],'future':future['id'],'draft_only':draft_only}
            if os.getenv('CBD_NOTIFICATION_BROWSER_QA')=='1':
                from backend.app import notification_families as families
                from backend.app.schemas import FamilyLinkInput,FamilyScopeInput,FamilyAssessmentInput,FamilyDeadlineInput
                people={'reviewer_id':ids['reviewer'],'approver_id':ids['approver']}
                def approve_family(kind,identifier):
                    families.decide(conn,actor_for(conn,ids['reviewer']),kind,identifier,Decision(decision='REVIEW',comments='TEST ONLY independent family review'))
                    families.decide(conn,actor_for(conn,ids['approver']),kind,identifier,Decision(decision='APPROVE',comments='TEST ONLY independent family approval'))
                children=[]
                for label,offset in [('Pending implementation',-10),('Upcoming amendment',15)]:
                    child=repo.create_instrument(conn,author,InstrumentInput(regulator_id=fixture_regulator,instrument_type_id=lookup(m.instrument_type,'MD'),primary_domain_id=domain,
                        official_reference_number='TEST-AMEND-'+new_id()[:8],title='TEST ONLY — '+label,issue_date=date.today()-timedelta(days=15),effective_date=date.today()+timedelta(days=offset),
                        regulatory_owner_unit_id=unit,interpretation_owner_user_id=ids['author'],source_document_id=document,confidentiality_class_id=lookup(m.confidentiality_class,'INTERNAL')))
                    repo.add_clause(conn,author,child['version_id'],ClauseInput(heading='TEST ONLY separately issued clause',clause_text='TEST ONLY separate source wording.',source_clause_reference='5.1'))
                    approve(child['version_id'])
                    proposal=families.propose_link(conn,author,record['id'],FamilyLinkInput(child_id=child['id'],relationship_type='AMENDS',effective_from=date.today()+timedelta(days=offset),basis='TEST ONLY independently checked amendment relationship.',**people))
                    approve_family('link',proposal['id']);children.append(child)
                sid=families.register_scope(conn,author,record['id'],FamilyScopeInput(org_unit_id=unit,owner_user_id=ids['business'],effective_from=date.today()))['id']
                # Retained registration: current UI no longer creates manual scopes.
                families.register_scope(conn,author,children[0]['id'],FamilyScopeInput(org_unit_id=unit,owner_user_id=ids['business'],effective_from=date.today()))
                assessment=families.propose_assessment(conn,actor_for(conn,ids['business']),sid,FamilyAssessmentInput(source_version_id=record['version_id'],outcome='NO_IMPACT',rationale='TEST ONLY independently checked no-impact conclusion.',**people))
                approve_family('assessment',assessment['id'])
                for offset,due in [(0,60),(10,100)]:
                    proposal=families.propose_deadline(conn,author,record['id'],FamilyDeadlineInput(source_version_id=record['version_id'],effective_from=date.today()+timedelta(days=offset),due_date=date.today()+timedelta(days=due),basis='TEST ONLY source-cited regulatory due date.',**people))
                    approve_family('deadline',proposal['id'])
                families_fixture={'root':record['id'],'child':children[0],'upcoming':children[1],'root_clause':root_clause,'parent_clause':parent_clause,'unit':unit,'users':ids}
            app=create_app(replace(cfg,storage=storage,log_dir=Path(folder)/'logs',secure_cookie=False,
                origins=(*cfg.origins,'http://127.0.0.1:8011')),engine)
            def consume_fixture_challenge(claims):
                with lock:
                    try:
                        with Session(bind=conn,join_transaction_mode='create_savepoint') as session:
                            record_challenge(session,claims);session.commit()
                    except IntegrityError as exc:raise HTTPException(400,INVALID) from exc
            app.state.consume_login_challenge=consume_fixture_challenge
            def db_override():
                with lock:
                    session=Session(bind=conn,join_transaction_mode='create_savepoint',expire_on_commit=False)
                    try:
                        with file_transaction(session):
                            yield session
                            session.commit()
                    except Exception:
                        session.rollback();raise
                    finally:session.close()
            app.dependency_overrides[get_db]=db_override
            fd=os.open(secrets_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
            with os.fdopen(fd,'w') as output:json.dump({'credentials':credentials,'record':record,'source_document':document,'editions':editions,'families':families_fixture,'obligations':obligations_fixture,'delivery':delivery_fixture,'leave':leave_fixture},output,default=str)
            print('Rollback-only browser fixture ready on 8011. Credentials saved to ignored owner-only file.',flush=True)
            uvicorn.run(app,host='127.0.0.1',port=8011,log_level='warning')
        finally:
            transaction.rollback()
            if secrets_path.exists():secrets_path.unlink()
            if department_profile.exists():department_profile.unlink()
    engine.dispose()

if __name__=='__main__':main()
