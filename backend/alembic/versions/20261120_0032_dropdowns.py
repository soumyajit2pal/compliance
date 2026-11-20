"""Dropdown catalogue, form selections and extensible check classifications."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261120_0032'
down_revision = '20261119_0031'
branch_labels = depends_on = None


def upgrade():
    conn = op.get_bind()
    offline = context.is_offline_mode()
    tables = set() if offline else set(sa.inspect(conn).get_table_names())

    def create(name, *cols):
        if name not in tables:
            op.create_table(name, sa.Column('id', sa.String(36), primary_key=True,
                server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
                sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.text('SYSTIMESTAMP')), *cols)

    create('cbd_dropdown_config', sa.Column('revision', sa.Integer, nullable=False),
           sa.Column('definition', sa.Text, nullable=False))
    op.execute("""INSERT INTO cbd_dropdown_config (id,revision,definition)
        SELECT 'portal',1,'{"lists":{},"fields":{},"presentation":{}}' FROM dual
        WHERE NOT EXISTS (SELECT 1 FROM cbd_dropdown_config WHERE id='portal')""")
    create('cbd_dropdown_answer', sa.Column('form_key', sa.String(80), nullable=False),
           sa.Column('record_id', sa.String(36), nullable=False), sa.Column('answers', sa.Text, nullable=False),
           sa.UniqueConstraint('form_key', 'record_id'))
    for key, codes in [('control_type', ['PREVENTIVE','DETECTIVE','CORRECTIVE']),
                       ('execution_mode', ['MANUAL','AUTOMATED','HYBRID'])]:
        name = 'cbd_' + key
        create(name, sa.Column('code',sa.String(40),nullable=False), sa.Column('name',sa.String(250),nullable=False),
               sa.Column('active_flag',sa.Integer,nullable=False,server_default='1'),
               sa.Column('display_sequence',sa.Integer,nullable=False,server_default='100'),
               sa.UniqueConstraint('code'), sa.CheckConstraint('active_flag IN (0,1)',name='ck_'+key[:12]+'_active_fla'))
        for index, code in enumerate(codes):
            op.execute(f"""INSERT INTO {name} (code,name,display_sequence)
                SELECT '{code}','{code.title()}',{index+1} FROM dual
                WHERE NOT EXISTS (SELECT 1 FROM {name} WHERE code='{code}')""")
        fks = [] if offline else sa.inspect(conn).get_foreign_keys('cbd_control')
        if not any(f['constrained_columns']==[key] for f in fks):
            op.create_foreign_key(None,'cbd_control',name,[key],['code'])
        old = 'ck_'+key+'_37'
        if offline or old in {c['name'] for c in sa.inspect(conn).get_check_constraints('cbd_control')}:
            op.drop_constraint(old,'cbd_control',type_='check')


def downgrade():
    raise RuntimeError('Retain published configuration, historical answers and referenced classification codes.')
