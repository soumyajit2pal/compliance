"""Administrator audit report and shared retained-event readers."""
import json
import re
from collections import deque
from ipaddress import ip_address
from datetime import date, datetime, time, timedelta, timezone
from itertools import islice
from urllib.parse import urlencode
from .bank_time import IST as BANK_ZONE

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from fastapi.encoders import jsonable_encoder

from . import controls, delegations, delivery, models as m, notification_families as families
from . import obligations, repository as repo
from .access import READ_ROLES
from .employee_profiles import CODE as EMPLOYEE_API_CODE
from .events import audit, now
from .obligation_export import csv_bytes
from .table_filters import column_choices, column_predicate, column_query, fields


RECORD_TYPES = {
    'sources': ('Regulatory sources', {
        'instrument': 'Regulatory instrument', 'version': 'Source edition',
        'metadata_correction': 'Metadata correction', 'family_link': 'Notification relationship',
        'family_deadline': 'Regulatory date', 'family_assessment': 'Notification assessment',
        'family_clause': 'Clause relationship',
        'clause_interpretation': 'Bank interpretation',
    }),
    'obligations': ('Obligations', {'obligation': 'Obligation'}),
    'work': ('Compliance work', {
        'action': 'Work item', 'action_extension': 'Target change request',
        'action_validation': 'Retained validation',
    }),
    'evidence': ('Evidence', {'evidence': 'Evidence'}),
    'checks': ('Checks and procedures', {
        'controls': 'Check', 'control-mappings': 'Obligation link', 'control_execution': 'Check result',
    }),
    'delegation': ('Leave cover', {'leave_delegation': 'Leave cover'}),
}
ADMIN_TYPES = {
    'user': 'User account', 'system': 'System settings', 'employee_profile_review': 'Employee profile review',
    'dropdown_config': 'Dropdown configuration', 'application_link': 'Connected application',
}
ADMIN_SYSTEM_RECORDS = {'LDAP': ('LDAP settings', 'ldap'), EMPLOYEE_API_CODE: ('Employee profile API', 'employee-api'),
                        'SMTP': ('Email settings', 'email-settings'), 'UPLOAD_POLICY': ('Upload settings', 'upload-settings')}
ALL_RECORD_TYPES = {**RECORD_TYPES, 'administration': ('Administration', ADMIN_TYPES),
                    'system-access': ('System access', {'portal_access': 'Portal request', 'authentication': 'Authentication'}),
                    'other': ('Other audit records', {})}
ENTITY_LABELS = {kind: label for _, types in ALL_RECORD_TYPES.values() for kind, label in types.items()}
AUTH_ACTIONS = {'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT'}
ACCESS_CHANGE_ACTIONS = {'ACCOUNT_CREATED', 'ACCESS_UPDATED', 'LDAP_ACCOUNT_REQUESTED', 'LDAP_ACCESS_REQUESTED'}
REQUEST_TYPES = {'requests': 'API requests', 'authentication': 'Authentication', 'access-changes': 'Access changes'}
PAGE_SIZE = 25
EXPORT_LIMIT = 5000
NO_CACHE = {'Cache-Control': 'no-store'}

