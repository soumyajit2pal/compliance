"""Compile null-safe control guards and enforce mapped results at database completion."""
from alembic import op
import sqlalchemy as sa
revision='20261115_0026'
down_revision='20261115_0025'
branch_labels=depends_on=None

def upgrade():
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
    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_cm_close_guard BEFORE UPDATE ON cbd_action FOR EACH ROW
    DECLARE n INTEGER; mapped INTEGER; sid VARCHAR2(36);
    BEGIN
      IF :NEW.record_status='COMPLETED' AND :OLD.record_status<>'COMPLETED' THEN
        SELECT COUNT(*) INTO mapped FROM cbd_action_control_link WHERE action_id=:NEW.id;
        IF mapped>0 THEN
          SELECT id INTO sid FROM cbd_action_submission WHERE action_id=:NEW.id AND submission_number=(SELECT MAX(submission_number) FROM cbd_action_submission WHERE action_id=:NEW.id);
          SELECT COUNT(*) INTO n FROM cbd_action_control_link l JOIN cbd_obligation_control_map m ON m.id=l.mapping_id JOIN cbd_control c ON c.id=m.control_id
          WHERE l.action_id=:NEW.id AND (m.superseded_by_id IS NOT NULL OR c.superseded_by_id IS NOT NULL OR m.approval_status<>'APPROVED' OR c.approval_status<>'APPROVED' OR m.mapping_status<>'ACTIVE' OR c.control_status<>'IMPLEMENTED' OR NOT EXISTS
            (SELECT 1 FROM cbd_action_control_result r JOIN cbd_control_execution e ON e.id=r.execution_id WHERE r.link_id=l.id AND r.submission_id=sid AND r.decision='ACCEPT' AND e.result='EFFECTIVE' AND e.reviewed_by=:NEW.reviewer_user_id AND e.performed_by=:NEW.owner_user_id AND e.period_from=:NEW.period_from AND e.period_to=:NEW.period_to));
          IF n>0 THEN RAISE_APPLICATION_ERROR(-20191,'Mapped controls need independent effective results for this submission.'); END IF;
        END IF;
      END IF;
    END;"""))

def downgrade():raise RuntimeError('Control governance guards must be retained.')
