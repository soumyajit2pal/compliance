"""Retain source interpretation exceptions and separate clause decisions."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261124_0038'
down_revision = '20261124_0037'
branch_labels = depends_on = None


def upgrade():
    bind = None if context.is_offline_mode() else op.get_bind()
    inspector = sa.inspect(bind) if bind is not None else None
    workflow = 'cbd_workflow_instance'
    request = 'cbd_clause_interpretation_request'
    if inspector is None or 'interpretation_exception_reason' not in {
        column['name'] for column in inspector.get_columns(workflow)
    }:
        op.add_column(workflow, sa.Column('interpretation_exception_reason', sa.Text()))
    if inspector is None or not inspector.has_table(request):
        op.create_table(request,
            sa.Column('id', sa.String(36), primary_key=True, server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('SYSTIMESTAMP')),
            sa.Column('clause_id', sa.String(36), sa.ForeignKey('cbd_regulatory_clause.id'), nullable=False),
            sa.Column('workflow_id', sa.String(36), sa.ForeignKey(workflow + '.id'), nullable=False, unique=True),
            sa.Column('interpretation', sa.Text(), nullable=False),
            sa.Column('reason', sa.Text(), nullable=False))
    if bind is None or 'ix_cbd_interpretation_clause' not in {
        index['name'] for index in sa.inspect(bind).get_indexes(request)
    }:
        op.create_index('ix_cbd_interpretation_clause', request, ['clause_id'])
    if bind is None or not bind.execute(sa.text(
        "SELECT 1 FROM user_indexes WHERE index_name = 'CBD_INTERPRETATION_CTX'"
    )).first():
        op.execute(sa.DDL("CREATE INDEX cbd_interpretation_ctx ON cbd_clause_interpretation_request (interpretation) "
            "INDEXTYPE IS CTXSYS.CONTEXT PARAMETERS ('FILTER CTXSYS.NULL_FILTER STOPLIST CTXSYS.EMPTY_STOPLIST "
            "MAINTENANCE MANUAL SYNC (ON COMMIT) TRANSACTIONAL')"))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_interpretation_retention
        BEFORE UPDATE OR DELETE ON cbd_clause_interpretation_request FOR EACH ROW
        BEGIN RAISE_APPLICATION_ERROR(-20103, 'Submitted clause interpretations must be retained.'); END;"""))


def downgrade():
    raise RuntimeError('Clause interpretation decisions are retained. Use a reviewed forward migration.')
