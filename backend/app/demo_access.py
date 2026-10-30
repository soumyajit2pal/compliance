"""Persistent UAT demo choices, with autofill for known public passwords only.

Completing first sign-in or choosing a private password does not hide an account.
Private passwords remain hashed and must be entered manually. No credential or
first-sign-in flag is changed by listing/selecting an account.
"""
from datetime import date
import sqlalchemy as sa
from . import models as m
from .reference_data import ROLE_SEED_USERS
from .security import verify_password

DEMO_PASSWORD = 'Password@1234'
# Both values have been publicly documented for these UAT demo accounts. Never
# disclose a deployment's configured SEED_USER_PASSWORD or attempt to recover it.
PUBLIC_DEMO_PASSWORDS = tuple(dict.fromkeys((DEMO_PASSWORD, 'Password@1234')))


def available_demo_users(db):
    reserved = [row[0] for row in ROLE_SEED_USERS]
    rows = db.execute(sa.select(m.user, m.organisational_unit.c.name.label('department'))
        .outerjoin(m.organisational_unit, m.user.c.org_unit_id == m.organisational_unit.c.id)
        .where(m.user.c.username.in_(reserved), m.user.c.login_type == 'STANDARD',
            m.user.c.active_flag == 1)).mappings().all()
    eligible = {row['id']: row for row 
    in rows}
    if not eligible:
        return []
    grants = db.execute(sa.select(m.user_role.c.user_id, m.role.c.name, m.role.c.code,
            m.user_role.c.global_scope_flag, m.organisational_unit.c.name.label('scope'))
        .join(m.role, m.role.c.id == m.user_role.c.role_id)
        .outerjoin(m.organisational_unit, m.organisational_unit.c.id == m.user_role.c.scope_org_unit_id)
        .where(m.user_role.c.user_id.in_(eligible),
            m.role.c.active_flag == 1, m.user_role.c.effective_from <= date.today(),
            sa.or_(m.user_role.c.effective_to.is_(None), m.user_role.c.effective_to > date.today()))).mappings().all()
    result = []
    for username in reserved:
        user = next((u for u in eligible.values() if u['username'] == username), None)
        if not user:
            continue
        assignments = [g for g in grants if g['user_id'] == user['id']]
        if not assignments:
            continue
        password = next((value for value in PUBLIC_DEMO_PASSWORDS
            if verify_password(value, user['password_hash'])), None)
        choice = {'username': username, 'full_name': user['full_name'],
            'department': user['department'], 'roles': [g['code'] for g in assignments],
            'scope': '; '.join(f"{g['name']} · {'Global' if g['global_scope_flag'] else g['scope'] or 'Unassigned'}" for g in assignments),
            'must_change_password': bool(user['must_change_password_flag']),
            'password_autofill_available': password is not None}
        if password is not None:
            choice['password'] = password
        result.append(choice)
    return result
