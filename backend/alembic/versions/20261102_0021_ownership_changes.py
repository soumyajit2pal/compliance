"""Independent same-revision ownership requests and retained assignment replacement links."""
from alembic import op,context
import sqlalchemy as sa
revision='20261102_0021'
down_revision='20261101_0020'
branch_labels=depends_on=None
# Frozen Oracle DDL: no imports from the evolving application model.
TABLES = [
    r"""CREATE TABLE cbd_obligation_owner_change (
	id VARCHAR2(36 CHAR) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) NOT NULL, 
	created_at DATE DEFAULT SYSTIMESTAMP NOT NULL, 
	obligation_id VARCHAR2(36 CHAR) NOT NULL, 
	baseline_revision INTEGER NOT NULL, 
	business_owner_unit_id VARCHAR2(36 CHAR) NOT NULL, 
	compliance_reviewer_user_id VARCHAR2(36 CHAR) NOT NULL, 
	approver_user_id VARCHAR2(36 CHAR) NOT NULL, 
	reason CLOB NOT NULL, 
	effective_from DATE, 
	applied_at DATE, 
	approval_status VARCHAR2(40 CHAR) DEFAULT 'DRAFT' NOT NULL, 
	created_by VARCHAR2(36 CHAR), 
	reviewed_by VARCHAR2(36 CHAR), 
	reviewed_at DATE, 
	approved_by VARCHAR2(36 CHAR), 
	approved_at DATE, 
	CONSTRAINT pk_primarykey_cbd_obl_d7f5ff78 PRIMARY KEY (id), 
	CONSTRAINT ck_approval_status_86 CHECK (approval_status IN ('DRAFT','IN_REVIEW','REVIEWED','APPROVED','REJECTED','WITHDRAWN')), 
	CONSTRAINT fk_foreignkey_cbd_obl_64e31d41 FOREIGN KEY(obligation_id) REFERENCES cbd_compliance_obligation (id), 
	CONSTRAINT fk_foreignkey_cbd_obl_e2b0aebe FOREIGN KEY(business_owner_unit_id) REFERENCES cbd_organisational_unit (id), 
	CONSTRAINT fk_foreignkey_cbd_obl_fa178dc6 FOREIGN KEY(compliance_reviewer_user_id) REFERENCES cbd_user (id), 
	CONSTRAINT fk_foreignkey_cbd_obl_1c09f39b FOREIGN KEY(approver_user_id) REFERENCES cbd_user (id), 
	CONSTRAINT fk_foreignkey_cbd_obl_5c10adf9 FOREIGN KEY(created_by) REFERENCES cbd_user (id), 
	CONSTRAINT fk_foreignkey_cbd_obl_9e9eeb15 FOREIGN KEY(reviewed_by) REFERENCES cbd_user (id), 
	CONSTRAINT fk_foreignkey_cbd_obl_2f460f32 FOREIGN KEY(approved_by) REFERENCES cbd_user (id), 
	CONSTRAINT ck_obligation_owner_ch_approve CHECK (approval_status <> 'APPROVED' OR (created_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL AND reviewed_at IS NOT NULL AND approved_at IS NOT NULL AND created_by <> reviewed_by AND created_by <> approved_by AND reviewed_by <> approved_by))
)""",
    r"""CREATE TABLE cbd_owner_change_assignment (
	id VARCHAR2(36 CHAR) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) NOT NULL, 
	created_at DATE DEFAULT SYSTIMESTAMP NOT NULL, 
	change_id VARCHAR2(36 CHAR) NOT NULL, 
	org_unit_id VARCHAR2(36 CHAR) NOT NULL, 
	user_id VARCHAR2(36 CHAR) NOT NULL, 
	owner_role VARCHAR2(40 CHAR) NOT NULL, 
	primary_owner_flag INTEGER DEFAULT 0 NOT NULL, 
	previous_owner_id VARCHAR2(36 CHAR), 
	task_id VARCHAR2(36 CHAR), 
	applied_owner_id VARCHAR2(36 CHAR), 
	CONSTRAINT pk_primarykey_cbd_own_a0286aa4 PRIMARY KEY (id), 
	CONSTRAINT ck_owner_role_87 CHECK (owner_role IN ('REGULATORY','BUSINESS','CONTROL','EVIDENCE','DATA')), 
	CONSTRAINT uq_unique_cbd_owner_c_76337c4e UNIQUE (change_id, owner_role, user_id, org_unit_id), 
	CONSTRAINT uq_unique_cbd_owner_c_b8d2a4a1 UNIQUE (task_id), 
	CONSTRAINT fk_foreignkey_cbd_own_9b651fb1 FOREIGN KEY(change_id) REFERENCES cbd_obligation_owner_change (id), 
	CONSTRAINT fk_foreignkey_cbd_own_fbde64c1 FOREIGN KEY(org_unit_id) REFERENCES cbd_organisational_unit (id), 
	CONSTRAINT fk_foreignkey_cbd_own_2368d8e2 FOREIGN KEY(user_id) REFERENCES cbd_user (id), 
	CONSTRAINT fk_foreignkey_cbd_own_b3a8eed2 FOREIGN KEY(previous_owner_id) REFERENCES cbd_obligation_owner (id), 
	CONSTRAINT fk_foreignkey_cbd_own_c05b1639 FOREIGN KEY(task_id) REFERENCES cbd_workflow_action (id), 
	CONSTRAINT fk_foreignkey_cbd_own_2a724efb FOREIGN KEY(applied_owner_id) REFERENCES cbd_obligation_owner (id), 
	CONSTRAINT ck_owner_change_primary_ow CHECK (primary_owner_flag IN (0,1))
)""",
]

