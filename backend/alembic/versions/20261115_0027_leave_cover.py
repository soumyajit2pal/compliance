"""Approved leave cover, retained dual-identity audit and immediate revocation."""
from alembic import op,context
import sqlalchemy as sa
import hashlib
revision='20261115_0027'
down_revision='20261115_0026'
branch_labels=depends_on=None

def upgrade():
    if context.is_offline_mode() or not sa.inspect(op.get_bind()).has_table('cbd_leave_delegation'):
        def fk(name,target,nullable=False):return sa.Column(name,sa.String(36),sa.ForeignKey('cbd_'+target+'.id'),nullable=nullable)
        op.create_table('cbd_leave_delegation',sa.Column('id',sa.String(36),primary_key=True,server_default=sa.text('LOWER(RAWTOHEX(SYS_GUID()))')),
            sa.Column('created_at',sa.DateTime(),nullable=False,server_default=sa.text('SYSTIMESTAMP')),
            fk('principal_user_id','user'),fk('delegate_user_id','user'),sa.Column('role_code',sa.String(40),nullable=False),fk('scope_unit_id','organisational_unit'),
            sa.Column('starts_on',sa.Date(),nullable=False),sa.Column('ends_on',sa.Date(),nullable=False),sa.Column('reason',sa.Text(),nullable=False),
            fk('reviewer_user_id','user'),fk('approver_user_id','user'),sa.Column('approval_status',sa.String(40),nullable=False,server_default=sa.text("'DRAFT'")),
            fk('created_by','user',True),fk('reviewed_by','user',True),sa.Column('reviewed_at',sa.DateTime()),fk('approved_by','user',True),sa.Column('approved_at',sa.DateTime()),
            fk('revoked_by','user',True),sa.Column('revoked_at',sa.DateTime()),sa.Column('revocation_reason',sa.Text()),sa.Column('edit_revision',sa.Integer(),nullable=False,server_default=sa.text('1')),
            sa.CheckConstraint('ends_on >= starts_on AND ends_on - starts_on < 90',name='ck_leave_duration'),
            sa.CheckConstraint('principal_user_id <> delegate_user_id AND reviewer_user_id <> principal_user_id AND reviewer_user_id <> delegate_user_id AND approver_user_id <> principal_user_id AND approver_user_id <> delegate_user_id AND reviewer_user_id <> approver_user_id',name='ck_leave_participants'),
            sa.CheckConstraint("role_code IN ('AUTHOR','REVIEWER','APPROVER','BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','CCO','ZONE_VIEWER')",name='ck_leave_role'),
            sa.CheckConstraint("approval_status IN ('DRAFT','IN_REVIEW','REVIEWED','APPROVED','REJECTED','WITHDRAWN')",name='ck_approval_status_93'),
            sa.CheckConstraint("approval_status <> 'APPROVED' OR (created_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL AND reviewed_at IS NOT NULL AND approved_at IS NOT NULL AND created_by <> reviewed_by AND created_by <> approved_by AND reviewed_by <> approved_by)",name='ck_leave_delegation_approve'),
            sa.CheckConstraint('(revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL) OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)',name='ck_leave_revocation'),
            sa.CheckConstraint('created_by = principal_user_id',name='ck_leave_principal_maker'))
    present=set() if context.is_offline_mode() else {c['name'] for c in sa.inspect(op.get_bind()).get_columns('cbd_audit_log')}
    fks=set() if context.is_offline_mode() else {f['name'] for f in sa.inspect(op.get_bind()).get_foreign_keys('cbd_audit_log')}
    for column,target in [('on_behalf_of_user_id','cbd_user'),('delegation_id','cbd_leave_delegation')]:
        if column not in present:op.add_column('cbd_audit_log',sa.Column(column,sa.String(36)))
        raw='foreignkey_cbd_audit_log_'+column+'_'+target+'.id';name='fk_'+raw[:18]+'_'+hashlib.sha1(raw.encode()).hexdigest()[:8]
        if name not in fks:op.create_foreign_key(name,'cbd_audit_log',target,[column],['id'])
    for column in ['actor_name','on_behalf_of_name']:
        if column not in present:op.add_column('cbd_audit_log',sa.Column(column,sa.String(250)))
    for table,cols in [('cbd_leave_delegation',['principal_user_id','delegate_user_id','scope_unit_id','reviewer_user_id','approver_user_id','created_by','reviewed_by','approved_by','revoked_by']),('cbd_audit_log',['on_behalf_of_user_id','delegation_id'])]:
        indices=set() if context.is_offline_mode() else {i['name'] for i in sa.inspect(op.get_bind()).get_indexes(table)}
        for column in cols:
            name='ix_'+table[4:18]+'_'+hashlib.sha1((table+column).encode()).hexdigest()[:8]
            if name not in indices:op.create_index(name,table,[column])
    columns=['id','principal_user_id','delegate_user_id','role_code','scope_unit_id','starts_on','ends_on','reviewer_user_id','approver_user_id','created_by']
    changes=' OR '.join(f'(:OLD.{c}<>:NEW.{c} OR (:OLD.{c} IS NULL AND :NEW.{c} IS NOT NULL) OR (:OLD.{c} IS NOT NULL AND :NEW.{c} IS NULL))' for c in columns)
    op.execute(sa.DDL(f"""CREATE OR REPLACE TRIGGER cbd_leave_cover_guard BEFORE UPDATE OR DELETE ON cbd_leave_delegation FOR EACH ROW
    BEGIN
      IF DELETING THEN RAISE_APPLICATION_ERROR(-20200,'Leave cover and its approval history must be retained.'); END IF;
      IF {changes} OR DBMS_LOB.COMPARE(:OLD.reason,:NEW.reason)<>0 THEN RAISE_APPLICATION_ERROR(-20201,'Leave cover terms are immutable. Withdraw and request a new cover.'); END IF;
      IF :OLD.revoked_at IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20202,'Revoked leave cover is immutable.'); END IF;
      IF :OLD.approval_status='APPROVED' AND (:NEW.approval_status<>'APPROVED' OR :OLD.reviewed_by<>:NEW.reviewed_by OR :OLD.approved_by<>:NEW.approved_by OR :OLD.reviewed_at<>:NEW.reviewed_at OR :OLD.approved_at<>:NEW.approved_at) THEN RAISE_APPLICATION_ERROR(-20203,'Approved leave-cover decisions are immutable; revoke with reason.'); END IF;
    END;"""))

def downgrade():raise RuntimeError('Leave cover and dual-identity audit history must be retained; use reviewed recovery.')
