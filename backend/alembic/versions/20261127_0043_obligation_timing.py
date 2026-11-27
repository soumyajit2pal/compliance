"""Record an event trigger or a one-time task deadline with the obligation revision."""
from alembic import op
import sqlalchemy as sa

revision = '20261127_0043'
down_revision = '20261126_0042'
branch_labels = depends_on = None


def upgrade():
    op.execute(sa.DDL("""
        DECLARE
            present NUMBER;
        BEGIN
            SELECT COUNT(*) INTO present FROM user_tab_columns
                WHERE table_name = 'CBD_COMPLIANCE_OBLIGATION' AND column_name = 'TASK_TRIGGER';
            IF present = 0 THEN
                EXECUTE IMMEDIATE 'ALTER TABLE cbd_compliance_obligation ADD (task_trigger VARCHAR2(500 CHAR))';
            END IF;
            SELECT COUNT(*) INTO present FROM user_tab_columns
                WHERE table_name = 'CBD_COMPLIANCE_OBLIGATION' AND column_name = 'TASK_DUE_DATE';
            IF present = 0 THEN
                EXECUTE IMMEDIATE 'ALTER TABLE cbd_compliance_obligation ADD (task_due_date DATE)';
            END IF;
        END;
    """))
    op.execute(sa.DDL("""
        CREATE OR REPLACE TRIGGER cbd_obligation_timing_guard
        BEFORE UPDATE OF task_trigger, task_due_date ON cbd_compliance_obligation
        FOR EACH ROW
        BEGIN
            IF :OLD.approval_status = 'APPROVED' THEN
                RAISE_APPLICATION_ERROR(-20005, 'Approved obligation timing requires a new revision.');
            END IF;
        END;
    """))


def downgrade():
    raise RuntimeError('Obligation timing details are retained. Use a reviewed forward migration.')
