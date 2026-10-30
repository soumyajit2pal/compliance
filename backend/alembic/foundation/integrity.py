"""Retain approved content, audit history, original dates and closure evidence.

SQL is frozen in this revision; no application metadata is imported.
"""
from alembic import op
import sqlalchemy as sa


TRIGGERS = [
    r"""CREATE OR REPLACE TRIGGER cbd_guard_001
BEFORE UPDATE OR DELETE ON cbd_regulator
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.name <> :NEW.name OR (:OLD.name IS NULL AND :NEW.name IS NOT NULL) OR (:OLD.name IS NOT NULL AND :NEW.name IS NULL)) OR
      (:OLD.regulator_type <> :NEW.regulator_type OR (:OLD.regulator_type IS NULL AND :NEW.regulator_type IS NOT NULL) OR (:OLD.regulator_type IS NOT NULL AND :NEW.regulator_type IS NULL)) OR
      (:OLD.jurisdiction <> :NEW.jurisdiction OR (:OLD.jurisdiction IS NULL AND :NEW.jurisdiction IS NOT NULL) OR (:OLD.jurisdiction IS NOT NULL AND :NEW.jurisdiction IS NULL)) OR
      (:OLD.parent_regulator_id <> :NEW.parent_regulator_id OR (:OLD.parent_regulator_id IS NULL AND :NEW.parent_regulator_id IS NOT NULL) OR (:OLD.parent_regulator_id IS NOT NULL AND :NEW.parent_regulator_id IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_002
BEFORE UPDATE OR DELETE ON cbd_domain_crosswalk
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.source_domain_id <> :NEW.source_domain_id OR (:OLD.source_domain_id IS NULL AND :NEW.source_domain_id IS NOT NULL) OR (:OLD.source_domain_id IS NOT NULL AND :NEW.source_domain_id IS NULL)) OR
      (:OLD.target_domain_id <> :NEW.target_domain_id OR (:OLD.target_domain_id IS NULL AND :NEW.target_domain_id IS NOT NULL) OR (:OLD.target_domain_id IS NOT NULL AND :NEW.target_domain_id IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.mapping_basis, :NEW.mapping_basis) <> 0 OR (:OLD.mapping_basis IS NULL AND :NEW.mapping_basis IS NOT NULL) OR (:OLD.mapping_basis IS NOT NULL AND :NEW.mapping_basis IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_003
BEFORE UPDATE OR DELETE ON cbd_document
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  RAISE_APPLICATION_ERROR(-20002, 'Retained audit, status and source metadata is append-only.');
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_004
BEFORE UPDATE OR DELETE ON cbd_regulatory_instrument
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.regulator_id <> :NEW.regulator_id OR (:OLD.regulator_id IS NULL AND :NEW.regulator_id IS NOT NULL) OR (:OLD.regulator_id IS NOT NULL AND :NEW.regulator_id IS NULL)) OR
      (:OLD.instrument_type_id <> :NEW.instrument_type_id OR (:OLD.instrument_type_id IS NULL AND :NEW.instrument_type_id IS NOT NULL) OR (:OLD.instrument_type_id IS NOT NULL AND :NEW.instrument_type_id IS NULL)) OR
      (:OLD.primary_domain_id <> :NEW.primary_domain_id OR (:OLD.primary_domain_id IS NULL AND :NEW.primary_domain_id IS NOT NULL) OR (:OLD.primary_domain_id IS NOT NULL AND :NEW.primary_domain_id IS NULL)) OR
      (:OLD.official_reference_number <> :NEW.official_reference_number OR (:OLD.official_reference_number IS NULL AND :NEW.official_reference_number IS NOT NULL) OR (:OLD.official_reference_number IS NOT NULL AND :NEW.official_reference_number IS NULL)) OR
      (:OLD.title <> :NEW.title OR (:OLD.title IS NULL AND :NEW.title IS NOT NULL) OR (:OLD.title IS NOT NULL AND :NEW.title IS NULL)) OR
      (:OLD.short_title <> :NEW.short_title OR (:OLD.short_title IS NULL AND :NEW.short_title IS NOT NULL) OR (:OLD.short_title IS NOT NULL AND :NEW.short_title IS NULL)) OR
      (:OLD.issue_date <> :NEW.issue_date OR (:OLD.issue_date IS NULL AND :NEW.issue_date IS NOT NULL) OR (:OLD.issue_date IS NOT NULL AND :NEW.issue_date IS NULL)) OR
      (:OLD.effective_date <> :NEW.effective_date OR (:OLD.effective_date IS NULL AND :NEW.effective_date IS NOT NULL) OR (:OLD.effective_date IS NOT NULL AND :NEW.effective_date IS NULL)) OR
      (:OLD.applicability_date <> :NEW.applicability_date OR (:OLD.applicability_date IS NULL AND :NEW.applicability_date IS NOT NULL) OR (:OLD.applicability_date IS NOT NULL AND :NEW.applicability_date IS NULL)) OR
      (:OLD.materiality <> :NEW.materiality OR (:OLD.materiality IS NULL AND :NEW.materiality IS NOT NULL) OR (:OLD.materiality IS NOT NULL AND :NEW.materiality IS NULL)) OR
      (:OLD.regulatory_owner_unit_id <> :NEW.regulatory_owner_unit_id OR (:OLD.regulatory_owner_unit_id IS NULL AND :NEW.regulatory_owner_unit_id IS NOT NULL) OR (:OLD.regulatory_owner_unit_id IS NOT NULL AND :NEW.regulatory_owner_unit_id IS NULL)) OR
      (:OLD.interpretation_owner_user_id <> :NEW.interpretation_owner_user_id OR (:OLD.interpretation_owner_user_id IS NULL AND :NEW.interpretation_owner_user_id IS NOT NULL) OR (:OLD.interpretation_owner_user_id IS NOT NULL AND :NEW.interpretation_owner_user_id IS NULL)) OR
      (:OLD.source_document_id <> :NEW.source_document_id OR (:OLD.source_document_id IS NULL AND :NEW.source_document_id IS NOT NULL) OR (:OLD.source_document_id IS NOT NULL AND :NEW.source_document_id IS NULL)) OR
      (:OLD.confidentiality_class_id <> :NEW.confidentiality_class_id OR (:OLD.confidentiality_class_id IS NULL AND :NEW.confidentiality_class_id IS NOT NULL) OR (:OLD.confidentiality_class_id IS NOT NULL AND :NEW.confidentiality_class_id IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.keywords, :NEW.keywords) <> 0 OR (:OLD.keywords IS NULL AND :NEW.keywords IS NOT NULL) OR (:OLD.keywords IS NOT NULL AND :NEW.keywords IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_005
BEFORE UPDATE OR DELETE ON cbd_instrument_version
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.instrument_id <> :NEW.instrument_id OR (:OLD.instrument_id IS NULL AND :NEW.instrument_id IS NOT NULL) OR (:OLD.instrument_id IS NOT NULL AND :NEW.instrument_id IS NULL)) OR
      (:OLD.version_number <> :NEW.version_number OR (:OLD.version_number IS NULL AND :NEW.version_number IS NOT NULL) OR (:OLD.version_number IS NOT NULL AND :NEW.version_number IS NULL)) OR
      (:OLD.version_date <> :NEW.version_date OR (:OLD.version_date IS NULL AND :NEW.version_date IS NOT NULL) OR (:OLD.version_date IS NOT NULL AND :NEW.version_date IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.consolidated_flag <> :NEW.consolidated_flag OR (:OLD.consolidated_flag IS NULL AND :NEW.consolidated_flag IS NOT NULL) OR (:OLD.consolidated_flag IS NOT NULL AND :NEW.consolidated_flag IS NULL)) OR
      (:OLD.source_document_id <> :NEW.source_document_id OR (:OLD.source_document_id IS NULL AND :NEW.source_document_id IS NOT NULL) OR (:OLD.source_document_id IS NOT NULL AND :NEW.source_document_id IS NULL)) OR
      (:OLD.supersedes_version_id <> :NEW.supersedes_version_id OR (:OLD.supersedes_version_id IS NULL AND :NEW.supersedes_version_id IS NOT NULL) OR (:OLD.supersedes_version_id IS NOT NULL AND :NEW.supersedes_version_id IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.change_summary, :NEW.change_summary) <> 0 OR (:OLD.change_summary IS NULL AND :NEW.change_summary IS NOT NULL) OR (:OLD.change_summary IS NOT NULL AND :NEW.change_summary IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_006
BEFORE UPDATE OR DELETE ON cbd_regulatory_clause
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.instrument_version_id <> :NEW.instrument_version_id OR (:OLD.instrument_version_id IS NULL AND :NEW.instrument_version_id IS NOT NULL) OR (:OLD.instrument_version_id IS NOT NULL AND :NEW.instrument_version_id IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.parent_clause_id <> :NEW.parent_clause_id OR (:OLD.parent_clause_id IS NULL AND :NEW.parent_clause_id IS NOT NULL) OR (:OLD.parent_clause_id IS NOT NULL AND :NEW.parent_clause_id IS NULL)) OR
      (:OLD.clause_level <> :NEW.clause_level OR (:OLD.clause_level IS NULL AND :NEW.clause_level IS NOT NULL) OR (:OLD.clause_level IS NOT NULL AND :NEW.clause_level IS NULL)) OR
      (:OLD.sequence_number <> :NEW.sequence_number OR (:OLD.sequence_number IS NULL AND :NEW.sequence_number IS NOT NULL) OR (:OLD.sequence_number IS NOT NULL AND :NEW.sequence_number IS NULL)) OR
      (:OLD.heading <> :NEW.heading OR (:OLD.heading IS NULL AND :NEW.heading IS NOT NULL) OR (:OLD.heading IS NOT NULL AND :NEW.heading IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.clause_text, :NEW.clause_text) <> 0 OR (:OLD.clause_text IS NULL AND :NEW.clause_text IS NOT NULL) OR (:OLD.clause_text IS NOT NULL AND :NEW.clause_text IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.internal_interpretation, :NEW.internal_interpretation) <> 0 OR (:OLD.internal_interpretation IS NULL AND :NEW.internal_interpretation IS NOT NULL) OR (:OLD.internal_interpretation IS NOT NULL AND :NEW.internal_interpretation IS NULL)) OR
      (:OLD.mandatory_flag <> :NEW.mandatory_flag OR (:OLD.mandatory_flag IS NULL AND :NEW.mandatory_flag IS NOT NULL) OR (:OLD.mandatory_flag IS NOT NULL AND :NEW.mandatory_flag IS NULL)) OR
      (:OLD.conditional_flag <> :NEW.conditional_flag OR (:OLD.conditional_flag IS NULL AND :NEW.conditional_flag IS NOT NULL) OR (:OLD.conditional_flag IS NOT NULL AND :NEW.conditional_flag IS NULL)) OR
      (:OLD.reporting_flag <> :NEW.reporting_flag OR (:OLD.reporting_flag IS NULL AND :NEW.reporting_flag IS NOT NULL) OR (:OLD.reporting_flag IS NOT NULL AND :NEW.reporting_flag IS NULL)) OR
      (:OLD.disclosure_flag <> :NEW.disclosure_flag OR (:OLD.disclosure_flag IS NULL AND :NEW.disclosure_flag IS NOT NULL) OR (:OLD.disclosure_flag IS NOT NULL AND :NEW.disclosure_flag IS NULL)) OR
      (:OLD.retention_flag <> :NEW.retention_flag OR (:OLD.retention_flag IS NULL AND :NEW.retention_flag IS NOT NULL) OR (:OLD.retention_flag IS NOT NULL AND :NEW.retention_flag IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.clause_status <> :NEW.clause_status OR (:OLD.clause_status IS NULL AND :NEW.clause_status IS NOT NULL) OR (:OLD.clause_status IS NOT NULL AND :NEW.clause_status IS NULL)) OR
      (:OLD.source_page_reference <> :NEW.source_page_reference OR (:OLD.source_page_reference IS NULL AND :NEW.source_page_reference IS NOT NULL) OR (:OLD.source_page_reference IS NOT NULL AND :NEW.source_page_reference IS NULL)) OR
      (:OLD.interpretation_status <> :NEW.interpretation_status OR (:OLD.interpretation_status IS NULL AND :NEW.interpretation_status IS NOT NULL) OR (:OLD.interpretation_status IS NOT NULL AND :NEW.interpretation_status IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_007
BEFORE UPDATE OR DELETE ON cbd_clause_relationship
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.source_clause_id <> :NEW.source_clause_id OR (:OLD.source_clause_id IS NULL AND :NEW.source_clause_id IS NOT NULL) OR (:OLD.source_clause_id IS NOT NULL AND :NEW.source_clause_id IS NULL)) OR
      (:OLD.target_clause_id <> :NEW.target_clause_id OR (:OLD.target_clause_id IS NULL AND :NEW.target_clause_id IS NOT NULL) OR (:OLD.target_clause_id IS NOT NULL AND :NEW.target_clause_id IS NULL)) OR
      (:OLD.relationship_type <> :NEW.relationship_type OR (:OLD.relationship_type IS NULL AND :NEW.relationship_type IS NOT NULL) OR (:OLD.relationship_type IS NOT NULL AND :NEW.relationship_type IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
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
      (:OLD.business_owner_unit_id <> :NEW.business_owner_unit_id OR (:OLD.business_owner_unit_id IS NULL AND :NEW.business_owner_unit_id IS NOT NULL) OR (:OLD.business_owner_unit_id IS NOT NULL AND :NEW.business_owner_unit_id IS NULL)) OR
      (:OLD.compliance_reviewer_user_id <> :NEW.compliance_reviewer_user_id OR (:OLD.compliance_reviewer_user_id IS NULL AND :NEW.compliance_reviewer_user_id IS NOT NULL) OR (:OLD.compliance_reviewer_user_id IS NOT NULL AND :NEW.compliance_reviewer_user_id IS NULL)) OR
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
    r"""CREATE OR REPLACE TRIGGER cbd_guard_009
BEFORE UPDATE OR DELETE ON cbd_policy_document
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.name <> :NEW.name OR (:OLD.name IS NULL AND :NEW.name IS NOT NULL) OR (:OLD.name IS NOT NULL AND :NEW.name IS NULL)) OR
      (:OLD.policy_type <> :NEW.policy_type OR (:OLD.policy_type IS NULL AND :NEW.policy_type IS NOT NULL) OR (:OLD.policy_type IS NOT NULL AND :NEW.policy_type IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.approval_authority <> :NEW.approval_authority OR (:OLD.approval_authority IS NULL AND :NEW.approval_authority IS NOT NULL) OR (:OLD.approval_authority IS NOT NULL AND :NEW.approval_authority IS NULL)) OR
      (:OLD.version_number <> :NEW.version_number OR (:OLD.version_number IS NULL AND :NEW.version_number IS NOT NULL) OR (:OLD.version_number IS NOT NULL AND :NEW.version_number IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.review_date <> :NEW.review_date OR (:OLD.review_date IS NULL AND :NEW.review_date IS NOT NULL) OR (:OLD.review_date IS NOT NULL AND :NEW.review_date IS NULL)) OR
      (:OLD.document_id <> :NEW.document_id OR (:OLD.document_id IS NULL AND :NEW.document_id IS NOT NULL) OR (:OLD.document_id IS NOT NULL AND :NEW.document_id IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_010
BEFORE UPDATE OR DELETE ON cbd_obligation_applicability
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.obligation_id <> :NEW.obligation_id OR (:OLD.obligation_id IS NULL AND :NEW.obligation_id IS NOT NULL) OR (:OLD.obligation_id IS NOT NULL AND :NEW.obligation_id IS NULL)) OR
      (:OLD.legal_entity_id <> :NEW.legal_entity_id OR (:OLD.legal_entity_id IS NULL AND :NEW.legal_entity_id IS NOT NULL) OR (:OLD.legal_entity_id IS NOT NULL AND :NEW.legal_entity_id IS NULL)) OR
      (:OLD.org_unit_id <> :NEW.org_unit_id OR (:OLD.org_unit_id IS NULL AND :NEW.org_unit_id IS NOT NULL) OR (:OLD.org_unit_id IS NOT NULL AND :NEW.org_unit_id IS NULL)) OR
      (:OLD.product_id <> :NEW.product_id OR (:OLD.product_id IS NULL AND :NEW.product_id IS NOT NULL) OR (:OLD.product_id IS NOT NULL AND :NEW.product_id IS NULL)) OR
      (:OLD.process_id <> :NEW.process_id OR (:OLD.process_id IS NULL AND :NEW.process_id IS NOT NULL) OR (:OLD.process_id IS NOT NULL AND :NEW.process_id IS NULL)) OR
      (:OLD.channel_id <> :NEW.channel_id OR (:OLD.channel_id IS NULL AND :NEW.channel_id IS NOT NULL) OR (:OLD.channel_id IS NOT NULL AND :NEW.channel_id IS NULL)) OR
      (:OLD.customer_segment_id <> :NEW.customer_segment_id OR (:OLD.customer_segment_id IS NULL AND :NEW.customer_segment_id IS NOT NULL) OR (:OLD.customer_segment_id IS NOT NULL AND :NEW.customer_segment_id IS NULL)) OR
      (:OLD.geography_id <> :NEW.geography_id OR (:OLD.geography_id IS NULL AND :NEW.geography_id IS NOT NULL) OR (:OLD.geography_id IS NOT NULL AND :NEW.geography_id IS NULL)) OR
      (:OLD.applicability_status <> :NEW.applicability_status OR (:OLD.applicability_status IS NULL AND :NEW.applicability_status IS NOT NULL) OR (:OLD.applicability_status IS NOT NULL AND :NEW.applicability_status IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.basis, :NEW.basis) <> 0 OR (:OLD.basis IS NULL AND :NEW.basis IS NOT NULL) OR (:OLD.basis IS NOT NULL AND :NEW.basis IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.conditions, :NEW.conditions) <> 0 OR (:OLD.conditions IS NULL AND :NEW.conditions IS NOT NULL) OR (:OLD.conditions IS NOT NULL AND :NEW.conditions IS NULL)) OR
      (:OLD.assessed_by <> :NEW.assessed_by OR (:OLD.assessed_by IS NULL AND :NEW.assessed_by IS NOT NULL) OR (:OLD.assessed_by IS NOT NULL AND :NEW.assessed_by IS NULL)) OR
      (:OLD.assessed_date <> :NEW.assessed_date OR (:OLD.assessed_date IS NULL AND :NEW.assessed_date IS NOT NULL) OR (:OLD.assessed_date IS NOT NULL AND :NEW.assessed_date IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.next_review_date <> :NEW.next_review_date OR (:OLD.next_review_date IS NULL AND :NEW.next_review_date IS NOT NULL) OR (:OLD.next_review_date IS NOT NULL AND :NEW.next_review_date IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_011
BEFORE UPDATE OR DELETE ON cbd_obligation_owner
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.obligation_id <> :NEW.obligation_id OR (:OLD.obligation_id IS NULL AND :NEW.obligation_id IS NOT NULL) OR (:OLD.obligation_id IS NOT NULL AND :NEW.obligation_id IS NULL)) OR
      (:OLD.org_unit_id <> :NEW.org_unit_id OR (:OLD.org_unit_id IS NULL AND :NEW.org_unit_id IS NOT NULL) OR (:OLD.org_unit_id IS NOT NULL AND :NEW.org_unit_id IS NULL)) OR
      (:OLD.user_id <> :NEW.user_id OR (:OLD.user_id IS NULL AND :NEW.user_id IS NOT NULL) OR (:OLD.user_id IS NOT NULL AND :NEW.user_id IS NULL)) OR
      (:OLD.owner_role <> :NEW.owner_role OR (:OLD.owner_role IS NULL AND :NEW.owner_role IS NOT NULL) OR (:OLD.owner_role IS NOT NULL AND :NEW.owner_role IS NULL)) OR
      (:OLD.primary_owner_flag <> :NEW.primary_owner_flag OR (:OLD.primary_owner_flag IS NULL AND :NEW.primary_owner_flag IS NOT NULL) OR (:OLD.primary_owner_flag IS NOT NULL AND :NEW.primary_owner_flag IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.delegated_user_id <> :NEW.delegated_user_id OR (:OLD.delegated_user_id IS NULL AND :NEW.delegated_user_id IS NOT NULL) OR (:OLD.delegated_user_id IS NOT NULL AND :NEW.delegated_user_id IS NULL)) OR
      (:OLD.delegated_from <> :NEW.delegated_from OR (:OLD.delegated_from IS NULL AND :NEW.delegated_from IS NOT NULL) OR (:OLD.delegated_from IS NOT NULL AND :NEW.delegated_from IS NULL)) OR
      (:OLD.delegated_to <> :NEW.delegated_to OR (:OLD.delegated_to IS NULL AND :NEW.delegated_to IS NOT NULL) OR (:OLD.delegated_to IS NOT NULL AND :NEW.delegated_to IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_012
BEFORE UPDATE OR DELETE ON cbd_control
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.title <> :NEW.title OR (:OLD.title IS NULL AND :NEW.title IS NOT NULL) OR (:OLD.title IS NOT NULL AND :NEW.title IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.objective, :NEW.objective) <> 0 OR (:OLD.objective IS NULL AND :NEW.objective IS NOT NULL) OR (:OLD.objective IS NOT NULL AND :NEW.objective IS NULL)) OR
      (:OLD.control_type <> :NEW.control_type OR (:OLD.control_type IS NULL AND :NEW.control_type IS NOT NULL) OR (:OLD.control_type IS NOT NULL AND :NEW.control_type IS NULL)) OR
      (:OLD.execution_mode <> :NEW.execution_mode OR (:OLD.execution_mode IS NULL AND :NEW.execution_mode IS NOT NULL) OR (:OLD.execution_mode IS NOT NULL AND :NEW.execution_mode IS NULL)) OR
      (:OLD.frequency_id <> :NEW.frequency_id OR (:OLD.frequency_id IS NULL AND :NEW.frequency_id IS NOT NULL) OR (:OLD.frequency_id IS NOT NULL AND :NEW.frequency_id IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.owner_user_id <> :NEW.owner_user_id OR (:OLD.owner_user_id IS NULL AND :NEW.owner_user_id IS NOT NULL) OR (:OLD.owner_user_id IS NOT NULL AND :NEW.owner_user_id IS NULL)) OR
      (:OLD.evidence_type_id <> :NEW.evidence_type_id OR (:OLD.evidence_type_id IS NULL AND :NEW.evidence_type_id IS NOT NULL) OR (:OLD.evidence_type_id IS NOT NULL AND :NEW.evidence_type_id IS NULL)) OR
      (:OLD.system_id <> :NEW.system_id OR (:OLD.system_id IS NULL AND :NEW.system_id IS NOT NULL) OR (:OLD.system_id IS NOT NULL AND :NEW.system_id IS NULL)) OR
      (:OLD.key_control_flag <> :NEW.key_control_flag OR (:OLD.key_control_flag IS NULL AND :NEW.key_control_flag IS NOT NULL) OR (:OLD.key_control_flag IS NOT NULL AND :NEW.key_control_flag IS NULL)) OR
      (:OLD.control_status <> :NEW.control_status OR (:OLD.control_status IS NULL AND :NEW.control_status IS NOT NULL) OR (:OLD.control_status IS NOT NULL AND :NEW.control_status IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.review_date <> :NEW.review_date OR (:OLD.review_date IS NULL AND :NEW.review_date IS NOT NULL) OR (:OLD.review_date IS NOT NULL AND :NEW.review_date IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_013
BEFORE UPDATE OR DELETE ON cbd_obligation_control_map
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.obligation_id <> :NEW.obligation_id OR (:OLD.obligation_id IS NULL AND :NEW.obligation_id IS NOT NULL) OR (:OLD.obligation_id IS NOT NULL AND :NEW.obligation_id IS NULL)) OR
      (:OLD.control_id <> :NEW.control_id OR (:OLD.control_id IS NULL AND :NEW.control_id IS NOT NULL) OR (:OLD.control_id IS NOT NULL AND :NEW.control_id IS NULL)) OR
      (:OLD.coverage_type <> :NEW.coverage_type OR (:OLD.coverage_type IS NULL AND :NEW.coverage_type IS NOT NULL) OR (:OLD.coverage_type IS NOT NULL AND :NEW.coverage_type IS NULL)) OR
      (:OLD.coverage_percentage <> :NEW.coverage_percentage OR (:OLD.coverage_percentage IS NULL AND :NEW.coverage_percentage IS NOT NULL) OR (:OLD.coverage_percentage IS NOT NULL AND :NEW.coverage_percentage IS NULL)) OR
      (:OLD.primary_control_flag <> :NEW.primary_control_flag OR (:OLD.primary_control_flag IS NULL AND :NEW.primary_control_flag IS NOT NULL) OR (:OLD.primary_control_flag IS NOT NULL AND :NEW.primary_control_flag IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.mapping_rationale, :NEW.mapping_rationale) <> 0 OR (:OLD.mapping_rationale IS NULL AND :NEW.mapping_rationale IS NOT NULL) OR (:OLD.mapping_rationale IS NOT NULL AND :NEW.mapping_rationale IS NULL)) OR
      (:OLD.effective_from <> :NEW.effective_from OR (:OLD.effective_from IS NULL AND :NEW.effective_from IS NOT NULL) OR (:OLD.effective_from IS NOT NULL AND :NEW.effective_from IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_014
BEFORE UPDATE OR DELETE ON cbd_evidence_item
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_015
BEFORE UPDATE OR DELETE ON cbd_compliance_test
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_016
BEFORE UPDATE OR DELETE ON cbd_test_plan
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.title <> :NEW.title OR (:OLD.title IS NULL AND :NEW.title IS NOT NULL) OR (:OLD.title IS NOT NULL AND :NEW.title IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.period_from <> :NEW.period_from OR (:OLD.period_from IS NULL AND :NEW.period_from IS NOT NULL) OR (:OLD.period_from IS NOT NULL AND :NEW.period_from IS NULL)) OR
      (:OLD.period_to <> :NEW.period_to OR (:OLD.period_to IS NULL AND :NEW.period_to IS NOT NULL) OR (:OLD.period_to IS NOT NULL AND :NEW.period_to IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_017
BEFORE UPDATE OR DELETE ON cbd_observation
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF UPDATING AND :OLD.original_due_date <> :NEW.original_due_date THEN RAISE_APPLICATION_ERROR(-20004, 'Original due dates are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.source_type <> :NEW.source_type OR (:OLD.source_type IS NULL AND :NEW.source_type IS NOT NULL) OR (:OLD.source_type IS NOT NULL AND :NEW.source_type IS NULL)) OR
      (:OLD.source_record_id <> :NEW.source_record_id OR (:OLD.source_record_id IS NULL AND :NEW.source_record_id IS NOT NULL) OR (:OLD.source_record_id IS NOT NULL AND :NEW.source_record_id IS NULL)) OR
      (:OLD.primary_obligation_id <> :NEW.primary_obligation_id OR (:OLD.primary_obligation_id IS NULL AND :NEW.primary_obligation_id IS NOT NULL) OR (:OLD.primary_obligation_id IS NOT NULL AND :NEW.primary_obligation_id IS NULL)) OR
      (:OLD.primary_clause_id <> :NEW.primary_clause_id OR (:OLD.primary_clause_id IS NULL AND :NEW.primary_clause_id IS NOT NULL) OR (:OLD.primary_clause_id IS NOT NULL AND :NEW.primary_clause_id IS NULL)) OR
      (:OLD.title <> :NEW.title OR (:OLD.title IS NULL AND :NEW.title IS NOT NULL) OR (:OLD.title IS NOT NULL AND :NEW.title IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.criteria, :NEW.criteria) <> 0 OR (:OLD.criteria IS NULL AND :NEW.criteria IS NOT NULL) OR (:OLD.criteria IS NOT NULL AND :NEW.criteria IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.condition_text, :NEW.condition_text) <> 0 OR (:OLD.condition_text IS NULL AND :NEW.condition_text IS NOT NULL) OR (:OLD.condition_text IS NOT NULL AND :NEW.condition_text IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.cause, :NEW.cause) <> 0 OR (:OLD.cause IS NULL AND :NEW.cause IS NOT NULL) OR (:OLD.cause IS NOT NULL AND :NEW.cause IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.consequence, :NEW.consequence) <> 0 OR (:OLD.consequence IS NULL AND :NEW.consequence IS NOT NULL) OR (:OLD.consequence IS NOT NULL AND :NEW.consequence IS NULL)) OR
      (:OLD.severity <> :NEW.severity OR (:OLD.severity IS NULL AND :NEW.severity IS NOT NULL) OR (:OLD.severity IS NOT NULL AND :NEW.severity IS NULL)) OR
      (:OLD.risk_category_id <> :NEW.risk_category_id OR (:OLD.risk_category_id IS NULL AND :NEW.risk_category_id IS NOT NULL) OR (:OLD.risk_category_id IS NOT NULL AND :NEW.risk_category_id IS NULL)) OR
      (:OLD.root_cause_id <> :NEW.root_cause_id OR (:OLD.root_cause_id IS NULL AND :NEW.root_cause_id IS NOT NULL) OR (:OLD.root_cause_id IS NOT NULL AND :NEW.root_cause_id IS NULL)) OR
      (:OLD.repeat_flag <> :NEW.repeat_flag OR (:OLD.repeat_flag IS NULL AND :NEW.repeat_flag IS NOT NULL) OR (:OLD.repeat_flag IS NOT NULL AND :NEW.repeat_flag IS NULL)) OR
      (:OLD.prior_observation_id <> :NEW.prior_observation_id OR (:OLD.prior_observation_id IS NULL AND :NEW.prior_observation_id IS NOT NULL) OR (:OLD.prior_observation_id IS NOT NULL AND :NEW.prior_observation_id IS NULL)) OR
      (:OLD.affected_unit_id <> :NEW.affected_unit_id OR (:OLD.affected_unit_id IS NULL AND :NEW.affected_unit_id IS NOT NULL) OR (:OLD.affected_unit_id IS NOT NULL AND :NEW.affected_unit_id IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.issue_date <> :NEW.issue_date OR (:OLD.issue_date IS NULL AND :NEW.issue_date IS NOT NULL) OR (:OLD.issue_date IS NOT NULL AND :NEW.issue_date IS NULL)) OR
      (:OLD.original_due_date <> :NEW.original_due_date OR (:OLD.original_due_date IS NULL AND :NEW.original_due_date IS NOT NULL) OR (:OLD.original_due_date IS NOT NULL AND :NEW.original_due_date IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.regulatory_impact, :NEW.regulatory_impact) <> 0 OR (:OLD.regulatory_impact IS NULL AND :NEW.regulatory_impact IS NOT NULL) OR (:OLD.regulatory_impact IS NOT NULL AND :NEW.regulatory_impact IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.customer_impact, :NEW.customer_impact) <> 0 OR (:OLD.customer_impact IS NULL AND :NEW.customer_impact IS NOT NULL) OR (:OLD.customer_impact IS NOT NULL AND :NEW.customer_impact IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.financial_impact, :NEW.financial_impact) <> 0 OR (:OLD.financial_impact IS NULL AND :NEW.financial_impact IS NOT NULL) OR (:OLD.financial_impact IS NOT NULL AND :NEW.financial_impact IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_018
BEFORE UPDATE OR DELETE ON cbd_remediation_action
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF UPDATING AND :OLD.original_due_date <> :NEW.original_due_date THEN RAISE_APPLICATION_ERROR(-20004, 'Original due dates are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.observation_id <> :NEW.observation_id OR (:OLD.observation_id IS NULL AND :NEW.observation_id IS NOT NULL) OR (:OLD.observation_id IS NOT NULL AND :NEW.observation_id IS NULL)) OR
      (:OLD.action_type <> :NEW.action_type OR (:OLD.action_type IS NULL AND :NEW.action_type IS NOT NULL) OR (:OLD.action_type IS NOT NULL AND :NEW.action_type IS NULL)) OR
      (:OLD.immediate_flag <> :NEW.immediate_flag OR (:OLD.immediate_flag IS NULL AND :NEW.immediate_flag IS NOT NULL) OR (:OLD.immediate_flag IS NOT NULL AND :NEW.immediate_flag IS NULL)) OR
      (:OLD.preventive_flag <> :NEW.preventive_flag OR (:OLD.preventive_flag IS NULL AND :NEW.preventive_flag IS NOT NULL) OR (:OLD.preventive_flag IS NOT NULL AND :NEW.preventive_flag IS NULL)) OR
      (:OLD.dependency_action_id <> :NEW.dependency_action_id OR (:OLD.dependency_action_id IS NULL AND :NEW.dependency_action_id IS NOT NULL) OR (:OLD.dependency_action_id IS NOT NULL AND :NEW.dependency_action_id IS NULL)) OR
      (:OLD.milestone <> :NEW.milestone OR (:OLD.milestone IS NULL AND :NEW.milestone IS NOT NULL) OR (:OLD.milestone IS NOT NULL AND :NEW.milestone IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.owner_user_id <> :NEW.owner_user_id OR (:OLD.owner_user_id IS NULL AND :NEW.owner_user_id IS NOT NULL) OR (:OLD.owner_user_id IS NOT NULL AND :NEW.owner_user_id IS NULL)) OR
      (:OLD.original_due_date <> :NEW.original_due_date OR (:OLD.original_due_date IS NULL AND :NEW.original_due_date IS NOT NULL) OR (:OLD.original_due_date IS NOT NULL AND :NEW.original_due_date IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_019
BEFORE UPDATE OR DELETE ON cbd_regulatory_change
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.trigger_version_id <> :NEW.trigger_version_id OR (:OLD.trigger_version_id IS NULL AND :NEW.trigger_version_id IS NOT NULL) OR (:OLD.trigger_version_id IS NOT NULL AND :NEW.trigger_version_id IS NULL)) OR
      (:OLD.previous_version_id <> :NEW.previous_version_id OR (:OLD.previous_version_id IS NULL AND :NEW.previous_version_id IS NOT NULL) OR (:OLD.previous_version_id IS NOT NULL AND :NEW.previous_version_id IS NULL)) OR
      (:OLD.change_type <> :NEW.change_type OR (:OLD.change_type IS NULL AND :NEW.change_type IS NOT NULL) OR (:OLD.change_type IS NOT NULL AND :NEW.change_type IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.summary, :NEW.summary) <> 0 OR (:OLD.summary IS NULL AND :NEW.summary IS NOT NULL) OR (:OLD.summary IS NOT NULL AND :NEW.summary IS NULL)) OR
      (:OLD.issue_date <> :NEW.issue_date OR (:OLD.issue_date IS NULL AND :NEW.issue_date IS NOT NULL) OR (:OLD.issue_date IS NOT NULL AND :NEW.issue_date IS NULL)) OR
      (:OLD.effective_date <> :NEW.effective_date OR (:OLD.effective_date IS NULL AND :NEW.effective_date IS NOT NULL) OR (:OLD.effective_date IS NOT NULL AND :NEW.effective_date IS NULL)) OR
      (:OLD.internal_assessment_date <> :NEW.internal_assessment_date OR (:OLD.internal_assessment_date IS NULL AND :NEW.internal_assessment_date IS NOT NULL) OR (:OLD.internal_assessment_date IS NOT NULL AND :NEW.internal_assessment_date IS NULL)) OR
      (:OLD.regulatory_implementation_date <> :NEW.regulatory_implementation_date OR (:OLD.regulatory_implementation_date IS NULL AND :NEW.regulatory_implementation_date IS NOT NULL) OR (:OLD.regulatory_implementation_date IS NOT NULL AND :NEW.regulatory_implementation_date IS NULL)) OR
      (:OLD.materiality <> :NEW.materiality OR (:OLD.materiality IS NULL AND :NEW.materiality IS NOT NULL) OR (:OLD.materiality IS NOT NULL AND :NEW.materiality IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.overall_implementation_status <> :NEW.overall_implementation_status OR (:OLD.overall_implementation_status IS NULL AND :NEW.overall_implementation_status IS NOT NULL) OR (:OLD.overall_implementation_status IS NOT NULL AND :NEW.overall_implementation_status IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_020
BEFORE UPDATE OR DELETE ON cbd_change_impact_assessment
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.change_id <> :NEW.change_id OR (:OLD.change_id IS NULL AND :NEW.change_id IS NOT NULL) OR (:OLD.change_id IS NOT NULL AND :NEW.change_id IS NULL)) OR
      (:OLD.org_unit_id <> :NEW.org_unit_id OR (:OLD.org_unit_id IS NULL AND :NEW.org_unit_id IS NOT NULL) OR (:OLD.org_unit_id IS NOT NULL AND :NEW.org_unit_id IS NULL)) OR
      (:OLD.impact_area <> :NEW.impact_area OR (:OLD.impact_area IS NULL AND :NEW.impact_area IS NOT NULL) OR (:OLD.impact_area IS NOT NULL AND :NEW.impact_area IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (:OLD.policy_impact_flag <> :NEW.policy_impact_flag OR (:OLD.policy_impact_flag IS NULL AND :NEW.policy_impact_flag IS NOT NULL) OR (:OLD.policy_impact_flag IS NOT NULL AND :NEW.policy_impact_flag IS NULL)) OR
      (:OLD.process_impact_flag <> :NEW.process_impact_flag OR (:OLD.process_impact_flag IS NULL AND :NEW.process_impact_flag IS NOT NULL) OR (:OLD.process_impact_flag IS NOT NULL AND :NEW.process_impact_flag IS NULL)) OR
      (:OLD.product_impact_flag <> :NEW.product_impact_flag OR (:OLD.product_impact_flag IS NULL AND :NEW.product_impact_flag IS NOT NULL) OR (:OLD.product_impact_flag IS NOT NULL AND :NEW.product_impact_flag IS NULL)) OR
      (:OLD.technology_impact_flag <> :NEW.technology_impact_flag OR (:OLD.technology_impact_flag IS NULL AND :NEW.technology_impact_flag IS NOT NULL) OR (:OLD.technology_impact_flag IS NOT NULL AND :NEW.technology_impact_flag IS NULL)) OR
      (:OLD.reporting_impact_flag <> :NEW.reporting_impact_flag OR (:OLD.reporting_impact_flag IS NULL AND :NEW.reporting_impact_flag IS NOT NULL) OR (:OLD.reporting_impact_flag IS NOT NULL AND :NEW.reporting_impact_flag IS NULL)) OR
      (:OLD.training_impact_flag <> :NEW.training_impact_flag OR (:OLD.training_impact_flag IS NULL AND :NEW.training_impact_flag IS NOT NULL) OR (:OLD.training_impact_flag IS NOT NULL AND :NEW.training_impact_flag IS NULL)) OR
      (:OLD.third_party_impact_flag <> :NEW.third_party_impact_flag OR (:OLD.third_party_impact_flag IS NULL AND :NEW.third_party_impact_flag IS NOT NULL) OR (:OLD.third_party_impact_flag IS NOT NULL AND :NEW.third_party_impact_flag IS NULL)) OR
      (:OLD.assessed_by <> :NEW.assessed_by OR (:OLD.assessed_by IS NULL AND :NEW.assessed_by IS NOT NULL) OR (:OLD.assessed_by IS NOT NULL AND :NEW.assessed_by IS NULL)) OR
      (:OLD.assessed_date <> :NEW.assessed_date OR (:OLD.assessed_date IS NULL AND :NEW.assessed_date IS NOT NULL) OR (:OLD.assessed_date IS NOT NULL AND :NEW.assessed_date IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_021
BEFORE UPDATE OR DELETE ON cbd_change_action
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF UPDATING AND :OLD.original_due_date <> :NEW.original_due_date THEN RAISE_APPLICATION_ERROR(-20004, 'Original due dates are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.impact_assessment_id <> :NEW.impact_assessment_id OR (:OLD.impact_assessment_id IS NULL AND :NEW.impact_assessment_id IS NOT NULL) OR (:OLD.impact_assessment_id IS NOT NULL AND :NEW.impact_assessment_id IS NULL)) OR
      (:OLD.dependency_action_id <> :NEW.dependency_action_id OR (:OLD.dependency_action_id IS NULL AND :NEW.dependency_action_id IS NOT NULL) OR (:OLD.dependency_action_id IS NOT NULL AND :NEW.dependency_action_id IS NULL)) OR
      (:OLD.evidence_id <> :NEW.evidence_id OR (:OLD.evidence_id IS NULL AND :NEW.evidence_id IS NOT NULL) OR (:OLD.evidence_id IS NOT NULL AND :NEW.evidence_id IS NULL)) OR
      (:OLD.validated_by <> :NEW.validated_by OR (:OLD.validated_by IS NULL AND :NEW.validated_by IS NOT NULL) OR (:OLD.validated_by IS NOT NULL AND :NEW.validated_by IS NULL)) OR
      (:OLD.validated_date <> :NEW.validated_date OR (:OLD.validated_date IS NULL AND :NEW.validated_date IS NOT NULL) OR (:OLD.validated_date IS NOT NULL AND :NEW.validated_date IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.validation_conclusion, :NEW.validation_conclusion) <> 0 OR (:OLD.validation_conclusion IS NULL AND :NEW.validation_conclusion IS NOT NULL) OR (:OLD.validation_conclusion IS NOT NULL AND :NEW.validation_conclusion IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.owner_user_id <> :NEW.owner_user_id OR (:OLD.owner_user_id IS NULL AND :NEW.owner_user_id IS NOT NULL) OR (:OLD.owner_user_id IS NOT NULL AND :NEW.owner_user_id IS NULL)) OR
      (:OLD.original_due_date <> :NEW.original_due_date OR (:OLD.original_due_date IS NULL AND :NEW.original_due_date IS NOT NULL) OR (:OLD.original_due_date IS NOT NULL AND :NEW.original_due_date IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_022
BEFORE UPDATE OR DELETE ON cbd_action
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF UPDATING AND :OLD.original_due_date <> :NEW.original_due_date THEN RAISE_APPLICATION_ERROR(-20004, 'Original due dates are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.obligation_id <> :NEW.obligation_id OR (:OLD.obligation_id IS NULL AND :NEW.obligation_id IS NOT NULL) OR (:OLD.obligation_id IS NOT NULL AND :NEW.obligation_id IS NULL)) OR
      (:OLD.applicability_id <> :NEW.applicability_id OR (:OLD.applicability_id IS NULL AND :NEW.applicability_id IS NOT NULL) OR (:OLD.applicability_id IS NOT NULL AND :NEW.applicability_id IS NULL)) OR
      (:OLD.dependency_action_id <> :NEW.dependency_action_id OR (:OLD.dependency_action_id IS NULL AND :NEW.dependency_action_id IS NOT NULL) OR (:OLD.dependency_action_id IS NOT NULL AND :NEW.dependency_action_id IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.description, :NEW.description) <> 0 OR (:OLD.description IS NULL AND :NEW.description IS NOT NULL) OR (:OLD.description IS NOT NULL AND :NEW.description IS NULL)) OR
      (:OLD.owner_unit_id <> :NEW.owner_unit_id OR (:OLD.owner_unit_id IS NULL AND :NEW.owner_unit_id IS NOT NULL) OR (:OLD.owner_unit_id IS NOT NULL AND :NEW.owner_unit_id IS NULL)) OR
      (:OLD.owner_user_id <> :NEW.owner_user_id OR (:OLD.owner_user_id IS NULL AND :NEW.owner_user_id IS NOT NULL) OR (:OLD.owner_user_id IS NOT NULL AND :NEW.owner_user_id IS NULL)) OR
      (:OLD.original_due_date <> :NEW.original_due_date OR (:OLD.original_due_date IS NULL AND :NEW.original_due_date IS NOT NULL) OR (:OLD.original_due_date IS NOT NULL AND :NEW.original_due_date IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_023
BEFORE UPDATE OR DELETE ON cbd_due_date_history
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.action_id <> :NEW.action_id OR (:OLD.action_id IS NULL AND :NEW.action_id IS NOT NULL) OR (:OLD.action_id IS NOT NULL AND :NEW.action_id IS NULL)) OR
      (:OLD.remediation_action_id <> :NEW.remediation_action_id OR (:OLD.remediation_action_id IS NULL AND :NEW.remediation_action_id IS NOT NULL) OR (:OLD.remediation_action_id IS NOT NULL AND :NEW.remediation_action_id IS NULL)) OR
      (:OLD.change_action_id <> :NEW.change_action_id OR (:OLD.change_action_id IS NULL AND :NEW.change_action_id IS NOT NULL) OR (:OLD.change_action_id IS NOT NULL AND :NEW.change_action_id IS NULL)) OR
      (:OLD.observation_id <> :NEW.observation_id OR (:OLD.observation_id IS NULL AND :NEW.observation_id IS NOT NULL) OR (:OLD.observation_id IS NOT NULL AND :NEW.observation_id IS NULL)) OR
      (:OLD.previous_due_date <> :NEW.previous_due_date OR (:OLD.previous_due_date IS NULL AND :NEW.previous_due_date IS NOT NULL) OR (:OLD.previous_due_date IS NOT NULL AND :NEW.previous_due_date IS NULL)) OR
      (:OLD.revised_due_date <> :NEW.revised_due_date OR (:OLD.revised_due_date IS NULL AND :NEW.revised_due_date IS NOT NULL) OR (:OLD.revised_due_date IS NOT NULL AND :NEW.revised_due_date IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.reason, :NEW.reason) <> 0 OR (:OLD.reason IS NULL AND :NEW.reason IS NOT NULL) OR (:OLD.reason IS NOT NULL AND :NEW.reason IS NULL)) OR
      (:OLD.requested_by <> :NEW.requested_by OR (:OLD.requested_by IS NULL AND :NEW.requested_by IS NOT NULL) OR (:OLD.requested_by IS NOT NULL AND :NEW.requested_by IS NULL)) OR
      (:OLD.requested_at <> :NEW.requested_at OR (:OLD.requested_at IS NULL AND :NEW.requested_at IS NOT NULL) OR (:OLD.requested_at IS NOT NULL AND :NEW.requested_at IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_024
BEFORE UPDATE OR DELETE ON cbd_regulatory_return
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_025
BEFORE UPDATE OR DELETE ON cbd_return_submission
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.return_id <> :NEW.return_id OR (:OLD.return_id IS NULL AND :NEW.return_id IS NOT NULL) OR (:OLD.return_id IS NOT NULL AND :NEW.return_id IS NULL)) OR
      (:OLD.period_from <> :NEW.period_from OR (:OLD.period_from IS NULL AND :NEW.period_from IS NOT NULL) OR (:OLD.period_from IS NOT NULL AND :NEW.period_from IS NULL)) OR
      (:OLD.period_to <> :NEW.period_to OR (:OLD.period_to IS NULL AND :NEW.period_to IS NOT NULL) OR (:OLD.period_to IS NOT NULL AND :NEW.period_to IS NULL)) OR
      (:OLD.internal_due_date <> :NEW.internal_due_date OR (:OLD.internal_due_date IS NULL AND :NEW.internal_due_date IS NOT NULL) OR (:OLD.internal_due_date IS NOT NULL AND :NEW.internal_due_date IS NULL)) OR
      (:OLD.regulatory_due_date <> :NEW.regulatory_due_date OR (:OLD.regulatory_due_date IS NULL AND :NEW.regulatory_due_date IS NOT NULL) OR (:OLD.regulatory_due_date IS NOT NULL AND :NEW.regulatory_due_date IS NULL)) OR
      (:OLD.submitted_at <> :NEW.submitted_at OR (:OLD.submitted_at IS NULL AND :NEW.submitted_at IS NOT NULL) OR (:OLD.submitted_at IS NOT NULL AND :NEW.submitted_at IS NULL)) OR
      (:OLD.submission_reference <> :NEW.submission_reference OR (:OLD.submission_reference IS NULL AND :NEW.submission_reference IS NOT NULL) OR (:OLD.submission_reference IS NOT NULL AND :NEW.submission_reference IS NULL)) OR
      (:OLD.version_number <> :NEW.version_number OR (:OLD.version_number IS NULL AND :NEW.version_number IS NOT NULL) OR (:OLD.version_number IS NOT NULL AND :NEW.version_number IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.revision_reason, :NEW.revision_reason) <> 0 OR (:OLD.revision_reason IS NULL AND :NEW.revision_reason IS NOT NULL) OR (:OLD.revision_reason IS NOT NULL AND :NEW.revision_reason IS NULL)) OR
      (:OLD.supersedes_submission_id <> :NEW.supersedes_submission_id OR (:OLD.supersedes_submission_id IS NULL AND :NEW.supersedes_submission_id IS NOT NULL) OR (:OLD.supersedes_submission_id IS NOT NULL AND :NEW.supersedes_submission_id IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_026
BEFORE UPDATE OR DELETE ON cbd_certification
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  IF UPDATING AND :OLD.code <> :NEW.code THEN RAISE_APPLICATION_ERROR(-20003, 'Business codes are immutable.'); END IF;
  IF DELETING AND :OLD.approval_status = 'APPROVED' THEN RAISE_APPLICATION_ERROR(-20005, 'Approved records must be retained.'); END IF;
  IF UPDATING AND :OLD.approval_status = 'APPROVED' AND (
      (:OLD.id <> :NEW.id OR (:OLD.id IS NULL AND :NEW.id IS NOT NULL) OR (:OLD.id IS NOT NULL AND :NEW.id IS NULL)) OR
      (:OLD.created_at <> :NEW.created_at OR (:OLD.created_at IS NULL AND :NEW.created_at IS NOT NULL) OR (:OLD.created_at IS NOT NULL AND :NEW.created_at IS NULL)) OR
      (:OLD.code <> :NEW.code OR (:OLD.code IS NULL AND :NEW.code IS NOT NULL) OR (:OLD.code IS NOT NULL AND :NEW.code IS NULL)) OR
      (:OLD.obligation_id <> :NEW.obligation_id OR (:OLD.obligation_id IS NULL AND :NEW.obligation_id IS NOT NULL) OR (:OLD.obligation_id IS NOT NULL AND :NEW.obligation_id IS NULL)) OR
      (:OLD.org_unit_id <> :NEW.org_unit_id OR (:OLD.org_unit_id IS NULL AND :NEW.org_unit_id IS NOT NULL) OR (:OLD.org_unit_id IS NOT NULL AND :NEW.org_unit_id IS NULL)) OR
      (:OLD.period_from <> :NEW.period_from OR (:OLD.period_from IS NULL AND :NEW.period_from IS NOT NULL) OR (:OLD.period_from IS NOT NULL AND :NEW.period_from IS NULL)) OR
      (:OLD.period_to <> :NEW.period_to OR (:OLD.period_to IS NULL AND :NEW.period_to IS NOT NULL) OR (:OLD.period_to IS NOT NULL AND :NEW.period_to IS NULL)) OR
      (:OLD.certified_by <> :NEW.certified_by OR (:OLD.certified_by IS NULL AND :NEW.certified_by IS NOT NULL) OR (:OLD.certified_by IS NOT NULL AND :NEW.certified_by IS NULL)) OR
      (:OLD.certified_date <> :NEW.certified_date OR (:OLD.certified_date IS NULL AND :NEW.certified_date IS NOT NULL) OR (:OLD.certified_date IS NOT NULL AND :NEW.certified_date IS NULL)) OR
      (DBMS_LOB.COMPARE(:OLD.statement, :NEW.statement) <> 0 OR (:OLD.statement IS NULL AND :NEW.statement IS NOT NULL) OR (:OLD.statement IS NOT NULL AND :NEW.statement IS NULL)) OR
      (:OLD.approval_status <> :NEW.approval_status OR (:OLD.approval_status IS NULL AND :NEW.approval_status IS NOT NULL) OR (:OLD.approval_status IS NOT NULL AND :NEW.approval_status IS NULL)) OR
      (:OLD.created_by <> :NEW.created_by OR (:OLD.created_by IS NULL AND :NEW.created_by IS NOT NULL) OR (:OLD.created_by IS NOT NULL AND :NEW.created_by IS NULL)) OR
      (:OLD.reviewed_by <> :NEW.reviewed_by OR (:OLD.reviewed_by IS NULL AND :NEW.reviewed_by IS NOT NULL) OR (:OLD.reviewed_by IS NOT NULL AND :NEW.reviewed_by IS NULL)) OR
      (:OLD.reviewed_at <> :NEW.reviewed_at OR (:OLD.reviewed_at IS NULL AND :NEW.reviewed_at IS NOT NULL) OR (:OLD.reviewed_at IS NOT NULL AND :NEW.reviewed_at IS NULL)) OR
      (:OLD.approved_by <> :NEW.approved_by OR (:OLD.approved_by IS NULL AND :NEW.approved_by IS NOT NULL) OR (:OLD.approved_by IS NOT NULL AND :NEW.approved_by IS NULL)) OR
      (:OLD.approved_at <> :NEW.approved_at OR (:OLD.approved_at IS NULL AND :NEW.approved_at IS NOT NULL) OR (:OLD.approved_at IS NOT NULL AND :NEW.approved_at IS NULL))
    ) THEN RAISE_APPLICATION_ERROR(-20006, 'Approved content is immutable; create a new version.'); END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_027
BEFORE UPDATE OR DELETE ON cbd_status_history
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  RAISE_APPLICATION_ERROR(-20002, 'Retained audit, status and source metadata is append-only.');
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_guard_028
BEFORE UPDATE OR DELETE ON cbd_audit_log
FOR EACH ROW
BEGIN
  IF UPDATING AND :OLD.id <> :NEW.id THEN RAISE_APPLICATION_ERROR(-20001, 'Record identifiers are immutable.'); END IF;
  RAISE_APPLICATION_ERROR(-20002, 'Retained audit, status and source metadata is append-only.');
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_current_source_guard
BEFORE INSERT OR UPDATE ON cbd_regulatory_instrument
FOR EACH ROW
DECLARE found_count INTEGER;
BEGIN

  IF :NEW.regulatory_status = 'CURRENT' AND :NEW.current_version_id IS NULL THEN
    RAISE_APPLICATION_ERROR(-20010, 'Current instruments require an approved current source version.');
  END IF;
  IF :NEW.current_version_id IS NOT NULL THEN
    SELECT COUNT(*) INTO found_count FROM cbd_instrument_version
    WHERE id = :NEW.current_version_id AND instrument_id = :NEW.id
      AND approval_status = 'APPROVED' AND current_version_flag = 1;
    IF found_count <> 1 THEN RAISE_APPLICATION_ERROR(-20011, 'Current version must be approved and belong to this instrument.'); END IF;
  END IF;
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
        AND owner_role = r.role_name AND approval_status = 'APPROVED'
        AND (r.role_name NOT IN ('REGULATORY','BUSINESS') OR primary_owner_flag = 1)
        AND effective_from <= :NEW.effective_from AND (effective_to IS NULL OR effective_to > :NEW.effective_from);
      IF found_count = 0 OR (r.role_name IN ('REGULATORY','BUSINESS') AND found_count <> 1) THEN
        RAISE_APPLICATION_ERROR(-20015, 'Active obligations require approved regulatory, business, control and reviewer ownership.');
      END IF;
    END LOOP;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_dates_action
BEFORE INSERT OR UPDATE ON cbd_action
FOR EACH ROW
DECLARE history_id VARCHAR2(36);
BEGIN

  IF INSERTING AND :NEW.original_due_date <> :NEW.current_due_date THEN
    RAISE_APPLICATION_ERROR(-20020, 'Initial current due date must equal the original due date.');
  END IF;
  IF UPDATING AND :OLD.current_due_date <> :NEW.current_due_date THEN
    BEGIN
      SELECT id INTO history_id FROM cbd_due_date_history
        WHERE action_id = :NEW.id AND previous_due_date = :OLD.current_due_date
          AND revised_due_date = :NEW.current_due_date AND approval_status = 'APPROVED' AND applied_at IS NULL
        FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021, 'Due-date changes require unused independently approved history.');
      WHEN TOO_MANY_ROWS THEN RAISE_APPLICATION_ERROR(-20022, 'Competing due-date changes must be resolved.');
    END;
    UPDATE cbd_due_date_history SET applied_at = SYSTIMESTAMP WHERE id = history_id;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_dates_remediation_ac
BEFORE INSERT OR UPDATE ON cbd_remediation_action
FOR EACH ROW
DECLARE history_id VARCHAR2(36);
BEGIN

  IF INSERTING AND :NEW.original_due_date <> :NEW.current_due_date THEN
    RAISE_APPLICATION_ERROR(-20020, 'Initial current due date must equal the original due date.');
  END IF;
  IF UPDATING AND :OLD.current_due_date <> :NEW.current_due_date THEN
    BEGIN
      SELECT id INTO history_id FROM cbd_due_date_history
        WHERE remediation_action_id = :NEW.id AND previous_due_date = :OLD.current_due_date
          AND revised_due_date = :NEW.current_due_date AND approval_status = 'APPROVED' AND applied_at IS NULL
        FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021, 'Due-date changes require unused independently approved history.');
      WHEN TOO_MANY_ROWS THEN RAISE_APPLICATION_ERROR(-20022, 'Competing due-date changes must be resolved.');
    END;
    UPDATE cbd_due_date_history SET applied_at = SYSTIMESTAMP WHERE id = history_id;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_dates_change_action
BEFORE INSERT OR UPDATE ON cbd_change_action
FOR EACH ROW
DECLARE history_id VARCHAR2(36);
BEGIN

  IF INSERTING AND :NEW.original_due_date <> :NEW.current_due_date THEN
    RAISE_APPLICATION_ERROR(-20020, 'Initial current due date must equal the original due date.');
  END IF;
  IF UPDATING AND :OLD.current_due_date <> :NEW.current_due_date THEN
    BEGIN
      SELECT id INTO history_id FROM cbd_due_date_history
        WHERE change_action_id = :NEW.id AND previous_due_date = :OLD.current_due_date
          AND revised_due_date = :NEW.current_due_date AND approval_status = 'APPROVED' AND applied_at IS NULL
        FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021, 'Due-date changes require unused independently approved history.');
      WHEN TOO_MANY_ROWS THEN RAISE_APPLICATION_ERROR(-20022, 'Competing due-date changes must be resolved.');
    END;
    UPDATE cbd_due_date_history SET applied_at = SYSTIMESTAMP WHERE id = history_id;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_dates_observation
BEFORE INSERT OR UPDATE ON cbd_observation
FOR EACH ROW
DECLARE history_id VARCHAR2(36);
BEGIN

  IF INSERTING AND :NEW.original_due_date <> :NEW.current_due_date THEN
    RAISE_APPLICATION_ERROR(-20020, 'Initial current due date must equal the original due date.');
  END IF;
  IF UPDATING AND :OLD.current_due_date <> :NEW.current_due_date THEN
    BEGIN
      SELECT id INTO history_id FROM cbd_due_date_history
        WHERE observation_id = :NEW.id AND previous_due_date = :OLD.current_due_date
          AND revised_due_date = :NEW.current_due_date AND approval_status = 'APPROVED' AND applied_at IS NULL
        FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20021, 'Due-date changes require unused independently approved history.');
      WHEN TOO_MANY_ROWS THEN RAISE_APPLICATION_ERROR(-20022, 'Competing due-date changes must be resolved.');
    END;
    UPDATE cbd_due_date_history SET applied_at = SYSTIMESTAMP WHERE id = history_id;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_due_application_guard
BEFORE UPDATE ON cbd_due_date_history
FOR EACH ROW

BEGIN

  IF :OLD.applied_at IS NOT NULL AND (:NEW.applied_at IS NULL OR :OLD.applied_at <> :NEW.applied_at) THEN
    RAISE_APPLICATION_ERROR(-20023, 'Applied due-date history cannot be reset or replayed.');
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_complete_action
BEFORE INSERT OR UPDATE ON cbd_action
FOR EACH ROW
DECLARE found_count INTEGER;
BEGIN

  IF :NEW.record_status = 'COMPLETED' THEN
    IF :NEW.completed_at IS NULL OR :NEW.completed_by IS NULL THEN
      RAISE_APPLICATION_ERROR(-20024, 'Completed actions require completion identity and time.');
    END IF;
    SELECT COUNT(*) INTO found_count FROM cbd_evidence_link l JOIN cbd_evidence_item e ON e.id = l.evidence_id
      WHERE l.action_id = :NEW.id AND e.evidence_status = 'ACCEPTED'
        AND e.retention_end_date >= TRUNC(SYSDATE);
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20025, 'Completed actions require current accepted linked evidence.'); END IF;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_complete_remediation_ac
BEFORE INSERT OR UPDATE ON cbd_remediation_action
FOR EACH ROW
DECLARE found_count INTEGER;
BEGIN

  IF :NEW.record_status = 'COMPLETED' THEN
    IF :NEW.completed_at IS NULL OR :NEW.completed_by IS NULL THEN
      RAISE_APPLICATION_ERROR(-20024, 'Completed actions require completion identity and time.');
    END IF;
    SELECT COUNT(*) INTO found_count FROM cbd_evidence_link l JOIN cbd_evidence_item e ON e.id = l.evidence_id
      WHERE l.remediation_action_id = :NEW.id AND e.evidence_status = 'ACCEPTED'
        AND e.retention_end_date >= TRUNC(SYSDATE);
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20025, 'Completed actions require current accepted linked evidence.'); END IF;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_complete_change_action
BEFORE INSERT OR UPDATE ON cbd_change_action
FOR EACH ROW
DECLARE found_count INTEGER;
BEGIN

  IF :NEW.record_status = 'COMPLETED' THEN
    IF :NEW.completed_at IS NULL OR :NEW.completed_by IS NULL THEN
      RAISE_APPLICATION_ERROR(-20024, 'Completed actions require completion identity and time.');
    END IF;
    SELECT COUNT(*) INTO found_count FROM cbd_evidence_link l JOIN cbd_evidence_item e ON e.id = l.evidence_id
      WHERE l.change_action_id = :NEW.id AND e.evidence_status = 'ACCEPTED'
        AND e.retention_end_date >= TRUNC(SYSDATE);
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20025, 'Completed actions require current accepted linked evidence.'); END IF;
  END IF;
END;""",
    r"""CREATE OR REPLACE TRIGGER cbd_close_observation_guard
BEFORE INSERT OR UPDATE ON cbd_observation
FOR EACH ROW
DECLARE found_count INTEGER;
BEGIN

  IF :NEW.record_status = 'CLOSED' THEN
    SELECT COUNT(*) INTO found_count FROM cbd_remediation_action WHERE observation_id = :NEW.id
      AND record_status NOT IN ('COMPLETED','CANCELLED');
    IF found_count > 0 THEN RAISE_APPLICATION_ERROR(-20026, 'Open remediation actions prevent observation closure.'); END IF;
    SELECT COUNT(*) INTO found_count FROM cbd_closure_validation v
      JOIN cbd_user validator ON validator.id = v.validated_by
      WHERE v.observation_id = :NEW.id AND v.decision = 'CLOSE'
        AND v.evidence_adequacy = 'ADEQUATE' AND v.implementation_verified_flag = 1
        AND (validator.org_unit_id IS NULL OR validator.org_unit_id <> :NEW.owner_unit_id)
        AND (v.sustainability_required_flag = 0 OR (v.sustainability_test_date IS NOT NULL AND v.sustainability_result = 'PASS'))
        AND EXISTS (SELECT 1 FROM cbd_evidence_link l JOIN cbd_evidence_item e ON e.id = l.evidence_id
          WHERE l.validation_id = v.id AND e.evidence_status = 'ACCEPTED' AND e.retention_end_date >= TRUNC(SYSDATE));
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20027, 'Independent closure and required sustainability validation is required.'); END IF;
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
        AND a.approval_status = 'APPROVED' AND b.approval_status = 'APPROVED'
        AND a.effective_from < NVL(b.effective_to, DATE '9999-12-31')
        AND b.effective_from < NVL(a.effective_to, DATE '9999-12-31');
    IF found_count > 0 THEN RAISE_APPLICATION_ERROR(-20028, 'Approved primary regulatory and business owner periods cannot overlap.'); END IF;
  END AFTER STATEMENT;
END;"""
]


def install():
    for statement in TRIGGERS:
        op.execute(sa.DDL(statement))