EVENT_LABELS = {
    'ACCEPT': 'Accepted', 'APPROVE': 'Approved', 'COMPLETE': 'Completed',
    'OBJECT': 'Changes requested', 'REJECT': 'Rejected', 'RETURN': 'Returned for correction',
    'REVIEW': 'Compliance review recorded', 'CANCEL': 'Cancelled', 'REVOKE': 'Revoked',
    'WITHDRAW': 'Withdrawn', 'DUE_DATE_CHANGED': 'Internal target extended',
    'OWNERS_UPDATED': 'Owners updated', 'REGISTERED': 'Notification registered',
    'CUSTOM_FIELDS_SAVED': 'Custom fields saved', 'CLAUSE_SAVED': 'Clause saved',
    'REASSESSMENT_TRIGGERED': 'Reassessment requested',
    'CONTROL_RESULT_RECORDED': 'Check result recorded',
    'CONTROL_RESULT_ACCEPT': 'Check result accepted', 'CONTROL_RESULT_REJECT': 'Check result rejected',
    'API_READ': 'API read', 'API_WRITE': 'API write', 'SIGN_IN': 'Sign in', 'SIGN_OUT': 'Sign out',
    'LOGIN_SUCCESS': 'Signed in', 'LOGIN_FAILED': 'Sign-in failed', 'LOGOUT': 'Signed out',
}
SUBJECT_EVENTS = {
    ('evidence', 'ACCEPT'): 'Evidence accepted for the submission',
    ('evidence', 'REJECT'): 'Evidence rejected for the submission',
    ('evidence', 'SUBMITTED'): 'Evidence submitted',
    ('action', 'SUBMITTED'): 'Work submitted for review',
    ('obligation', 'ACCEPT'): 'Owner validation recorded',
    ('obligation', 'SUBMITTED'): 'Obligation submitted for Compliance review',
}
VALUE_LABELS = {'IN_REVIEW': 'In review', 'PENDING_VALIDATION': 'Awaiting review',
                'IN_PROGRESS': 'In progress', 'NOT_APPLICABLE': 'Not applicable',
                'PASS': 'Pass', 'FAIL': 'Fail', **EVENT_LABELS}
# Audit writers can retain whole snapshots. Only defined, typed fields belong in
# this cross-record report. Free-form snapshot fields and internal references stay out.
STATUS_FIELDS = {
    'record_status': 'Status', 'status': 'Status', 'approval_status': 'Approval status',
    'correction_status': 'Approval status', 'evidence_status': 'Evidence status',
    'decision': 'Decision', 'result': 'Result', 'criticality': 'Criticality',
    'current_stage': 'Workflow stage', 'applicability_status': 'Applicability',
    'control_status': 'Check status', 'mapping_status': 'Link status',
    'proposed_result': 'Proposed result',
}
DATE_FIELDS = {
    'current_due_date': 'Current internal target', 'previous_due_date': 'Previous internal target',
    'revised_due_date': 'Proposed internal target', 'effective_from': 'Effective from',
    'effective_to': 'Effective to', 'next_review_date': 'Next review',
    'period_from': 'Period start', 'period_to': 'Period end',
    'starts_on': 'Cover starts', 'ends_on': 'Cover ends',
}


