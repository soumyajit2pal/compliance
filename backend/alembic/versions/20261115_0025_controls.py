"""Governed control revisions, scoped mappings and retained execution lineage."""
from alembic import op,context
import sqlalchemy as sa
import hashlib
revision='20261115_0025'
down_revision='20261115_0024'
branch_labels=depends_on=None

def constraint_name(kind,table,columns,target=None):
    cols='_'.join(columns)
    if target:cols+='_'+target
    text=kind+'_'+table+'_'+cols
    return {'foreignkey':'fk','unique':'uq'}[kind]+'_'+text[:18]+'_'+hashlib.sha1(text.encode()).hexdigest()[:8]
def add_fk(table,column,target):
    name=constraint_name('foreignkey',table,[column],target+'.id')
    op.create_foreign_key(name,table,target,[column],['id'])
def base():return [sa.Column('id',sa.String(36),primary_key=True,server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.text('SYSTIMESTAMP'))]
def fk(name,target,nullable=False):return sa.Column(name,sa.String(36),sa.ForeignKey('cbd_'+target+'.id'),nullable=nullable)
def upgrade():
    for table,extra in [('cbd_control',[sa.Column('governance_unit_id',sa.String(36))]),('cbd_obligation_control_map',[sa.Column('scope_unit_id',sa.String(36)),sa.Column('gap_description',sa.Text()),sa.Column('mapping_status',sa.String(20),nullable=False,server_default=sa.text("'ACTIVE'"))])]:
        present=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}
        columns=extra+[sa.Column('version_number',sa.Integer(),nullable=False,server_default=sa.text('1')),sa.Column('edit_revision',sa.Integer(),nullable=False,server_default=sa.text('1')),
            sa.Column('supersedes_id',sa.String(36)),sa.Column('superseded_by_id',sa.String(36)),sa.Column('reviewer_user_id',sa.String(36)),sa.Column('approver_user_id',sa.String(36)),sa.Column('change_reason',sa.Text())]
        for c in columns:
            if c.name not in present:op.add_column(table,c)
        fks=set() if context.is_offline_mode() else {f['name'] for f in sa.inspect(op.get_bind()).get_foreign_keys(table)}
        pairs=[('governance_unit_id' if table=='cbd_control' else 'scope_unit_id','cbd_organisational_unit'),('supersedes_id',table),('superseded_by_id',table),('reviewer_user_id','cbd_user'),('approver_user_id','cbd_user')]
        for column,target in pairs:
            if constraint_name('foreignkey',table,[column],target+'.id') not in fks:add_fk(table,column,target)
        desired=['code','version_number'] if table=='cbd_control' else ['obligation_id','control_id','scope_unit_id','version_number']
        old=['code'] if table=='cbd_control' else ['obligation_id','control_id','effective_from']
        if context.is_offline_mode():op.drop_constraint(constraint_name('unique',table,old),table,type_='unique')
        else:
            for key in sa.inspect(op.get_bind()).get_unique_constraints(table):
                if key['column_names']==old:op.drop_constraint(key['name'],table,type_='unique')
        keys=set() if context.is_offline_mode() else {k['name'] for k in sa.inspect(op.get_bind()).get_unique_constraints(table)}
        key=constraint_name('unique',table,desired)
        if key not in keys:op.create_unique_constraint(key,table,desired)
        checks=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_check_constraints(table)}
        key='ck_'+table[4:16]+'_version'
        if key not in checks:op.create_check_constraint(key,table,'version_number >= 1 AND edit_revision >= 1')
        if table=='cbd_obligation_control_map' and 'ck_cm_mapping_status' not in checks:op.create_check_constraint('ck_cm_mapping_status',table,"mapping_status IN ('ACTIVE','RETIRED')")
    present=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_columns('cbd_action')}
    if 'control_scope_reason' not in present:op.add_column('cbd_action',sa.Column('control_scope_reason',sa.Text()))
    if context.is_offline_mode() or not sa.inspect(op.get_bind()).has_table('cbd_action_control_link'):
        op.create_table('cbd_action_control_link',*base(),fk('action_id','action'),fk('mapping_id','obligation_control_map'),fk('linked_by','user'),sa.Column('linked_at',sa.DateTime(),nullable=False),sa.UniqueConstraint('action_id','mapping_id'))
    if context.is_offline_mode() or not sa.inspect(op.get_bind()).has_table('cbd_action_control_result'):
        op.create_table('cbd_action_control_result',*base(),fk('link_id','action_control_link'),fk('execution_id','control_execution'),sa.Column('attempt_number',sa.Integer(),nullable=False),fk('submission_id','action_submission',True),sa.Column('proposed_result',sa.String(40),nullable=False),sa.Column('decision',sa.String(20),nullable=False,server_default=sa.text("'PENDING'")),sa.Column('decision_reason',sa.Text()),sa.CheckConstraint("proposed_result IN ('EFFECTIVE','EXCEPTION','FAILED')",name='ck_cm_result_proposal'),sa.CheckConstraint("decision IN ('PENDING','ACCEPT','REJECT')",name='ck_cm_result_decision'),sa.UniqueConstraint('link_id','attempt_number'),sa.UniqueConstraint('execution_id'))
    tables={'cbd_control':['governance_unit_id','supersedes_id','superseded_by_id','reviewer_user_id','approver_user_id'],'cbd_obligation_control_map':['scope_unit_id','supersedes_id','superseded_by_id','reviewer_user_id','approver_user_id'],'cbd_action_control_link':['action_id','mapping_id','linked_by'],'cbd_action_control_result':['link_id','execution_id','submission_id']}
    for table,cols in tables.items():
        indexes=set() if context.is_offline_mode() else {i['name'] for i in sa.inspect(op.get_bind()).get_indexes(table)}
        for col in cols:
            if table=='cbd_action_control_result' and col=='execution_id':continue  # unique FK already indexes this column
            key='ix_'+table[4:18]+'_'+hashlib.sha1((table+col).encode()).hexdigest()[:8]
            if key not in indexes:op.create_index(key,table,[col])
    op.execute("INSERT INTO cbd_id_counter(id,entity_type,prefix,next_value) SELECT LOWER(RAWTOHEX(SYS_GUID())),'control','CTL',1 FROM dual WHERE NOT EXISTS (SELECT 1 FROM cbd_id_counter WHERE entity_type='control')")
    for table,fields,lobs in [
        ('control',['id','code','version_number','control_type','execution_mode','frequency_id','owner_unit_id','owner_user_id','governance_unit_id','evidence_type_id','system_id','key_control_flag','control_status','effective_from','effective_to','review_date','supersedes_id','created_by','title'],['description','objective','change_reason']),
        ('obligation_control_map',['id','obligation_id','control_id','scope_unit_id','version_number','coverage_type','coverage_percentage','primary_control_flag','effective_from','effective_to','supersedes_id','created_by','mapping_status'],['mapping_rationale','gap_description','change_reason'])]:
        changes=' OR '.join(f"(:OLD.{x}<>:NEW.{x} OR (:OLD.{x} IS NULL AND :NEW.{x} IS NOT NULL) OR (:OLD.{x} IS NOT NULL AND :NEW.{x} IS NULL))" for x in fields)
        changes+=' OR '+' OR '.join(f"(:OLD.{x} IS NULL AND :NEW.{x} IS NOT NULL) OR (:OLD.{x} IS NOT NULL AND :NEW.{x} IS NULL) OR DBMS_LOB.COMPARE(:OLD.{x},:NEW.{x})<>0" for x in lobs)
        op.execute(sa.DDL(f"""CREATE OR REPLACE TRIGGER cbd_cm_{table[:16]}_guard BEFORE UPDATE OR DELETE ON cbd_{table} FOR EACH ROW
        BEGIN
          IF DELETING THEN RAISE_APPLICATION_ERROR(-20180,'Control records and mapping history must be retained.'); END IF;
          IF :OLD.approval_status<>'DRAFT' AND ({changes}) THEN RAISE_APPLICATION_ERROR(-20181,'Revise approved or submitted control content.'); END IF;
          IF :OLD.approval_status='APPROVED' AND (:NEW.approval_status<>'APPROVED' OR (:OLD.reviewed_by<>:NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR (:OLD.approved_by<>:NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR (:OLD.reviewed_at<>:NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR (:OLD.approved_at<>:NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))) THEN RAISE_APPLICATION_ERROR(-20182,'Approved control decisions are immutable.'); END IF;
          IF :OLD.superseded_by_id IS NOT NULL AND (:OLD.superseded_by_id<>:NEW.superseded_by_id OR (:OLD.superseded_by_id IS NULL AND :NEW.superseded_by_id IS NOT NULL) OR (:OLD.superseded_by_id IS NOT NULL AND :NEW.superseded_by_id IS NULL)) THEN RAISE_APPLICATION_ERROR(-20183,'Revision history is immutable.'); END IF;
        END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_cm_action_link_guard BEFORE INSERT OR UPDATE OR DELETE ON cbd_action_control_link FOR EACH ROW
    DECLARE n INTEGER;
    BEGIN
      IF UPDATING OR DELETING THEN RAISE_APPLICATION_ERROR(-20184,'Assigned control links are immutable.'); END IF;
      SELECT COUNT(*) INTO n FROM cbd_action a JOIN cbd_obligation_control_map m ON m.obligation_id=a.obligation_id AND m.scope_unit_id=a.owner_unit_id JOIN cbd_control c ON c.id=m.control_id
      WHERE a.id=:NEW.action_id AND m.id=:NEW.mapping_id AND m.approval_status='APPROVED' AND c.approval_status='APPROVED' AND m.superseded_by_id IS NULL AND c.superseded_by_id IS NULL AND m.mapping_status='ACTIVE' AND c.control_status='IMPLEMENTED' AND a.record_status IN ('OPEN','IN_PROGRESS') AND NOT EXISTS(SELECT 1 FROM cbd_action_submission s WHERE s.action_id=a.id);
      IF n<>1 THEN RAISE_APPLICATION_ERROR(-20185,'Use approved control coverage for the exact obligation and action department.'); END IF;
    END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_cm_result_guard BEFORE UPDATE OR DELETE ON cbd_action_control_result FOR EACH ROW
    BEGIN
      IF DELETING OR :OLD.decision<>'PENDING' OR :OLD.link_id<>:NEW.link_id OR :OLD.execution_id<>:NEW.execution_id OR :OLD.attempt_number<>:NEW.attempt_number OR :OLD.proposed_result<>:NEW.proposed_result OR (:OLD.submission_id IS NOT NULL AND (:OLD.submission_id<>:NEW.submission_id OR (:OLD.submission_id IS NULL AND :NEW.submission_id IS NOT NULL) OR (:OLD.submission_id IS NOT NULL AND :NEW.submission_id IS NULL))) THEN RAISE_APPLICATION_ERROR(-20186,'Submitted result inputs and decisions are retained.'); END IF;
    END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_cm_execution_guard BEFORE UPDATE OR DELETE ON cbd_control_execution FOR EACH ROW
    BEGIN
      IF DELETING THEN RAISE_APPLICATION_ERROR(-20187,'Control execution history must be retained.'); END IF;
      IF :OLD.reviewed_by IS NOT NULL OR :OLD.control_id<>:NEW.control_id OR :OLD.period_from<>:NEW.period_from OR :OLD.period_to<>:NEW.period_to OR :OLD.due_date<>:NEW.due_date OR (:OLD.performed_by<>:NEW.performed_by OR (:OLD.performed_by IS NULL AND :NEW.performed_by IS NOT NULL) OR (:OLD.performed_by IS NOT NULL AND :NEW.performed_by IS NULL)) OR (:OLD.performed_date<>:NEW.performed_date OR (:OLD.performed_date IS NULL AND :NEW.performed_date IS NOT NULL) OR (:OLD.performed_date IS NOT NULL AND :NEW.performed_date IS NULL)) OR :OLD.exception_count<>:NEW.exception_count OR DBMS_LOB.COMPARE(:OLD.comments,:NEW.comments)<>0 THEN RAISE_APPLICATION_ERROR(-20188,'Execution inputs and decided results are immutable; retain a corrected attempt.'); END IF;
    END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_cm_execution_link BEFORE UPDATE OR DELETE ON cbd_evidence_link FOR EACH ROW
    BEGIN IF :OLD.control_execution_id IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20189,'Execution evidence links must be retained.'); END IF; END;"""))
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_cm_scope_guard BEFORE UPDATE ON cbd_action FOR EACH ROW
    BEGIN IF (:OLD.control_scope_reason IS NULL AND :NEW.control_scope_reason IS NOT NULL) OR (:OLD.control_scope_reason IS NOT NULL AND :NEW.control_scope_reason IS NULL) OR DBMS_LOB.COMPARE(:OLD.control_scope_reason,:NEW.control_scope_reason)<>0 THEN RAISE_APPLICATION_ERROR(-20190,'Original control scope rationale is immutable.'); END IF; END;"""))
def downgrade():raise RuntimeError('Control approvals, executions and mapping lineage must be retained; use reviewed recovery.')
