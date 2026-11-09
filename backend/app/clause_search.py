"""Search clause identifiers and wording through separate Oracle index paths."""
import sqlalchemy as sa

from . import models as m

clause = m.regulatory_clause
edition = m.instrument_version
instrument = m.regulatory_instrument
wording = (clause.c.heading, clause.c.clause_text, clause.c.internal_interpretation)


def _escaped_term(value):
    return '{' + value.replace('\\', '\\\\').replace('}', '}}') + '}'


def wording_expression(query, *, phrase=False):
    """Treat user input as text, with no user-supplied Oracle Text operators."""
    terms = [term for term in query.split() if any(character.isalnum() for character in term)]
    if not terms:
        return None
    return _escaped_term(' '.join(terms)) if phrase else ' AND '.join(map(_escaped_term, terms))


def _prefix(query):
    return query.upper().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def _like(column, pattern):
    return sa.func.upper(column).like(pattern, escape='\\')


def _literal(column, query):
    return sa.func.instr(sa.func.lower(column), query.lower()) > 0


def literal_match(query):
    return sa.or_(*(_literal(column, query) for column in wording))


def wording_branches(base, columns, query, *, phrase=False):
    expression = wording_expression(query, phrase=phrase)
    if not expression:
        return []
    return [base.where(sa.func.contains(column, expression, sa.literal_column(str(label))) > 0)
            for label, column in enumerate(columns, start=1)]


def candidate_ids(query, search_type, filters):
    """Keep separate indexable SELECTs so an OR with a scan cannot hide CONTAINS."""
    base = sa.select(clause.c.id).where(*filters)
    branches = []
    if search_type in {'keyword', 'phrase'}:
        branches.extend(wording_branches(base, wording, query, phrase=search_type == 'phrase'))
    if search_type in {'keyword', 'reference'}:
        pattern = _prefix(query)
        branches.extend(base.where(_like(column, pattern))
                        for column in (clause.c.code, clause.c.source_clause_reference, clause.c.source_page_reference))
        alias = m.business_code_alias
        branches.append(sa.select(alias.c.clause_id).where(alias.c.clause_id.is_not(None), _like(alias.c.legacy_code, pattern)))
        instrument_editions = sa.select(edition.c.id).join(instrument, instrument.c.id == edition.c.instrument_id)
        for column in (instrument.c.code, instrument.c.official_reference_number):
            branches.append(base.where(clause.c.instrument_version_id.in_(instrument_editions.where(_like(column, pattern)))))
        if search_type == 'keyword':
            # Instrument names and their master labels are searched in the small metadata tables.
            metadata = instrument_editions.join(m.regulator, m.regulator.c.id == instrument.c.regulator_id).join(
                m.regulatory_domain, m.regulatory_domain.c.id == instrument.c.primary_domain_id,
            ).where(sa.or_(*(_literal(column, query) for column in (
                instrument.c.title, instrument.c.short_title, m.regulator.c.code, m.regulator.c.name, m.regulatory_domain.c.name,
            ))))
            branches.append(base.where(clause.c.instrument_version_id.in_(metadata)))
    if not branches:
        return base.where(sa.false())
    return sa.union_all(*branches)
