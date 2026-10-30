"""Complete relational model from datamodel.pdf §§3–10 and the Release 1 plan.

SQLAlchemy Core metadata is also the autogenerate target. Frozen Alembic
revisions contain explicit operations and never import this evolving module.
Dates use inclusive starts / exclusive ends. Oracle generates UUID keys when
clients omit them. All foreign keys are restrictive (no cascading deletes).
"""
import sqlalchemy as sa
from .db_base import metadata

P = "cbd_"


def col(name, type_, nullable=False, default=None):
    return sa.Column(name, type_, nullable=nullable,
                     server_default=sa.text(default) if default is not None else None)


def text(name, nullable=False):
    return col(name, sa.Text(), nullable)


def string(name, length=100, nullable=False, default=None):
    return col(name, sa.String(length), nullable, default)


def flag(name, default="0"):
    return col(name, sa.Integer(), default=default)


def fk(name, target, nullable=False, use_alter=False):
    return sa.Column(name, sa.String(36), sa.ForeignKey(P + target + ".id", use_alter=use_alter), nullable=nullable)


def date(name, nullable=False):
    return col(name, sa.Date(), nullable)


def time(name, nullable=False):
    return col(name, sa.DateTime(), nullable)


def check(name, condition):
    return sa.CheckConstraint(condition, name="ck_" + name)


def enum(name, *values, default=None, nullable=False):
    return string(name, 40, nullable, repr(default) if default else None), check(
        name + "_" + str(len(metadata.tables)), name + " IN (" + ",".join(repr(v) for v in values) + ")")


def effective():
    return [date("effective_from"), date("effective_to", True)]


def approval():
    return [*enum("approval_status", "DRAFT", "IN_REVIEW", "REVIEWED", "APPROVED", "REJECTED", "WITHDRAWN", default="DRAFT"),
            fk("created_by", "user", True), fk("reviewed_by", "user", True), time("reviewed_at", True),
            fk("approved_by", "user", True), time("approved_at", True)]


def table(name, *items):
    columns = [sa.Column("id", sa.String(36), primary_key=True,
                         server_default=sa.text("LOWER(RAWTOHEX(SYS_GUID()))")),
               time("created_at")]
    columns[1].server_default = sa.DefaultClause(sa.text("SYSTIMESTAMP"))
    columns.extend(items)
    t = sa.Table(P + name, metadata, *columns)
    for c in t.c:
        if c.name.endswith("_flag") or c.name == "active_flag":
            t.append_constraint(check(name[:12] + "_" + c.name[:10], f"{c.name} IN (0,1)"))
    for start, end in (("effective_from", "effective_to"), ("period_from", "period_to"),
                       ("delegated_from", "delegated_to"), ("launch_date", "retirement_date")):
        if start in t.c and end in t.c:
            t.append_constraint(check(name[:16] + "_" + start[:5], f"{end} IS NULL OR {end} >= {start}"))
    if "approval_status" in t.c:
        t.append_constraint(check(name[:19] + "_approve", "approval_status <> 'APPROVED' OR "
            "(created_by IS NOT NULL AND reviewed_by IS NOT NULL AND approved_by IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND approved_at IS NOT NULL "
            "AND created_by <> reviewed_by AND created_by <> approved_by AND reviewed_by <> approved_by)"))
    return t


def unique(*names):
    return sa.UniqueConstraint(*names)


def master(name, code_length=40, *extra):
    return table(name, string("code", code_length), string("name", 250),
                 flag("active_flag", "1"), *extra, unique("code"))


# Supporting masters and access control (§§1, 3, 5, 7 and requirements week 2).
organisational_unit = master("organisational_unit", 30,
    *enum("unit_type", "BANK", "HO", "VERTICAL", "DEPARTMENT", "ZONE", "REGION", "BRANCH"),
    fk("parent_org_unit_id", "organisational_unit", True), col("level_number", sa.Integer()), *effective(),
    check("org_level", "level_number >= 0"))
legal_entity = master("legal_entity")
user = table("user", string("username", 100), string("full_name", 250), string("email", 254, True),
    string("login_type", 20, default="'STANDARD'"), string("password_hash", 300, True),
    fk("org_unit_id", "organisational_unit", True), flag("active_flag", "1"), flag("must_change_password_flag", "1"),
    flag("needs_email_confirmation_flag"), flag("needs_department_selection_flag"),
    string("department_code", 100, True), string("ldap_department_name", 250, True),
    string("ldap_last_seen_department_code", 100, True), string("ldap_last_seen_department_name", 250, True),
    time("ldap_department_checked_at", True), string("ldap_observation_id", 36, True),
    string("ldap_department_status", 30, default="'UNVERIFIED'"),
    check("user_ldap_department", "ldap_department_status IN ('UNVERIFIED','VERIFIED','MISMATCH','UNAVAILABLE','RECHECK_REQUIRED')"),
    unique("username"), check("user_login", "login_type IN ('STANDARD','LDAP')"))
