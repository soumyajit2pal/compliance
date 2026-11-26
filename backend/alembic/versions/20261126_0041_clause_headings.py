"""Mark generated document headings separately from source provisions."""
from alembic import op
import sqlalchemy as sa

revision = '20261126_0041'
down_revision = '20261125_0040'
branch_labels = depends_on = None


def upgrade():
    op.execute(sa.DDL("""
        DECLARE
            present NUMBER;
        BEGIN
            SELECT COUNT(*) INTO present FROM user_tab_columns
            WHERE table_name = 'CBD_REGULATORY_CLAUSE' AND column_name = 'HEADING_ONLY_FLAG';
            IF present = 0 THEN
                EXECUTE IMMEDIATE 'ALTER TABLE cbd_regulatory_clause ADD '
                    || '(heading_only_flag INTEGER DEFAULT 0 NOT NULL '
                    || 'CONSTRAINT ck_clause_heading_only CHECK (heading_only_flag IN (0, 1)))';
            END IF;
        END;
    """))
    op.execute(sa.DDL("""
        CREATE OR REPLACE TRIGGER cbd_clause_kind_guard
        BEFORE UPDATE OF heading_only_flag ON cbd_regulatory_clause FOR EACH ROW
        BEGIN
            IF :OLD.heading_only_flag <> :NEW.heading_only_flag THEN
                RAISE_APPLICATION_ERROR(-20032, 'Saved document headings and clauses keep their original record type.');
            END IF;
        END;
    """))


def downgrade():
    raise RuntimeError('Imported document headings are retained. Use a reviewed forward migration.')
