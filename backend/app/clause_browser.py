"""Bounded browsing reads. The legacy clause catalogue still serves authoring integrations."""
from collections import deque
from typing import Literal

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Query

from .bank_time import today as bank_today
from . import business_ids, clause_search, models as m, repository as repo
from .access import READ_ROLES
from .pagination import paginate, page_metadata
from .table_filters import column_choices, column_predicate, column_query, fields, label, version

PAGE_SIZE = 25
clause = m.regulatory_clause
edition = m.instrument_version
instrument = m.regulatory_instrument
parent = clause.alias('browse_parent')
child = clause.alias('browse_child')
summary_fields = ('id', 'code', 'instrument_version_id', 'parent_clause_id',
                  'heading', 'source_clause_reference', 'source_page_reference', 'approval_status')


def _ids(column, identifiers):
    return sa.or_(sa.false(), *(column.in_(identifiers[i:i+900]) for i in range(0, len(identifiers), 900)))


def _current_editions(visible_ids):
    today = bank_today()
    ranked = sa.select(edition.c.id, sa.func.row_number().over(
        partition_by=edition.c.instrument_id,
        order_by=(
            sa.case((edition.c.id == instrument.c.current_version_id, 0), else_=1),
            edition.c.effective_from.desc(), edition.c.version_date.desc(),
            # Canonical versions use major.minor. Split the numbers for numeric tie-breaking.
            sa.func.to_number(sa.func.regexp_substr(edition.c.version_number, '^[0-9]+')).desc().nulls_last(),
            sa.func.to_number(sa.func.ltrim(sa.func.regexp_substr(edition.c.version_number, '[.][0-9]+$'), '.')).desc().nulls_last(),
            edition.c.created_at.desc(), edition.c.id,
        ),
    ).label('position')).join(instrument, instrument.c.id == edition.c.instrument_id).where(
        _ids(edition.c.instrument_id, visible_ids), edition.c.approval_status == 'APPROVED',
        edition.c.effective_from <= today,
        sa.or_(edition.c.effective_to.is_(None), edition.c.effective_to > today),
    ).subquery()
    return sa.select(ranked.c.id).where(ranked.c.position == 1)


def _query(full=False):
    fields = list(clause.c) if full else [clause.c[key] for key in summary_fields]
    cancelled = sa.exists(sa.select(1).select_from(m.audit_log).where(
        m.audit_log.c.entity_id == edition.c.id, m.audit_log.c.entity_type == 'version',
        m.audit_log.c.action == 'DRAFT_CANCELLED',
    ))
    has_children = sa.exists(sa.select(1).select_from(child).where(
        child.c.parent_clause_id == clause.c.id, child.c.instrument_version_id == clause.c.instrument_version_id,
    ))
    return sa.select(*fields, edition.c.instrument_id, edition.c.version_number,
        edition.c.approval_status.label('version_approval_status'),
        edition.c.effective_from.label('version_effective_from'), edition.c.effective_to.label('version_effective_to'),
        sa.case((cancelled, 1), else_=0).label('version_cancelled_draft'),
        sa.case((has_children, 1), else_=0).label('has_children'),
        instrument.c.code.label('instrument_code'), instrument.c.title.label('instrument_title'),
        instrument.c.short_title.label('instrument_short_title'), parent.c.code.label('parent_code'),
    ).join(edition, edition.c.id == clause.c.instrument_version_id).join(
        instrument, instrument.c.id == edition.c.instrument_id,
    ).outerjoin(parent, sa.and_(parent.c.id == clause.c.parent_clause_id,
        parent.c.instrument_version_id == clause.c.instrument_version_id))


def _ancestors(db, rows):
    """Read one frontier at a time so a page shares parents and their metadata."""
    by_id = {row['id']: row for row in rows}
    frontier = rows
    while frontier:
        needed = {(row['parent_clause_id'], row['instrument_version_id']) for row in frontier
                  if row['parent_clause_id'] and row['parent_clause_id'] not in by_id}
        if not needed:
            break
        frontier = [dict(row) for row in db.execute(_query().where(
            sa.tuple_(clause.c.id, clause.c.instrument_version_id).in_(list(needed)),
        )).mappings()]
        by_id.update((row['id'], row) for row in frontier)
    paths = {}
    for row in rows:
        path = []
        seen = {row['id']}
        parent_row = by_id.get(row['parent_clause_id'])
        while parent_row and parent_row['instrument_version_id'] == row['instrument_version_id'] and parent_row['id'] not in seen:
            seen.add(parent_row['id'])
            path.append(parent_row)
            parent_row = by_id.get(parent_row['parent_clause_id'])
        paths[row['id']] = list(reversed(path))
    return paths