role = master("role")
user_role = table("user_role", fk("user_id", "user"), fk("role_id", "role"),
    fk("scope_org_unit_id", "organisational_unit", True), flag("global_scope_flag"), *effective(),
    check("role_scope", "(global_scope_flag = 1 AND scope_org_unit_id IS NULL) OR (global_scope_flag = 0 AND scope_org_unit_id IS NOT NULL)"))
frequency = master("frequency", 30, string("schedule_rule", 250, True))
evidence_type = master("evidence_type")
confidentiality_class = master("confidentiality_class", 30, col("rank_number", sa.Integer()))
risk_category = master("risk_category")
root_cause = master("root_cause")
channel = master("channel")
customer_segment = master("customer_segment")
geography = master("geography", 40, fk("parent_geography_id", "geography", True))
system = master("system", 40, string("url", 1000, True))
taxonomy_scheme = master("taxonomy_scheme", 30, string("source_reference", 250))
status = table("status", string("entity_type", 60), string("code", 40), string("name", 100),
    flag("terminal_flag"), unique("entity_type", "code"))
regulator = master("regulator", 20, string("regulator_type", 40), string("jurisdiction", 100),
    fk("parent_regulator_id", "regulator", True), *effective(), *approval())
regulatory_domain = master("regulatory_domain", 30, text("description"),
    fk("scheme_id", "taxonomy_scheme"), fk("parent_domain_id", "regulatory_domain", True),
    col("domain_level", sa.Integer(), default="1"), col("display_sequence", sa.Integer()),
    fk("domain_owner_unit_id", "organisational_unit", True), *effective(),
    check("domain_active_owner", "active_flag = 0 OR domain_owner_unit_id IS NOT NULL"))
domain_crosswalk = table("domain_crosswalk", fk("source_domain_id", "regulatory_domain"),
    fk("target_domain_id", "regulatory_domain"), text("mapping_basis"), *approval(),
    unique("source_domain_id", "target_domain_id"), check("domain_different", "source_domain_id <> target_domain_id"))
instrument_type = master("instrument_type", 20, col("authority_level", sa.Integer(), True),
    flag("creates_obligation_flag", "1"), flag("impact_assessment_required_flag", "1"))
obligation_category = master("obligation_category", 20)
document = table("document", string("file_name", 255), string("storage_uri", 1000),
    string("content_type", 150), col("file_size", sa.BigInteger()), string("file_hash", 256),
    fk("confidentiality_class_id", "confidentiality_class"), fk("owner_unit_id", "organisational_unit"),
    fk("uploaded_by", "user"), time("uploaded_at"), unique("storage_uri"), check("doc_size", "file_size >= 0"))

# Regulatory source and obligation definitions (§§3–4).
regulatory_instrument = table("regulatory_instrument", string("code", 50),
    fk("regulator_id", "regulator"), fk("instrument_type_id", "instrument_type"),
    fk("primary_domain_id", "regulatory_domain"), string("official_reference_number", 150, True),
    string("title", 500), string("short_title", 250, True), date("issue_date"), date("effective_date"),
    date("applicability_date", True), *enum("regulatory_status", "DRAFT", "CURRENT", "SUPERSEDED", "WITHDRAWN", default="DRAFT"),
    *enum("materiality", "CRITICAL", "HIGH", "MEDIUM", "LOW"),
    fk("regulatory_owner_unit_id", "organisational_unit"), fk("interpretation_owner_user_id", "user"),
    fk("source_document_id", "document"), fk("confidentiality_class_id", "confidentiality_class"),
    fk("current_version_id", "instrument_version", True, use_alter=True), text("keywords", True), *approval(), unique("code"))
instrument_version = table("instrument_version", fk("instrument_id", "regulatory_instrument"),
    string("version_number", 30), date("version_date"), *effective(), flag("consolidated_flag"),
    flag("current_version_flag"), fk("source_document_id", "document"),
    fk("supersedes_version_id", "instrument_version", True), text("change_summary", True), *approval(),
    unique("instrument_id", "version_number"), unique("id", "instrument_id"),
    check("version_current", "current_version_flag = 0 OR approval_status = 'APPROVED'"),
    check("version_change", "supersedes_version_id IS NULL OR change_summary IS NOT NULL"))
# Composite FK ensures a current-version pointer cannot refer to another instrument.
regulatory_instrument.append_constraint(sa.ForeignKeyConstraint(
    ["current_version_id", "id"], [P + "instrument_version.id", P + "instrument_version.instrument_id"], name="fk_cbd_current_version_owner", use_alter=True))
instrument_domain_map = table("instrument_domain_map", fk("instrument_id", "regulatory_instrument"),
    fk("domain_id", "regulatory_domain"), *enum("domain_role", "PRIMARY", "SECONDARY"), *effective(),
    unique("instrument_id", "domain_id", "effective_from"))
