"""Remove superseded installation seed records without changing current access.

Targets are frozen UUIDs, not a blanket inactive-row or expired-history purge.
Business references and active records block removal. An audit exception is
restricted to three identified seed-only entries and the migration session;
the append-only trigger is restored before the revision completes.
"""
from datetime import date

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import oracle

revision = "20261017_0007"
down_revision = "20261017_0006"
branch_labels = None
depends_on = None
START = date(2026, 10, 17)
SESSION_MARKER = "CBD_SEED_CLEANUP_0007"
CLEANUP_EVENT_ID = "3840c52f-2672-5d04-8e0c-66cfd19ad2cc"

REMOVAL_IDS = {'audit_log': ['16f05df1-af2a-5fce-a3ba-5edb09a7525a',
               '81055747-55ac-58ff-9ed5-f4545ff1c1a2',
               'e08e9715-85f2-5760-bc54-2179fc60bc5d'],
 'organisational_unit': ['9efe49bc-fd54-5ac7-9140-ba1d8fab77fb', '42b74f22-f1a4-5597-821c-c7c8fed9104e'],
 'role': ['22bd263f-c0f7-5d51-89ea-f70bdc7edf59',
          '5042989b-1b30-5fab-bd12-d56335e376cb',
          'e028ecd9-6b0a-58ca-a2d1-d5a6c711ed0c'],
 'user': ['66d24125-f3b6-58fa-9ec8-24fa37d60c46',
          '505ddd63-4f32-5fd2-868d-afd5e1e765dd',
          '5d98dd3b-b3ea-5c2f-9987-3d003b43c436'],
 'user_role': ['137cb331-36f2-520c-8724-a19a703e577a',
               '180d2813-1b8b-5aaa-ac35-6af91f375a9c',
               '458f8e8b-2acb-54aa-a7cd-d66b59cec80a',
               '6bc31e78-bae8-5828-aad7-080bb036493f',
               '6f632677-958e-5748-9d1c-2ebfec677af5',
               '7f5f2c37-2231-5166-9931-0253e090a1be',
               'ab00fe06-5e58-5532-b114-fa2e56f6e3b8',
               'acaba536-3d7a-5467-a772-a417f68dd2cf',
               'd3eb6ce1-022b-50fc-9e46-e9449cf99f58',
               'ec4620ac-793e-5091-aae6-d8f1440e26df']}

AUDIT_GUARD = """CREATE OR REPLACE TRIGGER cbd_guard_028
BEFORE UPDATE OR DELETE ON cbd_audit_log
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  RAISE_APPLICATION_ERROR(-20002, 'Retained audit, status and source metadata is append-only.');
END;"""


def _literal(value):
    return str(sa.literal(value).compile(dialect=oracle.dialect(), compile_kwargs={"literal_binds": True}))


def _ids(table):
    return ', '.join(_literal(identifier) for identifier in REMOVAL_IDS[table])


def _preflight_checks():
    checks = []
    for table in ('user', 'role', 'organisational_unit'):
        checks.append(f"""
          SELECT COUNT(*) INTO found_count FROM cbd_{table} WHERE id IN ({_ids(table)}) AND active_flag <> 0;
          IF found_count <> 0 THEN RAISE_APPLICATION_ERROR(-20070, 'Cleanup target is active: cbd_{table}'); END IF;
        """)
        exclusions = []
        for child in ('user', 'user_role', 'organisational_unit', 'audit_log'):
            predicate = f" AND child.id NOT IN ({_ids(child)})"
            exclusions.append(f"WHEN 'CBD_{child.upper()}' THEN {_literal(predicate)}")
        checks.append(f"""
          FOR fk_ref IN (
            SELECT child.table_name, cc.column_name FROM user_constraints child
              JOIN user_cons_columns cc ON cc.constraint_name = child.constraint_name
              WHERE child.constraint_type = 'R' AND child.r_constraint_name IN (
                SELECT constraint_name FROM user_constraints WHERE table_name = 'CBD_{table.upper()}' AND constraint_type = 'P')
          ) LOOP
            EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM "' || fk_ref.table_name || '" child WHERE child."'
              || fk_ref.column_name || '" IN ({_ids(table).replace(chr(39), chr(39) * 2)})'
              || CASE fk_ref.table_name {' '.join(exclusions)} ELSE '' END INTO found_count;
            IF found_count <> 0 THEN RAISE_APPLICATION_ERROR(-20072,
              'Cleanup target has other references in ' || fk_ref.table_name || '; explicit reassignment is required.'); END IF;
          END LOOP;
        """)
    checks.append(f"""
      SELECT COUNT(*) INTO found_count FROM cbd_user_role WHERE id IN ({_ids('user_role')})
        AND (effective_from <> {_literal(START)} OR effective_to IS NULL OR effective_to <> {_literal(START)});
      IF found_count <> 0 THEN RAISE_APPLICATION_ERROR(-20071, 'Cleanup assignment has a real effective period.'); END IF;
      SELECT COUNT(*) INTO found_count FROM cbd_audit_log WHERE id IN ({_ids('audit_log')})
        AND (entity_type <> 'user' OR entity_id NOT IN ({_ids('user')}) OR action <> 'RETIRE_SEED_ACCESS'
          OR channel IS NULL OR channel <> 'ALEMBIC' OR actor_user_id IS NOT NULL);
      IF found_count <> 0 THEN RAISE_APPLICATION_ERROR(-20073, 'Cleanup audit entry is not the identified seed-only event.'); END IF;
      SELECT COUNT(*) INTO found_count FROM cbd_audit_log WHERE entity_id IN
        ({_ids('user')}, {_ids('role')}, {_ids('organisational_unit')}, {_ids('user_role')})
        AND id NOT IN ({_ids('audit_log')});
      IF found_count <> 0 THEN RAISE_APPLICATION_ERROR(-20074, 'Cleanup target has additional audit history.'); END IF;
    """)
    return '\n'.join(checks)


