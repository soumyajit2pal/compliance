"""Add independently approved metadata corrections for approved instruments."""
from alembic import op
import sqlalchemy as sa

revision = "20261025_0011"
down_revision = "20261024_0010"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "cbd_metadata_correction",
        sa.Column("id", sa.String(36), nullable=False,
                  server_default=sa.text("LOWER(RAWTOHEX(SYS_GUID()))")),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("SYSTIMESTAMP")),
        sa.Column("instrument_id", sa.String(36), nullable=False),
        sa.Column("before_values_json", sa.Text(), nullable=False),
        sa.Column("proposed_values_json", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("reviewer_id", sa.String(36), nullable=False),
        sa.Column("approver_id", sa.String(36), nullable=False),
        sa.Column("correction_status", sa.String(40), nullable=False,
                  server_default=sa.text("'IN_REVIEW'")),
        sa.Column("reviewed_by", sa.String(36), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("approved_by", sa.String(36), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_primarykey_cbd_met_70a18053"),
        sa.ForeignKeyConstraint(["instrument_id"], ["cbd_regulatory_instrument.id"],
                                name="fk_foreignkey_cbd_met_9228138a"),
        sa.ForeignKeyConstraint(["created_by"], ["cbd_user.id"],
                                name="fk_foreignkey_cbd_met_ca0850f6"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["cbd_user.id"],
                                name="fk_foreignkey_cbd_met_9e25af96"),
        sa.ForeignKeyConstraint(["approver_id"], ["cbd_user.id"],
                                name="fk_foreignkey_cbd_met_e1e76655"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["cbd_user.id"],
                                name="fk_foreignkey_cbd_met_67828ba4"),
        sa.ForeignKeyConstraint(["approved_by"], ["cbd_user.id"],
                                name="fk_foreignkey_cbd_met_5fc2c76b"),
        sa.CheckConstraint(
            "correction_status IN ('IN_REVIEW','REVIEWED','APPROVED','RETURNED','REJECTED','WITHDRAWN')",
            name="ck_correction_status_26"),
        sa.CheckConstraint(
            "correction_status <> 'APPROVED' OR (reviewed_by IS NOT NULL AND approved_by IS NOT NULL "
            "AND reviewed_at IS NOT NULL AND approved_at IS NOT NULL "
            "AND created_by <> reviewed_by AND created_by <> approved_by "
            "AND reviewed_by <> approved_by)",
            name="ck_metadata_correction_approve"),
    )
    for name, field in [
        ("ix_metadata_corre_3172e476", "instrument_id"),
        ("ix_metadata_corre_9d1f037b", "created_by"),
        ("ix_metadata_corre_bb8ef5db", "reviewer_id"),
        ("ix_metadata_corre_4248884c", "approver_id"),
        ("ix_metadata_corre_9ad8d942", "reviewed_by"),
        ("ix_metadata_corre_a3d867eb", "approved_by"),
    ]:
        op.create_index(name, "cbd_metadata_correction", [field])

    op.execute(sa.DDL("""CREATE OR REPLACE TRIGGER cbd_retain_metadata_corr
      BEFORE UPDATE OR DELETE ON cbd_metadata_correction FOR EACH ROW
      BEGIN
        IF DELETING THEN
          RAISE_APPLICATION_ERROR(-20080,'Metadata correction history must be retained.');
        END IF;
        IF UPDATING AND (
          :OLD.id <> :NEW.id OR :OLD.instrument_id <> :NEW.instrument_id OR
          DBMS_LOB.COMPARE(:OLD.before_values_json,:NEW.before_values_json) <> 0 OR
          DBMS_LOB.COMPARE(:OLD.proposed_values_json,:NEW.proposed_values_json) <> 0 OR
          DBMS_LOB.COMPARE(:OLD.reason,:NEW.reason) <> 0 OR
          :OLD.created_by <> :NEW.created_by OR :OLD.reviewer_id <> :NEW.reviewer_id OR
          :OLD.approver_id <> :NEW.approver_id OR :OLD.created_at <> :NEW.created_at
        ) THEN
          RAISE_APPLICATION_ERROR(-20080,'Submitted metadata correction values are immutable.');
        END IF;
      END;"""))


def downgrade():
    raise RuntimeError("Approved metadata correction history cannot be destructively downgraded.")
