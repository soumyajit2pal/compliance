"""Apply the bank business date to Oracle ownership and evidence guards."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261125_0039'
down_revision = '20261124_0038'
branch_labels = depends_on = None

BANK_DAY = "TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Kolkata' AS DATE))"
TRIGGERS = {
    'cbd_active_obligation_guard': """CREATE OR REPLACE TRIGGER cbd_active_obligation_guard
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
        AND effective_from <= GREATEST(:NEW.effective_from,{business_day}) AND (effective_to IS NULL OR effective_to > GREATEST(:NEW.effective_from,{business_day}));
      IF found_count = 0 OR (r.role_name IN ('REGULATORY','BUSINESS') AND found_count <> 1) THEN
        RAISE_APPLICATION_ERROR(-20015, 'Active obligations require approved regulatory, business, control and reviewer ownership.');
      END IF;
    END LOOP;
  END IF;
END;""",
    'cbd_delivery_close_guard': """CREATE OR REPLACE TRIGGER cbd_delivery_close_guard BEFORE INSERT OR UPDATE ON cbd_action FOR EACH ROW
    DECLARE n INTEGER; snapshot CLOB; sid VARCHAR2(36);
    BEGIN
      IF :NEW.reviewer_user_id IS NOT NULL AND :NEW.record_status='COMPLETED' THEN
        IF :NEW.completed_by <> :NEW.reviewer_user_id OR :NEW.completed_by=:NEW.owner_user_id OR :NEW.period_to>TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Kolkata' AS DATE)) THEN RAISE_APPLICATION_ERROR(-20169,'Independent review and complete reporting period are required.'); END IF;
        BEGIN SELECT id,evidence_snapshot INTO sid,snapshot FROM cbd_action_submission WHERE action_id=:NEW.id AND submission_number=(SELECT MAX(submission_number) FROM cbd_action_submission WHERE action_id=:NEW.id);
        EXCEPTION WHEN NO_DATA_FOUND THEN RAISE_APPLICATION_ERROR(-20170,'A retained submission is required.'); END;
        SELECT COUNT(*) INTO n FROM JSON_TABLE(snapshot,'$[*]' COLUMNS(link_id VARCHAR2(36) PATH '$.link_id')) x WHERE NOT EXISTS
          (SELECT 1 FROM cbd_action_evidence_decision d JOIN cbd_evidence_link l ON l.id=d.evidence_link_id JOIN cbd_evidence_item e ON e.id=l.evidence_id
           WHERE d.submission_id=sid AND d.evidence_link_id=x.link_id AND d.decision='ACCEPT' AND d.reviewed_by=:NEW.reviewer_user_id AND e.evidence_status='ACCEPTED' AND e.retention_end_date>={business_day});
        IF n>0 THEN RAISE_APPLICATION_ERROR(-20171,'Every submitted evidence link requires accepted independent review.'); END IF;
      END IF;
    END;""",
    'cbd_complete_action': """CREATE OR REPLACE TRIGGER cbd_complete_action
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
        AND e.retention_end_date >= {business_day};
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20025, 'Completed actions require current accepted linked evidence.'); END IF;
  END IF;
END;""",
    'cbd_complete_remediation_ac': """CREATE OR REPLACE TRIGGER cbd_complete_remediation_ac
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
        AND e.retention_end_date >= {business_day};
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20025, 'Completed actions require current accepted linked evidence.'); END IF;
  END IF;
END;""",
    'cbd_complete_change_action': """CREATE OR REPLACE TRIGGER cbd_complete_change_action
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
        AND e.retention_end_date >= {business_day};
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20025, 'Completed actions require current accepted linked evidence.'); END IF;
  END IF;
END;""",
    'cbd_close_observation_guard': """CREATE OR REPLACE TRIGGER cbd_close_observation_guard
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
          WHERE l.validation_id = v.id AND e.evidence_status = 'ACCEPTED' AND e.retention_end_date >= {business_day});
    IF found_count = 0 THEN RAISE_APPLICATION_ERROR(-20027, 'Independent closure and required sustainability validation is required.'); END IF;
    END IF;
END;""",
}

def replace_guards(business_day):
    for sql in TRIGGERS.values():
        op.execute(sa.DDL(sql.format(business_day=business_day)))
    if not context.is_offline_mode():
        errors = op.get_bind().execute(sa.text(
            "SELECT name, text FROM user_errors WHERE type = 'TRIGGER' "
            "AND attribute = 'ERROR' AND name IN :names ORDER BY name, sequence"
        ).bindparams(sa.bindparam('names', expanding=True)),
            {'names': [name.upper() for name in TRIGGERS]}).all()
        if errors:
            raise RuntimeError(f'Business-date trigger compilation failed: {errors}')


def upgrade():
    replace_guards(BANK_DAY)


def downgrade():
    replace_guards('TRUNC(SYSDATE)')