INDEXES = [
    r"""CREATE INDEX ix_obligation_own_11313672 ON cbd_obligation_owner_change (approved_by)""",
    r"""CREATE INDEX ix_obligation_own_532192e0 ON cbd_obligation_owner_change (business_owner_unit_id)""",
    r"""CREATE INDEX ix_obligation_own_5af285d7 ON cbd_obligation_owner_change (reviewed_by)""",
    r"""CREATE INDEX ix_obligation_own_ada334df ON cbd_obligation_owner_change (approver_user_id)""",
    r"""CREATE INDEX ix_obligation_own_ba0913b9 ON cbd_obligation_owner_change (created_by)""",
    r"""CREATE INDEX ix_obligation_own_c96be97a ON cbd_obligation_owner_change (obligation_id)""",
    r"""CREATE INDEX ix_obligation_own_fce6c4f4 ON cbd_obligation_owner_change (compliance_reviewer_user_id)""",
    r"""CREATE UNIQUE INDEX uq_cbd_owner_change_pending ON cbd_obligation_owner_change (CASE WHEN (approval_status IN ('IN_REVIEW', 'REVIEWED')) THEN obligation_id END)""",
    r"""CREATE INDEX ix_owner_change_a_0e6908fd ON cbd_owner_change_assignment (previous_owner_id)""",
    r"""CREATE INDEX ix_owner_change_a_150479c9 ON cbd_owner_change_assignment (org_unit_id)""",
    r"""CREATE INDEX ix_owner_change_a_2adfdbfa ON cbd_owner_change_assignment (applied_owner_id)""",
    r"""CREATE INDEX ix_owner_change_a_3e57c227 ON cbd_owner_change_assignment (user_id)""",
    r"""CREATE INDEX ix_owner_change_a_5747bcf4 ON cbd_owner_change_assignment (change_id)""",
    r"""CREATE INDEX ix_cbd_owner_ended_change ON cbd_obligation_owner (ended_by_change_id)""",
]

