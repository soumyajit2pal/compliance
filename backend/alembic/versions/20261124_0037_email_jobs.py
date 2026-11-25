"""Capture notification mail in an Oracle outbox and support daily approval receipts."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261124_0037'
down_revision = '20261123_0036'
branch_labels = depends_on = None


def upgrade():
    table = 'cbd_email_job'
    inspector = None if context.is_offline_mode() else sa.inspect(op.get_bind())
    if inspector is None or not inspector.has_table(table):
        op.create_table(table,
            sa.Column('id', sa.String(36), primary_key=True, server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('SYS_EXTRACT_UTC(SYSTIMESTAMP)')),
            sa.Column('kind', sa.String(12), nullable=False),
            sa.Column('notification_id', sa.String(36), sa.ForeignKey('cbd_notification.id')),
            sa.Column('recipient_user_id', sa.String(36), sa.ForeignKey('cbd_user.id'), nullable=False),
            sa.Column('recipient_address', sa.String(254)),
            sa.Column('dedupe_key', sa.String(100), nullable=False, unique=True),
            sa.Column('status', sa.String(12), server_default='PENDING', nullable=False),
            sa.Column('attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
            sa.Column('digest_day', sa.Date()),
            sa.Column('next_attempt_at', sa.DateTime()), sa.Column('last_attempt_at', sa.DateTime()),
            sa.Column('claim_token', sa.String(36)), sa.Column('sent_at', sa.DateTime()),
            sa.Column('last_error', sa.String(60)),
            sa.CheckConstraint("(kind = 'EVENT' AND notification_id IS NOT NULL AND digest_day IS NULL) OR "
                "(kind = 'DIGEST' AND notification_id IS NULL AND digest_day IS NOT NULL) OR "
                "(kind = 'TEST' AND notification_id IS NULL AND digest_day IS NULL AND recipient_address IS NOT NULL)",
                name='ck_email_job_kind'),
            sa.CheckConstraint("status IN ('PENDING','SENDING','RETRY','SENT','FAILED','SKIPPED') AND attempts >= 0",
                name='ck_email_job_state'))
    indexes = set() if inspector is None else {index['name'] for index in sa.inspect(op.get_bind()).get_indexes(table)}
    for name, columns in [('ix_cbd_email_job_due', ['status','next_attempt_at','created_at']),
                          ('ix_cbd_email_job_history', ['created_at','id'])]:
        if name not in indexes:
            op.create_index(name, table, columns)
    for key in ('mail-settings', 'mail-digest'):
        op.execute(f"INSERT INTO cbd_id_counter (entity_type,prefix,next_value) SELECT '{key}','JOB',1 FROM dual "
                   f"WHERE NOT EXISTS (SELECT 1 FROM cbd_id_counter WHERE entity_type='{key}')")
    # Trigger runs in the notification transaction, including the scheduled reminders.
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_email_notification_queue
        AFTER INSERT ON cbd_notification FOR EACH ROW
        WHEN (NEW.channel = 'IN_APP')
        BEGIN
          INSERT INTO cbd_email_job (kind,notification_id,recipient_user_id,dedupe_key,created_at)
          VALUES ('EVENT',:NEW.id,:NEW.recipient_user_id,'EVENT:' || :NEW.id,:NEW.triggered_at);
        END;"""))


def downgrade():
    raise RuntimeError('Email delivery history is retained. Use a reviewed forward migration.')
