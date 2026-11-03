"""Contextual immutable codes with retained legacy references; online backfill."""
from collections import defaultdict
from datetime import datetime
import json,re
from uuid import uuid4
from alembic import op,context
import sqlalchemy as sa

revision='20261101_0020'
down_revision='20261101_0019'
branch_labels=depends_on=None
MARKER='CBD-ID-20261101-0020'
KINDS={'instrument':'cbd_regulatory_instrument','clause':'cbd_regulatory_clause','obligation':'cbd_compliance_obligation'}
GUARDS=['CBD_GUARD_004','CBD_GUARD_006','CBD_GUARD_008','CBD_CLAUSE_IDENTITY_GUARD']


def permitted_guard(sql,field):
    """Allow only an exact retained old/new pair on this maintenance connection.

    Every other UUID/content/approval/delete predicate remains effective. The
    original live trigger source is restored even when backfill fails.
    """
    sql,count=re.subn(r':OLD\.code\s*<>\s*:NEW\.code',r'(:OLD.code <> :NEW.code AND NOT cbd_id_allowed)',sql,flags=re.I)
    if not count:raise RuntimeError('Expected permanent-code guard is missing.')
    declaration='cbd_id_allowed BOOLEAN := FALSE; cbd_id_pairs PLS_INTEGER := 0;'
    if 'DECLARE' not in sql.split('BEGIN',1)[0].upper():declaration='DECLARE '+declaration
    initialization=f"""{declaration}
BEGIN
  IF UPDATING AND SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER') = '{MARKER}' THEN
    SELECT COUNT(*) INTO cbd_id_pairs FROM cbd_business_code_alias
      WHERE {field} = :OLD.id AND legacy_code = :OLD.code AND canonical_code = :NEW.code;
    cbd_id_allowed := cbd_id_pairs = 1;
  END IF;"""
    return re.sub(r'\bBEGIN\b',lambda _:initialization,sql,count=1,flags=re.I)


def plan_codes(data,retained,regulators,domains,types,versions):
    mappings={};used=defaultdict(set)

    def assign(kind,row,prefix):
        kept=retained.get((kind,row['id']))
        if not kept and re.fullmatch(re.escape(prefix)+r'\d{3,}',row['code']):kept=row['code']
        if kept:
            number=int(kept[len(prefix):]) if kept.startswith(prefix) and kept[len(prefix):].isdigit() else None
            if number:used[(kind,prefix)].add(number)
            mappings[(kind,row['id'])]=kept
            return kept
        number=1
        while number in used[(kind,prefix)]:number+=1
        used[(kind,prefix)].add(number);code=prefix+f'{number:03d}'
        if len(code)>200:raise RuntimeError('Generated code exceeds 200 characters.')
        mappings[(kind,row['id'])]=code
        return code

    # Reserve already canonical suffixes before assigning any legacy row.
    def reserve(kind,rows,prefix_for):
        for row in rows:
            prefix=prefix_for(row);kept=retained.get((kind,row['id']),row['code'])
            if kept.startswith(prefix) and kept[len(prefix):].isdigit():used[(kind,prefix)].add(int(kept[len(prefix):]))

    def instrument_prefix(row):
        parts=[regulators[row['regulator_id']],domains[row['primary_domain_id']],types[row['instrument_type_id']]]
        if any(not re.fullmatch(r'[A-Z0-9][A-Z0-9._/-]*',part.upper()) for part in parts):raise RuntimeError('Invalid identifier master code.')
        return 'INS-'+'-'.join(p.upper() for p in parts)+'-'+str(row['issue_date'].year)+'-'
    reserve('instrument',data['instrument'],instrument_prefix)
    for row in data['instrument']:assign('instrument',row,instrument_prefix(row))
    clause_prefix=lambda row:mappings[('instrument',versions[row['instrument_version_id']])]+'-C'
    reserve('clause',data['clause'],clause_prefix)
    pending=list(data['clause']);completed=set()
    while pending:
        ready=[row for row in pending if not row['parent_clause_id'] or row['parent_clause_id'] in completed]
        if not ready:raise RuntimeError('Clause parents are missing or cyclic. Repair the source hierarchy before migration.')
        for row in ready:
            assign('clause',row,clause_prefix(row));completed.add(row['id']);pending.remove(row)
    groups=defaultdict(list)
    for row in data['obligation']:groups[row['code']].append(row)
    ordered=sorted(groups.values(),key=lambda group:(min(r['created_at'] for r in group),group[0]['code']))
    def root(group):return min(group,key=lambda r:([int(v) for v in re.findall(r'\d+',str(r['version_number']))],r['created_at'],r['id']))
    obligation_prefix=lambda row:mappings[('clause',row['primary_clause_id'])]+'-OBL-'
    reserve('obligation',[root(g) for g in ordered],obligation_prefix)
    for group in ordered:
        original=root(group);code=assign('obligation',original,obligation_prefix(original))
        for row in group:mappings[('obligation',row['id'])]=code
    return mappings


