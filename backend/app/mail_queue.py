"""Transactional notification jobs, current recipient checks and SMTP delivery."""
from datetime import datetime, timedelta, timezone
from email.headerregistry import Address
from email.message import EmailMessage
from html import escape
import logging
import smtplib
import ssl
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from fastapi import HTTPException
import sqlalchemy as sa

from . import controls, mail_settings, migration_work, models as m, repository as repo
from .access import actor_for
from .employee_identity import blocked
from .events import new_id, now
from .notification_context import resolve_notification
from .task_queue import list_tasks

LOG = logging.getLogger('cbd.mail')
JOBS = m.email_job.c
IST = ZoneInfo('Asia/Kolkata')
MAX_ATTEMPTS = 5
CLAIM_TIMEOUT = timedelta(minutes=15)
EVENT_LIFETIME = timedelta(days=2)
TEST_LIFETIME = timedelta(hours=1)
STATUSES = ('PENDING', 'SENDING', 'RETRY', 'SENT', 'FAILED', 'SKIPPED')
EVENT_LABELS = {
    'REVIEW_ASSIGNED': 'Compliance review assigned', 'APPROVAL_ASSIGNED': 'Final approval assigned',
    'OBLIGATION_OWNER_VALIDATION': 'Obligation ownership confirmation needed',
    'CONTROL_REVIEW': 'Check or obligation link decision assigned',
    'CONTROL_APPROVE': 'Check or obligation link approved',
    'CONTROL_RETURN': 'Check or obligation link returned',
    'CONTROL_REJECT': 'Check or obligation link rejected',
    'ACTION_CCO_ESCALATION': 'Overdue work escalated', 'ACTION_UPCOMING': 'Work due soon',
    'ACTION_ASSIGNED': 'New compliance work assigned', 'ACTION_REVIEW_REQUIRED': 'Compliance work ready for review',
    'ACTION_COMPLETE': 'Compliance work completed', 'ACTION_RETURN': 'Compliance work returned',
    'EVIDENCE_ACCEPT': 'Evidence accepted', 'EVIDENCE_REJECT': 'Evidence returned',
    'ACCESS_APPROVAL_REQUIRED': 'Employee access review required',
    'FAMILY_APPROVE': 'Notification family proposal approved', 'FAMILY_RETURN': 'Notification family proposal returned',
    'FAMILY_REJECT': 'Notification family proposal rejected', 'FAMILY_WITHDRAW': 'Notification family proposal withdrawn',
    'CHECK_REVIEW_DUE': 'Check review due',
    migration_work.REVIEW_EVENT: 'Import content review required',
    migration_work.READY_EVENT: 'Validated import ready to load',
}
PENDING_EVENTS = {
    'REVIEW_ASSIGNED', 'APPROVAL_ASSIGNED', 'TASK_DELEGATED', 'OBLIGATION_REVIEW_ASSIGNED',
    'OBLIGATION_OWNER_VALIDATION', 'OBLIGATION_DECISION_ASSIGNED', 'OWNERSHIP_REVIEW_ASSIGNED',
    'OWNERSHIP_DECISION_ASSIGNED', 'LEAVE_COVER_REVIEW', 'LEAVE_COVER_REVIEWED',
    'CONTROL_REVIEW', 'EXTENSION_REVIEW', 'EXTENSION_APPROVAL', 'ACTION_REVIEW_REQUIRED',
    migration_work.REVIEW_EVENT, migration_work.READY_EVENT,
}
ACTION_REMINDERS = {
    'ACTION_ASSIGNED', 'ACTION_PERIOD_STARTED', 'ACTION_UPCOMING', 'ACTION_OVERDUE',
    'ACTION_CCO_ESCALATION', 'EVIDENCE_REVIEW_OVERDUE', 'REGULATORY_DELAY',
}


def india_time(timestamp):
    return (timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=timezone.utc)).astimezone(IST)


def event_label(kind):
    return EVENT_LABELS.get(kind, kind.replace('_', ' ').capitalize())


def decisions(db, actor):
    return [task for task in list_tasks(db, actor) if task['kind'] == 'DECISION' and not task.get('shared')]


