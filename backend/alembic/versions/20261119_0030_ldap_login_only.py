"""LDAP authentication only; preserve department approval provenance and history."""
from alembic import op,context
import sqlalchemy as sa
revision='20261119_0030'
down_revision='20261119_0029'
branch_labels=depends_on=None

def upgrade():
    offline=context.is_offline_mode()
    columns=set() if offline else {c['name'] for c in sa.inspect(op.get_bind()).get_columns('cbd_user')}
    if 'emp_dept_api_approved_flag' not in columns:
        op.add_column('cbd_user',sa.Column('emp_dept_api_approved_flag',sa.Integer(),nullable=False,server_default=sa.text('0')))
    checks=set() if offline else {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints('cbd_user')}
    if 'ck_emp_dept_api_approved' not in checks:
        op.create_check_constraint('ck_emp_dept_api_approved','cbd_user','emp_dept_api_approved_flag IN (0,1)')
    # Record provenance only when retained independent API approval already proves it.
    # No LDAP code is re-labelled as an API approval, and no access state is changed.
    op.execute(sa.text("""UPDATE cbd_user u SET emp_dept_api_approved_flag=1
      WHERE u.emp_dept_approved_namespace='API' AND EXISTS (
        SELECT 1 FROM cbd_ldap_department_request r WHERE r.user_id=u.id
        AND r.status='APPROVED' AND r.identity_source='EMPLOYEE_API'
        AND r.proposed_namespace='API' AND r.proposed_code=u.emp_dept_approved_code
        AND NOT EXISTS (SELECT 1 FROM cbd_ldap_department_request newer
          WHERE newer.user_id=u.id AND newer.status='APPROVED' AND newer.identity_source<>'EMPLOYEE_API'
          AND newer.decided_at>=r.decided_at))"""))
    op.execute('''BEGIN
      FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%' AND status='ENABLED') LOOP
        EXECUTE IMMEDIATE 'ALTER TRIGGER "' || item.trigger_name || '" COMPILE';
      END LOOP;
    END;''')

def downgrade():raise RuntimeError('Approval provenance and historical audit must be retained; use reviewed recovery.')
