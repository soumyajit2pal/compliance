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
    ("BANK", "Bank of Maharashtra", "BANK", None, 0),
    ("COMPLIANCE", "Compliance Department", "DEPARTMENT", "BANK", 1),
    ("RETAIL", "Retail Banking", "DEPARTMENT", "BANK", 1),
    ("OPERATIONS", "OPERATIONS", "DEPARTMENT", "BANK", 1),
    ("CREDIT", "Credit and Risk", "DEPARTMENT", "BANK", 1),
    ("IT", "Information Technology", "DEPARTMENT", "BANK", 1),
    ("PUNE-ZONE", "Pune Zone", "ZONE", "OPERATIONS", 2),
    ("PUNE-BRANCH", "Pune Main Branch", "BRANCH", "PUNE-ZONE", 3),
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
    ("retail.owner", "Retail Business Owner", "BUSINESS_OWNER", "RETAIL", False),
    ("operations.owner", "Operations Business Owner", "BUSINESS_OWNER", "OPERATIONS", False),
    ("control.owner", "Control Owner", "CONTROL_OWNER", "RETAIL", False),
    ("evidence.owner", "Evidence Owner", "EVIDENCE_OWNER", "RETAIL", False),
    ("cco", "Chief Compliance Office", "CCO", "COMPLIANCE", True),
    ("zone.viewer", "Zone Viewer", "ZONE_VIEWER", "PUNE-ZONE", False),
]

# Departments supplied by the user on 24 October 2026; no inferred owner assignments.
REQUESTED_DEPARTMENTS = [('BUSINESS-DEVELOPMENT', 'BUSINESS DEVELOPMENT'), ('CASH-MANAGEMENT', 'CASH MANAGEMENT'), ('CISO', 'CISO'), ('DIGITAL-BANKING', 'DIGITAL BANKING DEPARTMENT'), ('DISASTER-RECOVERY', 'DISASTER RECOVERY CENTER'), ('GOVT-BUSINESS-CELL', 'GOVT. BUSINESS CELL'), ('HO-IT-COMPLIANCE', 'HO IT COMPLIANCE'), ('HUMAN-RESOURCES', 'HUMAN RESOURCES MANAGEMENT'), ('INFRASTRUCTURE-PLANNING', 'INFRASTRUCTURE PLANNING'), ('INSPECTION-AUDIT', 'INSPECTION AND AUDIT'), ('IT-PROJECTS', 'IT PROJECTS'), ('IT-SOFTWARE', 'IT SOFTWARE'), ('LEGAL', 'LEGAL'), ('LLMS', 'LLMS'), ('MARKETING', 'MARKETING'), ('OPERATIONS', 'OPERATIONS'), ('PAYMENT-PROCUREMENT', 'PAYMENT & PROCUREMENT'), ('PLANNING-DEVELOPMENT', 'PLANNING & DEVELOPMENT'), ('PMO', 'PMO'), ('PMO-GIFT-CITY', 'PMO GIFT CITY'), ('QA-TEAM', 'QA TEAM'), ('RAJBHASHA', 'RAJBHASHA'), ('RECOVERY', 'RECOVERY'), ('TRANSACTION-MONITORING', 'TRANSACTION MONITORING'), ('VIGILANCE', 'VIGILANCE')]
ORGANISATION_HIERARCHY.extend([('BUSINESS-DEVELOPMENT', 'BUSINESS DEVELOPMENT', 'DEPARTMENT', 'BANK', 1), ('CASH-MANAGEMENT', 'CASH MANAGEMENT', 'DEPARTMENT', 'BANK', 1), ('CISO', 'CISO', 'DEPARTMENT', 'BANK', 1), ('DIGITAL-BANKING', 'DIGITAL BANKING DEPARTMENT', 'DEPARTMENT', 'BANK', 1), ('DISASTER-RECOVERY', 'DISASTER RECOVERY CENTER', 'DEPARTMENT', 'BANK', 1), ('GOVT-BUSINESS-CELL', 'GOVT. BUSINESS CELL', 'DEPARTMENT', 'BANK', 1), ('HO-IT-COMPLIANCE', 'HO IT COMPLIANCE', 'DEPARTMENT', 'BANK', 1), ('HUMAN-RESOURCES', 'HUMAN RESOURCES MANAGEMENT', 'DEPARTMENT', 'BANK', 1), ('INFRASTRUCTURE-PLANNING', 'INFRASTRUCTURE PLANNING', 'DEPARTMENT', 'BANK', 1), ('INSPECTION-AUDIT', 'INSPECTION AND AUDIT', 'DEPARTMENT', 'BANK', 1), ('IT-PROJECTS', 'IT PROJECTS', 'DEPARTMENT', 'BANK', 1), ('IT-SOFTWARE', 'IT SOFTWARE', 'DEPARTMENT', 'BANK', 1), ('LEGAL', 'LEGAL', 'DEPARTMENT', 'BANK', 1), ('LLMS', 'LLMS', 'DEPARTMENT', 'BANK', 1), ('MARKETING', 'MARKETING', 'DEPARTMENT', 'BANK', 1), ('PAYMENT-PROCUREMENT', 'PAYMENT & PROCUREMENT', 'DEPARTMENT', 'BANK', 1), ('PLANNING-DEVELOPMENT', 'PLANNING & DEVELOPMENT', 'DEPARTMENT', 'BANK', 1), ('PMO', 'PMO', 'DEPARTMENT', 'BANK', 1), ('PMO-GIFT-CITY', 'PMO GIFT CITY', 'DEPARTMENT', 'BANK', 1), ('QA-TEAM', 'QA TEAM', 'DEPARTMENT', 'BANK', 1), ('RAJBHASHA', 'RAJBHASHA', 'DEPARTMENT', 'BANK', 1), ('RECOVERY', 'RECOVERY', 'DEPARTMENT', 'BANK', 1), ('TRANSACTION-MONITORING', 'TRANSACTION MONITORING', 'DEPARTMENT', 'BANK', 1), ('VIGILANCE', 'VIGILANCE', 'DEPARTMENT', 'BANK', 1)])