def annotate_search_rows(db, rows):
    mark_current(db, rows)
    paths = _ancestors(db, rows)
    for row in rows:
        row['parent_path'] = [
            item['source_clause_reference'] or item['heading'] or item['code'] for item in paths[row['id']]
        ]


def edition_text(row):
    status = row['version_approval_status']
    if row['version_is_effective_current']:
        display = 'Current approved'
    elif row['version_cancelled_draft']:
        display = 'Cancelled draft'
    elif status == 'APPROVED' and row['version_effective_from'] > bank_today():
        display = 'Approved Future effective'
    elif status == 'APPROVED' and row['version_effective_to'] and row['version_effective_to'] <= bank_today():
        display = 'Approved Historical'
    else:
        display = label(status)
    return 'v' + version(row['version_number']), display


CLAUSE_COLUMNS = {
    'clause': fields('code','heading','source_clause_reference'),
    'instrument': fields('instrument_code','instrument_short_title','instrument_title'),
    'source_edition': edition_text,
    'parent_path': lambda row:' → '.join(row['parent_path']) or 'Top level',
    'page': fields('source_page_reference'),
    'clause_approval': lambda row:label(row['approval_status']),
}


def matching_clause_rows(db, statement, order, includes, required):
    with db.execute(statement.order_by(*order)) as result:
        for partition in result.mappings().partitions(100):
            rows = [dict(row) for row in partition]
            if 'parent_path' in required:
                annotate_search_rows(db, rows)
            elif 'source_edition' in required:
                mark_current(db, rows)
            yield from (row for row in rows if includes is None or includes(row))


def register_page(db, statement, order, page, size, columns):
    includes = column_predicate(columns, CLAUSE_COLUMNS)
    option = getattr(columns, 'options_for', '')
    if option:
        source = matching_clause_rows(db, statement, order, includes, {*columns, option})
        return column_choices(source, option, CLAUSE_COLUMNS)
    if includes:
        total = 0
        offset = (page - 1) * size
        items = []
        tail = deque(maxlen=size)
        for row in matching_clause_rows(db, statement, order, includes, columns):
            if offset <= total < offset + size:
                items.append(row)
            tail.append(row)
            total += 1
        info = page_metadata(total, page, size)
        if total and info['page'] < page:
            items = list(tail)[-(info['end'] - info['start'] + 1):]
        if 'parent_path' not in columns:
            annotate_search_rows(db, items)
        return {'items': items, 'pagination': info}

    total = db.execute(sa.select(sa.func.count()).select_from(statement.subquery())).scalar_one()
    info = page_metadata(total, page, size)
    rows = [dict(row) for row in db.execute(statement.order_by(*order)
            .offset((info['page'] - 1) * size).limit(size)).mappings()] if total else []
    annotate_search_rows(db, rows)
    return {'items': rows, 'pagination': info}