def queue_daily_digest(db, cfg, timestamp):
    local = india_time(timestamp)
    day = local.date()
    if not cfg['enabled'] or cfg['problem'] or not cfg['digest_enabled'] or local.strftime('%H:%M') < cfg['digest_time']:
        return 0
    counter = m.id_counter.c
    today_key = int(day.strftime('%Y%m%d'))
    receipt = db.execute(sa.select(counter.id, counter.next_value)
        .where(counter.entity_type == 'mail-digest', counter.next_value < today_key)
        .with_for_update(skip_locked=True)).first()
    if not receipt:
        return 0
    wf, task = m.workflow_instance.c, m.workflow_action.c
    action = m.action.c
    selects = [
        sa.select(task.assignee_user_id).join(m.workflow_instance, wf.id == task.instance_id).where(
            wf.record_status == 'OPEN', wf.current_stage == task.stage, task.decision.is_(None)),
        sa.select(action.reviewer_user_id).where(action.record_status == 'PENDING_VALIDATION'),
    ]
    for table in (*controls.KINDS.values(), m.leave_delegation):
        c = table.c
        selects.append(sa.select(c.reviewer_user_id).where(c.approval_status == 'IN_REVIEW'))
        selects.append(sa.select(c.approver_user_id).where(c.approval_status == 'REVIEWED'))
    candidates = sa.union(*selects).subquery()
    user = m.user.c
    rows = db.execute(sa.select(user.id, user.email).where(user.active_flag == 1,
        user.must_change_password_flag == 0, user.needs_email_confirmation_flag == 0,
        user.needs_department_selection_flag == 0, user.email.is_not(None),
        user.id.in_(sa.select(list(candidates.c)[0])))).all()
    count = 0
    for user_id, address in rows:
        if not mail_settings.mailbox(address.strip()):
            continue
        try:
            actor = actor_for(db, user_id)
        except HTTPException:
            continue
        if blocked(actor.user) or not decisions(db, actor):
            continue
        db.execute(m.email_job.insert().values(id=new_id(), kind='DIGEST', recipient_user_id=user_id,
            dedupe_key=f'DIGEST:{day}:{user_id}', digest_day=day, created_at=timestamp))
        count += 1
    db.execute(m.id_counter.update().where(counter.id == receipt.id).values(next_value=today_key))
    return count


def task_path(task):
    path = task.get('action_path')
    if path:
        return path
    if task.get('ownership_change_id'):
        return f"obligations/{task['obligation_id']}?tab=owners&ownership_change={task['ownership_change_id']}"
    if task.get('obligation_id'):
        return f"obligations/{task['obligation_id']}?tab=workflow"
    if task.get('proposal_id'):
        return f"notification-families/{task['instrument_id']}?proposal={task['proposal_id']}"
    if task.get('correction_id'):
        return f"repository/{task['instrument_id']}?tab=workflow&correction={task['correction_id']}"
    if task.get('version_id'):
        return f"repository/{task['instrument_id']}?version={task['version_id']}&tab=workflow"
    return 'approvals'


def event_path(item):
    if item.get('action_path'):
        return item['action_path']
    if item['entity_type'] == 'version' and item.get('instrument_id'):
        return f"repository/{item['instrument_id']}?version={item['entity_id']}&tab=workflow"
    if item['entity_type'] == 'metadata_correction' and item.get('instrument_id'):
        return f"repository/{item['instrument_id']}?tab=workflow&correction={item['entity_id']}"
    return 'notifications'