def subject(db, actor, kind, identifier):
    """Use existing record readers, including each source and evidence classification check."""
    if kind in ADMIN_TYPES:
        if kind == 'system':
            if identifier not in ADMIN_SYSTEM_RECORDS:
                raise HTTPException(404, 'Administrative record is unavailable.')
            name, path = ADMIN_SYSTEM_RECORDS[identifier]
            return None, name, path, None
        if kind == 'user':
            row = repo.one(db, m.user, identifier)
            query = urlencode({'tab': row['login_type'], 'q': row['username']})
            return row['username'], row['full_name'], 'users?' + query, None
        if kind == 'application_link':
            row = repo.one(db, m.application_link, identifier)
            return row['code'], row['name'], 'applications', None
        return None, None, 'dropdowns?tab=history' if kind == 'dropdown_config' else None, None
    if kind == 'instrument':
        row = repo.read_instrument(db, actor, identifier)
        return row['code'], row['title'], 'repository/' + identifier, row['regulatory_owner_unit_id']
    if kind == 'version':
        edition, row = repo.read_version(db, actor, identifier)
        path = f"repository/{row['id']}?version={identifier}&tab=workflow"
        return row['code'], f"{row['title']} · {repo.source_version_label(edition['version_number'])}", path, row['regulatory_owner_unit_id']
    if kind == 'metadata_correction':
        correction = repo.one(db, m.metadata_correction, identifier)
        row = repo.read_instrument(db, actor, correction['instrument_id'])
        return row['code'], row['title'], f"repository/{row['id']}?tab=workflow&correction={identifier}", row['regulatory_owner_unit_id']
    if kind == 'clause_interpretation':
        from . import clause_interpretations
        request = repo.one(db, m.clause_interpretation_request, identifier)
        clause, _, row = clause_interpretations.context(db, actor, request['clause_id'])
        return clause['code'], row['title'], clause_interpretations.path(row['id'], clause, identifier), row['regulatory_owner_unit_id']
    if kind.startswith('family_'):
        proposal_type = kind.removeprefix('family_')
        proposal = repo.one(db, families.KINDS[proposal_type], identifier)
        row, _ = families.proposal_context(db, actor, proposal_type, proposal)
        unit = (repo.one(db, m.notification_scope, proposal['scope_id'])['org_unit_id']
                if proposal_type == 'assessment' else row['regulatory_owner_unit_id'])
        return row['code'], row['title'], f"notification-families/{row['id']}?proposal={identifier}", unit
    if kind == 'obligation':
        row = obligations.read(db, actor, identifier)
        return row['code'], row['title'], f'obligations/{identifier}?tab=workflow', row['business_owner_unit_id']
    if kind == 'evidence':
        row = delivery.evidence_read(db, actor, identifier)
        return row['code'], row['title'], f'evidence/{identifier}', None
    if kind in {'controls', 'control-mappings'}:
        row = controls.read(db, actor, kind, identifier)
        unit = row['owner_unit_id'] if kind == 'controls' else row['scope_unit_id']
        return row.get('code'), row.get('title') or 'Obligation link', f'{kind}/{identifier}', unit
    if kind == 'leave_delegation':
        actor.require(READ_ROLES)
        row = delegations.read(db, actor, identifier)
        if actor.actual_actor:
            actor.actual_actor.require(READ_ROLES)
            delegations.read(db, actor.actual_actor, identifier)
        return None, 'Leave cover', f'delegations/{identifier}', row['scope_unit_id']

    action_id = identifier
    if kind == 'action_extension':
        action_id = repo.one(db, m.due_date_history, identifier)['action_id']
    elif kind == 'action_validation':
        action_id = repo.one(db, m.action_validation, identifier)['action_id']
    elif kind == 'control_execution':
        execution = m.action_control_result
        link = m.action_control_link
        action_id = db.execute(sa.select(link.c.action_id).join(
            execution, execution.c.link_id == link.c.id,
        ).where(execution.c.execution_id == identifier)).scalars().first()
        if action_id is None:
            raise HTTPException(404, 'Linked work item is unavailable.')
    row, _ = delivery.read(db, actor, action_id)
    return row['code'], row['description'], f'actions/{action_id}', row['owner_unit_id']


def report_subject(db, actor, kind, identifier):
    # Admin oversight includes retained events whose subjects have retired or
    # are outside a separate operational role. It does not confer that role.
    if kind in ENTITY_LABELS and kind not in {'portal_access', 'authentication'}:
        try:
            return subject(db, actor, kind, identifier)
        except HTTPException as error:
            if error.status_code not in {403, 404}:
                raise
    table, reference, name = {
        'instrument': (m.regulatory_instrument, 'code', 'title'),
        'obligation': (m.compliance_obligation, 'code', 'title'),
        'action': (m.action, 'code', 'description'),
        'evidence': (m.evidence_item, 'code', 'title'),
        'controls': (m.control, 'code', 'title'),
    }.get(kind, (None, None, None))
    if table is not None:
        row = db.execute(sa.select(table.c[reference], table.c[name]).where(table.c.id == identifier)).first()
        if row:
            return row[0], row[1], None, None
    return None, None, None, None


def retained_object(value):
    if not value:
        return {}
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def label_code(value):
    return value.replace('_', ' ').capitalize()