TRIGGERS = [
    r"""CREATE OR REPLACE TRIGGER cbd_guard_008
BEFORE UPDATE OR DELETE ON cbd_compliance_obligation
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.primary_clause_id <> :NEW.primary_clause_id OR (:OLD.primary_clause_id IS NULL AND :NEW.primary_clause_id IS NOT NULL) OR (:OLD.primary_clause_id IS NOT NULL AND :NEW.primary_clause_id IS NULL)) OR
      (:OLD.title <> :NEW.title OR (:OLD.title IS NULL AND :NEW.title IS NOT NULL) OR (:OLD.title IS NOT NULL AND :NEW.title IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.statement, :NEW.statement) <> 0 OR (:OLD.statement IS NULL AND :NEW.statement IS NOT NULL) OR (:OLD.statement IS NOT NULL AND :NEW.statement IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.internal_interpretation, :NEW.internal_interpretation) <> 0 OR (:OLD.internal_interpretation IS NULL AND :NEW.internal_interpretation IS NOT NULL) OR (:OLD.internal_interpretation IS NOT NULL AND :NEW.internal_interpretation IS NULL)) OR
      (:OLD.category_id <> :NEW.category_id OR (:OLD.category_id IS NULL AND :NEW.category_id IS NOT NULL) OR (:OLD.category_id IS NOT NULL AND :NEW.category_id IS NULL)) OR
      (:OLD.obligation_nature <> :NEW.obligation_nature OR (:OLD.obligation_nature IS NULL AND :NEW.obligation_nature IS NOT NULL) OR (:OLD.obligation_nature IS NOT NULL AND :NEW.obligation_nature IS NULL)) OR
      (:OLD.frequency_id <> :NEW.frequency_id OR (:OLD.frequency_id IS NULL AND :NEW.frequency_id IS NOT NULL) OR (:OLD.frequency_id IS NOT NULL AND :NEW.frequency_id IS NULL)) OR
      (:OLD.primary_domain_id <> :NEW.primary_domain_id OR (:OLD.primary_domain_id IS NULL AND :NEW.primary_domain_id IS NOT NULL) OR (:OLD.primary_domain_id IS NOT NULL AND :NEW.primary_domain_id IS NULL)) OR
      (:OLD.criticality <> :NEW.criticality OR (:OLD.criticality IS NULL AND :NEW.criticality IS NOT NULL) OR (:OLD.criticality IS NOT NULL AND :NEW.criticality IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.breach_consequence, :NEW.breach_consequence) <> 0 OR (:OLD.breach_consequence IS NULL AND :NEW.breach_consequence IS NOT NULL) OR (:OLD.breach_consequence IS NOT NULL AND :NEW.breach_consequence IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.evidence_standard, :NEW.evidence_standard) <> 0 OR (:OLD.evidence_standard IS NULL AND :NEW.evidence_standard IS NOT NULL) OR (:OLD.evidence_standard IS NOT NULL AND :NEW.evidence_standard IS NULL)) OR
      (:OLD.testing_required_flag <> :NEW.testing_required_flag OR (:OLD.testing_required_flag IS NULL AND :NEW.testing_required_flag IS NOT NULL) OR (:OLD.testing_required_flag IS NOT NULL AND :NEW.testing_required_flag IS NULL)) OR
      (:OLD.certification_required_flag <> :NEW.certification_required_flag OR (:OLD.certification_required_flag IS NULL AND :NEW.certification_required_flag IS NOT NULL) OR (:OLD.certification_required_flag IS NOT NULL AND :NEW.certification_required_flag IS NULL)) OR
      (:OLD.reporting_required_flag <> :NEW.reporting_required_flag OR (:OLD.reporting_required_flag IS NULL AND :NEW.reporting_required_flag IS NOT NULL) OR (:OLD.reporting_required_flag IS NOT NULL AND :NEW.reporting_required_flag IS NULL)) OR
      (:OLD.retention_required_flag <> :NEW.retention_required_flag OR (:OLD.retention_required_flag IS NULL AND :NEW.retention_required_flag IS NOT NULL) OR (:OLD.retention_required_flag IS NOT NULL AND :NEW.retention_required_flag IS NULL)) OR
      (:OLD.regulatory_owner_unit_id <> :NEW.regulatory_owner_unit_id OR (:OLD.regulatory_owner_unit_id IS NULL AND :NEW.regulatory_owner_unit_id IS NOT NULL) OR (:OLD.regulatory_owner_unit_id IS NOT NULL AND :NEW.regulatory_owner_unit_id IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.next_review_date <> :NEW.next_review_date OR (:OLD.next_review_date IS NULL AND :NEW.next_review_date IS NOT NULL) OR (:OLD.next_review_date IS NOT NULL AND :NEW.next_review_date IS NULL)) OR
      (:OLD.version_number <> :NEW.version_number OR (:OLD.version_number IS NULL AND :NEW.version_number IS NOT NULL) OR (:OLD.version_number IS NOT NULL AND :NEW.version_number IS NULL)) OR
      (:OLD.supersedes_obligation_id <> :NEW.supersedes_obligation_id OR (:OLD.supersedes_obligation_id IS NULL AND :NEW.supersedes_obligation_id IS NOT NULL) OR (:OLD.supersedes_obligation_id IS NOT NULL AND :NEW.supersedes_obligation_id IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_active_obligation_guard
BEFORE INSERT OR UPDATE ON cbd_compliance_obligation
FOR EACH ROW
DECLARE found_count INTEGER;
BEGIN

  IF :NEW.record_status = 'ACTIVE' THEN
    SELECT COUNT(*) INTO found_count FROM cbd_obligation_clause_map
      WHERE obligation_id = :NEW.id AND clause_id = :NEW.primary_clause_id AND link_type = 'PRIMARY'
        AND effective_from <= :NEW.effective_from AND (effective_to IS NULL OR effective_to > :NEW.effective_from);
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20012, 'Active obligations require a primary source mapping.'); END IF;
    SELECT COUNT(*) INTO found_count FROM cbd_regulatory_clause
      WHERE id = :NEW.primary_clause_id AND interpretation_status = 'APPROVED' AND approval_status = 'APPROVED';
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20013, 'Active obligations require approved source interpretation.'); END IF;
    SELECT COUNT(*) INTO found_count FROM cbd_obligation_applicability WHERE obligation_id = :NEW.id
      AND approval_status = 'APPROVED' AND effective_from <= :NEW.effective_from
      AND (effective_to IS NULL OR effective_to > :NEW.effective_from);
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20014, 'Active obligations require approved applicability.'); END IF;
    FOR r IN (SELECT 'REGULATORY' role_name FROM dual UNION ALL SELECT 'BUSINESS' FROM dual
              UNION ALL SELECT 'CONTROL' FROM dual UNION ALL SELECT 'COMPLIANCE_REVIEWER' FROM dual) LOOP
      SELECT COUNT(*) INTO found_count FROM cbd_obligation_owner WHERE obligation_id = :NEW.id
        AND ended_by_change_id IS NULL AND owner_role = r.role_name AND approval_status = 'APPROVED'
        AND (r.role_name NOT IN ('REGULATORY','BUSINESS') OR primary_owner_flag = 1)
        AND effective_from <= GREATEST(:NEW.effective_from,TRUNC(SYSDATE)) AND (effective_to IS NULL OR effective_to > GREATEST(:NEW.effective_from,TRUNC(SYSDATE)));
      IF found_count = 0 OR (r.role_name IN ('REGULATORY','BUSINESS') AND found_count <> 1) THEN
        RAISE_APPLICATION_ERROR(-20015, 'Active obligations require approved regulatory, business, control and reviewer ownership.');
      END IF;
    END LOOP;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_primary_owner_guard
FOR INSERT OR UPDATE ON cbd_obligation_owner
COMPOUND TRIGGER
  locked_id VARCHAR2(36);
  found_count INTEGER;
  BEFORE EACH ROW IS
  BEGIN
    SELECT id INTO locked_id FROM cbd_compliance_obligation WHERE id = :NEW.obligation_id FOR UPDATE;
  END BEFORE EACH ROW;
  AFTER STATEMENT IS
  BEGIN
    SELECT COUNT(*) INTO found_count FROM cbd_obligation_owner a JOIN cbd_obligation_owner b
      ON a.obligation_id = b.obligation_id AND a.owner_role = b.owner_role AND a.id < b.id
      WHERE a.owner_role IN ('REGULATORY','BUSINESS') AND a.primary_owner_flag = 1 AND b.primary_owner_flag = 1
        AND a.ended_by_change_id IS NULL AND b.ended_by_change_id IS NULL AND a.approval_status = 'APPROVED' AND b.approval_status = 'APPROVED'
        AND a.effective_from < NVL(b.effective_to, DATE '9999-12-31')
        AND b.effective_from < NVL(a.effective_to, DATE '9999-12-31');
    IF found_count > 0 THEN RAISE_APPLICATION_ERROR(-20028, 'Approved primary regulatory and business owner periods cannot overlap.'); END IF;
  END AFTER STATEMENT;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_owner_change_parent_guard
BEFORE UPDATE ON cbd_compliance_obligation FOR EACH ROW
DECLARE permitted INTEGER;
BEGIN
  IF :OLD.approval_status = 'APPROVED' AND (:OLD.business_owner_unit_id <> :NEW.business_owner_unit_id OR :OLD.compliance_reviewer_user_id <> :NEW.compliance_reviewer_user_id) THEN
    SELECT COUNT(*) INTO permitted FROM cbd_obligation_owner_change
      WHERE obligation_id=:OLD.id AND approval_status='APPROVED' AND applied_at IS NULL
      AND baseline_revision=:OLD.edit_revision AND :NEW.edit_revision=:OLD.edit_revision+1
      AND business_owner_unit_id=:NEW.business_owner_unit_id AND compliance_reviewer_user_id=:NEW.compliance_reviewer_user_id;
    IF permitted<>1 THEN RAISE_APPLICATION_ERROR(-20082,'Approved ownership fields require an independently approved ownership request.'); END IF;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_owner_assignment_end_guard
BEFORE UPDATE OF ended_by_change_id ON cbd_obligation_owner FOR EACH ROW
DECLARE permitted INTEGER; retained INTEGER;
BEGIN
  IF :OLD.ended_by_change_id IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20083,'Assignment replacement history is immutable.'); END IF;
  IF :NEW.ended_by_change_id IS NOT NULL THEN
    SELECT COUNT(*) INTO permitted FROM cbd_obligation_owner_change
      WHERE id=:NEW.ended_by_change_id AND obligation_id=:OLD.obligation_id AND approval_status='APPROVED' AND applied_at IS NULL;
    SELECT COUNT(*) INTO retained FROM cbd_owner_change_assignment WHERE change_id=:NEW.ended_by_change_id AND previous_owner_id=:OLD.id;
    IF permitted<>1 OR retained<>0 THEN RAISE_APPLICATION_ERROR(-20083,'End an assignment only through its approved replacement request.'); END IF;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_owner_change_retain
BEFORE UPDATE OR DELETE ON cbd_obligation_owner_change FOR EACH ROW
BEGIN
  IF DELETING THEN RAISE_APPLICATION_ERROR(-20084,'Ownership request history must be retained.'); END IF;
  IF :OLD.id<>:NEW.id OR :OLD.obligation_id<>:NEW.obligation_id OR :OLD.baseline_revision<>:NEW.baseline_revision
    OR :OLD.business_owner_unit_id<>:NEW.business_owner_unit_id OR :OLD.compliance_reviewer_user_id<>:NEW.compliance_reviewer_user_id
    OR :OLD.approver_user_id<>:NEW.approver_user_id OR :OLD.created_by<>:NEW.created_by OR DBMS_LOB.COMPARE(:OLD.reason,:NEW.reason)<>0 THEN
    RAISE_APPLICATION_ERROR(-20084,'Submitted ownership proposals are immutable. Withdraw and submit a new request.');
  END IF;
  IF :OLD.applied_at IS NOT NULL THEN RAISE_APPLICATION_ERROR(-20084,'Applied ownership requests are immutable.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_owner_change_item_retain
BEFORE UPDATE OR DELETE ON cbd_owner_change_assignment FOR EACH ROW
BEGIN
  IF DELETING THEN RAISE_APPLICATION_ERROR(-20084,'Ownership proposal assignments must be retained.'); END IF;
  IF :OLD.id<>:NEW.id OR :OLD.change_id<>:NEW.change_id OR :OLD.user_id<>:NEW.user_id OR :OLD.org_unit_id<>:NEW.org_unit_id
    OR :OLD.owner_role<>:NEW.owner_role OR :OLD.primary_owner_flag<>:NEW.primary_owner_flag
    OR NVL(:OLD.previous_owner_id,'-')<>NVL(:NEW.previous_owner_id,'-')
    OR (:OLD.task_id IS NOT NULL AND NVL(:OLD.task_id,'-')<>NVL(:NEW.task_id,'-'))
    OR (:OLD.applied_owner_id IS NOT NULL AND NVL(:OLD.applied_owner_id,'-')<>NVL(:NEW.applied_owner_id,'-')) THEN
    RAISE_APPLICATION_ERROR(-20084,'Ownership proposal assignments and their retained links are immutable.');
  END IF;
END;""",
]

def upgrade():
    op.execute(sa.DDL(TABLES[0]))
    op.add_column('cbd_obligation_owner',sa.Column('ended_by_change_id',sa.String(36),nullable=True))
    op.create_foreign_key('fk_foreignkey_cbd_obl_07d4475b','cbd_obligation_owner','cbd_obligation_owner_change',['ended_by_change_id'],['id'])
    op.execute(sa.DDL(TABLES[1]))
    for statement in INDEXES+TRIGGERS:op.execute(sa.DDL(statement))
    for name in ['cbd_guard_011']:
        op.execute('ALTER TRIGGER '+name+' COMPILE')
    if not context.is_offline_mode():
        errors=op.get_bind().execute(sa.text("SELECT name,text FROM user_errors WHERE type='TRIGGER' AND name LIKE 'CBD_%' ORDER BY name,sequence")).all()
        if errors:raise RuntimeError('Ownership migration trigger compilation failed: '+str(errors))

def downgrade():
    raise RuntimeError('Ownership requests, approvals and replacement history must be retained.')
