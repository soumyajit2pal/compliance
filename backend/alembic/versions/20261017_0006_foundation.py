"""Consolidated database foundation with the approved organisation/access seed.

Revision 0006 is the existing UAT checkpoint and the fresh-install baseline.
Earlier installation revisions have been consolidated into frozen foundation
modules. Existing UAT upgrades directly from this checkpoint to revision 0007.
"""
from backend.alembic.foundation import access, integrity, references, schema

revision = "20261017_0006"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    access._password()  # Validate the environment secret before any Oracle DDL.
    schema.install()
    references.install()
    integrity.install()
    access.install()


def downgrade():
    raise RuntimeError("The foundation contains retained compliance records; use a reviewed forward migration.")