def retained_value(key, value):
    if not isinstance(value, str):
        return None
    if key in DATE_FIELDS:
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            return None
    if re.fullmatch(r'[A-Z][A-Z_0-9]{0,39}', value):
        return VALUE_LABELS.get(value, label_code(value))
    return None


def entry_changes(event):
    before = retained_object(event['old_value'])
    after = retained_object(event['new_value'])
    if event['field_name']:
        key = event['field_name']
        # Some retained audit writers record a single named scalar.
        if not before:
            before = {key: (event['old_value'] or '').strip('"')}
        if not after:
            after = {key: (event['new_value'] or '').strip('"')}
    changes = []
    for key, label in ({**STATUS_FIELDS, **DATE_FIELDS}).items():
        if key not in after:
            continue
        previous = retained_value(key, before.get(key))
        value = retained_value(key, after[key])
        if previous != value:
            changes.append({'field': label, 'from': previous, 'to': value})
    if event['action'] == 'DUE_DATE_CHANGED':
        changes.sort(key=lambda change: change['field'] != 'Current internal target')
    return changes


def project(event, record, admin):
    code, name, path, _ = record
    kind, action = event['entity_type'], event['action']
    actor_name = event['actor_name'] or event['current_actor']
    represented = event['on_behalf_of_name'] or event['current_principal']
    authentication = kind == 'authentication' or action in AUTH_ACTIONS or action in {'SIGN_IN', 'SIGN_OUT'}
    group = ('Authentication' if authentication else 'Access' if kind == 'portal_access' else
             'Access change' if action in ACCESS_CHANGE_ACTIONS or kind == 'employee_profile_review' else
             'Administration' if kind in ADMIN_TYPES else 'Business event')
    result = {
        'id': event['id'], 'when': event['event_at'].replace(tzinfo=timezone.utc),
        'actor': actor_name or ('Unauthenticated' if authentication or kind == 'portal_access' else
                                'System' if not event['actor_user_id'] else 'Former user'),
        'represented': represented, 'record_id': event['entity_id'],
        'record_type': ENTITY_LABELS.get(kind, label_code(kind)),
        'record_code': code, 'record_title': name, 'path': path,
        'event': SUBJECT_EVENTS.get((kind, action)) or EVENT_LABELS.get(action, label_code(action)),
        'changes': entry_changes(event), 'reason': event['reason'] if kind not in ADMIN_TYPES else None,
    }
    if admin:
        if kind not in ENTITY_LABELS or authentication:
            result['reason'] = None
        status = event['http_status']
        result.update(
            group=group, outcome=('Failed' if status >= 400 else 'Success') if status is not None else (
                'Failed' if action == 'LOGIN_FAILED' else 'Success' if action in {'LOGIN_SUCCESS', 'LOGOUT'} else None),
            client_ip=event['client_ip'], actor_username=event['actor_username'],
            actor_roles=(event['actor_roles'] or '').split(',') if event['actor_roles'] else [],
            request_id=event['request_id'], request_method=event['request_method'], request_route=event['request_route'],
            http_status=status, duration_ms=event['duration_ms'], user_agent=event['user_agent'],
            channel=event['channel'], delegation_id=event['delegation_id'],
        )
    return result


def event_query():
    current_actor = m.user.alias('audit_actor')
    principal = m.user.alias('audit_principal')
    event = m.audit_log.c
    columns = [column for column in event if column.name != 'session_id']
    return (sa.select(*columns, current_actor.c.full_name.label('current_actor'), principal.c.full_name.label('current_principal'))
            .select_from(m.audit_log)
            .outerjoin(current_actor, current_actor.c.id == event.actor_user_id)
            .outerjoin(principal, principal.c.id == event.on_behalf_of_user_id))