def still_pending(db, actor, item):
    identifier = item['entity_id']
    entity = item['entity_type']
    if entity == 'migration':
        return migration_work.notification_pending(db, item)
    key = {'version': 'version_id', 'metadata_correction': 'correction_id', 'obligation': 'obligation_id',
           'clause_interpretation': 'interpretation_id',
           'action': 'action_id', 'action_extension': 'extension_id'}.get(entity, 'proposal_id' if entity.startswith('family_') else 'id')
    stage = {'REVIEW_ASSIGNED': 'COMPLIANCE_REVIEW', 'APPROVAL_ASSIGNED': 'FINAL_APPROVAL',
             'OBLIGATION_REVIEW_ASSIGNED': 'COMPLIANCE_REVIEW', 'OBLIGATION_OWNER_VALIDATION': 'BUSINESS_VALIDATION',
             'OWNERSHIP_REVIEW_ASSIGNED': 'COMPLIANCE_REVIEW', 'EXTENSION_REVIEW': 'COMPLIANCE_REVIEW',
             'EXTENSION_APPROVAL': 'FINAL_APPROVAL', 'ACTION_REVIEW_REQUIRED': 'EVIDENCE_REVIEW'}.get(item['notification_type'])
    workflow = item['trigger_key'].split(':', 1)[0] if entity in {'version', 'metadata_correction', 'obligation', 'clause_interpretation'} or entity.startswith('family_') else None
    return any(task.get(key) == identifier and (not stage or task.get('stage') == stage)
               and (not workflow or task.get('instance_id') == workflow)
               for task in decisions(db, actor))


def reminder_applies(db, actor, item):
    from . import delivery
    from .delivery_reminders import review_overdue
    action, obligation = delivery.read(db, actor, item['entity_id'])
    if action['record_status'] not in delivery.OPEN:
        return False
    kind = item['notification_type']
    day = delivery.today()
    delta = (action['current_due_date'] - day).days
    if kind in {'ACTION_ASSIGNED', 'ACTION_PERIOD_STARTED', 'ACTION_UPCOMING'}:
        return actor.id == action['owner_user_id'] and (kind != 'ACTION_UPCOMING' or 0 <= delta <= 3)
    if kind == 'ACTION_OVERDUE':
        return delta < 0 and actor.id in {action['owner_user_id'], action['escalation_user_id']}
    cco = actor.covers(obligation['regulatory_owner_unit_id'], {'CCO'})
    if kind == 'ACTION_CCO_ESCALATION':
        return delta <= -7 and cco
    if kind == 'EVIDENCE_REVIEW_OVERDUE':
        sub = delivery.latest(db, action)
        return (action['record_status'] == 'PENDING_VALIDATION' and sub and review_overdue(sub)
                and actor.id in {action['reviewer_user_id'], action['escalation_user_id']})
    deadline = delivery.effective_deadline(db, actor, obligation)
    return (deadline and deadline['due_date'] < day
            and (cco or actor.id in {action['owner_user_id'], action['escalation_user_id']}))


class SkipMail(Exception):
    """A bounded status code displayed in Notification jobs."""


