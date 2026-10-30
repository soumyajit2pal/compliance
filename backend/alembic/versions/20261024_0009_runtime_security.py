"""Server-side sessions, login throttling and QA-style LDAP onboarding/configuration."""
from alembic import op
import sqlalchemy as sa

revision = "20261024_0009"
down_revision = "20261024_0008"
branch_labels = depends_on = None


def upgrade():
    for flag in ['needs_email_confirmation_flag', 'needs_department_selection_flag']:
        op.add_column('cbd_user', sa.Column(flag, sa.Integer(), nullable=False, server_default=sa.text('0')))
        op.create_check_constraint('ck_user_'+flag[:10], 'cbd_user', flag+' IN (0,1)')
    # Explicit frozen definitions, following the existing Core naming convention.
    from hashlib import sha1
    def named(kind, table, columns):
        value = f"{kind}_{table}_{columns}"
        prefix = {"primarykey": "pk", "unique": "uq", "foreignkey": "fk"}[kind]
        return prefix + "_" + value[:18] + "_" + sha1(value.encode()).hexdigest()[:8]
    for name, fields, uniques in [
        ("app_session", [sa.Column("user_id", sa.String(36), nullable=False),
          sa.Column("token_hash", sa.String(64), nullable=False), sa.Column("csrf_token", sa.String(100), nullable=False),
          sa.Column("expires_at", sa.DateTime(), nullable=False), sa.Column("last_seen_at", sa.DateTime(), nullable=False),
          sa.Column("revoked_flag", sa.Integer(), server_default=sa.text("0"), nullable=False)], [("token_hash",)]),
        ("login_attempt", [sa.Column("identity_hash", sa.String(64), nullable=False),
          sa.Column("address_hash", sa.String(64), nullable=False),
          sa.Column("succeeded_flag", sa.Integer(), nullable=False),
          sa.Column("attempted_at", sa.DateTime(), nullable=False)], []),
        ("directory_configuration", [sa.Column("code", sa.String(40), nullable=False),
          sa.Column("configuration", sa.Text(), nullable=False), sa.Column("secret_cipher", sa.Text(), nullable=True)],
          [("code",)]),
    ]:
        table = "cbd_" + name
        constraints = [sa.PrimaryKeyConstraint("id", name=named("primarykey", table, "id"))]
        for cols in uniques:
            constraints.append(sa.UniqueConstraint(*cols, name=named("unique", table, "_".join(cols))))
        if name == "app_session":
            constraints.append(sa.ForeignKeyConstraint(["user_id"], ["cbd_user.id"],
              name=named("foreignkey", table, "user_id_cbd_user.id")))
        flag = "succeeded_flag" if name == "login_attempt" else "revoked_flag" if name == "app_session" else None
        if flag:
            constraints.append(sa.CheckConstraint(f"{flag} IN (0,1)", name="ck_"+name[:12]+"_"+flag[:10]))
        op.create_table(table, sa.Column("id", sa.String(36), nullable=False,
            server_default=sa.text("LOWER(RAWTOHEX(SYS_GUID()))")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("SYSTIMESTAMP")),
            *fields, *constraints)
        if name == "app_session":
            digest = sha1((table+"user_id").encode()).hexdigest()[:8]
            op.create_index("ix_"+table[4:18]+"_"+digest, table, ["user_id"])


def downgrade():
    raise RuntimeError("Retained authentication history cannot be destructively downgraded.")