def filters(q: str = Query('', max_length=160), audit_record_type: str = Query('', max_length=20),
            from_day: date | None = Query(None, alias='from'), to_day: date | None = Query(None, alias='to'),
            audit_event_type: str = Query('', max_length=20), audit_outcome: str = Query('', max_length=10)):
    if audit_record_type and audit_record_type not in ALL_RECORD_TYPES:
        raise HTTPException(422, 'Select a record type from the list.')
    if from_day and to_day and from_day > to_day:
        raise HTTPException(422, 'Choose an end date on or after the start date.')
    if (audit_event_type and audit_event_type not in REQUEST_TYPES) or audit_outcome not in {'', 'success', 'failed'}:
        raise HTTPException(422, 'Select an event type and outcome from the filters.')
    return q.strip(), audit_record_type, from_day, to_day, audit_event_type, audit_outcome


def cursor_key(value):
    try:
        timestamp, identifier = value.split('~', 1)
        moment = datetime.fromisoformat(timestamp)
        if moment.tzinfo is not None or not re.fullmatch(r'[A-Za-z0-9-]{1,36}', identifier):
            raise ValueError
        return moment, identifier
    except ValueError:
        raise HTTPException(422, 'This page link is invalid. Open the latest audit entries.') from None


def cursor_for(item):
    return item['when'].replace(tzinfo=None).isoformat() + '~' + item['id']


def matches(entry, term):
    if not term:
        return True
    text = [entry[key] for key in ('id', 'actor', 'represented', 'record_id', 'record_type', 'record_code',
                                  'record_title', 'event', 'reason')]
    text.extend(entry.get(key) for key in ('client_ip', 'actor_username', 'request_id', 'request_method', 'request_route', 'outcome'))
    text.extend(value for change in entry['changes'] for value in change.values())
    return term in ' '.join(value for value in text if value).casefold()


def date_bounds(event, from_day, to_day):
    conditions = []
    if from_day and from_day > date.min:
        start = datetime.combine(from_day, time.min, BANK_ZONE).astimezone(timezone.utc).replace(tzinfo=None)
        conditions.append(event.event_at >= start)
    if to_day:
        end = datetime.combine(to_day, time.max, BANK_ZONE).astimezone(timezone.utc).replace(tzinfo=None)
        conditions.append(event.event_at <= end)
    return conditions


def primary_requests(event, through=None):
    recorded = m.audit_log.alias('request_result')
    duplicates = sa.select(sa.literal(1)).select_from(recorded).where(
        recorded.c.entity_type == 'portal_access', recorded.c.request_id == event.request_id)
    if through is not None:
        duplicates = duplicates.where(recorded.c.event_at <= through)
    return ~sa.and_(event.action.in_(sorted(AUTH_ACTIONS)), event.request_id.is_not(None), sa.exists(duplicates))


def event_groups(event):
    return {
        'requests': sa.and_(event.entity_type == 'portal_access', event.action.in_(['API_READ', 'API_WRITE'])),
        'authentication': sa.or_(event.entity_type == 'authentication', event.action.in_(sorted(AUTH_ACTIONS | {'SIGN_IN', 'SIGN_OUT'}))),
        'access-changes': sa.or_(event.entity_type == 'employee_profile_review', event.action.in_(sorted(ACCESS_CHANGE_ACTIONS))),
    }


def failed_event(event):
    return sa.or_(event.http_status >= 400, event.action == 'LOGIN_FAILED')


def stats(db, from_day, to_day, through):
    event = m.audit_log.c
    groups = event_groups(event)
    query = sa.select(
        sa.func.count().label('total'),
        sa.func.count(sa.case((groups['authentication'], 1))).label('authentication'),
        sa.func.count(sa.case((groups['access-changes'], 1))).label('access_changes'),
        sa.func.count(sa.case((failed_event(event), 1))).label('failed'),
    ).select_from(m.audit_log).where(primary_requests(event, through), event.event_at <= through, *date_bounds(event, from_day, to_day))
    return dict(db.execute(query).mappings().one())