regulatory_clause = table("regulatory_clause", fk("instrument_version_id", "instrument_version"),
    string("code", 100), fk("parent_clause_id", "regulatory_clause", True), col("clause_level", sa.Integer()),
    col("sequence_number", sa.Numeric(12, 4)), string("heading", 500, True), text("clause_text"),
    text("internal_interpretation", True), flag("mandatory_flag", "1"), flag("conditional_flag"),
    flag("reporting_flag"), flag("disclosure_flag"), flag("retention_flag"), *effective(),
    *enum("clause_status", "CURRENT", "AMENDED", "SUPERSEDED", "DELETED", default="CURRENT"),
    string("source_page_reference", 50, True), string("source_clause_reference", 100, True),
    *enum("interpretation_status", "PENDING", "REVIEWED", "APPROVED", default="PENDING"),
    *approval(), unique("instrument_version_id", "code"), unique("id", "instrument_version_id"),
    check("clause_level", "clause_level >= 0"))
metadata_correction = table("metadata_correction", fk("instrument_id", "regulatory_instrument"),
    text("before_values_json"), text("proposed_values_json"), text("reason"),
    fk("created_by", "user"), fk("reviewer_id", "user"), fk("approver_id", "user"),
    *enum("correction_status", "IN_REVIEW", "REVIEWED", "APPROVED", "RETURNED", "REJECTED", "WITHDRAWN", default="IN_REVIEW"),
    fk("reviewed_by", "user", True), time("reviewed_at", True),
    fk("approved_by", "user", True), time("approved_at", True),
    check("metadata_correction_approve", "correction_status <> 'APPROVED' OR "
        "(reviewed_by IS NOT NULL AND approved_by IS NOT NULL AND reviewed_at IS NOT NULL "
        "AND approved_at IS NOT NULL AND created_by <> reviewed_by AND created_by <> approved_by "
        "AND reviewed_by <> approved_by)"))
regulatory_clause.append_constraint(sa.ForeignKeyConstraint(
    ["parent_clause_id", "instrument_version_id"], [P+"regulatory_clause.id", P+"regulatory_clause.instrument_version_id"], name="fk_cbd_clause_parent_version"))
clause_relationship = table("clause_relationship", fk("source_clause_id", "regulatory_clause"),
    fk("target_clause_id", "regulatory_clause"),
    *enum("relationship_type", "AMENDS", "SUPERSEDES", "REFERS_TO", "DEPENDS_ON", "REPEALS"),
    text("description"), *effective(), *approval(), check("clause_not_self", "source_clause_id <> target_clause_id"),
    unique("source_clause_id", "target_clause_id", "relationship_type", "effective_from"))
compliance_obligation = table("compliance_obligation", string("code", 80),
    fk("primary_clause_id", "regulatory_clause"), string("title", 500), text("statement"), text("internal_interpretation"),
    fk("category_id", "obligation_category"), *enum("obligation_nature", "ONGOING", "PERIODIC", "EVENT_DRIVEN", "ONE_TIME"),
    fk("frequency_id", "frequency"), fk("primary_domain_id", "regulatory_domain"),
    *enum("criticality", "CRITICAL", "HIGH", "MEDIUM", "LOW"), text("breach_consequence"), text("evidence_standard"),
    flag("testing_required_flag"), flag("certification_required_flag"), flag("reporting_required_flag"), flag("retention_required_flag"),
    fk("regulatory_owner_unit_id", "organisational_unit"), fk("business_owner_unit_id", "organisational_unit"),
    fk("compliance_reviewer_user_id", "user"), *effective(), date("next_review_date"),
    *enum("record_status", "DRAFT", "ACTIVE", "SUPERSEDED", "RETIRED", default="DRAFT"),
    col("version_number", sa.Integer(), default="1"), fk("supersedes_obligation_id", "compliance_obligation", True),
    *approval(), unique("code", "version_number"), check("obl_version", "version_number > 0"),
    check("obl_active_approved", "record_status <> 'ACTIVE' OR approval_status = 'APPROVED'"))
obligation_clause_map = table("obligation_clause_map", fk("obligation_id", "compliance_obligation"),
    fk("clause_id", "regulatory_clause"), *enum("link_type", "PRIMARY", "SUPPORTING", "EXCEPTION", "DEFINITION"),
    *effective(), unique("obligation_id", "clause_id", "effective_from"))

# Applicability, accountability and policy/product/process mappings (§§5–6).
process = master("process", 40, fk("parent_process_id", "process", True),
    fk("owner_unit_id", "organisational_unit"), *enum("criticality", "CRITICAL", "HIGH", "MEDIUM", "LOW"))
product = master("product", 40, string("category", 100), fk("owner_unit_id", "organisational_unit"),
    fk("customer_segment_id", "customer_segment", True), fk("channel_id", "channel", True),
    date("launch_date"), date("retirement_date", True))
policy_document = table("policy_document", string("code", 50), string("name", 500), string("policy_type", 40),
    fk("owner_unit_id", "organisational_unit"), string("approval_authority", 250), string("version_number", 30),
    *effective(), date("review_date"), string("record_status", 40), fk("document_id", "document"),
    *approval(), unique("code", "version_number"))