def message_for(db, job, cfg, timestamp):
    """Resolve current access and pending decisions. Record content lives in the portal."""
    items = []
    if job['kind'] == 'TEST':
        if timestamp - job['created_at'] > TEST_LIFETIME:
            raise SkipMail('EXPIRED')
        address = job['recipient_address']
        title = 'Test email delivery'
        summary = 'The compliance portal submitted this test message to the SMTP relay.'
        path = 'email-settings?tab=jobs'
    else:
        try:
            actor = actor_for(db, job['recipient_user_id'])
        except HTTPException:
            raise SkipMail('ACCOUNT_UNAVAILABLE') from None
        user = actor.user
        address = (user.get('email') or '').strip()
        if user.get('needs_email_confirmation_flag') or not mail_settings.mailbox(address):
            raise SkipMail('NO_CONFIRMED_EMAIL')
        if job['kind'] == 'DIGEST':
            if not cfg['digest_enabled'] or job['digest_day'] != india_time(timestamp).date():
                raise SkipMail('DIGEST_OUTDATED')
            tasks = [] if blocked(user) or user['must_change_password_flag'] or user['needs_department_selection_flag'] else decisions(db, actor)
            if not tasks:
                raise SkipMail('NO_PENDING_DECISIONS')
            title = 'Daily approval reminder'
            summary = f'{len(tasks)} pending decision(s) as of {job["digest_day"]} (IST).'
            path = 'approvals'
            # Include links and categories. Titles, comments and attachments stay in the application.
            items = [(event_label(task.get('stage') or 'Decision'), task_path(task))
                     for task in sorted(tasks, key=lambda task: str(task.get('due_at') or '9999'))[:50]]
            if len(tasks) > 50:
                summary += f' Open My decisions to see the remaining {len(tasks) - 50}.'
        else:
            if timestamp - job['created_at'] > EVENT_LIFETIME:
                raise SkipMail('EXPIRED')
            source = repo.one(db, m.notification, job['notification_id'])
            own_access_notice = source['entity_type'] == 'user' and source['entity_id'] == actor.id
            if (blocked(user) or user['must_change_password_flag'] or user['needs_department_selection_flag']) and not own_access_notice:
                raise SkipMail('ACCOUNT_UNAVAILABLE')
            item = resolve_notification(db, actor, source, strict=True)
            if not item:
                raise SkipMail('ACCESS_CHANGED')
            kind = item['notification_type']
            if ((kind in PENDING_EVENTS and not still_pending(db, actor, item))
                    or (kind in ACTION_REMINDERS and not reminder_applies(db, actor, item))):
                raise SkipMail('EVENT_OUTDATED')
            if kind == 'CHECK_REVIEW_DUE':
                check = controls.read(db, actor, 'controls', item['entity_id'])
                if (not controls.current(check) or check['owner_user_id'] != actor.id
                        or not check['review_date'] or check['review_date'] > controls.today() + timedelta(days=7)):
                    raise SkipMail('EVENT_OUTDATED')
            if kind == 'OBLIGATION_REVIEW_DUE':
                from .obligations import read
                obligation = read(db, actor, item['entity_id'])
                if (obligation['record_status'] != 'ACTIVE' or not obligation['next_review_date']
                        or obligation['next_review_date'] > controls.today() + timedelta(days=7)):
                    raise SkipMail('EVENT_OUTDATED')
            title = event_label(kind)
            summary = 'Open Compliance by Design to view this notification and any next steps.'
            path = event_path(item)

    base = cfg['portal_url'].rstrip('/') + '/#'
    url = base + path
    msg = EmailMessage()
    msg['From'] = Address(display_name=cfg['from_name'], addr_spec=cfg['from_address'])
    msg['To'] = address
    msg['Subject'] = '[Compliance by Design] ' + title
    msg['Message-ID'] = f'<{job["id"]}@{cfg["from_address"].rsplit("@", 1)[1]}>'
    msg.set_content('\n\n'.join([title, summary, *(f'{label} {base + link}' for label, link in items), url]))
    links = ''.join(f'<li><a href="{escape(base + link, quote=True)}">{escape(label)}</a></li>' for label, link in items)
    msg.add_alternative(f'<main><h1>{escape(title)}</h1><p>{escape(summary)}</p>'
        + (f'<ul>{links}</ul>' if links else '')
        + f'<p><a href="{escape(url, quote=True)}">Open Compliance by Design</a></p></main>', subtype='html')
    return address, msg


def smtp_send(message, cfg):
    transport = cfg['transport']
    context = None
    if transport != 'PLAIN':
        context = ssl.create_default_context(cafile=cfg['ca_file'])
        context.minimum_version = ssl.TLSVersion.TLSv1_2
    args = (cfg['host'], cfg['port'])
    extra = {'timeout': cfg['timeout_seconds']}
    client = smtplib.SMTP_SSL(*args, context=context, **extra) if transport == 'TLS' else smtplib.SMTP(*args, **extra)
    try:
        if transport == 'STARTTLS':
            client.starttls(context=context)
        if cfg['username']:
            client.login(cfg['username'], cfg['password'])
        client.send_message(message)
    finally:
        # DATA acceptance is the decision. A disconnect during teardown must not retry an accepted message.
        try:
            client.close()
        except OSError:
            pass


def error_code(exc):
    if isinstance(exc, (ssl.SSLError, smtplib.SMTPNotSupportedError)):
        return 'TLS_OR_RELAY_CAPABILITY', False
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return 'SMTP_AUTHENTICATION', 400 <= exc.smtp_code < 500
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return 'RECIPIENT_REJECTED', any(400 <= code < 500 for code, _ in exc.recipients.values())
    if isinstance(exc, smtplib.SMTPResponseException):
        return 'SMTP_' + str(exc.smtp_code), 400 <= exc.smtp_code < 500
    if isinstance(exc, (smtplib.SMTPException, OSError)):
        return 'RELAY_UNAVAILABLE', True
    return 'PROCESSING_ERROR', True


