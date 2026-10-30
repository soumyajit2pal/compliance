"""LDAP department baseline and independent administrator change decisions."""
from alembic import op,context
import sqlalchemy as sa

revision='20261029_0015'
down_revision='20261029_0014'
branch_labels=depends_on=None


def _type(value):
    return str(value.compile(dialect=op.get_bind().dialect)).replace('VARCHAR2(','VARCHAR(')


def _column(table,column):
    if not context.is_offline_mode():
        current={c['name']:c for c in sa.inspect(op.get_bind()).get_columns(table)}.get(column.name)
        if current:
            expected_default=str(column.server_default.arg) if column.server_default else None
            if (current['nullable']!=column.nullable or _type(current['type'])!=_type(column.type)
                or (current.get('default') or '').strip()!=(expected_default or '').strip()):
                raise RuntimeError('Existing LDAP department column differs from the reviewed revision scaffold.')
            return
    op.add_column(table,column)


def _table(name,*definitions):
    if not context.is_offline_mode() and sa.inspect(op.get_bind()).has_table(name):
        inspector=sa.inspect(op.get_bind())
        actual={c['name']:c for c in inspector.get_columns(name)}
        expected={c.name:c for c in definitions if isinstance(c,sa.Column)}
        matches=set(actual)==set(expected) and all(actual[n]['nullable']==c.nullable and
            _type(actual[n]['type'])==_type(c.type) and (actual[n].get('default') or '').strip()==
            (str(c.server_default.arg) if c.server_default else '').strip() for n,c in expected.items())
        fks={(tuple(c['constrained_columns']),c['referred_table'],tuple(c['referred_columns'])) for c in inspector.get_foreign_keys(name)}
        checks={c['name'] for c in inspector.get_check_constraints(name)}
        if (not matches or inspector.get_pk_constraint(name)['constrained_columns']!=['id']
            or fks!={(('user_id',),'cbd_user',('id',)),(('requested_by',),'cbd_user',('id',)),(('decided_by',),'cbd_user',('id',))}
            or checks!={'ck_ldap_dept_request_state','ck_ldap_dept_request_owner','ck_ldap_dept_independent'}
            or op.get_bind().execute(sa.text('SELECT COUNT(*) FROM cbd_ldap_department_request')).scalar_one()):
            raise RuntimeError('Existing LDAP department history is not the exact empty revision scaffold. Investigate without dropping data.')
        return
    op.create_table(name,*definitions)


