"""Admin-managed shortcuts to independently authorised applications."""
from urllib.parse import urlsplit

import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from .events import audit, new_id
from .models import application_link
from .repository import one


def list_links(db, actor):
    table = application_link
    rows = [dict(row) for row in db.execute(sa.select(table).order_by(table.c.name, table.c.code)).mappings()]
    for row in rows:
        row['configured'] = bool(row['url'])
        if not row['active_flag'] and 'ADMIN' not in actor.roles:
            row['url'] = None
    return rows


def validated(values):
    address = values['url'] or None
    if address:
        try:
            url = urlsplit(address)
            valid = (url.scheme == 'https' and url.hostname and url.username is None and url.password is None
                     and not any(char.isspace() or ord(char) < 32 or ord(char) == 127 or char == '\\' for char in address))
            _ = url.port
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(422, 'Enter a bank-approved HTTPS address without embedded credentials.')
    if values['active_flag'] and not address:
        raise HTTPException(422, 'Add the approved HTTPS address before making the application available.')
    values['url'] = address
    values['description'] = values.get('description') or ' '
    return values


def snapshot(row):
    # The launcher URL can carry internal parameters. Keep its configuration state
    # in the retained change record without duplicating the address or description.
    return {'name': row['name'], 'code': row['code'],
            'status': 'AVAILABLE' if row['active_flag'] and row['url'] else 'INACTIVE' if row['url'] else 'CONFIGURATION_PENDING'}


def create(db, actor, payload):
    actor.require({'ADMIN'})
    row = validated(payload.model_dump())
    row.update(id=new_id(), code=row['code'].upper())
    try:
        db.execute(application_link.insert().values(**row))
    except IntegrityError as exc:
        if db.execute(sa.select(application_link.c.id).where(application_link.c.code == row['code'])).first():
            raise HTTPException(409, 'An application already uses that code.') from exc
        raise
    audit(db, actor, 'application_link', row['id'], 'APPLICATION_ADDED', new=snapshot(row))
    return {'id': row['id']}


def update(db, actor, identifier, payload):
    actor.require({'ADMIN'})
    old = one(db, application_link, identifier, lock=True)
    changes = payload.model_dump(exclude_unset=True)
    if any(changes.get(key, True) is None for key in ('name', 'active_flag')):
        raise HTTPException(422, 'Enter the application name and choose whether it is available.')
    row = validated({**old, **changes})
    changes = {key: row[key] for key in changes if old[key] != row[key]}
    if changes:
        db.execute(application_link.update().where(application_link.c.id == identifier).values(**changes))
        action = 'APPLICATION_ENABLED' if 'active_flag' in changes and row['active_flag'] else (
            'APPLICATION_DISABLED' if 'active_flag' in changes else 'APPLICATION_UPDATED')
        audit(db, actor, 'application_link', identifier, action, old=snapshot(old),
              new={**snapshot(row), 'changed_fields': list(changes)})
    return {'ok': True}
