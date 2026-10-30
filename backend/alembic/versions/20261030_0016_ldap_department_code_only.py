"""Use only LDAP department codes; retain code approval and audit history."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261030_0016'
down_revision = '20261029_0015'
branch_labels = depends_on = None


def _history_guard():
    immutable = ('id', 'created_at', 'user_id', 'previous_code', 'proposed_code',
                 'observed_at', 'observation_id', 'requested_by', 'requested_at', 'request_reason')
    changes = '\n    OR '.join(
        f'(:OLD.{name} <> :NEW.{name} OR (:OLD.{name} IS NULL AND :NEW.{name} IS NOT NULL) '
        f'OR (:OLD.{name} IS NOT NULL AND :NEW.{name} IS NULL))' for name in immutable)
    op.execute(sa.DDL(f'''CREATE OR REPLACE TRIGGER cbd_ldap_dept_history_guard
BEFORE UPDATE OR DELETE ON cbd_ldap_department_request FOR EACH ROW
BEGIN
  IF DELETING THEN
    RAISE_APPLICATION_ERROR(-20150, 'LDAP department request history must be retained');
  END IF;
  IF :OLD.status <> 'PENDING' THEN
    RAISE_APPLICATION_ERROR(-20151, 'Decided LDAP department requests are immutable');
  END IF;
  IF {changes} THEN
    RAISE_APPLICATION_ERROR(-20152, 'LDAP department request evidence is immutable');
  END IF;
  IF :NEW.status NOT IN ('APPROVED','REJECTED','SUPERSEDED','OBSOLETE') THEN
    RAISE_APPLICATION_ERROR(-20153, 'Invalid LDAP department decision transition');
  END IF;
END;'''))


def upgrade():
    # Replace the name-dependent guard first. Oracle DDL commits independently;
    # resume safely after interrupted DDL without altering retained code evidence.
    _history_guard()
    for table, columns in (
        ('cbd_user', ('ldap_department_name', 'ldap_last_seen_department_name')),
        ('cbd_ldap_department_request', ('previous_name', 'proposed_name')),
    ):
        present = None if context.is_offline_mode() else {
            column['name'] for column in sa.inspect(op.get_bind()).get_columns(table)}
        for column in columns:
            if present is None or column in present:
                op.drop_column(table, column)
    _history_guard()
    # Column DDL can invalidate unrelated user-row retention triggers.
    op.execute('''BEGIN
      FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%' AND status = 'ENABLED') LOOP
        EXECUTE IMMEDIATE 'ALTER TRIGGER "' || item.trigger_name || '" COMPILE';
      END LOOP;
    END;''')


def downgrade():
    raise RuntimeError('Removed LDAP name fields cannot be reconstructed. Use a reviewed backup recovery plan.')