def compare_event(moment, identifier, newer):
    event = m.audit_log.c
    if newer:
        return sa.or_(event.event_at > moment, sa.and_(event.event_at == moment, event.id > identifier))
    return sa.or_(event.event_at < moment, sa.and_(event.event_at == moment, event.id < identifier))


def chronological(query, cursor, newer):
    event = m.audit_log.c
    if cursor:
        query = query.where(compare_event(*cursor_key(cursor), newer))
    order = (event.event_at, event.id) if newer else (event.event_at.desc(), event.id.desc())
    return query.order_by(*order)


def log_cutoff(value):
    current = now().replace(microsecond=0)
    if value == 'latest':
        # Oracle DATE stores event_at to the second. Exclude the open second
        # so requests recorded after the page loads cannot change its count.
        return current - timedelta(seconds=1)
    if not value:
        return current
    try:
        through = datetime.fromisoformat(value)
        if through.tzinfo is not None:
            through = through.astimezone(timezone.utc).replace(tzinfo=None)
    except (OverflowError, ValueError):
        raise HTTPException(422, 'Open the newest entries to restart paging.') from None
    return min(through.replace(microsecond=0), current)


def entry_time(item):
    return item['when'].astimezone(BANK_ZONE).strftime('%d %b %Y, %H:%M')


def entry_date(item):
    return item['when'].astimezone(BANK_ZONE).date()


def entry_target(item):
    return (
        ' '.join(part for part in (item['request_method'], item['request_route']) if part),
        fields('record_type', 'record_code', 'record_title', 'record_id')(item),
        tuple(tuple(change.values()) for change in item['changes']),
    )


AUDIT_COLUMNS = {
    'when': lambda item: (entry_time(item), entry_date(item)),
    'actor': fields('actor', 'actor_username', 'represented'),
    'event': fields('group', 'event'),
    'outcome': fields('outcome', 'http_status'),
    'access_record': entry_target,
    'client_ip': fields('client_ip'),
    'details': lambda item: ('Details', item['event'], item['record_code']),
}


AUDIT_CHOICES = {
    **AUDIT_COLUMNS,
    'when': entry_date,
    'access_record': lambda item: (
        ' '.join(part for part in (item['request_method'], item['request_route']) if part),
        item['record_code'], item['record_title'], item['record_type'],
    ),
}


def audit_filters(selection, columns, through=None):
    q, record_type, from_day, to_day, event_type, outcome = selection
    event = m.audit_log.c
    conditions = [primary_requests(event, through), *date_bounds(event, from_day, to_day)]
    if through is not None:
        conditions.append(event.event_at <= through)
    if record_type == 'other':
        conditions.append(event.entity_type.not_in(list(ENTITY_LABELS)))
    elif record_type:
        conditions.append(event.entity_type.in_(list(ALL_RECORD_TYPES[record_type][1])))
    if event_type:
        conditions.append(event_groups(event)[event_type])
    if outcome == 'failed':
        conditions.append(failed_event(event))
    elif outcome == 'success':
        conditions.append(sa.or_(event.http_status < 400, event.action.in_(['LOGIN_SUCCESS', 'LOGOUT'])))
    try:
        address = str(ip_address(q))
    except ValueError:
        address = None
    if address:
        conditions.append(event.client_ip == address)
        q = ''
    remaining = dict(columns)
    remaining.pop(getattr(columns, 'options_for', ''), None)
    ip_filter = remaining.get('client_ip')
    ip = sa.func.lower(event.client_ip)
    if isinstance(ip_filter, frozenset):
        # Keep the SQL IN list within Oracle's supported bound. Mixed
        # selections such as a missing IP use the shared filter.
        if len(ip_filter) <= 1000 and all(re.fullmatch(r'[0-9a-f:.]+', term) for term in ip_filter):
            conditions.append(ip.in_(sorted(ip_filter)))
            del remaining['client_ip']
    elif ip_filter and re.fullmatch(r'[0-9a-f:.]+', ip_filter):
        conditions.append(ip.contains(ip_filter, autoescape=True))
        del remaining['client_ip']
    return conditions, q.casefold(), column_predicate(remaining, AUDIT_COLUMNS)


