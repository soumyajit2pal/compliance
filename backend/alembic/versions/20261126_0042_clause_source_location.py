"""Widen the clause source location and retain its search index."""
from alembic import op
import sqlalchemy as sa

revision = '20261126_0042'
down_revision = '20261126_0041'
branch_labels = depends_on = None


def upgrade():
    op.execute(sa.DDL("""
        DECLARE
            location_length NUMBER;
            index_present NUMBER;
            create_index CONSTANT VARCHAR2(200) :=
                'CREATE INDEX ix_cbd_cls_find_page ON cbd_regulatory_clause (UPPER(source_page_reference))';
        BEGIN
            SELECT char_length INTO location_length FROM user_tab_columns
                WHERE table_name = 'CBD_REGULATORY_CLAUSE' AND column_name = 'SOURCE_PAGE_REFERENCE';
            SELECT COUNT(*) INTO index_present FROM user_indexes WHERE index_name = 'IX_CBD_CLS_FIND_PAGE';
            IF location_length < 1200 THEN
                IF index_present > 0 THEN
                    EXECUTE IMMEDIATE 'DROP INDEX ix_cbd_cls_find_page';
                    index_present := 0;
                END IF;
                BEGIN
                    EXECUTE IMMEDIATE 'ALTER TABLE cbd_regulatory_clause MODIFY (source_page_reference VARCHAR2(1200 CHAR))';
                EXCEPTION WHEN OTHERS THEN
                    EXECUTE IMMEDIATE create_index;
                    RAISE;
                END;
            END IF;
            IF index_present = 0 THEN
                EXECUTE IMMEDIATE create_index;
            END IF;
            FOR invalid_trigger IN (
                SELECT object_name FROM user_objects
                    WHERE object_type = 'TRIGGER' AND status = 'INVALID' AND object_name IN (
                        SELECT trigger_name FROM user_triggers WHERE table_name = 'CBD_REGULATORY_CLAUSE'
                        UNION
                        SELECT name FROM user_dependencies WHERE type = 'TRIGGER'
                            AND referenced_owner = USER AND referenced_type = 'TABLE'
                            AND referenced_name = 'CBD_REGULATORY_CLAUSE'
                    )
            ) LOOP
                EXECUTE IMMEDIATE 'ALTER TRIGGER '
                    || DBMS_ASSERT.ENQUOTE_NAME(invalid_trigger.object_name, FALSE) || ' COMPILE';
            END LOOP;
        END;
    """))


def downgrade():
    raise RuntimeError('Long source locations are retained. Use a reviewed forward migration.')
