"""Optional employee-master observations and durable retry queue; no access changes."""
from alembic import op,context
import sqlalchemy as sa
from sqlalchemy.dialects.oracle import TIMESTAMP
revision='20261119_0028'
down_revision='20261115_0027'
branch_labels=depends_on=None

def upgrade():
    if context.is_offline_mode() or not sa.inspect(op.get_bind()).has_table('cbd_employee_profile'):
        op.create_table('cbd_employee_profile',
            sa.Column('id',sa.String(36),primary_key=True,server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.text('SYSTIMESTAMP')),
            sa.Column('user_id',sa.String(36),sa.ForeignKey('cbd_user.id'),nullable=False),
            sa.Column('pf_no',sa.String(40),nullable=False),sa.Column('account_name',sa.String(100),nullable=False),
            *[sa.Column(n,sa.String(size)) for n,size in [('employee_name',250),('designation',250),('branch_code',40),('branch_name',250),('current_branch_code',40),('zone_code',40),('zone_name',250),('department_code',100),('department_name',250),('employee_status',40)]],
            sa.Column('sync_status',sa.String(20),nullable=False),sa.Column('last_error_code',sa.String(40)),sa.Column('missing_fields',sa.Text()),
            sa.Column('last_attempt_at',sa.DateTime(),nullable=False),sa.Column('last_success_at',sa.DateTime()),
            sa.Column('attempt_started_at',TIMESTAMP(),nullable=False),
            sa.Column('retry_count',sa.Integer(),nullable=False,server_default=sa.text('0')),
            sa.Column('next_retry_at',sa.DateTime()),sa.Column('lease_token',sa.String(36)),sa.Column('lease_until',sa.DateTime()),
            sa.CheckConstraint("sync_status IN ('SUCCESS','PARTIAL','FAILED')",name='ck_employee_sync_status'),
            sa.CheckConstraint('retry_count >= 0',name='ck_employee_retry_count'),sa.UniqueConstraint('user_id'))
        op.create_index('ix_cbd_employee_retry','cbd_employee_profile',['next_retry_at','lease_until'])

def downgrade():raise RuntimeError('Employee observations and last successful data must be retained; use reviewed recovery.')