obligation_applicability = table("obligation_applicability", fk("obligation_id", "compliance_obligation"),
    fk("legal_entity_id", "legal_entity"), fk("org_unit_id", "organisational_unit", True),
    fk("product_id", "product", True), fk("process_id", "process", True), fk("channel_id", "channel", True),
    fk("customer_segment_id", "customer_segment", True), fk("geography_id", "geography", True),
    *enum("applicability_status", "APPLICABLE", "PARTIALLY_APPLICABLE", "NOT_APPLICABLE"),
    text("basis"), text("conditions", True), fk("assessed_by", "user"), date("assessed_date"),
    *approval(), *effective(), date("next_review_date"),
    check("app_partial", "applicability_status <> 'PARTIALLY_APPLICABLE' OR conditions IS NOT NULL"))
obligation_owner = table("obligation_owner", fk("obligation_id", "compliance_obligation"),
    fk("org_unit_id", "organisational_unit"), fk("user_id", "user", True),
    *enum("owner_role", "REGULATORY", "BUSINESS", "CONTROL", "EVIDENCE", "DATA", "COMPLIANCE_REVIEWER", "APPROVER"),
    flag("primary_owner_flag"), *effective(), fk("delegated_user_id", "user", True),
    date("delegated_from", True), date("delegated_to", True), *approval(),
    check("owner_delegation", "(delegated_user_id IS NULL AND delegated_from IS NULL AND delegated_to IS NULL) OR (delegated_user_id IS NOT NULL AND delegated_from IS NOT NULL AND delegated_to IS NOT NULL)"))
obligation_process_map = table("obligation_process_map", fk("obligation_id", "compliance_obligation"),
    fk("process_id", "process"), *enum("relevance_type", "PRIMARY", "DIRECT", "INDIRECT", "SUPPORTING"),
    *enum("criticality", "CRITICAL", "HIGH", "MEDIUM", "LOW"), *effective(), unique("obligation_id", "process_id", "effective_from"))
obligation_product_map = table("obligation_product_map", fk("obligation_id", "compliance_obligation"),
    fk("product_id", "product"), *enum("applicability_status", "APPLICABLE", "PARTIALLY_APPLICABLE", "NOT_APPLICABLE"),
    text("reason"), *effective(), unique("obligation_id", "product_id", "effective_from"))
obligation_policy_map = table("obligation_policy_map", fk("obligation_id", "compliance_obligation"),
    fk("policy_id", "policy_document"), string("policy_clause_reference", 150),
    *enum("coverage_status", "FULL", "PARTIAL", "GAP"), text("gap_description", True), fk("reviewed_by", "user"),
    *effective(), check("policy_gap", "coverage_status = 'FULL' OR gap_description IS NOT NULL"),
    unique("obligation_id", "policy_id", "policy_clause_reference", "effective_from"))

# Control design, execution and reusable evidence (§7).
control = table("control", string("code", 80), string("title", 500), text("description"), text("objective"),
    *enum("control_type", "PREVENTIVE", "DETECTIVE", "CORRECTIVE"),
    *enum("execution_mode", "MANUAL", "AUTOMATED", "HYBRID"), fk("frequency_id", "frequency"),
    fk("owner_unit_id", "organisational_unit"), fk("owner_user_id", "user", True),
    fk("evidence_type_id", "evidence_type"), fk("system_id", "system", True), flag("key_control_flag"),
    *enum("control_status", "DESIGNED", "IMPLEMENTED", "INEFFECTIVE", "RETIRED", default="DESIGNED"),
    *effective(), date("review_date"), *approval(), unique("code"))
obligation_control_map = table("obligation_control_map", fk("obligation_id", "compliance_obligation"),
    fk("control_id", "control"), *enum("coverage_type", "FULL", "PARTIAL", "COMPENSATING"),
    col("coverage_percentage", sa.Numeric(5, 2), True), flag("primary_control_flag"), text("mapping_rationale"),
    *effective(), *approval(), unique("obligation_id", "control_id", "effective_from"),
    check("control_pct", "coverage_percentage BETWEEN 0 AND 100"))
evidence_package = table("evidence_package", string("code", 80), string("title", 500),
    fk("owner_unit_id", "organisational_unit"), unique("code"))
control_execution = table("control_execution", fk("control_id", "control"), date("period_from"), date("period_to"),
    date("due_date"), date("performed_date", True), fk("performed_by", "user", True), fk("reviewed_by", "user", True),
    *enum("result", "PENDING", "EFFECTIVE", "EXCEPTION", "FAILED", "NOT_APPLICABLE", "OVERDUE", default="PENDING"),
    col("exception_count", sa.Integer(), default="0"), fk("evidence_package_id", "evidence_package", True),
    string("certification_status", 40, default="'NOT_REQUIRED'"), text("comments", True),
    check("exec_count", "exception_count >= 0"),
    check("exec_performed", "result IN ('PENDING','OVERDUE') OR (performed_by IS NOT NULL AND reviewed_by IS NOT NULL AND performed_by <> reviewed_by AND performed_date IS NOT NULL)"))
