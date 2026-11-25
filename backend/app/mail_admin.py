"""Administrator settings, SMTP diagnostics and the paginated notification job register."""
from datetime import date, datetime, time, timedelta, timezone

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
import sqlalchemy as sa

from . import mail_queue as queue, mail_settings as settings, models as m
from .events import NOTIFICATION_WAKE, audit, new_id, now
from .pagination import page_metadata, page_query
from .table_filters import choice_key, column_query

PATH = '/api/admin/email'
JOB_TYPES = {'EVENT': 'Workflow notification', 'DIGEST': 'Daily approval reminder', 'TEST': 'Test email'}
J = m.email_job.c
N = m.notification.c
U = m.user.c
SOURCE = m.email_job.outerjoin(m.notification, N.id == J.notification_id).join(m.user, U.id == J.recipient_user_id)
TYPE = sa.case(JOB_TYPES, value=J.kind)
RECIPIENT = sa.func.coalesce(J.recipient_address, U.email, '—')
EVENT = sa.case(queue.EVENT_LABELS, value=N.notification_type,
    else_=sa.func.coalesce(sa.func.initcap(sa.func.replace(N.notification_type, '_', ' ')), TYPE))
DAY = sa.func.to_char(J.created_at + sa.text("INTERVAL '05:30' HOUR TO MINUTE"), 'YYYY-MM-DD')
COLUMNS = {
    'queued_ist': DAY, 'type': TYPE, 'event': EVENT, 'recipient': RECIPIENT,
    'status': sa.func.initcap(J.status), 'attempts': sa.cast(J.attempts, sa.String(10)),
    'details': sa.func.coalesce(J.last_error, '—'),
}
DETAIL = sa.select(J.id, J.created_at, J.kind, J.status, J.attempts, J.digest_day, J.last_attempt_at,
    J.next_attempt_at, J.sent_at, J.last_error, J.recipient_address, U.username, U.email,
    N.notification_type, N.entity_type, N.entity_id).select_from(SOURCE)


class TestEmail(BaseModel):
    recipient: str = Field(max_length=254)


def utc(value):
    return value.replace(tzinfo=timezone.utc).isoformat() if value else None


def job_detail(row):
    result = dict(row)
    for key in ('created_at', 'last_attempt_at', 'next_attempt_at', 'sent_at'):
        result[key] = utc(row[key])
    result['recipient'] = result.pop('recipient_address') or result.pop('email', None)
    result.pop('email', None)
    result['type_label'] = JOB_TYPES[row['kind']]
    result['event_label'] = queue.event_label(row['notification_type']) if row['notification_type'] else result['type_label']
    return result


def date_bound(day):
    return datetime.combine(day, time.min, queue.IST).astimezone(timezone.utc).replace(tzinfo=None)


def job_list(db, q, status, kind, start, end, pages, filters):
    if filters.keys() - COLUMNS.keys() or filters.options_for and filters.options_for not in COLUMNS:
        raise HTTPException(422, 'Choose a notification jobs column.')
    conditions = []
    if q:
        term = q.strip().lower()
        conditions.append(sa.or_(*(sa.func.lower(c).contains(term, autoescape=True) for c in (J.id, RECIPIENT, U.username, EVENT, J.last_error))))
    if status:
        conditions.append(J.status == status)
    if kind:
        conditions.append(J.kind == kind)
    if start:
        conditions.append(J.created_at >= date_bound(start))
    if end:
        conditions.append(J.created_at < date_bound(end) + timedelta(days=1))
    for key, value in filters.items():
        if key != filters.options_for:
            column = sa.func.lower(COLUMNS[key])
            conditions.append(column.in_(sorted(value)) if isinstance(value, frozenset) else column.contains(value, autoescape=True))
    if filters.options_for:
        column = COLUMNS[filters.options_for]
        labels = db.execute(sa.select(column).select_from(SOURCE).where(*conditions).distinct().order_by(column)).scalars()
        options = {choice_key(label): label for label in labels if label}
        return {'options': [{'value': value, 'label': label} for value, label in options.items()]}
    total = db.execute(sa.select(sa.func.count()).select_from(SOURCE).where(*conditions)).scalar_one()
    info = page_metadata(total, pages['page'], pages['page_size'] or 25)
    offset = (info['page'] - 1) * info['page_size']
    rows = db.execute(DETAIL.where(*conditions).order_by(J.created_at.desc(), J.id.desc())
                      .offset(offset).limit(info['page_size'])).mappings()
    return {'items': [job_detail(row) for row in rows], 'pagination': info}


