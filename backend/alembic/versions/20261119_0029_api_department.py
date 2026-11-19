"""API-first department identity, source-aware retained requests and automatic review."""
from alembic import context,op
import sqlalchemy as sa
from sqlalchemy.dialects.oracle import TIMESTAMP
revision='20261119_0029'
down_revision='20261119_0028'
branch_labels=depends_on=None

def upgrade():
    columns={
      'cbd_user':[sa.Column('emp_dept_managed_flag',sa.Integer(),nullable=False,server_default=sa.text('0')),
        *[sa.Column(name,sa.String(size)) for name,size in [('emp_dept_approved_code',100),('emp_dept_approved_name',250),('emp_dept_approved_namespace',10),('emp_dept_observed_code',100),('emp_dept_observed_name',250),('emp_dept_namespace',10),('emp_dept_source',30),('emp_dept_status',30),('emp_dept_observation_id',36),('emp_dept_warning',500)]],
        sa.Column('emp_dept_checked_at',TIMESTAMP())],
      'cbd_ldap_department_request':[sa.Column('identity_source',sa.String(30),nullable=False,server_default=sa.text("'LEGACY_LDAP'")),
        *[sa.Column(name,sa.String(size)) for name,size in [('previous_namespace',10),('proposed_namespace',10),('previous_department_name',250),('proposed_department_name',250)]],
        sa.Column('automatic_flag',sa.Integer(),nullable=False,server_default=sa.text('0'))]}
    checks={'cbd_user':[('ck_emp_dept_managed','emp_dept_managed_flag IN (0,1)'),('ck_emp_dept_status',"emp_dept_status IS NULL OR emp_dept_status IN ('UNVERIFIED','VERIFIED','MISMATCH','UNAVAILABLE','RECHECK_REQUIRED')")],
      'cbd_ldap_department_request':[('ck_dept_request_source',"identity_source IN ('LEGACY_LDAP','EMPLOYEE_API','LDAP_FALLBACK')"),('ck_dept_request_auto','automatic_flag IN (0,1)')]}
    for table,additions in columns.items():
        present=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}
        for column in additions:
            if column.name not in present:op.add_column(table,column)
        present=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints(table)}
        for name,sql in checks[table]:
            if name not in present:op.create_check_constraint(name,table,sql)
    # Existing evidence/decision trigger remains; supplement it for new source fields.
    immutable=['identity_source','previous_namespace','proposed_namespace','previous_department_name','proposed_department_name','automatic_flag']
    changed=' OR '.join(f'(:OLD.{c}<>:NEW.{c} OR (:OLD.{c} IS NULL AND :NEW.{c} IS NOT NULL) OR (:OLD.{c} IS NOT NULL AND :NEW.{c} IS NULL))' for c in immutable)
    op.execute(sa.DDL(f'''CREATE OR REPLACE TRIGGER cbd_dept_source_guard BEFORE UPDATE ON cbd_ldap_department_request FOR EACH ROW
    BEGIN IF {changed} THEN RAISE_APPLICATION_ERROR(-20210,'Department source evidence is immutable.'); END IF; END;'''))
    # ALTER TABLE can invalidate dependent retained-control triggers in Oracle.
    op.execute('''BEGIN
      FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%' AND status = 'ENABLED') LOOP
        EXECUTE IMMEDIATE 'ALTER TRIGGER "' || item.trigger_name || '" COMPILE';
      END LOOP;
    END;''')

def downgrade():raise RuntimeError('Department source observations and review history must be retained; use reviewed recovery.')