def browse(db, actor, instrument_id, edition_filter, parent_id, mode, query, status, page, search_type,
           page_size=None, columns=None):
    actor.require(READ_ROLES)
    query = query.strip()
    paged_register = mode == 'search' and page_size is not None
    option = getattr(columns, 'options_for', '')
    empty = (column_choices([], option, CLAUSE_COLUMNS) if paged_register and option else
             paginate([], page, page_size) if paged_register else {'items': [], 'next_page': None})
    if mode == 'search' and query and search_type == 'literal' and (
        instrument_id == 'all' or edition_filter in {'all', 'current'}
    ):
        raise HTTPException(422, 'Choose a specific source edition for exact wording search.')
    if instrument_id == 'all' and (mode == 'tree' or not (query or status)):
        return empty
    if instrument_id == 'all' and edition_filter not in {'current', 'all'}:
        return empty
    if instrument_id != 'all':
        repo.read_instrument(db, actor, instrument_id)
    visible_ids = [instrument_id] if instrument_id != 'all' else [row['id'] for row in repo.listing(db, actor, {})]
    if not visible_ids:
        return empty
    statement = _query().where(_ids(edition.c.instrument_id, visible_ids))
    clause_scope = clause.c.instrument_version_id.in_(sa.select(edition.c.id).where(_ids(edition.c.instrument_id, visible_ids)))
    if edition_filter == 'current':
        clause_scope = clause.c.instrument_version_id.in_(_current_editions(visible_ids))
    elif edition_filter != 'all':
        clause_scope = clause.c.instrument_version_id == edition_filter
    if edition_filter != 'all':
        statement = statement.where(clause_scope)
    if mode == 'tree':
        statement = statement.where(parent.c.id == parent_id if parent_id else parent.c.id.is_(None))
        order = (clause.c.sequence_number, clause.c.code, clause.c.id)
    else:
        search_filters = [clause_scope]
        if status:
            approval = clause.c.approval_status == status
            statement = statement.where(approval)
            search_filters.append(approval)
        if query:
            if search_type == 'literal':
                statement = statement.where(clause_search.literal_match(query))
            else:
                statement = statement.where(clause.c.id.in_(clause_search.candidate_ids(query, search_type, search_filters)))
        order = (instrument.c.title, instrument.c.id, edition.c.version_date.desc(),
                 clause.c.sequence_number, clause.c.code, clause.c.id)
    if paged_register:
        return register_page(db, statement, order, page, page_size, columns if columns is not None else {})
    rows = [dict(row) for row in db.execute(statement.order_by(*order)
            .offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE + 1)).mappings()]
    items = rows[:PAGE_SIZE]
    if mode == 'search':
        annotate_search_rows(db, items)
    else:
        mark_current(db, items)
    return {'items': items, 'next_page': page + 1 if len(rows) > PAGE_SIZE else None}


def mark_current(db, rows):
    if rows:
        current_ids = set(db.execute(_current_editions(sorted({row['instrument_id'] for row in rows}))).scalars())
        for row in rows:
            row['version_is_effective_current'] = row['instrument_version_id'] in current_ids


def detail(db, actor, identifier):
    from .clause_interpretations import apply_approved
    actor.require(READ_ROLES)
    # Check source scope before selecting either text column.
    source = db.execute(sa.select(clause.c.instrument_version_id).where(clause.c.id == identifier)).scalar_one_or_none()
    if not source:
        raise HTTPException(404, 'Clause not found in your authorised area.')
    version, owner = repo.read_version(db, actor, source)
    opened = db.execute(_query(full=True).where(clause.c.id == identifier,
        clause.c.instrument_version_id == source)).mappings().first()
    if not opened:
        raise HTTPException(404, 'Clause not found in your authorised area.')
    row = dict(opened)
    apply_approved(db, [row])
    row['legacy_codes'] = business_ids.aliases(db, 'clause', [identifier]).get(identifier, [])
    carry = db.execute(sa.select(m.clause_carry_forward).where(
        m.clause_carry_forward.c.target_clause_id == identifier,
        m.clause_carry_forward.c.target_version_id == source,
    )).mappings().first()
    original = None
    if carry:
        previous = db.execute(_query().where(clause.c.id == carry['source_clause_id'],
            edition.c.instrument_id == owner['id'])).mappings().first()
        if previous:
            original = dict(previous)
    document_id = version['source_document_id']
    document = db.execute(sa.select(m.document.c.file_name).where(m.document.c.id == document_id)).scalar_one_or_none() if document_id else None
    ancestors = _ancestors(db, [row])[identifier]
    mark_current(db, [*ancestors, row] + ([original] if original else []))
    return {'clause': row, 'ancestors': ancestors, 'edition': version,
            'owner_unit_id': owner['regulatory_owner_unit_id'], 'source_document': {'id': document_id, 'name': document} if document else None,
            'provenance': dict(carry) if carry else None, 'original': original}


def install(app, get_db, current):
    @app.get('/api/clause-browser')
    def listing(instrument: str = Query('all', max_length=36), edition: str = Query('all', max_length=36),
                parent: str | None = Query(None, max_length=36), mode: Literal['tree', 'search'] = 'tree',
                search_type: Literal['keyword', 'phrase', 'reference', 'literal'] = 'keyword',
                q: str = Query('', max_length=200), status: str = Query('', max_length=30),
                page: int = Query(1, ge=1, le=1_000_000), page_size: int | None = Query(None, ge=1, le=100),
                columns=Depends(column_query), db=Depends(get_db), actor=Depends(current)):
        return browse(db, actor, instrument, edition, parent, mode, q, status, page, search_type, page_size, columns)

    @app.get('/api/clause-browser/{identifier}')
    def read(identifier: str, db=Depends(get_db), actor=Depends(current)):
        return detail(db, actor, identifier)