def entries(db, actor, conditions, term, included, cursor='', newer=False):
    subjects = {}
    query = chronological(event_query().where(*conditions), cursor, newer)
    with db.execute(query) as result:
        for event in result.yield_per(100).mappings():
            key = event['entity_type'], event['entity_id']
            if key[0] == 'portal_access':
                record = (None, None, None, None)
            else:
                if key not in subjects:
                    subjects[key] = report_subject(db, actor, *key)
                record = subjects[key]
            item = project(event, record, True)
            if matches(item, term) and (included is None or included(item)):
                yield item


def take_entries(source, size):
    try:
        return list(islice(source, size))
    finally:
        source.close()


def page_metadata(items, total, end, through):
    return {
        'total': total, 'end': end, 'through': through,
        'older': cursor_for(items[-1]) if items and end < total else None,
        'newer': cursor_for(items[0]) if items and end > len(items) else None,
    }


def count_audit_page(db, conditions, items, through):
    # Admin can see every retained event that passes the SQL filters. The
    # count and position use the same predicates as the page query.
    end = sa.literal(0)
    if items:
        last = items[-1]
        before_or_at_last = ~compare_event(last['when'].replace(tzinfo=None), last['id'], False)
        end = sa.func.count(sa.case((before_or_at_last, 1)))
    total, position = db.execute(
        sa.select(sa.func.count(), end).select_from(m.audit_log).where(*conditions)
    ).one()
    return page_metadata(items, total, position, through)


def page_matching_entries(source, older, newer, size, through):
    """Count matches after projection and scope checks, retaining one page."""
    boundary = cursor_key(older or newer) if older or newer else None
    items = deque(maxlen=size)
    total = end = 0
    try:
        for item in source:
            total += 1
            key = item['when'].replace(tzinfo=None), item['id']
            if newer:
                if key > boundary:
                    items.append(item)
                    end = total
            elif len(items) < size and (boundary is None or key < boundary):
                items.append(item)
                end = total
    finally:
        source.close()
    rows = list(items)
    return rows, page_metadata(rows, total, end, through)


def change_lines(item):
    def line(change):
        return f"{change['field']}: {change['from'] or '—'} → {change['to'] or '—'}"
    return '\n'.join(line(change) for change in item['changes'])


