"""Reconcile missing reference seeds and retain migration/decision source history."""
from alembic import op
import sqlalchemy as sa
from backend.alembic.foundation import references

revision = '20261024_0010'
down_revision = '20261024_0009'
branch_labels = depends_on = None


def upgrade():
    # Frozen, insert-only MERGE snapshot: retains every existing owner/profile decision.
    references.install()
    for table,fields,lobs in [
        ('migration_batch',['id','code','source_file','file_hash','uploaded_by','uploaded_at','source_count'],[]),
        ('migration_row',['id','batch_id','sheet_name','row_number','source_system','legacy_id'],['source_payload']),
        ('workflow_action',['id','instance_id','stage','assignee_user_id','due_at'],[]),
    ]:
        checks=[]
        for field in fields:
            checks.append(f"(:OLD.{field} <> :NEW.{field} OR (:OLD.{field} IS NULL AND :NEW.{field} IS NOT NULL) OR (:OLD.{field} IS NOT NULL AND :NEW.{field} IS NULL))")
        for field in lobs:
            checks.append(f"(DBMS_LOB.COMPARE(:OLD.{field},:NEW.{field}) <> 0 OR (:OLD.{field} IS NULL AND :NEW.{field} IS NOT NULL) OR (:OLD.{field} IS NOT NULL AND :NEW.{field} IS NULL))")
        decided="IF :OLD.decision IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20081,'A recorded workflow decision is immutable.'); END IF;" if table=='workflow_action' else ''
        op.execute(sa.DDL(f"""CREATE OR REPLACE TRIGGER cbd_retain_{table}
          BEFORE UPDATE OR DELETE ON cbd_{table} FOR EACH ROW
          BEGIN
            IF DELETING THEN RAISE_APPLICATION_ERROR(-20080,'Source and workflow history must be retained.'); END IF;
            IF UPDATING THEN
              IF {' OR '.join(checks)} THEN RAISE_APPLICATION_ERROR(-20080,'Original source/assignment metadata is immutable.'); END IF;
              {decided}
            END IF;
          END;"""))
    # Oracle invalidates dependent PL/SQL after adding user columns. Recompile the
    # existing retained closure guard as part of this deployment, not API startup.
    op.execute('ALTER TRIGGER cbd_close_observation_guard COMPILE')
    op.execute("""INSERT INTO cbd_audit_log (id,entity_type,entity_id,action,event_at,channel,reason)
       SELECT LOWER(RAWTOHEX(SYS_GUID())),'system','20261024_0010','RECONCILE_FOUNDATION',SYSTIMESTAMP,'ALEMBIC',
         'Insert-only frozen master reconciliation and retained migration/workflow history'
       FROM dual WHERE NOT EXISTS (SELECT 1 FROM cbd_audit_log WHERE entity_type='system'
         AND entity_id='20261024_0010' AND action='RECONCILE_FOUNDATION')""")


def downgrade():
    raise RuntimeError('Retained source history cannot be destructively downgraded.')
