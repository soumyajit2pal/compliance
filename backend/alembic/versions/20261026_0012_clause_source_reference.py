"""Separate official clause numbering from permanent system references."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261026_0012'
down_revision = '20261025_0011'
branch_labels = depends_on = None


def upgrade():
    columns = [] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_columns('cbd_regulatory_clause')
    existing = next((column for column in columns if column['name'].lower() == 'source_clause_reference'), None)
    if existing is None:
        op.add_column('cbd_regulatory_clause', sa.Column('source_clause_reference', sa.String(100), nullable=True))
    elif getattr(existing['type'], 'length', None) != 100 or not existing['nullable']:
        raise RuntimeError('The existing source_clause_reference column differs from this migration.')
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_clause_identity_guard
      BEFORE UPDATE ON cbd_regulatory_clause FOR EACH ROW
      BEGIN
        IF :OLD.code <> :NEW.code THEN
          RAISE_APPLICATION_ERROR(-20003,'Clause references are permanent.');
        END IF;
        IF :OLD.approval_status = 'APPROVED' AND (
          :OLD.source_clause_reference <> :NEW.source_clause_reference OR
          (:OLD.source_clause_reference IS NULL AND :NEW.source_clause_reference IS NOT NULL) OR
          (:OLD.source_clause_reference IS NOT NULL AND :NEW.source_clause_reference IS NULL)
        ) THEN
          RAISE_APPLICATION_ERROR(-20006,'Approved source numbering is immutable; create a new source version.');
        END IF;
      END;"""))
    op.execute('ALTER TRIGGER cbd_guard_006 COMPILE')


def downgrade():
    raise RuntimeError('Source numbering and permanent clause identity protections must be retained.')
