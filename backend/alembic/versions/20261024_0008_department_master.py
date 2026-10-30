"""Seed the 25 departments supplied on 24 October, preserving current identities."""
from datetime import date
from uuid import UUID, uuid5
from alembic import op
import sqlalchemy as sa

revision = "20261024_0008"
down_revision = "20261017_0007"
branch_labels = depends_on = None

# Frozen input: do not import the application's evolving reference catalogue.
DEPARTMENTS = [
    ("BUSINESS-DEVELOPMENT", "BUSINESS DEVELOPMENT"), ("CASH-MANAGEMENT", "CASH MANAGEMENT"),
    ("CISO", "CISO"), ("DIGITAL-BANKING", "DIGITAL BANKING DEPARTMENT"),
    ("DISASTER-RECOVERY", "DISASTER RECOVERY CENTER"), ("GOVT-BUSINESS-CELL", "GOVT. BUSINESS CELL"),
    ("HO-IT-COMPLIANCE", "HO IT COMPLIANCE"), ("HUMAN-RESOURCES", "HUMAN RESOURCES MANAGEMENT"),
    ("INFRASTRUCTURE-PLANNING", "INFRASTRUCTURE PLANNING"), ("INSPECTION-AUDIT", "INSPECTION AND AUDIT"),
    ("IT-PROJECTS", "IT PROJECTS"), ("IT-SOFTWARE", "IT SOFTWARE"), ("LEGAL", "LEGAL"), ("LLMS", "LLMS"),
    ("MARKETING", "MARKETING"), ("OPERATIONS", "OPERATIONS"),
    ("PAYMENT-PROCUREMENT", "PAYMENT & PROCUREMENT"), ("PLANNING-DEVELOPMENT", "PLANNING & DEVELOPMENT"),
    ("PMO", "PMO"), ("PMO-GIFT-CITY", "PMO GIFT CITY"), ("QA-TEAM", "QA TEAM"),
    ("RAJBHASHA", "RAJBHASHA"), ("RECOVERY", "RECOVERY"),
    ("TRANSACTION-MONITORING", "TRANSACTION MONITORING"), ("VIGILANCE", "VIGILANCE"),
]


def upgrade():
    for code, name in DEPARTMENTS:
        identifier = str(uuid5(UUID("54db3707-2125-5f98-af13-cafbe8bfc9a4"), "organisational_unit:" + code))
        op.execute(sa.text("""MERGE INTO cbd_organisational_unit target
            USING (SELECT :code code, :name name FROM dual) src ON (target.code = src.code)
            WHEN NOT MATCHED THEN INSERT
              (id, code, name, unit_type, parent_org_unit_id, level_number, effective_from, active_flag)
              VALUES (:identifier, src.code, src.name, 'DEPARTMENT',
                (SELECT id FROM cbd_organisational_unit WHERE code='BANK'), 1, :start_date, 1)
        """).bindparams(code=code, name=name, identifier=identifier, start_date=date(2026, 10, 24)))
    # The existing OPERATIONS ID, parent, members and scoped roles remain intact.
    op.execute("UPDATE cbd_organisational_unit SET name='OPERATIONS' WHERE code='OPERATIONS'")
    op.execute("""INSERT INTO cbd_audit_log
        (id,entity_type,entity_id,action,new_value,event_at,channel,reason)
        SELECT LOWER(RAWTOHEX(SYS_GUID())), 'system','20261024_0008','SEED_DEPARTMENTS',
          '25 requested departments; OPERATIONS identity preserved',SYSTIMESTAMP,'ALEMBIC',
          'User-supplied department catalogue dated 24 October 2026'
        FROM dual WHERE NOT EXISTS (SELECT 1 FROM cbd_audit_log
          WHERE entity_type='system' AND entity_id='20261024_0008' AND action='SEED_DEPARTMENTS')""")


def downgrade():
    raise RuntimeError("Departments may be referenced by business history; destructive downgrade is blocked.")