evidence_item = table("evidence_item", string("code", 80), string("title", 500), fk("evidence_type_id", "evidence_type"),
    fk("document_id", "document", True), string("repository_uri", 1000, True), string("source_system", 250, True),
    string("source_record", 250, True), date("period_from", True), date("period_to", True),
    fk("uploaded_by", "user"), time("uploaded_at"),
    *enum("evidence_status", "SUBMITTED", "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED", default="SUBMITTED"),
    fk("verified_by", "user", True), time("verified_at", True), text("rejection_reason", True),
    fk("confidentiality_class_id", "confidentiality_class"), date("retention_end_date"), string("file_hash", 256),
    fk("supersedes_evidence_id", "evidence_item", True), unique("code"),
    check("evidence_repo", "document_id IS NOT NULL OR repository_uri IS NOT NULL"),
    check("evidence_accept", "evidence_status <> 'ACCEPTED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by <> uploaded_by)"),
    check("evidence_reject", "evidence_status <> 'REJECTED' OR rejection_reason IS NOT NULL"))
evidence_package_item = table("evidence_package_item", fk("package_id", "evidence_package"),
    fk("evidence_id", "evidence_item"), unique("package_id", "evidence_id"))

# Assurance and remediation (§8).
compliance_test = master("compliance_test", 80, string("test_type", 40), text("objective"), fk("frequency_id", "frequency"),
    fk("owner_unit_id", "organisational_unit"), fk("owner_user_id", "user"), fk("reviewer_user_id", "user"),
    text("population"), text("sampling_method"), text("expected_evidence"), text("procedure_text"),
    text("pass_criteria"), text("severity_method"), check("test_independent", "owner_user_id <> reviewer_user_id"))
obligation_test_map = table("obligation_test_map", fk("obligation_id", "compliance_obligation"),
    fk("test_id", "compliance_test"), *effective(), unique("obligation_id", "test_id", "effective_from"))
test_plan = table("test_plan", string("code", 80), string("title", 500), fk("owner_unit_id", "organisational_unit"),
    date("period_from"), date("period_to"), *approval(), unique("code"))
test_execution = table("test_execution", fk("test_id", "compliance_test"), fk("plan_id", "test_plan", True),
    fk("org_unit_id", "organisational_unit"), date("period_from"), date("period_to"), text("population"),
    col("population_count", sa.Integer()), col("sample_size", sa.Integer()), date("started_date", True),
    date("completed_date", True), fk("tester_user_id", "user"), fk("reviewer_user_id", "user"),
    *enum("result", "PENDING", "PASS", "FAIL", "PARTIAL", "NOT_APPLICABLE", default="PENDING"), text("conclusion", True),
    check("test_counts", "population_count >= 0 AND sample_size >= 0 AND sample_size <= population_count"),
    check("test_exec_independent", "tester_user_id <> reviewer_user_id"))
test_sample = table("test_sample", fk("execution_id", "test_execution"), string("sample_reference", 150),
    date("sample_date"), string("attribute_name", 250), text("expected_result"), text("actual_result"),
    flag("exception_flag"), fk("evidence_id", "evidence_item", True),
    unique("execution_id", "sample_reference", "attribute_name"))
observation = table("observation", string("code", 80), string("source_type", 40), string("source_record_id", 36),
    fk("primary_obligation_id", "compliance_obligation"), fk("primary_clause_id", "regulatory_clause", True),
    string("title", 500), text("description"), text("criteria"), text("condition_text"), text("cause"), text("consequence"),
    *enum("severity", "CRITICAL", "HIGH", "MEDIUM", "LOW"), fk("risk_category_id", "risk_category"),
    fk("root_cause_id", "root_cause", True), flag("repeat_flag"), fk("prior_observation_id", "observation", True),
    fk("affected_unit_id", "organisational_unit"), fk("owner_unit_id", "organisational_unit"),
    date("issue_date"), date("original_due_date"), date("current_due_date"),
    *enum("record_status", "OPEN", "IN_PROGRESS", "PENDING_VALIDATION", "CLOSED", "REOPENED", default="OPEN"),
    text("regulatory_impact", True), text("customer_impact", True), text("financial_impact", True),
    *approval(), unique("code"), check("observation_repeat", "repeat_flag = 0 OR prior_observation_id IS NOT NULL"))
observation_obligation_map = table("observation_obligation_map", fk("observation_id", "observation"),
    fk("obligation_id", "compliance_obligation"), unique("observation_id", "obligation_id"))


def delivery_fields():
    return [string("code", 80), text("description"), fk("owner_unit_id", "organisational_unit"),
        fk("owner_user_id", "user"), date("original_due_date"), date("current_due_date"),
        *enum("record_status", "DRAFT", "OPEN", "IN_PROGRESS", "PENDING_VALIDATION", "COMPLETED", "CANCELLED", default="DRAFT"),
        time("completed_at", True), fk("completed_by", "user", True),
        col("extension_count", sa.Integer(), default="0"), text("extension_reason", True),
        string("evidence_status", 40, default="'PENDING'"), *approval(), unique("code")]