def install(app, get_db, current, runtime):
    @app.get(PATH + '/settings')
    def get_settings(db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        config = settings.public(settings.load(db, runtime), runtime)
        counts = dict(db.execute(sa.select(J.status, sa.func.count()).group_by(J.status)).all())
        return config | {'counts': counts, 'default_recipient': actor.user.get('email')}

    @app.put(PATH + '/settings')
    def save_settings(payload: settings.SettingsUpdate, db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        result = settings.save(db, runtime, payload)
        audit(db, actor, 'system', settings.CODE, 'SMTP_SETTINGS_SAVED', new={
            k: result[k] for k in ('enabled', 'host', 'port', 'transport', 'from_address',
                                   'has_password', 'digest_enabled', 'digest_time')})
        db.info[NOTIFICATION_WAKE] = True
        return result

    @app.post(PATH + '/test', status_code=202)
    def test_email(payload: TestEmail, db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        recipient = payload.recipient.strip()
        if not settings.mailbox(recipient):
            raise HTTPException(422, 'Enter one valid test recipient email address.')
        config = settings.load(db, runtime)
        if not settings.public(config, runtime)['test_ready']:
            raise HTTPException(409, 'Save usable SMTP settings before sending a test.')
        identifier = new_id()
        db.execute(m.email_job.insert().values(id=identifier, kind='TEST', recipient_user_id=actor.id,
            recipient_address=recipient, dedupe_key='TEST:' + identifier, created_at=now()))
        audit(db, actor, 'system', settings.CODE, 'SMTP_TEST_QUEUED', new={'job_id': identifier})
        db.info[NOTIFICATION_WAKE] = True
        return {'id': identifier, 'status': 'PENDING'}

    @app.get(PATH + '/jobs')
    def list_jobs(q: str = Query('', max_length=160), status: str = Query('', max_length=12),
                  kind: str = Query('', max_length=12), start: date | None = None, end: date | None = None,
                  pages=Depends(page_query), filters=Depends(column_query), db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        if (status and status not in queue.STATUSES) or (kind and kind not in JOB_TYPES) or (start and end and end < start):
            raise HTTPException(422, 'Choose a valid status, job type and date range.')
        return job_list(db, q, status, kind, start, end, pages, filters)

    @app.get(PATH + '/jobs/{identifier}')
    def get_job(identifier: str, db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        row = db.execute(DETAIL.where(J.id == identifier)).mappings().first()
        if not row:
            raise HTTPException(404, 'Email job not found.')
        return job_detail(row)

    @app.post(PATH + '/jobs/{identifier}/retry')
    def retry_job(identifier: str, db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        timestamp = now()
        changed = db.execute(m.email_job.update().where(J.id == identifier, J.status.in_(('FAILED', 'RETRY')),
            sa.or_(sa.and_(J.kind == 'EVENT', J.created_at >= timestamp - queue.EVENT_LIFETIME),
                   sa.and_(J.kind == 'TEST', J.created_at >= timestamp - queue.TEST_LIFETIME),
                   sa.and_(J.kind == 'DIGEST', J.digest_day == queue.india_time(timestamp).date())))
            .values(status='PENDING', attempts=0, next_attempt_at=None, claim_token=None))
        if not changed.rowcount:
            raise HTTPException(409, 'Only unexpired failed or retrying jobs can be queued again.')
        audit(db, actor, 'system', settings.CODE, 'SMTP_JOB_REQUEUED', new={'job_id': identifier})
        db.info[NOTIFICATION_WAKE] = True
        return {'status': 'PENDING'}