def install(app, get_db, current):
    def admin(actor=Depends(current)):
        actor.require({'ADMIN'})
        return actor

    @app.get('/api/audit-trail')
    def list_audit(actor=Depends(admin), selection=Depends(filters), older: str = Query('', max_length=80),
                   newer: str = Query('', max_length=80), page_size: int = Query(PAGE_SIZE, ge=1, le=100),
                   through: str = Query('', max_length=40), columns=Depends(column_query), db=Depends(get_db)):
        if older and newer:
            raise HTTPException(422, 'Open one audit page at a time.')
        through = log_cutoff(through)
        conditions, term, included = audit_filters(selection, columns, through)
        if columns.options_for:
            if columns.options_for == 'when' and not term and included is None:
                # The date menu needs only the indexed timestamps, even in a large log.
                with db.execute(sa.select(m.audit_log.c.event_at).where(*conditions)) as timestamps:
                    dates = {moment.replace(tzinfo=timezone.utc).astimezone(BANK_ZONE).date()
                             for moment in timestamps.scalars()}
                return column_choices(dates, 'when', {'when': lambda day: day})
            source = entries(db, actor, conditions, term, included)
            return column_choices(source, columns.options_for, AUDIT_CHOICES)
        if term or included is not None:
            items, page = page_matching_entries(entries(db, actor, conditions, term, included), older, newer, page_size, through)
        else:
            items = take_entries(entries(db, actor, conditions, term, included, older or newer, bool(newer)), page_size)
            if newer:
                items.reverse()
            page = count_audit_page(db, conditions, items, through)
        return JSONResponse(jsonable_encoder({
            'items': [{key: value for key, value in item.items() if key not in {
                'reason', 'path', 'user_agent', 'actor_roles', 'channel', 'delegation_id',
            }} for item in items],
            'types': [{'id': key, 'name': value[0]} for key, value in ALL_RECORD_TYPES.items()],
            'summary': stats(db, selection[2], selection[3], through),
            'event_types': [{'id': key, 'name': name} for key, name in REQUEST_TYPES.items()],
            **page,
        }), headers=NO_CACHE)

    @app.get('/api/audit-trail/export')
    def export_audit(actor=Depends(admin), selection=Depends(filters), columns=Depends(column_query), db=Depends(get_db)):
        rows = take_entries(entries(db, actor, *audit_filters(selection, columns)), EXPORT_LIMIT + 1)
        if len(rows) > EXPORT_LIMIT:
            raise HTTPException(422, f'This export exceeds {EXPORT_LIMIT:,} entries. Narrow the dates or filters.')
        headers = ('When (IST)', 'Actor', 'On behalf of', 'Record type', 'Record code', 'Record title',
                   'Record ID', 'Event', 'Recorded changes', 'Reason', 'Audit entry ID',
                   'Event type', 'Outcome', 'HTTP status', 'Client IP', 'Request', 'Correlation ID',
                   'Role codes at the time', 'User agent', 'Duration (ms)')
        values = [(item['when'].astimezone(BANK_ZONE).isoformat(timespec='seconds'), item['actor'],
                   item['represented'], item['record_type'], item['record_code'], item['record_title'],
                   item['record_id'], item['event'], change_lines(item), item['reason'], item['id'],
                   item['group'], item['outcome'], item['http_status'], item['client_ip'],
                   ' '.join(part for part in (item['request_method'], item['request_route']) if part),
                   item['request_id'], ', '.join(item['actor_roles']), item['user_agent'], item['duration_ms'])
                  for item in rows]
        content = csv_bytes(('Audit Log', headers, values))
        q, kind, start, end, event_type, outcome = selection
        audit(db, actor, 'audit_report', 'trail', 'EXPORTED', new={
            'count': len(rows), 'record_type': kind, 'from': start, 'to': end, 'search_applied': bool(q),
            'event_type': event_type, 'outcome': outcome, 'column_filters_applied': bool(columns),
        })
        return Response(content, media_type='text/csv', headers={
            **NO_CACHE, 'Content-Disposition': 'attachment; filename="compliance-audit-trail.csv"',
            'X-Source-Records': str(len(rows)),
        })

    @app.get('/api/audit-trail/{identifier}')
    def audit_detail(identifier: str, actor=Depends(admin), db=Depends(get_db)):
        event = m.audit_log.c
        item = db.execute(event_query().where(event.id == identifier)).mappings().first()
        if item is not None:
            try:
                record = report_subject(db, actor, item['entity_type'], item['entity_id'])
            except HTTPException as error:
                if error.status_code not in {403, 404}:
                    raise
            else:
                detail = project(item, record, True)
                if detail['request_id'] and detail['http_status'] is None:
                    request = db.execute(sa.select(event.http_status, event.duration_ms).where(
                        event.id == detail['request_id'], event.entity_type == 'portal_access')).first()
                    if request is not None:
                        status, duration = request
                        detail.update(http_status=status, duration_ms=duration,
                                      outcome='Failed' if status >= 400 else 'Success')
                if item['entity_type'] == 'application_link':
                    changed = retained_object(item['new_value']).get('changed_fields')
                    if isinstance(changed, list):
                        detail['settings_changed'] = [field for field in ('name', 'description', 'url', 'active_flag') if field in changed]
                return JSONResponse(jsonable_encoder(detail), headers=NO_CACHE)
        raise HTTPException(404, 'Audit entry not found in your authorised area.')