remediation_action = table("remediation_action", fk("observation_id", "observation"),
    *enum("action_type", "CORRECTION", "CORRECTIVE", "PREVENTIVE"), flag("immediate_flag"), flag("preventive_flag"),
    fk("dependency_action_id", "remediation_action", True), string("milestone", 500, True), *delivery_fields())
closure_validation = table("closure_validation", fk("observation_id", "observation"),
    fk("action_id", "remediation_action", True),
    *enum("evidence_adequacy", "ADEQUATE", "PARTIAL", "INADEQUATE"), flag("implementation_verified_flag"),
    flag("sustainability_required_flag"), date("sustainability_test_date", True), string("sustainability_result", 40, True),
    text("procedure_text"), text("conclusion"), fk("validated_by", "user"), date("validated_date"),
    fk("reviewed_by", "user"), date("reviewed_date"),
    *enum("decision", "CLOSE", "REOPEN", "FURTHER_WORK"), text("reopen_reason", True),
    check("validation_independent", "validated_by <> reviewed_by"),
    check("validation_reopen", "decision <> 'REOPEN' OR reopen_reason IS NOT NULL"),
    check("validation_close", "decision <> 'CLOSE' OR (implementation_verified_flag = 1 AND evidence_adequacy = 'ADEQUATE' AND (sustainability_required_flag = 0 OR (sustainability_test_date IS NOT NULL AND sustainability_result = 'PASS')))"))

# Regulatory change, standalone implementation actions and returns (§9).
regulatory_change = table("regulatory_change", string("code", 80), fk("trigger_version_id", "instrument_version"),
    fk("previous_version_id", "instrument_version", True), string("change_type", 40), text("summary"),
    date("issue_date"), date("effective_date"), date("internal_assessment_date"), date("regulatory_implementation_date"),
    *enum("materiality", "CRITICAL", "HIGH", "MEDIUM", "LOW"), fk("owner_unit_id", "organisational_unit"),
    string("record_status", 40, default="'DRAFT'"), string("overall_implementation_status", 40, default="'PENDING'"),
    *approval(), unique("code"))
change_impact_assessment = table("change_impact_assessment", fk("change_id", "regulatory_change"),
    fk("org_unit_id", "organisational_unit"), string("impact_area", 150), text("description"),
    flag("policy_impact_flag"), flag("process_impact_flag"), flag("product_impact_flag"), flag("technology_impact_flag"),
    flag("reporting_impact_flag"), flag("training_impact_flag"), flag("third_party_impact_flag"),
    fk("assessed_by", "user"), date("assessed_date"), *approval(), unique("change_id", "org_unit_id", "impact_area"))
change_action = table("change_action", fk("impact_assessment_id", "change_impact_assessment"),
    fk("dependency_action_id", "change_action", True), fk("evidence_id", "evidence_item", True),
    fk("validated_by", "user", True), date("validated_date", True), text("validation_conclusion", True), *delivery_fields())
action = table("action", fk("obligation_id", "compliance_obligation"),
    fk("applicability_id", "obligation_applicability", True), fk("dependency_action_id", "action", True), *delivery_fields())
due_date_history = table("due_date_history", fk("action_id", "action", True),
    fk("remediation_action_id", "remediation_action", True), fk("change_action_id", "change_action", True),
    fk("observation_id", "observation", True), date("previous_due_date"), date("revised_due_date"),
    text("reason"), fk("requested_by", "user"), time("requested_at"), time("applied_at", True), *approval(),
    check("due_one_target", "CASE WHEN action_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN remediation_action_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN change_action_id IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN observation_id IS NOT NULL THEN 1 ELSE 0 END = 1"),
    check("due_distinct", "previous_due_date <> revised_due_date"),
    check("due_requester", "approved_by IS NULL OR approved_by <> requested_by"))
regulatory_return = master("regulatory_return", 80, fk("regulator_id", "regulator"),
    fk("instrument_id", "regulatory_instrument"), fk("frequency_id", "frequency"), text("due_rule"),
    fk("owner_unit_id", "organisational_unit"), fk("data_provider_unit_id", "organisational_unit"),
    fk("approver_user_id", "user"), string("submission_platform", 250), text("source_systems"))
obligation_return_map = table("obligation_return_map", fk("obligation_id", "compliance_obligation"),
    fk("return_id", "regulatory_return"), *effective(), unique("obligation_id", "return_id", "effective_from"))
return_submission = table("return_submission", fk("return_id", "regulatory_return"),
    date("period_from"), date("period_to"), date("internal_due_date"), date("regulatory_due_date"),
    time("submitted_at", True), string("submission_reference", 250, True), col("version_number", sa.Integer(), default="1"),
    *enum("record_status", "DRAFT", "REVIEWED", "APPROVED", "SUBMITTED", "REVISED", "REJECTED", default="DRAFT"),
    text("revision_reason", True), fk("supersedes_submission_id", "return_submission", True), *approval(),
    unique("return_id", "period_from", "period_to", "version_number"),
    check("return_version", "version_number > 0 AND (version_number = 1 OR revision_reason IS NOT NULL)"),
    check("return_submitted", "record_status <> 'SUBMITTED' OR (submitted_at IS NOT NULL AND submission_reference IS NOT NULL AND approval_status = 'APPROVED')"))
