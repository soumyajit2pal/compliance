"""Week 5 action periods, immutable submissions and independent evidence decisions."""
from alembic import op,context
import sqlalchemy as sa
revision='20261115_0024'
down_revision='20261111_0023'
branch_labels=depends_on=None


def exists(table):
    return not context.is_offline_mode() and sa.inspect(op.get_bind()).has_table(table)
def fk(column,target):
    return sa.Column(column,sa.String(36),sa.ForeignKey('cbd_'+target+'.id'),nullable=False)
def base():
    return [sa.Column('id',sa.String(36),primary_key=True,server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.text('SYSTIMESTAMP'))]

def upgrade():
    columns=[sa.Column('period_from',sa.Date()),sa.Column('period_to',sa.Date()),
        sa.Column('action_type',sa.String(40),nullable=False,server_default=sa.text("'IMPLEMENTATION'")),
        sa.Column('priority',sa.String(20),nullable=False,server_default=sa.text("'MEDIUM'")),
        sa.Column('reviewer_user_id',sa.String(36)),sa.Column('escalation_user_id',sa.String(36)),
        sa.Column('evidence_type_id',sa.String(36)),sa.Column('evidence_requirement',sa.Text()),
        sa.Column('result_notes',sa.Text()),sa.Column('edit_revision',sa.Integer(),nullable=False,server_default=sa.text('1')),
        sa.Column('retained_validation_required_flag',sa.Integer(),nullable=False,server_default=sa.text('0'))]
    present={} if context.is_offline_mode() else {c['name']:c for c in sa.inspect(op.get_bind()).get_columns('cbd_action')}
    for c in columns:
        if c.name not in present:op.add_column('cbd_action',c)
    existing=set() if context.is_offline_mode() else {f['name'] for f in sa.inspect(op.get_bind()).get_foreign_keys('cbd_action')}
    for name,target in [('reviewer_user_id','user'),('escalation_user_id','user'),('evidence_type_id','evidence_type')]:
        key='fk_dlv_'+name[:17]
        if key not in existing:op.create_foreign_key(key,'cbd_action','cbd_'+target,['%s'%name],['id'])
    constraints=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints('cbd_action')}
    for key,condition in [('ck_action_period','period_to IS NULL OR period_from IS NULL OR period_to >= period_from'),('ck_action_reviewer','reviewer_user_id IS NULL OR reviewer_user_id <> owner_user_id'),('ck_dlv_retained_flag','retained_validation_required_flag IN (0,1)')]:
        if key not in constraints:op.create_check_constraint(key,'cbd_action',condition)
    if not exists('cbd_action_submission'):
        op.create_table('cbd_action_submission',*base(),fk('action_id','action'),sa.Column('submission_number',sa.Integer(),nullable=False),
            sa.Column('result_notes',sa.Text(),nullable=False),sa.Column('evidence_snapshot',sa.Text(),nullable=False),fk('submitted_by','user'),
            sa.Column('submitted_at',sa.DateTime(),nullable=False),sa.UniqueConstraint('action_id','submission_number'))
    if not exists('cbd_action_evidence_decision'):
        op.create_table('cbd_action_evidence_decision',*base(),fk('submission_id','action_submission'),fk('evidence_link_id','evidence_link'),
            sa.Column('decision',sa.String(40),nullable=False),sa.Column('reason',sa.Text(),nullable=False),fk('reviewed_by','user'),
            sa.Column('reviewed_at',sa.DateTime(),nullable=False),sa.UniqueConstraint('submission_id','evidence_link_id'),
            sa.CheckConstraint("decision IN ('ACCEPT','REJECT')",name='ck_dlv_evidence_decision'))
    if not exists('cbd_action_validation'):
        op.create_table('cbd_action_validation',*base(),fk('action_id','action'),sa.Column('reference',sa.String(250),nullable=False),
            sa.Column('procedure_text',sa.Text(),nullable=False),sa.Column('result',sa.String(40),nullable=False),fk('document_id','document'),
            fk('recorded_by','user'),sa.Column('recorded_at',sa.DateTime(),nullable=False),sa.Column('reviewed_by',sa.String(36),sa.ForeignKey('cbd_user.id')),
            sa.Column('reviewed_at',sa.DateTime()),sa.Column('decision',sa.String(40),nullable=False,server_default=sa.text("'PENDING'")),sa.Column('decision_reason',sa.Text()),
            sa.CheckConstraint("result IN ('PASS','FAIL')",name='ck_dlv_validation_result'),sa.CheckConstraint("decision IN ('PENDING','ACCEPT','REJECT')",name='ck_dlv_validation_decision'),
            sa.CheckConstraint('reviewed_by IS NULL OR reviewed_by <> recorded_by',name='ck_dlv_validation_independent'))
    indices=set() if context.is_offline_mode() else set(op.get_bind().execute(sa.text("SELECT LOWER(index_name) FROM user_indexes WHERE table_name='CBD_ACTION'")).scalars())
    if 'uq_cbd_action_period' not in indices:
        keys=','.join("CASE WHEN period_from IS NOT NULL AND record_status <> 'CANCELLED' THEN "+c+' END' for c in ['obligation_id','owner_unit_id','action_type','period_from','period_to'])
        op.execute('CREATE UNIQUE INDEX uq_cbd_action_period ON cbd_action ('+keys+')')
    import hashlib
    for table,columns in [('action',['reviewer_user_id','escalation_user_id','evidence_type_id']),('action_submission',['action_id','submitted_by']),('action_evidence_decision',['submission_id','evidence_link_id','reviewed_by']),('action_validation',['action_id','document_id','recorded_by','reviewed_by'])]:
        name='cbd_'+table
        indices=set() if context.is_offline_mode() else set(op.get_bind().execute(sa.text('SELECT LOWER(index_name) FROM user_indexes WHERE table_name=:name'),{'name':name.upper()}).scalars())
        for column in columns:
            index='ix_'+name[4:18]+'_'+hashlib.sha1((name+column).encode()).hexdigest()[:8]
            if index not in indices:
                if table=='action_submission' and column=='action_id' and 'ix_dlv_submission_action' in indices:
                    op.execute('ALTER INDEX ix_dlv_submission_action RENAME TO '+index)
                else:op.create_index(index,name,[column])
    op.execute("INSERT INTO cbd_id_counter(id,entity_type,prefix,next_value) SELECT LOWER(RAWTOHEX(SYS_GUID())),'delivery-reminders','JOB',1 FROM dual WHERE NOT EXISTS (SELECT 1 FROM cbd_id_counter WHERE entity_type='delivery-reminders')")
    for table in ['action_submission','action_evidence_decision']:
        op.execute(sa.DDL(f"CREATE OR REPLACE TRIGGER cbd_retain_{table[:19]} BEFORE UPDATE OR DELETE ON cbd_{table} BEGIN RAISE_APPLICATION_ERROR(-20160,'Delivery submissions and decisions are immutable.'); END;"))
    fields=['id','code','obligation_id','owner_unit_id','owner_user_id','original_due_date','period_from','period_to','action_type','priority','reviewer_user_id','escalation_user_id','evidence_type_id']
    changes=' OR '.join(f'(:OLD.{c} <> :NEW.{c} OR (:OLD.{c} IS NULL AND :NEW.{c} IS NOT NULL) OR (:OLD.{c} IS NOT NULL AND :NEW.{c} IS NULL))' for c in fields)
    op.execute(sa.DDL(f"""CREATE OR REPLACE TRIGGER cbd_delivery_action_guard BEFORE UPDATE OR DELETE ON cbd_action FOR EACH ROW
    BEGIN
      IF DELETING THEN RAISE_APPLICATION_ERROR(-20161,'Assigned actions must be retained.'); END IF;
      IF :OLD.reviewer_user_id IS NOT NULL AND ({changes}) THEN RAISE_APPLICATION_ERROR(-20162,'Assigned delivery metadata is immutable.'); END IF;
    END;"""))
    fields=['id','code','title','evidence_type_id','document_id','repository_uri','source_system','source_record','period_from','period_to','uploaded_by','uploaded_at','confidentiality_class_id','retention_end_date','file_hash','supersedes_evidence_id']
    changes=' OR '.join(f'(:OLD.{c} <> :NEW.{c} OR (:OLD.{c} IS NULL AND :NEW.{c} IS NOT NULL) OR (:OLD.{c} IS NOT NULL AND :NEW.{c} IS NULL))' for c in fields)
    op.execute(sa.DDL(f"""CREATE OR REPLACE TRIGGER cbd_delivery_evidence_guard BEFORE UPDATE OR DELETE ON cbd_evidence_item FOR EACH ROW
    BEGIN
      IF DELETING THEN RAISE_APPLICATION_ERROR(-20163,'Evidence originals and retention history must be retained.'); END IF;
      IF {changes} THEN RAISE_APPLICATION_ERROR(-20164,'Correct evidence through a new version.'); END IF;
      IF :OLD.evidence_status <> 'SUBMITTED' AND (:OLD.verified_by <> :NEW.verified_by OR :OLD.verified_at <> :NEW.verified_at) THEN RAISE_APPLICATION_ERROR(-20165,'Recorded evidence verification is immutable.'); END IF;
    END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_delivery_link_guard BEFORE UPDATE OR DELETE ON cbd_evidence_link FOR EACH ROW
    BEGIN IF :OLD.action_id IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20166,'Action evidence links and original reuse history must be retained.'); END IF; END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_delivery_validation_guard BEFORE UPDATE OR DELETE ON cbd_action_validation FOR EACH ROW
    BEGIN
      IF DELETING OR :OLD.decision <> 'PENDING' THEN RAISE_APPLICATION_ERROR(-20167,'Retained validation decisions are immutable.'); END IF;
      IF :OLD.action_id <> :NEW.action_id OR :OLD.document_id <> :NEW.document_id OR :OLD.recorded_by <> :NEW.recorded_by OR :OLD.result <> :NEW.result OR :OLD.reference <> :NEW.reference OR DBMS_LOB.COMPARE(:OLD.procedure_text,:NEW.procedure_text)<>0 THEN RAISE_APPLICATION_ERROR(-20168,'Retained validation inputs are immutable.'); END IF;
    END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_delivery_close_guard BEFORE INSERT OR UPDATE ON cbd_action FOR EACH ROW
    DECLARE n INTEGER; snapshot CLOB; sid VARCHAR2(36);
    BEGIN
      IF :NEW.reviewer_user_id IS NOT NULL AND :NEW.record_status='COMPLETED' THEN
        IF :NEW.completed_by <> :NEW.reviewer_user_id OR :NEW.completed_by=:NEW.owner_user_id OR :NEW.period_to>TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Kolkata' AS DATE)) THEN RAISE_APPLICATION_ERROR(-20169,'Independent review and complete reporting period are required.'); END IF;
        BEGIN SELECT id,evidence_snapshot INTO sid,snapshot FROM cbd_action_submission WHERE action_id=:NEW.id AND submission_number=(SELECT MAX(submission_number) FROM cbd_action_submission WHERE action_id=:NEW.id);
        EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20170,'A retained submission is required.'); END;
        SELECT COUNT(*) INTO n FROM JSON_TABLE(snapshot,'$[*]' COLUMNS(link_id VARCHAR2(36) PATH '$.link_id')) x WHERE NOT EXISTS
          (SELECT 1 FROM cbd_action_evidence_decision d JOIN cbd_evidence_link l ON l.id=d.evidence_link_id JOIN cbd_evidence_item e ON e.id=l.evidence_id
           WHERE d.submission_id=sid AND d.evidence_link_id=x.link_id AND d.decision='ACCEPT' AND d.reviewed_by=:NEW.reviewer_user_id AND e.evidence_status='ACCEPTED' AND e.retention_end_date>=TRUNC(SYSDATE));
        IF n>0 THEN RAISE_APPLICATION_ERROR(-20171,'Every submitted evidence link requires accepted independent review.'); END IF;
      END IF;
    END;"""))
    op.execute("""BEGIN FOR item IN (SELECT trigger_name FROM user_triggers WHERE trigger_name LIKE 'CBD_%') LOOP EXECUTE IMMEDIATE 'ALTER TRIGGER "'||item.trigger_name||'" COMPILE'; END LOOP; END;""")

def downgrade():
    raise RuntimeError('Delivery submissions, evidence and approval history must be retained; use reviewed recovery.')
