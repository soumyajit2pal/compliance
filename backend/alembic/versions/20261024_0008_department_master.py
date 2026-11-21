"""Retained revision for the original department catalogue, retired from seeding."""

revision = "20261024_0008"
down_revision = "20261017_0007"
branch_labels = depends_on = None


def upgrade():
    # Earlier installs may already hold these departments and related assignments.
    # Keep this ledger revision without inserting or changing organisation records.
    pass


def downgrade():
    raise RuntimeError("Departments may be referenced by business history; destructive downgrade is blocked.")
