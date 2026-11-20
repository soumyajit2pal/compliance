"""Align the original reference labels with the checks and procedures workspace."""

from alembic import op

revision = '20261120_0034'
down_revision = '20261120_0033'
branch_labels = depends_on = None


def upgrade():
    op.execute("UPDATE cbd_role SET name='Check Owner' WHERE code='CONTROL_OWNER' AND name='Control Owner'")
    op.execute("UPDATE cbd_obligation_category SET name='Check' WHERE code='OBL-CTRL' AND name='Control'")
    if op.get_context().opts.get('seed_environment') == 'uat':
        op.execute("""UPDATE cbd_user SET full_name='Check Owner'
            WHERE id='82140d17-fb35-582f-95e0-a4c5417a393e' AND username='control.owner'
            AND login_type='STANDARD' AND full_name='Control Owner'""")


def downgrade():
    raise RuntimeError('Reference labels may have been edited since deployment. Use a reviewed forward migration.')
