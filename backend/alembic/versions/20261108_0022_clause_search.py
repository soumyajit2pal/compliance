"""Oracle Text for clause wording, with separate case-insensitive reference indexes."""
from alembic import context, op
import sqlalchemy as sa

revision = '20261108_0022'
down_revision = '20261102_0021'
branch_labels = depends_on = None

TEXT_INDEXES = {
    'cbd_cls_wording_ctx': 'clause_text',
    'cbd_cls_interpretation_ctx': 'internal_interpretation',
    'cbd_cls_heading_ctx': 'heading',
}
REFERENCE_INDEXES = {
    'ix_cbd_cls_find_code': ('cbd_regulatory_clause', 'code'),
    'ix_cbd_cls_find_number': ('cbd_regulatory_clause', 'source_clause_reference'),
    'ix_cbd_cls_find_page': ('cbd_regulatory_clause', 'source_page_reference'),
    'ix_cbd_cls_find_legacy': ('cbd_business_code_alias', 'legacy_code'),
    'ix_cbd_ins_find_code': ('cbd_regulatory_instrument', 'code'),
    'ix_cbd_ins_find_reference': ('cbd_regulatory_instrument', 'official_reference_number'),
}
TEXT_OPTIONS = 'FILTER CTXSYS.NULL_FILTER STOPLIST CTXSYS.EMPTY_STOPLIST MAINTENANCE MANUAL SYNC (ON COMMIT) TRANSACTIONAL'


def _existing(bind, name, table, column, domain):
    parameters = {'name': name.upper()}
    row = bind.execute(sa.text(
        'SELECT table_name, index_type, status, ityp_owner, ityp_name, domidx_status, domidx_opstatus '
        'FROM user_indexes WHERE index_name = :name'
    ), parameters).mappings().first()
    if row is None:
        return False
    valid_type = (row['index_type'] == 'DOMAIN' and row['ityp_owner'] == 'CTXSYS' and row['ityp_name'] == 'CONTEXT'
                  and row['domidx_status'] == row['domidx_opstatus'] == 'VALID') if domain else row['index_type'] == 'FUNCTION-BASED NORMAL'
    if domain:
        indexed = bind.execute(sa.text(
            'SELECT column_name FROM user_ind_columns WHERE index_name = :name AND column_position = 1'
        ), parameters).scalar_one_or_none()
        valid_column = indexed == column.upper()
    else:
        expression = bind.execute(sa.text(
            'SELECT column_expression FROM user_ind_expressions WHERE index_name = :name AND column_position = 1'
        ), parameters).scalar_one_or_none()
        valid_column = bool(expression and expression.replace('"', '').replace(' ', '').upper() == f'UPPER({column.upper()})')
    if row['table_name'] != table.upper() or row['status'] != 'VALID' or not valid_type or not valid_column:
        raise RuntimeError(f'Index {name} exists with an unexpected definition or status. Inspect it before retrying.')
    return True


def upgrade():
    bind = None if context.is_offline_mode() else op.get_bind()
    if bind is not None and not bind.execute(sa.text(
        "SELECT 1 FROM all_indextypes WHERE owner='CTXSYS' AND indextype_name='CONTEXT'"
    )).first():
        raise RuntimeError('Oracle Text CTXSYS.CONTEXT must be available in this PDB before applying this revision.')
    for name, column in TEXT_INDEXES.items():
        if bind is None or not _existing(bind, name, 'cbd_regulatory_clause', column, True):
            op.execute(sa.DDL(f"CREATE INDEX {name} ON cbd_regulatory_clause ({column}) "
                              f"INDEXTYPE IS CTXSYS.CONTEXT FILTER BY instrument_version_id PARAMETERS ('{TEXT_OPTIONS}')"))
        if bind is not None:
            if not _existing(bind, name, 'cbd_regulatory_clause', column, True):
                raise RuntimeError(f'Oracle Text index {name} is missing after creation.')
            if bind.execute(sa.text(
                'SELECT 1 FROM ctx_user_index_errors WHERE err_index_name = :name FETCH FIRST 1 ROWS ONLY'
            ), {'name': name.upper()}).first():
                raise RuntimeError(f'Oracle Text index {name} reports indexing errors. Inspect CTX_USER_INDEX_ERRORS before retrying.')
    for name, (table, column) in REFERENCE_INDEXES.items():
        if bind is None or not _existing(bind, name, table, column, False):
            op.execute(sa.DDL(f'CREATE INDEX {name} ON {table} (UPPER({column}))'))


def downgrade():
    for name in reversed([*TEXT_INDEXES, *REFERENCE_INDEXES]):
        op.execute(sa.DDL(f'DROP INDEX {name}'))
