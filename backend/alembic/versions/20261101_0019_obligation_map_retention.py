"""Retain approved/in-flight obligation source and process mappings."""
from alembic import op,context
import sqlalchemy as sa

revision='20261101_0019'
down_revision='20261101_0018'
branch_labels=depends_on=None


def upgrade():
    for table,name in [('clause','cbd_obl_clause_guard'),('process','cbd_obl_process_guard')]:
        op.execute(sa.DDL(f"""CREATE OR REPLACE TRIGGER {name}
            BEFORE UPDATE OR DELETE ON cbd_obligation_{table}_map
            FOR EACH ROW
            DECLARE parent_status VARCHAR2(30);
            BEGIN
              SELECT approval_status INTO parent_status FROM cbd_compliance_obligation
                WHERE id = :OLD.obligation_id;
              IF parent_status <> 'DRAFT' THEN
                RAISE_APPLICATION_ERROR(-20081,'Reviewed obligation mappings must be retained. Create a governed revision.');
              END IF;
              IF UPDATING THEN
                SELECT approval_status INTO parent_status FROM cbd_compliance_obligation
                  WHERE id = :NEW.obligation_id;
                IF parent_status <> 'DRAFT' THEN
                  RAISE_APPLICATION_ERROR(-20081,'A mapping cannot be moved into a reviewed obligation.');
                END IF;
              END IF;
            END;"""))
        if not context.is_offline_mode():
            errors=op.get_bind().execute(sa.text('SELECT text FROM user_errors WHERE name = :name'),{'name':name.upper()}).scalars().all()
            if errors:raise RuntimeError('Obligation mapping retention trigger failed to compile: '+' '.join(errors))


def downgrade():
    raise RuntimeError('Retained obligation mapping protections require reviewed replacement.')
