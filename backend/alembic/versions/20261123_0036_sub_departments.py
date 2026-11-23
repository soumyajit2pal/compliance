"""Allow sub-department units while preserving the existing hierarchy and access."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261123_0036'
down_revision = '20261120_0035'
branch_labels = depends_on = None


def upgrade():
    table = 'cbd_organisational_unit'
    offline = context.is_offline_mode()
    existing = set() if offline else {
        check['name'].lower() for check in sa.inspect(op.get_bind()).get_check_constraints(table, include_all=True)
    }
    for name, condition in (
        ('ck_org_unit_type', "unit_type IN ('BANK','HO','VERTICAL','DEPARTMENT','SUB_DEPARTMENT','ZONE','REGION','BRANCH')"),
        ('ck_sub_department_parent', "unit_type <> 'SUB_DEPARTMENT' OR parent_org_unit_id IS NOT NULL"),
    ):
        if name not in existing:
            op.create_check_constraint(name, table, condition)
    # Install the broader check before removing the original Oracle constraint.
    if offline or 'ck_unit_type_0' in existing:
        op.drop_constraint('ck_unit_type_0', table, type_='check')


def downgrade():
    raise RuntimeError('Sub-department codes can be in use. Use a reviewed forward migration.')