def _preflight():
    op.execute(sa.text('DECLARE found_count INTEGER; BEGIN\n' + _preflight_checks() + '\nEND;'))


def _cleanup_records():
    # A single PL/SQL statement keeps all removals and their summary atomic.
    removals = '\n'.join(
        f'DELETE FROM cbd_{table} WHERE id IN ({_ids(table)}); removed_{table} := SQL%ROWCOUNT;'
        for table in ('audit_log', 'user_role', 'user', 'role', 'organisational_unit'))
    declarations = '\n'.join(f'removed_{table} INTEGER;' for table in REMOVAL_IDS)
    locks = '\n'.join(f'LOCK TABLE cbd_{table} IN EXCLUSIVE MODE NOWAIT;' for table in REMOVAL_IDS)
    op.execute(sa.text(f"""
      DECLARE found_count INTEGER; previous_identifier VARCHAR2(64); {declarations}
      BEGIN
        previous_identifier := SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER');
        {locks}
        {_preflight_checks()}
        DBMS_SESSION.SET_IDENTIFIER({_literal(SESSION_MARKER)});
        {removals}
        MERGE INTO cbd_audit_log target
        USING (SELECT {_literal(CLEANUP_EVENT_ID)} id FROM dual) source ON (target.id = source.id)
        WHEN NOT MATCHED THEN INSERT (id, entity_type, entity_id, action, new_value, event_at, channel, reason)
          VALUES (source.id, 'system', {_literal(revision)}, 'CLEANUP_ACCESS_SEEDS',
            JSON_OBJECT('users_removed' VALUE removed_user, 'roles_removed' VALUE removed_role,
              'units_removed' VALUE removed_organisational_unit, 'assignments_removed' VALUE removed_user_role,
              'seed_audit_entries_removed' VALUE removed_audit_log), SYSTIMESTAMP, 'ALEMBIC',
            'User requested removal of superseded installation seed records.');
        DBMS_SESSION.SET_IDENTIFIER(previous_identifier);
      EXCEPTION WHEN OTHERS THEN
        DBMS_SESSION.SET_IDENTIFIER(previous_identifier);
        RAISE;
      END;
    """))


def _cleanup_guard():
    return f"""CREATE OR REPLACE TRIGGER cbd_guard_028
BEFORE UPDATE OR DELETE ON cbd_audit_log
FOR EACH ROW
BEGIN
  IF DELETING AND SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER') = {_literal(SESSION_MARKER)}
    AND :OLD.id IN ({_ids('audit_log')}) AND :OLD.entity_type = 'user'
    AND :OLD.entity_id IN ({_ids('user')}) AND :OLD.action = 'RETIRE_SEED_ACCESS'
    AND :OLD.channel = 'ALEMBIC' AND :OLD.actor_user_id IS NULL THEN
    NULL;
  ELSE
    IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
    RAISE_APPLICATION_ERROR(-20002, 'Retained audit, status and source metadata is append-only.');
  END IF;
END;"""


def upgrade():
    _preflight()
    # Oracle DDL commits independently. Validate first, repeat the checks under
    # locks in the atomic DML block, and always restore the exact original guard.
    try:
        op.execute(sa.DDL(_cleanup_guard()))
        _cleanup_records()
    finally:
        op.execute(sa.DDL(AUDIT_GUARD))


def downgrade():
    raise RuntimeError('Deleted installation seed records cannot be recreated by a downgrade.')
