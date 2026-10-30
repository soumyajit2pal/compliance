"""Reference data for both UAT and Prod; no sample business records or passwords.

This revision owns its data snapshot. MERGE inserts missing codes without
overwriting an administrator's existing names or decisions. Domain seeds use
the approved REGULATORY_DOMAINS list.
"""
from datetime import date
from uuid import UUID, uuid5

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import oracle


NAMESPACE = UUID("7f4891a8-0115-4e2d-b38f-e02b6f5f8d85")
START = date(2026, 10, 17)
ROLE_IDS = {'ADMIN': 'b93f709a-5a20-543b-b59d-476959a5bd22',
 'APPROVER': 'ed74a497-b1dd-5c09-b426-4af9f69526e3',
 'AUTHOR': 'd1fc676d-d1fc-56d2-8ae3-5056bb19671f',
 'BUSINESS_OWNER': '362faa27-5fae-5461-af4d-6b775b97762e',
 'CCO': '6ff5c287-ad11-50dc-b112-9172330b53a4',
 'CONTROL_OWNER': '5cae4a5a-779a-5669-a885-16fc6fdc7ebb',
 'EVIDENCE_OWNER': '816b3e17-d2dc-5d8d-8d8c-d8e868ad2768',
 'REVIEWER': '4d03307e-d67f-5de5-8ede-7b59de5b480d',
 'ZONE_VIEWER': 'c8b3e5c3-5330-559d-91ac-33515e04cb5e'}


def identity(table, code):
    if table == "role":
        return ROLE_IDS[code]
    return str(uuid5(NAMESPACE, table + ":" + code))


def merge(table, keys, **values):
    # Literal SQL also supports `alembic upgrade head --sql` for DBA review.
    values = {"id": identity(table, ":".join(str(values[k]) for k in keys)), **values}
    literal = lambda value: str(sa.literal(value).compile(dialect=oracle.dialect(), compile_kwargs={"literal_binds": True}))
    columns = list(values)
    select = ", ".join(literal(values[c]) + " AS " + c for c in columns)
    on = " AND ".join("target." + k + " = source." + k for k in keys)
    op.execute(sa.text(f"MERGE INTO cbd_{table} target USING (SELECT {select} FROM dual) source "
        f"ON ({on}) WHEN NOT MATCHED THEN INSERT ({', '.join(columns)}) "
        f"VALUES ({', '.join('source.' + c for c in columns)})"))


def masters(table, rows, **extra):
    for code, name in rows:
        merge(table, ["code"], code=code, name=name, active_flag=1, **extra)


