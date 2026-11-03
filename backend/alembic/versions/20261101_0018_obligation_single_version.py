"""Serialize pending/active obligations by immutable business code at the DB layer."""
from alembic import op,context
import sqlalchemy as sa

revision='20261101_0018'
down_revision='20261101_0017'
branch_labels=depends_on=None


def upgrade():
    if not context.is_offline_mode():
        for predicate in ["record_status = 'ACTIVE'","approval_status IN ('DRAFT','IN_REVIEW','REVIEWED')"]:
            duplicates=op.get_bind().execute(sa.text('SELECT code FROM cbd_compliance_obligation WHERE '+predicate+' GROUP BY code HAVING COUNT(*) > 1')).first()
            if duplicates:raise RuntimeError('Conflicting obligation versions require reviewed correction. No existing rows were removed.')
    op.create_index('uq_cbd_obligation_active','cbd_compliance_obligation',
        [sa.text("CASE WHEN record_status = 'ACTIVE' THEN code END")],unique=True)
    op.create_index('uq_cbd_obligation_pending','cbd_compliance_obligation',
        [sa.text("CASE WHEN approval_status IN ('DRAFT','IN_REVIEW','REVIEWED') THEN code END")],unique=True)


def downgrade():
    raise RuntimeError('Review concurrency protections before changing obligation version rules.')
