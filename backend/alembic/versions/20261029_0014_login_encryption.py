"""Single-use encrypted-login challenge replay protection."""
from alembic import op
import sqlalchemy as sa
revision = '20261029_0014'
down_revision = '20261028_0013'
branch_labels = depends_on = None

def upgrade():
    op.create_table('cbd_used_login_challenge',
        sa.Column('id', sa.String(36), server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))'), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('SYSTIMESTAMP'), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_primarykey_cbd_use_4c74fbd2')))
    op.create_index('ix_used_login_challenge_expires', 'cbd_used_login_challenge', ['expires_at'])

def downgrade():
    raise RuntimeError('Login replay protection must remain while encrypted login is deployed.')