REGULATORS = [
    ("RBI", "Reserve Bank of India"), ("SEBI", "Securities and Exchange Board of India"),
    ("IRDAI", "Insurance Regulatory and Development Authority of India"),
    ("PFRDA", "Pension Fund Regulatory and Development Authority"),
    ("FIU", "Financial Intelligence Unit"), ("DFS", "Department of Financial Services"),
    ("MoF", "Ministry of Finance"),
]
REGULATORY_DOMAINS = [
    ("REG-GOV", "Compliance Governance"), ("REG-KYC", "KYC / AML / CFT"),
    ("REG-CUST", "Customer Protection and Service"), ("REG-DEP", "Deposits"),
    ("REG-RETAIL", "Retail Credit"), ("REG-MSME", "MSME Credit"), ("REG-CORP", "Corporate Credit"),
    ("REG-TRE", "Treasury and Investments"), ("REG-RISK", "Risk Management"), ("REG-OUT", "Outsourcing"),
    ("REG-IT-CYB", "Information Technology and Cyber Security"), ("REG-FRAUD", "Fraud Risk Management"),
    ("REG-DATA", "Data Quality and Regulatory Reporting"), ("REG-RECOVERY", "Recovery and Collections"),
    ("REG-TDCR", "Transfer and Distribution of Credit Risk"),
]
CATEGORIES = [
    ("OBL-POL", "Policy"), ("OBL-CTRL", "Control"), ("OBL-APP", "Approval"),
    ("OBL-REP", "Regulatory Reporting"), ("OBL-DISC", "Disclosure"), ("OBL-TRAIN", "Training"),
    ("OBL-CERT", "Certification"), ("OBL-ESC", "Escalation"), ("OBL-MON", "Monitoring"),
    ("OBL-TEST", "Testing"), ("OBL-REC", "Record Retention"), ("OBL-AUD", "Audit Trail"),
    ("OBL-RCA", "Root-cause Analysis"), ("OBL-REM", "Remediation"), ("OBL-GOV", "Governance"),
]
TYPES = [
    ("ACT", "Act"), ("RULE", "Rule"), ("REGULATION", "Regulation"), ("MD", "Master Direction"),
    ("DIRECTION", "Direction"), ("CIRCULAR", "Circular"), ("NOTIFICATION", "Notification"),
    ("SUPERVISORY", "Supervisory Letter"), ("FAQ", "FAQ / Clarification"), ("ADVISORY", "Advisory"),
    ("GOV-DIRECTIVE", "Government Directive"), ("INTERNAL-ADVISORY", "Internal Compliance Advisory"),
    ("GUIDELINE", "Guideline"),
]
ROLES = [('ADMIN', 'Admin'),
 ('AUTHOR', 'Author'),
 ('REVIEWER', 'Reviewer'),
 ('APPROVER', 'Approver'),
 ('BUSINESS_OWNER', 'Business Owner'),
 ('CONTROL_OWNER', 'Control Owner'),
 ('EVIDENCE_OWNER', 'Evidence Owner'),
 ('CCO', 'CCO'),
 ('ZONE_VIEWER', 'Zone Viewer')]
STATUSES = {
    "approval": ["DRAFT", "IN_REVIEW", "REVIEWED", "APPROVED", "REJECTED", "WITHDRAWN"],
    "instrument": ["DRAFT", "CURRENT", "SUPERSEDED", "WITHDRAWN"],
    "clause": ["CURRENT", "AMENDED", "SUPERSEDED", "DELETED"],
    "interpretation": ["PENDING", "REVIEWED", "APPROVED"],
    "obligation": ["DRAFT", "ACTIVE", "SUPERSEDED", "RETIRED"],
    "applicability": ["APPLICABLE", "PARTIALLY_APPLICABLE", "NOT_APPLICABLE"],
    "control": ["DESIGNED", "IMPLEMENTED", "INEFFECTIVE", "RETIRED"],
    "control_execution": ["PENDING", "EFFECTIVE", "EXCEPTION", "FAILED", "NOT_APPLICABLE", "OVERDUE"],
    "evidence": ["SUBMITTED", "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"],
    "test_execution": ["PENDING", "PASS", "FAIL", "PARTIAL", "NOT_APPLICABLE"],
    "observation": ["OPEN", "IN_PROGRESS", "PENDING_VALIDATION", "CLOSED", "REOPENED"],
    "action": ["DRAFT", "OPEN", "IN_PROGRESS", "PENDING_VALIDATION", "COMPLETED", "CANCELLED"],
    "return_submission": ["DRAFT", "REVIEWED", "APPROVED", "SUBMITTED", "REVISED", "REJECTED"],
    "workflow": ["OPEN", "APPROVED", "REJECTED", "RETURNED", "WITHDRAWN"],
    "migration": ["STAGED", "PENDING", "READY", "CORRECTION_REQUIRED", "CONTENT_VALIDATION_PENDING", "LOADED", "REJECTED", "RECONCILED"],
    "regulatory_change": ["DRAFT", "IN_ASSESSMENT", "APPROVED", "IMPLEMENTING", "COMPLETED", "WITHDRAWN"],
    "change_implementation": ["PENDING", "IN_PROGRESS", "COMPLETED", "NO_IMPACT", "OVERDUE"],
    "certification": ["NOT_REQUIRED", "PENDING", "SUBMITTED", "APPROVED", "REJECTED"],
    "policy": ["DRAFT", "CURRENT", "SUPERSEDED", "RETIRED"],
    "notification_delivery": ["PENDING", "DELIVERED", "FAILED"],
    "reconciliation": ["PENDING", "RECONCILED", "EXCEPTIONS"],
    "dq_rating": ["SATISFACTORY", "NEEDS_IMPROVEMENT", "UNSATISFACTORY", "NOT_ASSESSED"],
}


