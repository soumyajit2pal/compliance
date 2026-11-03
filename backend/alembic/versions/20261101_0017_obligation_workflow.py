"""Week 4 obligation revision control and retained named ownership validation."""
from alembic import op
import sqlalchemy as sa

revision='20261101_0017'
down_revision='20261030_0016'
branch_labels=depends_on=None


def upgrade():
    op.add_column('cbd_compliance_obligation',sa.Column('edit_revision',sa.Integer(),server_default=sa.text('1'),nullable=False))
    op.add_column('cbd_compliance_obligation',sa.Column('content_validation_status',sa.String(30),server_default=sa.text("'PENDING'"),nullable=False))
    op.create_table('cbd_obligation_validation_task',
        sa.Column('id',sa.String(36),server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))'),nullable=False),
        sa.Column('created_at',sa.DateTime(),server_default=sa.text('SYSTIMESTAMP'),nullable=False),
        sa.Column('owner_id',sa.String(36),nullable=False),sa.Column('task_id',sa.String(36),nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['owner_id'],['cbd_obligation_owner.id']),
        sa.ForeignKeyConstraint(['task_id'],['cbd_workflow_action.id']),sa.UniqueConstraint('task_id'))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_retain_obligation_validation
        BEFORE UPDATE OR DELETE ON cbd_obligation_validation_task
        BEGIN RAISE_APPLICATION_ERROR(-20080,'Named ownership validation history must be retained.'); END;"""))
    # Adding columns invalidates dependent Oracle PL/SQL, even when unchanged.
    for name in ['cbd_active_obligation_guard','cbd_primary_owner_guard']:
        op.execute('ALTER TRIGGER '+name+' COMPILE')


def downgrade():
    raise RuntimeError('Retained obligation decisions cannot be destructively downgraded.')