data_quality_assessment = table("data_quality_assessment", fk("submission_id", "return_submission"),
    string("accuracy_rating", 40), string("completeness_rating", 40), string("timeliness_rating", 40), string("consistency_rating", 40),
    string("reconciliation_status", 40), col("total_exception_count", sa.Integer(), default="0"),
    col("material_exception_count", sa.Integer(), default="0"), fk("certified_by", "user"), date("assessment_date"),
    check("dq_counts", "total_exception_count >= 0 AND material_exception_count >= 0 AND material_exception_count <= total_exception_count"))
certification = table("certification", string("code", 80), fk("obligation_id", "compliance_obligation"),
    fk("org_unit_id", "organisational_unit"), date("period_from"), date("period_to"),
    fk("certified_by", "user"), date("certified_date"), text("statement"), *approval(), unique("code"))

# Typed evidence targets retain actual FKs instead of unvalidated entity IDs (§7.5).
evidence_link = table("evidence_link", fk("evidence_id", "evidence_item"),
    *[fk(n + "_id", target, True) for n, target in [
        ("obligation", "compliance_obligation"), ("control_execution", "control_execution"),
        ("test_execution", "test_execution"), ("observation", "observation"), ("action", "action"),
        ("remediation_action", "remediation_action"), ("change_action", "change_action"),
        ("certification", "certification"), ("validation", "closure_validation")]],
    *enum("link_purpose", "IMPLEMENTATION", "DESIGN", "EXECUTION", "VALIDATION"),
    flag("primary_evidence_flag"), fk("linked_by", "user"), time("linked_at"))
target_cols = [c.name for c in evidence_link.c if c.name.endswith("_id") and c.name != "evidence_id"]
evidence_link.append_constraint(check("evidence_one_target", " + ".join(
    f"CASE WHEN {c} IS NOT NULL THEN 1 ELSE 0 END" for c in target_cols) + " = 1"))

# Shared workflow and retained audit (§10).
workflow_instance = table("workflow_instance", string("workflow_type", 60), string("entity_type", 60),
    string("entity_id", 36), string("current_stage", 40), fk("started_by", "user"), time("started_at"),
    time("completed_at", True), *enum("record_status", "OPEN", "APPROVED", "REJECTED", "RETURNED", "WITHDRAWN", default="OPEN"))
workflow_action = table("workflow_action", fk("instance_id", "workflow_instance"),
    string("stage", 40), fk("assignee_user_id", "user"), time("due_at"), string("decision", 40, True),
    text("comments", True), fk("acted_by", "user", True), time("acted_at", True))
status_history = table("status_history", string("entity_type", 60), string("entity_id", 36),
    string("previous_status", 40, True), string("new_status", 40), text("reason"),
    fk("changed_by", "user"), time("changed_at"))
audit_log = table("audit_log", string("entity_type", 60), string("entity_id", 36), string("action", 60),
    string("field_name", 150, True), text("old_value", True), text("new_value", True), fk("actor_user_id", "user", True),
    time("event_at"), string("channel", 40), text("reason", True), string("session_id", 128, True))
comment = table("comment", string("entity_type", 60), string("entity_id", 36), string("comment_type", 40),
    text("comment_text"), fk("created_by", "user"), fk("confidentiality_class_id", "confidentiality_class"),
    fk("parent_comment_id", "comment", True))
notification = table("notification", string("entity_type", 60), string("entity_id", 36), string("notification_type", 60),
    fk("recipient_user_id", "user"), string("channel", 40), string("trigger_key", 200),
    time("triggered_at"), time("delivered_at", True), time("escalated_at", True), time("read_at", True),
    string("delivery_status", 40, default="'PENDING'"), unique("recipient_user_id", "trigger_key"))

# Migration lineage and reconciliation (requirements weeks 2, 6–8).
migration_batch = table("migration_batch", string("code", 80), string("source_file", 500), string("file_hash", 256),
    fk("uploaded_by", "user"), time("uploaded_at"), col("source_count", sa.Integer()),
    col("loaded_count", sa.Integer(), default="0"), col("rejected_count", sa.Integer(), default="0"),
    col("pending_count", sa.Integer(), default="0"), string("record_status", 40, default="'STAGED'"),
    text("reconciliation_notes", True), unique("code"),
    check("batch_counts", "source_count >= 0 AND loaded_count >= 0 AND rejected_count >= 0 AND pending_count >= 0 AND loaded_count + rejected_count + pending_count <= source_count"))
migration_row = table("migration_row", fk("batch_id", "migration_batch"), string("sheet_name", 250),
    col("row_number", sa.Integer()), string("source_system", 100), string("legacy_id", 250),
    text("source_payload"), string("validation_status", 40, default="'PENDING'"), text("validation_errors", True),
    string("target_entity_type", 60, True), string("target_entity_id", 36, True), time("loaded_at", True),
    unique("source_system", "legacy_id"), unique("batch_id", "sheet_name", "row_number"),
    check("migration_row_number", "row_number > 0"))
