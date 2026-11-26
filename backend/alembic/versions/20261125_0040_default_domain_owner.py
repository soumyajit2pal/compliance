"""Assign Compliance Department to regulatory domains without an owner."""
from alembic import op
import sqlalchemy as sa

revision = '20261125_0040'
down_revision = '20261125_0039'
branch_labels = depends_on = None


def upgrade():
    op.execute(sa.DDL("""
        DECLARE
            compliance_id cbd_organisational_unit.id%%TYPE;
            business_day DATE := TRUNC(CAST(SYSTIMESTAMP AT TIME ZONE 'Asia/Kolkata' AS DATE));
        BEGIN
            SELECT MAX(id) INTO compliance_id
            FROM cbd_organisational_unit
            WHERE code = 'COMPLIANCE'
              AND unit_type = 'DEPARTMENT'
              AND active_flag = 1
              AND effective_from <= business_day
              AND (effective_to IS NULL OR effective_to > business_day);

            IF compliance_id IS NOT NULL THEN
                FOR domain_row IN (
                    SELECT id FROM cbd_regulatory_domain
                    WHERE domain_owner_unit_id IS NULL
                ) LOOP
                    UPDATE cbd_regulatory_domain
                    SET domain_owner_unit_id = compliance_id
                    WHERE id = domain_row.id AND domain_owner_unit_id IS NULL;

                    IF SQL%%ROWCOUNT = 1 THEN
                        INSERT INTO cbd_audit_log
                            (entity_type, entity_id, action, field_name, old_value, new_value, event_at, channel, reason)
                        VALUES
                            ('regulatory_domain', domain_row.id, 'MASTER_UPDATED', 'domain_owner_unit_id',
                             '{"domain_owner_unit_id":null}',
                             JSON_OBJECT('domain_owner_unit_id' VALUE compliance_id),
                             SYS_EXTRACT_UTC(SYSTIMESTAMP), 'ALEMBIC', 'Default regulatory domain owner is Compliance Department.');
                    END IF;
                END LOOP;
            END IF;
        END;
    """))


def downgrade():
    raise RuntimeError('Regulatory domain ownership changes are retained. Use a reviewed forward migration.')
