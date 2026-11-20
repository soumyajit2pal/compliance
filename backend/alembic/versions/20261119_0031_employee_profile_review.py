"""Unified employee profile approval; archive history before removing superseded schema."""
from alembic import op,context
import sqlalchemy as sa
revision='20261119_0031'
down_revision='20261119_0030'
branch_labels=depends_on=None

LEGACY_USER=['department_code', 'ldap_last_seen_department_code', 'ldap_division', 'ldap_last_seen_division', 'ldap_info', 'ldap_last_seen_info', 'ldap_department_checked_at', 'ldap_observation_id', 'ldap_department_status', 'emp_dept_managed_flag', 'emp_dept_approved_code', 'emp_dept_approved_name', 'emp_dept_approved_namespace', 'emp_dept_observed_code', 'emp_dept_observed_name', 'emp_dept_namespace', 'emp_dept_source', 'emp_dept_status', 'emp_dept_observation_id', 'emp_dept_checked_at', 'emp_dept_warning', 'emp_dept_api_approved_flag']
OLD_PROFILE=['employee_name', 'designation', 'branch_code', 'branch_name', 'current_branch_code', 'zone_code', 'zone_name', 'department_code', 'department_name', 'employee_status']
OLD_REQUEST=['id', 'created_at', 'user_id', 'previous_code', 'proposed_code', 'previous_division', 'proposed_division', 'previous_info', 'proposed_info', 'observation_id', 'observed_at', 'requested_by', 'requested_at', 'request_reason', 'status', 'decided_by', 'decided_at', 'decision_reason', 'identity_source', 'previous_namespace', 'proposed_namespace', 'previous_department_name', 'proposed_department_name', 'automatic_flag']
CREATE_TABLES=['\nCREATE TABLE cbd_employee_legacy_record (\n\tid VARCHAR2(36 CHAR) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) NOT NULL, \n\tcreated_at DATE DEFAULT SYSTIMESTAMP NOT NULL, \n\tuser_id VARCHAR2(36 CHAR) NOT NULL, \n\trecord_type VARCHAR2(30 CHAR) NOT NULL, \n\toriginal_id VARCHAR2(36 CHAR) NOT NULL, \n\tpayload CLOB NOT NULL, \n\tCONSTRAINT pk_primarykey_cbd_emp_98863b42 PRIMARY KEY (id), \n\tCONSTRAINT uq_unique_cbd_employe_c383be4e UNIQUE (record_type, original_id), \n\tCONSTRAINT fk_foreignkey_cbd_emp_d7cbdfec FOREIGN KEY(user_id) REFERENCES cbd_user (id)\n)\n\n', "\nCREATE TABLE cbd_employee_profile_version (\n\tid VARCHAR2(36 CHAR) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) NOT NULL, \n\tcreated_at DATE DEFAULT SYSTIMESTAMP NOT NULL, \n\tprofile_id VARCHAR2(36 CHAR) NOT NULL, \n\tfingerprint VARCHAR2(64 CHAR) NOT NULL, \n\tldap_department_code VARCHAR2(100 CHAR), \n\tldap_valid_flag INTEGER DEFAULT 0 NOT NULL, \n\tapi_complete_flag INTEGER DEFAULT 0 NOT NULL, \n\temployee_name VARCHAR2(250 CHAR), \n\tdesignation VARCHAR2(250 CHAR), \n\tbranch_code VARCHAR2(40 CHAR), \n\tbranch_name VARCHAR2(250 CHAR), \n\tcurrent_branch_code VARCHAR2(40 CHAR), \n\tzone_code VARCHAR2(40 CHAR), \n\tzone_name VARCHAR2(250 CHAR), \n\tdepartment_code VARCHAR2(100 CHAR), \n\tdepartment_name VARCHAR2(250 CHAR), \n\temployee_status VARCHAR2(40 CHAR), \n\tobservation_source VARCHAR2(20 CHAR) NOT NULL, \n\tobserved_at TIMESTAMP NOT NULL, \n\tapi_observed_at TIMESTAMP, \n\tCONSTRAINT pk_primarykey_cbd_emp_ac1f090b PRIMARY KEY (id), \n\tCONSTRAINT ck_employee_version_source CHECK (observation_source IN ('LOGIN','API_RETRY')), \n\tCONSTRAINT uq_unique_cbd_employe_7ae704c8 UNIQUE (profile_id, fingerprint), \n\tCONSTRAINT fk_foreignkey_cbd_emp_60e116f5 FOREIGN KEY(profile_id) REFERENCES cbd_employee_profile (id), \n\tCONSTRAINT ck_employee_pro_ldap_valid CHECK (ldap_valid_flag IN (0,1)), \n\tCONSTRAINT ck_employee_pro_api_comple CHECK (api_complete_flag IN (0,1))\n)\n\n", "\nCREATE TABLE cbd_employee_profile_review (\n\tid VARCHAR2(36 CHAR) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) NOT NULL, \n\tcreated_at DATE DEFAULT SYSTIMESTAMP NOT NULL, \n\tprofile_id VARCHAR2(36 CHAR) NOT NULL, \n\tversion_id VARCHAR2(36 CHAR) NOT NULL, \n\tprevious_version_id VARCHAR2(36 CHAR), \n\trequested_by VARCHAR2(36 CHAR) NOT NULL, \n\trequested_at TIMESTAMP NOT NULL, \n\trequest_reason VARCHAR2(1000 CHAR) NOT NULL, \n\tstatus VARCHAR2(20 CHAR) DEFAULT 'PENDING' NOT NULL, \n\tdecided_by VARCHAR2(36 CHAR), \n\tdecided_at TIMESTAMP, \n\tdecision_reason VARCHAR2(1000 CHAR), \n\tCONSTRAINT pk_primarykey_cbd_emp_c978bbbc PRIMARY KEY (id), \n\tCONSTRAINT ck_employee_review_status CHECK (status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED','OBSOLETE')), \n\tCONSTRAINT ck_employee_review_independent CHECK (status NOT IN ('APPROVED','REJECTED') OR (decided_by IS NOT NULL AND decided_by <> requested_by AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)), \n\tCONSTRAINT fk_foreignkey_cbd_emp_bb256858 FOREIGN KEY(profile_id) REFERENCES cbd_employee_profile (id), \n\tCONSTRAINT fk_foreignkey_cbd_emp_48e95cbf FOREIGN KEY(version_id) REFERENCES cbd_employee_profile_version (id), \n\tCONSTRAINT fk_foreignkey_cbd_emp_414b6f67 FOREIGN KEY(previous_version_id) REFERENCES cbd_employee_profile_version (id), \n\tCONSTRAINT fk_foreignkey_cbd_emp_419e32cb FOREIGN KEY(requested_by) REFERENCES cbd_user (id), \n\tCONSTRAINT fk_foreignkey_cbd_emp_57842919 FOREIGN KEY(decided_by) REFERENCES cbd_user (id)\n)\n\n"]
PROFILE_ADDITIONS=["status VARCHAR2(30 CHAR) DEFAULT 'UNVERIFIED' NOT NULL", 'approved_version_id VARCHAR2(36 CHAR)', 'latest_version_id VARCHAR2(36 CHAR)', 'warning VARCHAR2(500 CHAR)', 'ldap_checked_at DATE']
NEW_FKS=['ALTER TABLE cbd_employee_profile ADD CONSTRAINT fk_foreignkey_cbd_emp_397f6ed0 FOREIGN KEY(latest_version_id) REFERENCES cbd_employee_profile_version (id)', 'ALTER TABLE cbd_employee_profile ADD CONSTRAINT fk_foreignkey_cbd_emp_f4a309dd FOREIGN KEY(approved_version_id) REFERENCES cbd_employee_profile_version (id)', 'ALTER TABLE cbd_app_session ADD CONSTRAINT fk_foreignkey_cbd_app_0d6b38f7 FOREIGN KEY(employee_version_id) REFERENCES cbd_employee_profile_version (id)']

