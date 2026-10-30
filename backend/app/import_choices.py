"""Current database values for an authorised import download; no seed fallback."""
from collections import defaultdict
from datetime import date
from typing import get_args
import sqlalchemy as sa
from . import models as m
from .access import Actor
from .schemas import InstrumentInput

MATERIALITY_CODES = get_args(InstrumentInput.model_fields['materiality'].annotation)


def current_master(row):
    today = date.today()
    return (row.get('active_flag', 1) and
            (not row.get('effective_from') or row['effective_from'] <= today) and
            (not row.get('effective_to') or row['effective_to'] > today))


def materiality_code(db, value):
    query = sa.select(m.risk_category).where(m.risk_category.c.active_flag == 1,
        m.risk_category.c.code.in_(MATERIALITY_CODES))
    rows = db.execute(query.where(sa.or_(sa.func.upper(m.risk_category.c.code) == value.upper(),
        sa.func.upper(m.risk_category.c.name) == value.upper()))).mappings().all()
    return rows[0]['code'] if len(rows) == 1 else None


def database_choices(db, actor):
    """Return names from this request's database transaction, never a cached list."""
    def names(table, draft_domains=False, materiality=False):
        query = sa.select(table).order_by(sa.func.upper(table.c.name), table.c.code)
        if materiality:
            query = query.where(table.c.code.in_(MATERIALITY_CODES))
        rows = db.execute(query).mappings()
        # Domain active_flag controls review submission. Draft-only domains remain
        # valid classifications for Draft creation, matching the portal workflow.
        return [row['name'] for row in rows if draft_domains or current_master(row)]

    all_units = {row['id']: dict(row) for row in db.execute(sa.select(m.organisational_unit)).mappings()}
    units = [row for row in all_units.values() if current_master(row)
        and actor.covers(row['id'], {'AUTHOR', 'REVIEWER'})]
    today = date.today()
    grants = db.execute(sa.select(m.user_role, m.role.c.code.label('role_code'))
        .join(m.role, m.role.c.id == m.user_role.c.role_id)
        .where(m.role.c.code == 'AUTHOR', m.role.c.active_flag == 1,
            m.user_role.c.effective_from <= today,
            sa.or_(m.user_role.c.effective_to.is_(None), m.user_role.c.effective_to > today))).mappings()
    per_user = defaultdict(list)
    for grant in grants:
        per_user[grant['user_id']].append(dict(grant))
    owners = []
    for user in db.execute(sa.select(m.user).where(m.user.c.active_flag == 1,
            m.user.c.needs_email_confirmation_flag == 0, m.user.c.needs_department_selection_flag == 0)
            .order_by(sa.func.upper(m.user.c.full_name), m.user.c.username)).mappings():
        candidate = Actor(dict(user), per_user.get(user['id'], []), all_units)
        if any(candidate.covers(unit['id'], {'AUTHOR'}) for unit in units):
            owners.append(f"{user['full_name']} ({user['username']})")
    return {
        'Regulator': names(m.regulator),
        'Primary regulatory domain': names(m.regulatory_domain, draft_domains=True),
        'Additional affected domains': names(m.regulatory_domain, draft_domains=True),
        'Instrument type': names(m.instrument_type),
        'Materiality': names(m.risk_category, materiality=True),
        'Confidentiality': names(m.confidentiality_class),
        'Regulatory owner department': sorted([unit['name'] for unit in units], key=str.casefold),
        'Interpretation owner': owners,
    }