def eligible(timestamp):
    return sa.or_(JOBS.status == 'PENDING',
                  sa.and_(JOBS.status == 'RETRY', JOBS.next_attempt_at <= timestamp),
                  sa.and_(JOBS.status == 'SENDING', JOBS.last_attempt_at < timestamp - CLAIM_TIMEOUT))


def deliver_one(engine, runtime, identifier, timestamp):
    token = new_id()
    with engine.begin() as db:
        cfg = mail_settings.load(db, runtime)
        if cfg['problem'] or mail_settings.validate(cfg | {'enabled': True}, runtime.environment):
            return False
        scope = sa.true() if cfg['enabled'] else JOBS.kind == 'TEST'
        claimed = db.execute(m.email_job.update().where(JOBS.id == identifier, scope, eligible(timestamp))
            .values(status='SENDING', claim_token=token, last_attempt_at=timestamp, attempts=JOBS.attempts + 1))
        if not claimed.rowcount:
            return False
        job = db.execute(sa.select(m.email_job).where(JOBS.id == identifier)).mappings().one()
    values = dict(claim_token=None, next_attempt_at=None, last_error=None)
    try:
        if job['attempts'] > MAX_ATTEMPTS:
            values.update(status='FAILED', last_error='CLAIM_EXPIRED')
        else:
            with engine.connect() as db:
                address, message = message_for(db, job, cfg, timestamp)
            values['recipient_address'] = address
            smtp_send(message, cfg)
            values.update(status='SENT', sent_at=now())
    except SkipMail as exc:
        values.update(status='SKIPPED', last_error=str(exc))
    except HTTPException:
        values.update(status='SKIPPED', last_error='RECORD_UNAVAILABLE')
    except Exception as exc:
        code, transient = error_code(exc)
        retry = transient and job['attempts'] < MAX_ATTEMPTS
        values.update(status='RETRY' if retry else 'FAILED', last_error=code,
                      next_attempt_at=now() + timedelta(minutes=2 ** job['attempts']) if retry else None)
        LOG.warning('Email job delivery unsuccessful job=%s state=%s reason=%s', identifier, values['status'], code)
    with engine.begin() as db:
        result = db.execute(m.email_job.update().where(JOBS.id == identifier, JOBS.claim_token == token).values(**values))
    return bool(result.rowcount and values['status'] == 'SENT')


def deliver_pending(engine, runtime, *, limit=50, stopping=lambda: False):
    timestamp = now()
    with engine.begin() as db:
        cfg = mail_settings.load(db, runtime)
        if cfg['problem'] or mail_settings.validate(cfg | {'enabled': True}, runtime.environment):
            return 0
        scope = sa.true() if cfg['enabled'] else JOBS.kind == 'TEST'
        # Retain the job receipt, including notifications that aged out during a pause.
        db.execute(m.email_job.update().where(scope, JOBS.status.in_(('PENDING', 'RETRY')),
            sa.or_(sa.and_(JOBS.kind == 'EVENT', JOBS.created_at < timestamp - EVENT_LIFETIME),
                   sa.and_(JOBS.kind == 'TEST', JOBS.created_at < timestamp - TEST_LIFETIME),
                   sa.and_(JOBS.kind == 'DIGEST', JOBS.digest_day < india_time(timestamp).date())))
            .values(status='SKIPPED', next_attempt_at=None, last_error='EXPIRED'))
        ids = db.execute(sa.select(JOBS.id).where(scope, eligible(timestamp))
            .order_by(sa.case((JOBS.kind == 'TEST', 0), else_=1), JOBS.created_at, JOBS.id).limit(limit)).scalars().all()
    sent = 0
    for identifier in ids:
        if stopping():
            break
        try:
            sent += deliver_one(engine, runtime, identifier, now())
        except sa.exc.SQLAlchemyError:
            LOG.warning('Oracle could not persist email job state job=%s', identifier)
    return sent