def upgrade():
    for name,length in [('department_code',100),('ldap_department_name',250),
        ('ldap_last_seen_department_code',100),('ldap_last_seen_department_name',250),('ldap_observation_id',36)]:
        _column('cbd_user',sa.Column(name,sa.String(length),nullable=True))
    _column('cbd_user',sa.Column('ldap_department_checked_at',sa.DateTime(),nullable=True))
    _column('cbd_user',sa.Column('ldap_department_status',sa.String(30),server_default=sa.text("'UNVERIFIED'"),nullable=False))
    predicate="ldap_department_status IN ('UNVERIFIED','VERIFIED','MISMATCH','UNAVAILABLE','RECHECK_REQUIRED')"
    existing_checks={} if context.is_offline_mode() else {c['name']:c for c in sa.inspect(op.get_bind()).get_check_constraints('cbd_user')}
    if 'ck_user_ldap_department' not in existing_checks:
        op.create_check_constraint('ck_user_ldap_department','cbd_user',predicate)
    else:
        import re
        clean=lambda value:re.sub(r'[\s\"()]','',value).upper()
        if clean(existing_checks['ck_user_ldap_department']['sqltext'])!=clean(predicate):
            raise RuntimeError('Existing LDAP department state check differs from the revision.')
    _column('cbd_app_session',sa.Column('ldap_observation_id',sa.String(36),nullable=True))
    _table('cbd_ldap_department_request',
        sa.Column('id',sa.String(36),server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))'),nullable=False),
        sa.Column('created_at',sa.DateTime(),server_default=sa.text('SYSTIMESTAMP'),nullable=False),
        sa.Column('user_id',sa.String(36),nullable=False),
        sa.Column('previous_code',sa.String(100),nullable=True),sa.Column('previous_name',sa.String(250),nullable=True),
        sa.Column('proposed_code',sa.String(100),nullable=False),sa.Column('proposed_name',sa.String(250),nullable=False),
        sa.Column('observed_at',sa.DateTime(),nullable=False),sa.Column('observation_id',sa.String(36),nullable=False),
        sa.Column('requested_by',sa.String(36),nullable=False),sa.Column('requested_at',sa.DateTime(),nullable=False),
        sa.Column('request_reason',sa.String(1000),nullable=True),
        sa.Column('status',sa.String(20),server_default=sa.text("'PENDING'"),nullable=False),
        sa.Column('decided_by',sa.String(36),nullable=True),sa.Column('decided_at',sa.DateTime(),nullable=True),
        sa.Column('decision_reason',sa.String(1000),nullable=True),
        sa.PrimaryKeyConstraint('id',name=op.f('pk_primarykey_cbd_lda_e805ef92')),
        sa.ForeignKeyConstraint(['user_id'],['cbd_user.id'],name=op.f('fk_foreignkey_cbd_lda_292d85d2')),
        sa.ForeignKeyConstraint(['requested_by'],['cbd_user.id'],name=op.f('fk_foreignkey_cbd_lda_19412d61')),
        sa.ForeignKeyConstraint(['decided_by'],['cbd_user.id'],name=op.f('fk_foreignkey_cbd_lda_ef57e74b')),
        sa.CheckConstraint("status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED','OBSOLETE')",name='ck_ldap_dept_request_state'),
        sa.CheckConstraint('requested_by = user_id',name='ck_ldap_dept_request_owner'),
        sa.CheckConstraint("status NOT IN ('APPROVED','REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND decided_by <> user_id)",name='ck_ldap_dept_independent'))
    indexes=[] if context.is_offline_mode() else sa.inspect(op.get_bind()).get_indexes('cbd_ldap_department_request')
    existing=next((i for i in indexes if i['name']=='uq_cbd_ldap_dept_pending'),None)
    if not existing:
        op.create_index('uq_cbd_ldap_dept_pending','cbd_ldap_department_request',
            [sa.text("CASE WHEN status = 'PENDING' THEN user_id END")],unique=True)
    else:
        from backend.alembic.oracle_compare import equivalent_case_indexes
        from types import SimpleNamespace
        actual=SimpleNamespace(name=existing['name'],unique=existing['unique'],
            expressions=[sa.text(value) for value in existing.get('expressions',[])])
        expected=SimpleNamespace(name='uq_cbd_ldap_dept_pending',unique=True,
            expressions=[sa.text("CASE WHEN status = 'PENDING' THEN user_id END")])
        if not equivalent_case_indexes(actual,expected):
            raise RuntimeError('Existing LDAP pending-request index differs from the revision.')
    op.execute(sa.DDL('''CREATE OR REPLACE TRIGGER cbd_ldap_dept_history_guard
BEFORE UPDATE OR DELETE ON cbd_ldap_department_request FOR EACH ROW
BEGIN
  IF DELETING THEN
    RAISE_APPLICATION_ERROR(-20150, 'LDAP department request history must be retained');
  END IF;
  IF :OLD.status <> 'PENDING' THEN
    RAISE_APPLICATION_ERROR(-20151, 'Decided LDAP department requests are immutable');
  END IF;
  IF (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL))
    OR (:OLD.user_id <> :NEW.user_id OR (:OLD.user_id IS NULL AND :NEW.user_id IS NOT NULL) OR (:OLD.user_id IS NOT NULL AND :NEW.user_id IS NULL))
    OR (:OLD.previous_code <> :NEW.previous_code OR (:OLD.previous_code IS NULL AND :NEW.previous_code IS NOT NULL) OR (:OLD.previous_code IS NOT NULL AND :NEW.previous_code IS NULL))
    OR (:OLD.previous_name <> :NEW.previous_name OR (:OLD.previous_name IS NULL AND :NEW.previous_name IS NOT NULL) OR (:OLD.previous_name IS NOT NULL AND :NEW.previous_name IS NULL))
    OR (:OLD.proposed_code <> :NEW.proposed_code OR (:OLD.proposed_code IS NULL AND :NEW.proposed_code IS NOT NULL) OR (:OLD.proposed_code IS NOT NULL AND :NEW.proposed_code IS NULL))
    OR (:OLD.proposed_name <> :NEW.proposed_name OR (:OLD.proposed_name IS NULL AND :NEW.proposed_name IS NOT NULL) OR (:OLD.proposed_name IS NOT NULL AND :NEW.proposed_name IS NULL))
    OR (:OLD.observed_at <> :NEW.observed_at OR (:OLD.observed_at IS NULL AND :NEW.observed_at IS NOT NULL) OR (:OLD.observed_at IS NOT NULL AND :NEW.observed_at IS NULL))
    OR (:OLD.observation_id <> :NEW.observation_id OR (:OLD.observation_id IS NULL AND :NEW.observation_id IS NOT NULL) OR (:OLD.observation_id IS NOT NULL AND :NEW.observation_id IS NULL))
    OR (:OLD.requested_by <> :NEW.requested_by OR (:OLD.requested_by IS NULL AND :NEW.requested_by IS NOT NULL) OR (:OLD.requested_by IS NOT NULL AND :NEW.requested_by IS NULL))
    OR (:OLD.requested_at <> :NEW.requested_at OR (:OLD.requested_at IS NULL AND :NEW.requested_at IS NOT NULL) OR (:OLD.requested_at IS NOT NULL AND :NEW.requested_at IS NULL))
    OR (:OLD.request_reason <> :NEW.request_reason OR (:OLD.request_reason IS NULL AND :NEW.request_reason IS NOT NULL) OR (:OLD.request_reason IS NOT NULL AND :NEW.request_reason IS NULL)) THEN
    RAISE_APPLICATION_ERROR(-20152, 'LDAP department request evidence is immutable');
  END IF;
  IF :NEW.status NOT IN ('APPROVED','REJECTED','SUPERSEDED','OBSOLETE') THEN
    RAISE_APPLICATION_ERROR(-20153, 'Invalid LDAP department decision transition');
  END IF;
END;'''))
    # ALTER TABLE invalidates dependent Oracle triggers; compile without DML.
    op.execute('''BEGIN
      FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%' AND status = 'ENABLED') LOOP
        EXECUTE IMMEDIATE 'ALTER TRIGGER "' || item.trigger_name || '" COMPILE';
      END LOOP;
    END;''')


def downgrade():
    raise RuntimeError('LDAP department approval evidence must be retained; use a reviewed recovery plan.')