def exists(table):return context.is_offline_mode() or sa.inspect(op.get_bind()).has_table(table)
def columns(table):return None if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}
def archive(table,kind,fields,user='id'):
    present=columns(table)
    fields=[f for f in fields if present is None or f in present]
    if not fields:return
    pairs=','.join("'%s' VALUE t.%s"%(f,f) for f in fields)
    op.execute(sa.text("INSERT INTO cbd_employee_legacy_record (user_id,record_type,original_id,payload) SELECT t.%s,'%s',t.id,JSON_OBJECT(%s RETURNING CLOB) FROM %s t WHERE NOT EXISTS (SELECT 1 FROM cbd_employee_legacy_record a WHERE a.record_type='%s' AND a.original_id=t.id)"%(user,kind,pairs,table,kind)))

def upgrade():
    # Offline DDL is frozen in this revision; no imports from evolving application models.
    for ddl in CREATE_TABLES:
        name=ddl.split('CREATE TABLE ')[1].split()[0]
        if context.is_offline_mode() or not exists(name):op.execute(ddl)
    # Microsecond ordering avoids ambiguous consecutive observations/decisions.
    for table,names in [('cbd_employee_profile_version',['observed_at','api_observed_at']),('cbd_employee_profile_review',['requested_at','decided_at'])]:
        for name in names:
            if not context.is_offline_mode():
                current=next(c for c in sa.inspect(op.get_bind()).get_columns(table) if c['name']==name)
                if not isinstance(current['type'],sa.TIMESTAMP):op.execute('ALTER TABLE '+table+' MODIFY ('+name+' TIMESTAMP)')
    # All old employee evidence is archived before destructive column/table cleanup.
    archive('cbd_user','USER',LEGACY_USER)
    if exists('cbd_ldap_department_request'):archive('cbd_ldap_department_request','DEPARTMENT_REVIEW',OLD_REQUEST,'user_id')
    archive('cbd_employee_profile','API_PROFILE',['id','user_id','pf_no','account_name',*OLD_PROFILE,'last_success_at'],'user_id')
    for ddl in PROFILE_ADDITIONS:
        if columns('cbd_employee_profile') is None or ddl.split()[0] not in columns('cbd_employee_profile'):op.execute('ALTER TABLE cbd_employee_profile ADD '+ddl)
    if context.is_offline_mode() or not next(c for c in sa.inspect(op.get_bind()).get_columns('cbd_employee_profile') if c['name']=='pf_no')['nullable']:op.execute('ALTER TABLE cbd_employee_profile MODIFY (pf_no NULL)')
    if context.is_offline_mode() or 'ck_employee_profile_status' not in {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints('cbd_employee_profile')}:op.execute("ALTER TABLE cbd_employee_profile ADD CONSTRAINT ck_employee_profile_status CHECK (status IN ('UNVERIFIED','PENDING','REJECTED','RECHECK_REQUIRED','VERIFIED','UNAVAILABLE'))")
    if columns('cbd_app_session') is None or 'employee_version_id' not in columns('cbd_app_session'):op.add_column('cbd_app_session',sa.Column('employee_version_id',sa.String(36)))
    for ddl in NEW_FKS:
        parts=ddl.split();table=parts[2];name=parts[5]
        if context.is_offline_mode() or name.lower() not in {c['name'] for c in sa.inspect(op.get_bind()).get_foreign_keys(table)}:op.execute(ddl)
    if context.is_offline_mode() or 'ix_app_session_15b3e925' not in {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('cbd_app_session')}:op.execute('CREATE INDEX ix_app_session_15b3e925 ON cbd_app_session (employee_version_id)')
    if context.is_offline_mode() or 'uq_cbd_employee_pending' not in {i['name'] for i in sa.inspect(op.get_bind()).get_indexes('cbd_employee_profile_review')}:op.execute("CREATE UNIQUE INDEX uq_cbd_employee_pending ON cbd_employee_profile_review (CASE WHEN status='PENDING' THEN profile_id ELSE NULL END)")
    if exists('cbd_ldap_department_request'):op.drop_table('cbd_ldap_department_request')
    # No old session may continue across the changed approval contract.
    op.execute('UPDATE cbd_app_session SET revoked_flag=1 WHERE revoked_flag=0')
    for name in ['ck_user_ldap_department','ck_emp_dept_managed','ck_emp_dept_status','ck_emp_dept_api_approved']:
        if context.is_offline_mode() or name in {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints('cbd_user')}:op.drop_constraint(name,'cbd_user',type_='check')
    for table,names in [('cbd_user',LEGACY_USER),('cbd_employee_profile',OLD_PROFILE),('cbd_app_session',['ldap_observation_id'])]:
        for name in names:
            if columns(table) is None or name in columns(table):op.drop_column(table,name)
    for table,name in [('cbd_employee_profile_version','cbd_employee_version_guard'),('cbd_employee_legacy_record','cbd_employee_archive_guard')]:
        op.execute('CREATE OR REPLACE TRIGGER '+name+' BEFORE UPDATE OR DELETE ON '+table+" BEGIN RAISE_APPLICATION_ERROR(-20220,'Employee identity evidence is immutable.'); END;")
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_employee_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON cbd_employee_profile FOR EACH ROW
    DECLARE matches NUMBER;
    BEGIN
      IF DELETING THEN RAISE_APPLICATION_ERROR(-20221,'Employee profile history must be retained.'); END IF;
      IF INSERTING AND (:NEW.approved_version_id IS NOT NULL OR :NEW.latest_version_id IS NOT NULL OR :NEW.status<>'UNVERIFIED') THEN RAISE_APPLICATION_ERROR(-20223,'New employee profiles require independent setup.'); END IF;
      IF :OLD.user_id<>:NEW.user_id OR (:OLD.pf_no IS NOT NULL AND (:NEW.pf_no IS NULL OR :NEW.pf_no<>:OLD.pf_no)) THEN RAISE_APPLICATION_ERROR(-20222,'Employee identity binding is immutable.'); END IF;
      IF :NEW.approved_version_id IS NOT NULL AND (:OLD.approved_version_id IS NULL OR :NEW.approved_version_id<>:OLD.approved_version_id) THEN
        SELECT COUNT(*) INTO matches FROM cbd_employee_profile_review WHERE profile_id=:NEW.id AND version_id=:NEW.approved_version_id AND status='APPROVED' AND (previous_version_id=:OLD.approved_version_id OR (previous_version_id IS NULL AND :OLD.approved_version_id IS NULL));
        IF matches=0 THEN RAISE_APPLICATION_ERROR(-20223,'Independent profile approval required.'); END IF;
      ELSIF :OLD.approved_version_id IS NOT NULL AND :NEW.approved_version_id IS NULL THEN RAISE_APPLICATION_ERROR(-20223,'Approved profile cannot be cleared.'); END IF;
      IF :NEW.status='VERIFIED' AND (:NEW.approved_version_id IS NULL OR :NEW.latest_version_id IS NULL OR :NEW.latest_version_id<>:NEW.approved_version_id) THEN RAISE_APPLICATION_ERROR(-20224,'Only an approved current profile can be verified.'); END IF;
      IF :NEW.latest_version_id IS NOT NULL THEN
        SELECT COUNT(*) INTO matches FROM cbd_employee_profile_version WHERE id=:NEW.latest_version_id AND profile_id=:NEW.id;
        IF matches<>1 THEN RAISE_APPLICATION_ERROR(-20224,'Profile version ownership mismatch.'); END IF;
      END IF;
    END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_employee_review_guard BEFORE INSERT OR UPDATE OR DELETE ON cbd_employee_profile_review FOR EACH ROW
    DECLARE target_user VARCHAR2(36); latest VARCHAR2(36); approved VARCHAR2(36); valid_count NUMBER;
    BEGIN
      IF DELETING THEN RAISE_APPLICATION_ERROR(-20225,'Employee review history must be retained.'); END IF;
      SELECT user_id,latest_version_id,approved_version_id INTO target_user,latest,approved FROM cbd_employee_profile WHERE id=:NEW.profile_id;
      IF :NEW.requested_by<>target_user THEN RAISE_APPLICATION_ERROR(-20225,'Profile review owner mismatch.'); END IF;
      SELECT COUNT(*) INTO valid_count FROM cbd_employee_profile_version WHERE id=:NEW.version_id AND profile_id=:NEW.profile_id;
      IF valid_count<>1 THEN RAISE_APPLICATION_ERROR(-20225,'Profile review version mismatch.'); END IF;
      IF UPDATING THEN
        IF :OLD.status<>'PENDING' THEN RAISE_APPLICATION_ERROR(-20226,'Decided employee reviews are immutable.'); END IF;
        IF :OLD.id<>:NEW.id OR :OLD.profile_id<>:NEW.profile_id OR :OLD.version_id<>:NEW.version_id OR :OLD.requested_by<>:NEW.requested_by OR :OLD.requested_at<>:NEW.requested_at OR :OLD.created_at<>:NEW.created_at OR :OLD.request_reason<>:NEW.request_reason OR (:OLD.previous_version_id<>:NEW.previous_version_id) OR (:OLD.previous_version_id IS NULL AND :NEW.previous_version_id IS NOT NULL) OR (:OLD.previous_version_id IS NOT NULL AND :NEW.previous_version_id IS NULL) THEN RAISE_APPLICATION_ERROR(-20227,'Profile review evidence is immutable.'); END IF;
        IF :NEW.status IN ('APPROVED','REJECTED') THEN
          IF latest IS NULL OR latest<>:NEW.version_id OR (approved<>:NEW.previous_version_id) OR (approved IS NULL AND :NEW.previous_version_id IS NOT NULL) OR (approved IS NOT NULL AND :NEW.previous_version_id IS NULL) THEN RAISE_APPLICATION_ERROR(-20228,'Profile review is stale.'); END IF;
          SELECT COUNT(*) INTO valid_count FROM cbd_employee_profile_version WHERE id=:NEW.version_id AND ldap_valid_flag=1 AND api_complete_flag=1;
          IF valid_count<>1 THEN RAISE_APPLICATION_ERROR(-20228,'Complete identity evidence is required.'); END IF;
        END IF;
        IF :NEW.status NOT IN ('APPROVED','REJECTED','SUPERSEDED','OBSOLETE') THEN RAISE_APPLICATION_ERROR(-20229,'Invalid profile review transition.'); END IF;
      ELSE
        IF :NEW.status<>'PENDING' THEN RAISE_APPLICATION_ERROR(-20229,'New profile review must be pending.'); END IF;
        IF latest IS NULL OR latest<>:NEW.version_id OR (approved<>:NEW.previous_version_id) OR (approved IS NULL AND :NEW.previous_version_id IS NOT NULL) OR (approved IS NOT NULL AND :NEW.previous_version_id IS NULL) THEN RAISE_APPLICATION_ERROR(-20228,'New profile review must match the current observation and approval.'); END IF;
      END IF;
    END;"""))
    op.execute("""BEGIN FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%' AND status='ENABLED') LOOP EXECUTE IMMEDIATE 'ALTER TRIGGER "' || item.trigger_name || '" COMPILE'; END LOOP; END;""")

def downgrade():raise RuntimeError('Profile and archived approval evidence must be retained; use reviewed recovery.')