def install():
    masters("role", ROLES)
    masters("frequency", [(c, n) for c, n in [
        ("ONGOING", "Ongoing"), ("EVENT", "Event-driven"), ("ONE_TIME", "One-time"),
        ("DAILY", "Daily"), ("WEEKLY", "Weekly"), ("MONTHLY", "Monthly"),
        ("QUARTERLY", "Quarterly"), ("HALF_YEARLY", "Half-yearly"), ("ANNUAL", "Annual")]])
    masters("evidence_type", [("DOCUMENT", "Document"), ("SYSTEM_REPORT", "System Report"),
        ("SCREENSHOT", "Screenshot"), ("REGISTER", "Register"), ("MINUTES", "Minutes"),
        ("CERTIFICATE", "Certificate"), ("SUBMISSION", "Submission Acknowledgement")])
    for rank, (code, name) in enumerate([("PUBLIC", "Public"), ("INTERNAL", "Internal"),
                                       ("CONFIDENTIAL", "Confidential"), ("RESTRICTED", "Restricted")]):
        masters("confidentiality_class", [(code, name)], rank_number=rank)
    masters("risk_category", [("CRITICAL", "Critical"), ("HIGH", "High"), ("MEDIUM", "Medium"), ("LOW", "Low")])
    masters("root_cause", [(n.upper().replace(" ", "_"), n) for n in [
        "People", "Process", "Technology", "Governance", "Data", "Policy", "Training", "Third party", "Capacity", "Supervision", "Other"]])
    masters("instrument_type", TYPES, creates_obligation_flag=1, impact_assessment_required_flag=1)
    masters("obligation_category", CATEGORIES)
    for code, name in REGULATORS:
        masters("regulator", [(code, name)], regulator_type="GOVERNMENT" if code in {"DFS", "MoF"} else "REGULATORY",
                jurisdiction="India", effective_from=START)
    source = "framework.pdf Level 2"
    masters("taxonomy_scheme", [("REGULATORY", "Regulatory Domains")], source_reference=source)
    for sequence, (code, name) in enumerate(REGULATORY_DOMAINS, 1):
        # No organisation/owner is invented. Activate after approved master onboarding.
        merge("regulatory_domain", ["code"], code=code, name=name, active_flag=0,
            description=name + "; source: " + source,
            scheme_id=identity("taxonomy_scheme", "REGULATORY"), domain_level=1,
            display_sequence=sequence, effective_from=START)
    for entity, codes in STATUSES.items():
        for code in codes:
            merge("status", ["entity_type", "code"], entity_type=entity, code=code,
                name=code.replace("_", " ").title(), terminal_flag=int(code in {
                    "APPROVED", "REJECTED", "WITHDRAWN", "CLOSED", "COMPLETED", "CANCELLED", "RETIRED", "SUPERSEDED"}))
    for entity, prefix in [("instrument", "INS"), ("clause", "CLS"), ("obligation", "OBL"),
            ("control", "CTL"), ("test", "TST"), ("observation", "OBS"), ("action", "ACT"),
            ("remediation_action", "REM"), ("change_action", "CHA"), ("regulatory_change", "RCM"),
            ("evidence", "EVD"), ("return", "RTR"), ("certification", "CRT"), ("evidence_package", "EVP")]:
        merge("id_counter", ["entity_type"], entity_type=entity, prefix=prefix, next_value=1)
    for code, name in [("DAKSH", "DAKSH"), ("CERTIFICATES", "Compliance Certificates"), ("IRAR_RMP_MANC", "IRAR / RMP / MANC")]:
        merge("application_link", ["code"], code=code, name=name, active_flag=0,
            description="Retained application; configure the bank-approved URL before activation.")

