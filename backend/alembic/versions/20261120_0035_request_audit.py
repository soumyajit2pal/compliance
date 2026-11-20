"""Store safe request metadata alongside append-only audit events."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261120_0035'
down_revision = '20261120_0034'
branch_labels = depends_on = None


def upgrade():
    table = 'cbd_audit_log'
    inspector = None if context.is_offline_mode() else sa.inspect(op.get_bind())
    existing = set() if inspector is None else {item['name'] for item in inspector.get_columns(table)}
    indexes = set() if inspector is None else {item['name'] for item in inspector.get_indexes(table)}
    for name, kind in (
        ('client_ip', sa.String(45)), ('request_id', sa.String(36)), ('request_method', sa.String(12)),
        ('request_route', sa.String(250)), ('actor_username', sa.String(100)), ('actor_roles', sa.String(300)),
        ('user_agent', sa.String(512)), ('http_status', sa.Integer()), ('duration_ms', sa.Numeric(12, 2)),
    ):
        if name not in existing:
            op.add_column(table, sa.Column(name, kind, nullable=True))
    for name, columns in (
        ('ix_cbd_audit_timeline', ['event_at', 'id']),
        ('ix_cbd_audit_subject', ['entity_type', 'entity_id']),
        ('ix_cbd_audit_request', ['request_id', 'entity_type']),
    ):
        if name not in indexes:
            op.create_index(name, table, columns)


def downgrade():
    raise RuntimeError('Request audit history is retained. Use a reviewed forward migration.')
