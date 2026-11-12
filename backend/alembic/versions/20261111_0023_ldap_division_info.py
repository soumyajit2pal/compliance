"""Retain approved/observed LDAP division and info with immutable request evidence."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261111_0023'
down_revision = '20261108_0022'
branch_labels = depends_on = None


def upgrade():
    for table, columns in (
        ('cbd_user', (('ldap_division',250), ('ldap_last_seen_division',250),
                      ('ldap_info',2000), ('ldap_last_seen_info',2000))),
        ('cbd_ldap_department_request', (('previous_division',250), ('proposed_division',250),
                                         ('previous_info',2000), ('proposed_info',2000))),
    ):
        present = {} if context.is_offline_mode() else {
            column['name']:column for column in sa.inspect(op.get_bind()).get_columns(table)}
        for name,length in columns:
            if name not in present:
                op.add_column(table, sa.Column(name,sa.String(length),nullable=True))
            elif (not isinstance(present[name]['type'],sa.String)
                  or present[name]['type'].length!=length or not present[name]['nullable']):
                raise RuntimeError(f'Existing {table}.{name} does not match the LDAP identity migration.')

    immutable = ('id','created_at','user_id','previous_code','proposed_code',
                 'previous_division','proposed_division','previous_info','proposed_info',
                 'observed_at','observation_id','requested_by','requested_at','request_reason')
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
    op.execute('''BEGIN
      FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%' AND status = 'ENABLED') LOOP
        EXECUTE IMMEDIATE 'ALTER TRIGGER "' || item.trigger_name || '" COMPILE';
      END LOOP;
    END;''')


def downgrade():
    raise RuntimeError('LDAP division/info approval evidence must be retained. Use a reviewed backup recovery plan.')
