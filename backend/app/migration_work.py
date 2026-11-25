"""Actionable regulatory imports for the current reviewer and uploader."""
from datetime import date

import sqlalchemy as sa
from fastapi import HTTPException

from . import models as m
from .access import actor_for
from .events import new_id, notify

PENDING = 'CONTENT_VALIDATION_PENDING'
READY = 'MIGRATION_READY'
REVIEW_EVENT = 'IMPORT_CONTENT_REVIEW_REQUIRED'
READY_EVENT = 'IMPORT_READY_TO_LOAD'


def has_global_role(actor, role):
    return not actor.delegation and actor.covers(None, {role})


def can_review(actor, batch):
    return actor.id != batch['uploaded_by'] and has_global_role(actor, 'REVIEWER')


def regulatory_batch():
    return ~m.migration_batch.c.record_status.startswith('OBL_', autoescape=True)


def has_rows(db, batch_id, status):
    row = m.migration_row.c
    return db.execute(sa.select(row.id).where(row.batch_id == batch_id,
        row.validation_status == status).limit(1)).first() is not None


def reviewers(db, uploader):
    today = date.today()
    grant, role, user = m.user_role.c, m.role.c, m.user.c
    candidates = db.execute(sa.select(grant.user_id).distinct()
        .join(m.role, role.id == grant.role_id).join(m.user, user.id == grant.user_id)
        .where(user.active_flag == 1, user.id != uploader, role.active_flag == 1,
            role.code == 'REVIEWER', grant.global_scope_flag == 1, grant.effective_from <= today,
            sa.or_(grant.effective_to.is_(None), grant.effective_to > today))).scalars().all()
    for user_id in candidates:
        # Check the effective workspace access, including the employee profile gate.
        try:
            actor = actor_for(db, user_id)
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
            continue
        if has_global_role(actor, 'REVIEWER'):
            yield user_id


def request_review(db, batch_id, uploader, *, already_pending=False):
    if not has_rows(db, batch_id, PENDING):
        return
    event = m.notification.c
    previous = db.execute(sa.select(event.id).where(event.entity_type == 'migration',
        event.entity_id == batch_id, event.notification_type == REVIEW_EVENT).limit(1)).first()
    if already_pending and previous:
        return
    key = f'{batch_id}:import-review:{new_id()}'
    for user_id in reviewers(db, uploader):
        notify(db, 'migration', batch_id, user_id, REVIEW_EVENT, key)


def notify_ready(db, batch):
    batch_id = batch['id']
    notify(db, 'migration', batch_id, batch['uploaded_by'], READY_EVENT, f'{batch_id}:import-ready:{new_id()}')


def tasks(db, actor):
    batch, row = m.migration_batch.c, m.migration_row.c
    actionable = []
    if has_global_role(actor, 'REVIEWER'):
        actionable.append(sa.and_(batch.uploaded_by != actor.id, row.validation_status == PENDING))
    if has_global_role(actor, 'AUTHOR'):
        actionable.append(sa.and_(batch.uploaded_by == actor.id, row.validation_status == READY))
    if not actionable:
        return []
    rows = db.execute(sa.select(batch.id, batch.code, batch.source_file, batch.uploaded_at, row.validation_status)
        .join(m.migration_row, row.batch_id == batch.id)
        .where(regulatory_batch(), sa.or_(*actionable)).distinct()
        .order_by(batch.uploaded_at.desc(), batch.id)).mappings()
    return [dict(kind='DECISION' if record['validation_status'] == PENDING else 'WORK',
        stage='IMPORT_CONTENT_REVIEW' if record['validation_status'] == PENDING else 'IMPORT_DRAFT_LOAD',
        shared=record['validation_status'] == PENDING,
        workflow_kind='MIGRATION_IMPORT', batch_id=record['id'], code=record['code'],
        title=record['source_file'], action_path='migration/' + record['id'], due_at=None) for record in rows]


def notification_context(db, actor, item):
    table = m.migration_batch
    batch = db.execute(sa.select(table.c.id, table.c.source_file, table.c.uploaded_by)
        .where(table.c.id == item['entity_id'], regulatory_batch())).mappings().first()
    if not batch:
        return None
    review = item['notification_type'] == REVIEW_EVENT
    if review:
        if not can_review(actor, batch):
            return None
    elif (item['notification_type'] != READY_EVENT or actor.id != batch['uploaded_by']
            or not has_global_role(actor, 'AUTHOR')):
        return None
    pending = has_rows(db, batch['id'], PENDING if review else READY)
    if review:
        status = 'Awaiting review' if pending else 'No rows awaiting review'
        message = ('Compare the imported rows with the authoritative source and confirm the content.' if pending
            else 'The batch currently has no rows awaiting independent content validation.')
        action = 'Open import review' if pending else 'Open import batch'
    else:
        status = 'Ready to load' if pending else 'No rows ready to load'
        message = ('Open the validated import and load the ready rows as Drafts.' if pending
            else 'The batch currently has no rows ready to load as Drafts.')
        action = 'Open ready import' if pending else 'Open import batch'
    return dict(item, source_title=batch['source_file'], message=message, access_status_label=status,
        action_path='migration/' + batch['id'], action_label=action)


def notification_pending(db, item):
    kind = item['notification_type']
    status = PENDING if kind == REVIEW_EVENT else READY
    if not has_rows(db, item['entity_id'], status):
        return False
    # A queued email from an earlier review cycle can become actionable again after a refresh.
    event = m.notification.c
    newer = db.execute(sa.select(event.id).where(event.entity_type == 'migration',
        event.entity_id == item['entity_id'], event.notification_type == kind,
        event.recipient_user_id == item['recipient_user_id'], event.triggered_at > item['triggered_at']).limit(1)).first()
    return newer is None
