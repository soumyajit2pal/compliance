"""Move requirement nature to an editable reference master while retaining existing codes."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261120_0033'
down_revision = '20261120_0032'
branch_labels = depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = None if context.is_offline_mode() else sa.inspect(conn)
    master = 'cbd_obligation_nature'
    parent = 'cbd_compliance_obligation'
    if inspector is None or not inspector.has_table(master):
        op.create_table(master,
            sa.Column('id', sa.String(36), primary_key=True, server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.text('SYSTIMESTAMP')),
            sa.Column('code', sa.String(40), nullable=False),
            sa.Column('name', sa.String(250), nullable=False),
            sa.Column('active_flag', sa.Integer, nullable=False, server_default='1'),
            sa.Column('display_sequence', sa.Integer, nullable=False, server_default='100'),
            sa.UniqueConstraint('code'),
            sa.CheckConstraint('active_flag IN (0,1)', name='ck_obligation_n_active_fla'))
    for index, code in enumerate(('ONGOING','PERIODIC','EVENT_DRIVEN','ONE_TIME'), start=1):
        label = code.replace('_',' ').title()
        op.execute(f"""INSERT INTO {master} (code,name,display_sequence)
            SELECT '{code}','{label}',{index} FROM dual
            WHERE NOT EXISTS (SELECT 1 FROM {master} WHERE code='{code}')""")
    if inspector is None or not any(f['constrained_columns']==['obligation_nature'] for f in inspector.get_foreign_keys(parent)):
        op.create_foreign_key(None,parent,master,['obligation_nature'],['code'])
    old = 'ck_obligation_nature_27'
    if inspector is None or old in {c['name'] for c in inspector.get_check_constraints(parent)}:
        op.drop_constraint(old,parent,type_='check')


def downgrade():
    raise RuntimeError('Published nature codes may be in use. Use a reviewed forward migration.')
