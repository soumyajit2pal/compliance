"""Current regulatory domain classification, from framework.pdf Level 2."""

REGULATORY_DOMAINS = [
    ("REG-GOV", "Compliance Governance"), ("REG-KYC", "KYC / AML / CFT"),
    ("REG-CUST", "Customer Protection and Service"), ("REG-DEP", "Deposits"),
    ("REG-RETAIL", "Retail Credit"), ("REG-MSME", "MSME Credit"), ("REG-CORP", "Corporate Credit"),
    ("REG-TRE", "Treasury and Investments"), ("REG-RISK", "Risk Management"), ("REG-OUT", "Outsourcing"),
    ("REG-IT-CYB", "Information Technology and Cyber Security"), ("REG-FRAUD", "Fraud Risk Management"),
    ("REG-DATA", "Data Quality and Regulatory Reporting"), ("REG-RECOVERY", "Recovery and Collections"),
    ("REG-TDCR", "Transfer and Distribution of Credit Risk"),
]

# code, name, unit type, parent code, level; parent records come first.
ORGANISATION_HIERARCHY = [
    ("BANK", "Bank Of Maharashtra", "BANK", None, 0),
    ("COMPLIANCE", "Compliance Department", "DEPARTMENT", "BANK", 1),
]

APPLICATION_ROLES = [
    ("ADMIN", "Admin"), ("AUTHOR", "Author"), ("REVIEWER", "Reviewer"),
    ("APPROVER", "Approver"), ("BUSINESS_OWNER", "Business Owner"),
    ("CONTROL_OWNER", "Control Owner"), ("EVIDENCE_OWNER", "Evidence Owner"),
    ("CCO", "CCO"), ("ZONE_VIEWER", "Zone Viewer"),
]

# username, full name, role code, home organisation, global role scope
ROLE_SEED_USERS = [
    ("admin", "System Administrator", "ADMIN", "COMPLIANCE", True),
    ("author", "Regulatory Author", "AUTHOR", "COMPLIANCE", True),
    ("reviewer", "Compliance Reviewer", "REVIEWER", "COMPLIANCE", True),
    ("approver", "Final Approver", "APPROVER", "COMPLIANCE", True),
    ("retail.owner", "Retail Business Owner", "BUSINESS_OWNER", "COMPLIANCE", False),
    ("operations.owner", "Operations Business Owner", "BUSINESS_OWNER", "COMPLIANCE", False),
    ("control.owner", "Control Owner", "CONTROL_OWNER", "COMPLIANCE", False),
    ("evidence.owner", "Evidence Owner", "EVIDENCE_OWNER", "COMPLIANCE", False),
    ("cco", "Chief Compliance Office", "CCO", "COMPLIANCE", True),
    ("zone.viewer", "Zone Viewer", "ZONE_VIEWER", "COMPLIANCE", False),
]