application_link = master("application_link", 40, string("url", 1000, True), text("description"))
id_counter = table("id_counter", string("entity_type", 60), string("prefix", 40),
    col("next_value", sa.BigInteger(), default="1"), unique("entity_type"), check("counter_positive", "next_value > 0"))

# Runtime security state. Created only by revision 0009, never by API startup.
app_session = table("app_session", fk("user_id", "user"), string("token_hash", 64),
    string("csrf_token", 100), time("expires_at"), time("last_seen_at"), flag("revoked_flag"),
    string("ldap_observation_id", 36, True),
    unique("token_hash"))
login_attempt = table("login_attempt", string("identity_hash", 64), string("address_hash", 64),
    flag("succeeded_flag"), time("attempted_at"))
directory_configuration = table("directory_configuration", string("code", 40),
    text("configuration"), text("secret_cipher", True), unique("code"))

# Clause provenance and notification families (revision 0013).
clause_carry_forward = table("clause_carry_forward", fk("source_clause_id", "regulatory_clause"),
    string("target_clause_id", 36), fk("target_version_id", "instrument_version"),
    fk("created_by", "user"), text("basis"), unique("target_version_id", "source_clause_id"),
    unique("target_clause_id"), sa.ForeignKeyConstraint(["target_clause_id", "target_version_id"],
        [P+"regulatory_clause.id", P+"regulatory_clause.instrument_version_id"]))
notification_link = table("notification_link", fk("parent_id", "regulatory_instrument"),
    fk("child_id", "regulatory_instrument"),
    *enum("relationship_type", "AMENDS", "CLARIFIES", "SUPERSEDES", "REPEALS"),
    date("effective_from"), text("basis"), *approval(), check("family_self", "parent_id <> child_id"))
notification_scope = table("notification_scope", fk("instrument_id", "regulatory_instrument"),
    fk("org_unit_id", "organisational_unit"), fk("owner_user_id", "user"),
    fk("created_by", "user"), date("effective_from"), unique("instrument_id", "org_unit_id"))
notification_assessment = table("notification_assessment", fk("scope_id", "notification_scope"),
    fk("source_version_id", "instrument_version"), *enum("outcome", "COMPLETED", "NO_IMPACT"),
    text("rationale"), string("action_snapshot", 64), col("revision", sa.Integer()),
    *approval(), unique("scope_id", "revision"), check("assessment_revision", "revision > 0"))
regulatory_deadline = table("regulatory_deadline", fk("instrument_id", "regulatory_instrument"),
    fk("source_version_id", "instrument_version"), date("due_date"), date("effective_from"),
    text("basis"), *approval())

# FK indexes support parent checks/updates without Oracle child-table scans.
for t in metadata.tables.values():
    for c in t.c:
        if c.foreign_keys and not c.primary_key and not any(list(i.columns)[0] is c for i in t.indexes) and not any(isinstance(key,sa.UniqueConstraint) and list(key.columns)==[c] for key in t.constraints):
            digest = __import__("hashlib").sha1((t.name + c.name).encode()).hexdigest()[:8]
            sa.Index("ix_" + t.name[4:18] + "_" + digest, c)

# Oracle ignores all-NULL function-index entries, enforcing one current version.
sa.Index("uq_cbd_version_current", sa.case(
    (instrument_version.c.current_version_flag == 1, instrument_version.c.instrument_id), else_=None), unique=True)
sa.Index("uq_cbd_family_parent", sa.case((notification_link.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']),
    notification_link.c.child_id), else_=None), unique=True)
sa.Index("uq_cbd_deadline_effective", sa.case((regulatory_deadline.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']),
    regulatory_deadline.c.instrument_id), else_=None), sa.case((regulatory_deadline.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']),
    regulatory_deadline.c.effective_from), else_=None), unique=True)

# Ephemeral replay protection is separate from retained business/audit history.
# Append new tables so existing enum/check names stay stable.
used_login_challenge = table('used_login_challenge', time('expires_at'))
sa.Index('ix_used_login_challenge_expires', used_login_challenge.c.expires_at)

# Retained LDAP identity approvals; independent of home organisation and roles.
ldap_department_request = table('ldap_department_request', fk('user_id','user'),
    string('previous_code',100,True), string('previous_name',250,True),
    string('proposed_code',100), string('proposed_name',250), time('observed_at'),
    string('observation_id',36), fk('requested_by','user'), time('requested_at'),
    string('request_reason',1000,True), string('status',20,default="'PENDING'"),
    fk('decided_by','user',True), time('decided_at',True), string('decision_reason',1000,True),
    check('ldap_dept_request_state', "status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED','OBSOLETE')"),
    check('ldap_dept_request_owner', 'requested_by = user_id'),
    check('ldap_dept_independent', "status NOT IN ('APPROVED','REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND decided_by <> user_id)"))
sa.Index('uq_cbd_ldap_dept_pending',sa.case((ldap_department_request.c.status=='PENDING',
    ldap_department_request.c.user_id),else_=None),unique=True)