def upgrade():
    offline=context.is_offline_mode();bind=op.get_bind();inspector=None if offline else sa.inspect(bind)
    if offline or 'cbd_business_code_alias' not in inspector.get_table_names():
        op.create_table('cbd_business_code_alias',
            sa.Column('id',sa.String(36),primary_key=True,server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.text('SYSTIMESTAMP')),
            sa.Column('instrument_id',sa.String(36),sa.ForeignKey('cbd_regulatory_instrument.id')),
            sa.Column('clause_id',sa.String(36),sa.ForeignKey('cbd_regulatory_clause.id')),
            sa.Column('obligation_id',sa.String(36),sa.ForeignKey('cbd_compliance_obligation.id')),
            sa.Column('legacy_code',sa.String(200),nullable=False),sa.Column('canonical_code',sa.String(200),nullable=False),
            sa.UniqueConstraint('legacy_code','instrument_id','clause_id','obligation_id'),
            sa.CheckConstraint('(CASE WHEN instrument_id IS NULL THEN 0 ELSE 1 END + CASE WHEN clause_id IS NULL THEN 0 ELSE 1 END + CASE WHEN obligation_id IS NULL THEN 0 ELSE 1 END) = 1',name='ck_business_alias_one_target'))
    for name in KINDS.values():
        if offline or next(c for c in inspector.get_columns(name) if c['name']=='code')['type'].length<200:
            indexes={'uq_cbd_obligation_active':"CASE WHEN record_status = 'ACTIVE' THEN code END",
                     'uq_cbd_obligation_pending':"CASE WHEN approval_status IN ('DRAFT','IN_REVIEW','REVIEWED') THEN code END"} if name=='cbd_compliance_obligation' else {}
            # Oracle requires rebuilding function-based indexes around widening.
            for index in indexes:
                if offline or bind.execute(sa.text('SELECT COUNT(*) FROM user_indexes WHERE index_name=:name'),{'name':index.upper()}).scalar():op.drop_index(index,table_name=name)
            try:op.alter_column(name,'code',type_=sa.String(200))
            finally:
                for index,expression in indexes.items():op.create_index(index,name,[sa.text(expression)],unique=True)
    # Resume a nontransactional DDL interruption after widening but before an
    # index was recreated, even when the column is already 200 characters.
    if not offline:
        for index,expression in {'uq_cbd_obligation_active':"CASE WHEN record_status = 'ACTIVE' THEN code END",
                                 'uq_cbd_obligation_pending':"CASE WHEN approval_status IN ('DRAFT','IN_REVIEW','REVIEWED') THEN code END"}.items():
            if not bind.execute(sa.text('SELECT COUNT(*) FROM user_indexes WHERE index_name=:name'),{'name':index.upper()}).scalar():
                op.create_index(index,'cbd_compliance_obligation',[sa.text(expression)],unique=True)
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_business_alias_retention
        BEFORE UPDATE OR DELETE ON cbd_business_code_alias FOR EACH ROW
        BEGIN RAISE_APPLICATION_ERROR(-20082,'Legacy business references are append-only.'); END;"""))
    if offline:
        op.execute('-- REQUIRED: Run Alembic online for revision 20261101_0020. This reference SQL omits its audited data backfill.')
        return
    metadata=sa.MetaData()
    tables={kind:sa.Table(name,metadata,autoload_with=bind,resolve_fks=False) for kind,name in KINDS.items()}
    alias=sa.Table('cbd_business_code_alias',metadata,autoload_with=bind,resolve_fks=False)
    audit=sa.Table('cbd_audit_log',metadata,autoload_with=bind,resolve_fks=False)
    data={kind:[dict(r) for r in bind.execute(sa.select(table).order_by(table.c.created_at,table.c.id)).mappings()] for kind,table in tables.items()}
    retained={}
    for row in bind.execute(sa.select(alias)).mappings():
        for kind in KINDS:
            if row[kind+'_id']:
                key=(kind,row[kind+'_id'])
                if key in retained and retained[key]!=row['canonical_code']:raise RuntimeError('Conflicting retained canonical references.')
                retained[key]=row['canonical_code']
    def master(name):return dict(bind.execute(sa.text('SELECT id, code FROM '+name)).all())
    regulators=master('cbd_regulator');domains=master('cbd_regulatory_domain');types=master('cbd_instrument_type')
    versions=dict(bind.execute(sa.text('SELECT id,instrument_id FROM cbd_instrument_version')).all())
    mappings=plan_codes(data,retained,regulators,domains,types,versions)
    originals={}
    for name in GUARDS:
        sql=''.join(bind.execute(sa.text("SELECT text FROM user_source WHERE name=:name AND type='TRIGGER' ORDER BY line"),{'name':name}).scalars())
        if not sql:raise RuntimeError('Required existing protection is missing: '+name)
        originals[name]='CREATE OR REPLACE '+sql
    try:
        for name,sql in originals.items():
            field='instrument_id' if name=='CBD_GUARD_004' else 'obligation_id' if name=='CBD_GUARD_008' else 'clause_id'
            op.execute(sa.DDL(permitted_guard(sql,field)))
        errors=bind.execute(sa.text("SELECT name,text FROM user_errors WHERE name IN ('CBD_GUARD_004','CBD_GUARD_006','CBD_GUARD_008','CBD_CLAUSE_IDENTITY_GUARD')")).all()
        if errors:raise RuntimeError('Identifier maintenance guard compilation failed: '+str(errors))
        bind.execute(sa.text('BEGIN DBMS_SESSION.SET_IDENTIFIER(:marker); END;'),{'marker':MARKER})
        # Roll back ALL backfill DML before restoration DDL if anything fails.
        with bind.begin_nested():
            for kind,rows in data.items():
                for row in rows:
                    code=mappings[(kind,row['id'])]
                    if row['code']==code:continue
                    if (kind,row['id']) not in retained:
                        bind.execute(alias.insert().values(id=str(uuid4()),**{kind+'_id':row['id']},legacy_code=row['code'],canonical_code=code))
                    bind.execute(tables[kind].update().where(tables[kind].c.id==row['id']).values(code=code))
                    bind.execute(audit.insert().values(id=str(uuid4()),entity_type=kind,entity_id=row['id'],action='BUSINESS_CODE_MIGRATED',
                        old_value=json.dumps({'code':row['code']}),new_value=json.dumps({'code':code}),event_at=datetime.now(),channel='MIGRATION',
                        reason='User-authorised contextual identifier convention; original retained as a legacy reference.'))
    finally:
        bind.execute(sa.text('BEGIN DBMS_SESSION.CLEAR_IDENTIFIER; END;'))
        failed=[]
        for name,sql in originals.items():
            try:op.execute(sa.DDL(sql))
            except Exception:failed.append(name)
        if failed:raise RuntimeError('Restore original integrity guards before resuming: '+', '.join(failed))
    # Widening may invalidate dependent integrity triggers; compile, never disable.
    for name in bind.execute(sa.text("SELECT object_name FROM user_objects WHERE object_type='TRIGGER' AND status='INVALID' AND object_name LIKE 'CBD_%'")).scalars().all():
        op.execute(sa.DDL('ALTER TRIGGER '+name+' COMPILE'))
    errors=bind.execute(sa.text("SELECT name,text FROM user_errors WHERE name LIKE 'CBD_%'")).all()
    if errors:raise RuntimeError('Integrity protections failed compilation: '+str(errors))


def downgrade():
    raise RuntimeError('Permanent contextual and legacy business references must be retained.')
