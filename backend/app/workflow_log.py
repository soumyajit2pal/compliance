"""Scoped approval history projected from the existing business audit events."""
from datetime import date

import sqlalchemy as sa
from fastapi import Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response

from . import audit_trail as retained, delivery, models as m
from .access import READ_ROLES
from .events import audit
from .obligation_export import csv_bytes
from .table_filters import column_choices, column_predicate, column_query, fields


DECISIONS = {
    'SUBMITTED': 'Submitted', 'REVIEW': 'Reviewed', 'APPROVE': 'Approved',
    'ACCEPT': 'Accepted', 'OBJECT': 'Changes requested', 'RETURN': 'Returned',
    'REJECT': 'Rejected', 'WITHDRAW': 'Withdrawn', 'TASK_DELEGATED': 'Delegated',
    'COMPLETE': 'Completed', 'CANCEL': 'Cancelled', 'REVOKE': 'Revoked',
    'ACTIVATED': 'Activated',
}
STAGES = {
    'SUBMISSION': 'Submission', 'COMPLIANCE_REVIEW': 'Compliance review',
    'BUSINESS_VALIDATION': 'Owner validation', 'FINAL_APPROVAL': 'Final approval',
    'EVIDENCE_REVIEW': 'Evidence review', 'WORK_REVIEW': 'Work review',
    'RESULT_REVIEW': 'Result review', 'ACTIVATION': 'Activation',
}
RESULTS = {**STAGES, 'APPROVED': 'Approved', 'REJECTED': 'Rejected', 'RETURNED': 'Returned',
           'WITHDRAWN': 'Withdrawn', 'COMPLETED': 'Completed', 'CANCELLED': 'Cancelled',
           'REVOKED': 'Revoked', 'ACCEPTED': 'Accepted', 'ACTIVE': 'Active'}
REVIEW_ACTIONS = {'SUBMITTED', 'REVIEW', 'APPROVE', 'RETURN', 'REJECT', 'WITHDRAW', 'TASK_DELEGATED'}
WORKFLOW_ACTIONS = {
    'version': REVIEW_ACTIONS,
    'metadata_correction': REVIEW_ACTIONS | {'CORRECTION_SUBMITTED'},
    'obligation': REVIEW_ACTIONS | {'ACCEPT', 'OBJECT', 'ACTIVATED', 'OWNERSHIP_CHANGE_REQUESTED'}
    | {'OWNERSHIP_' + item for item in ('REVIEW', 'ACCEPT', 'OBJECT', 'APPROVE', 'RETURN', 'REJECT', 'WITHDRAW')},
    'family_link': REVIEW_ACTIONS, 'family_deadline': REVIEW_ACTIONS,
    'family_assessment': REVIEW_ACTIONS, 'family_clause': REVIEW_ACTIONS,
    'action': {'SUBMITTED', 'RETURN', 'COMPLETE', 'CANCEL'},
    'action_extension': {'REQUESTED', 'REVIEW', 'APPROVE', 'RETURN', 'REJECT'},
    'action_validation': {'RECORDED', 'ACCEPT', 'REJECT'},
    'evidence': {'SUBMITTED', 'ACCEPT', 'REJECT'},
    'controls': REVIEW_ACTIONS, 'control-mappings': REVIEW_ACTIONS,
    'control_execution': {'RESULT_RECORDED', 'ACCEPT', 'REJECT'},
    'leave_delegation': {'REQUESTED', 'REVIEW', 'APPROVE', 'REJECT', 'WITHDRAW', 'REVOKE'},
}
SUBMISSION_ACTIONS = {'REQUESTED', 'CORRECTION_SUBMITTED', 'OWNERSHIP_CHANGE_REQUESTED', 'RECORDED', 'RESULT_RECORDED'}
RECORD_TYPES = {key: (label, [kind for kind in kinds if kind in WORKFLOW_ACTIONS])
                for key, (label, kinds) in retained.RECORD_TYPES.items()}


def options(values):
    return [{'id': key, 'name': label} for key, label in values.items()]


def selection(q: str = Query('', max_length=160), audit_record_type: str = Query('', max_length=20),
              department: str = Query('', max_length=36), workflow_stage: str = Query('', max_length=30),
              workflow_decision: str = Query('', max_length=30),
              from_day: date | None = Query(None, alias='from'), to_day: date | None = Query(None, alias='to')):
    if audit_record_type and audit_record_type not in RECORD_TYPES:
        raise HTTPException(422, 'Select a workflow record type from the list.')
    if (workflow_stage and workflow_stage not in STAGES) or (workflow_decision and workflow_decision not in DECISIONS):
        raise HTTPException(422, 'Select a workflow stage and decision from the lists.')
    if from_day and to_day and from_day > to_day:
        raise HTTPException(422, 'Choose an end date on or after the start date.')
    return q.strip(), audit_record_type, department, workflow_stage, workflow_decision, from_day, to_day


def normal_decision(action):
    return 'SUBMITTED' if action in SUBMISSION_ACTIONS else action.removeprefix('OWNERSHIP_')


def predicate(record_type='', decision=''):
    event = m.audit_log.c
    kinds = RECORD_TYPES[record_type][1] if record_type else WORKFLOW_ACTIONS
    return sa.or_(*(sa.and_(event.entity_type == kind, event.action.in_(
        sorted(action for action in WORKFLOW_ACTIONS[kind] if not decision or normal_decision(action) == decision),
    )) for kind in kinds))


def evidence_subject(db, actor, event, data):
    # Reused evidence can be visible in one work item and restricted in another.
    # Check the exact submitted use before exposing that decision or reason.
    link = m.evidence_link.c
    sub = m.action_submission.c
    evidence_id = event['entity_id']
    if event['action'] == 'SUBMITTED':
        candidates = db.execute(sa.select(link.action_id).where(
            link.evidence_id == evidence_id, link.primary_evidence_flag == 1, link.action_id.is_not(None),
        ).distinct().limit(2)).scalars().all()
        action_id = candidates[0] if len(candidates) == 1 else None
    else:
        action_id = db.execute(sa.select(link.action_id).join(
            m.action_submission, sub.action_id == link.action_id,
        ).where(link.id == data.get('evidence_link_id'), link.evidence_id == evidence_id,
                sub.id == data.get('submission_id'))).scalar_one_or_none()
    if action_id is None:
        raise HTTPException(404, 'The retained evidence use is unavailable.')
    row = delivery.evidence_read(db, actor, evidence_id, action_id=action_id)
    action, _ = delivery.read(db, actor, action_id)
    return row['code'], row['title'], 'evidence/' + evidence_id, action['owner_unit_id']


def stage_for_task(db, event, data, action):
    task, workflow = m.workflow_action.c, m.workflow_instance.c
    kind, identifier = event['entity_type'], event['entity_id']
    if kind != 'obligation' or not data.get('task_id'):
        return None
    if event['action'].startswith('OWNERSHIP_'):
        kind, identifier = 'obligation_ownership', data.get('change_id')
        change = m.obligation_owner_change.c
        if not db.execute(sa.select(change.id).where(change.id == identifier, change.obligation_id == event['entity_id'])).first():
            return None
    return db.execute(sa.select(task.stage).join(m.workflow_instance, workflow.id == task.instance_id).where(
        task.id == data['task_id'], workflow.entity_type == kind, workflow.entity_id == identifier,
        task.acted_by == (event['on_behalf_of_user_id'] or event['actor_user_id']), task.decision == action,
    )).scalar_one_or_none()


def stage_and_result(db, event, data, decision):
    kind = event['entity_type']
    stage = data.get('workflow_stage')
    next_stage = data.get('next_stage')
    if isinstance(stage, str) and isinstance(next_stage, str) and stage in STAGES and next_stage in RESULTS:
        return stage, next_stage
    if decision == 'SUBMITTED':
        destination = {'action': 'WORK_REVIEW', 'evidence': None, 'control_execution': None,
                       'action_validation': 'RESULT_REVIEW'}.get(kind, 'COMPLIANCE_REVIEW')
        return 'SUBMISSION', destination
    if decision == 'ACTIVATED':
        return 'ACTIVATION', 'ACTIVE'
    stage = {'REVIEW': 'COMPLIANCE_REVIEW', 'APPROVE': 'FINAL_APPROVAL', 'OBJECT': 'BUSINESS_VALIDATION'}.get(decision)
    if kind in {'evidence', 'control_execution', 'action_validation', 'action'}:
        stage = {'evidence': 'EVIDENCE_REVIEW', 'control_execution': 'RESULT_REVIEW',
                 'action_validation': 'RESULT_REVIEW', 'action': None if decision == 'CANCEL' else 'WORK_REVIEW'}[kind]
    elif decision == 'ACCEPT':
        stage = 'BUSINESS_VALIDATION'
    elif stage is None and decision in {'RETURN', 'REJECT', 'WITHDRAW'}:
        stage = stage_for_task(db, event, data, decision)
        if stage is None and kind != 'obligation':
            old = retained.retained_object(event['old_value'])
            status = next((old[key] for key in ('status', 'approval_status', 'correction_status') if key in old), None)
            if isinstance(status, str):
                stage = {'IN_REVIEW': 'COMPLIANCE_REVIEW', 'REVIEWED': 'FINAL_APPROVAL'}.get(status)
    result = {'APPROVE': 'APPROVED', 'OBJECT': 'RETURNED', 'RETURN': 'RETURNED', 'REJECT': 'REJECTED',
              'WITHDRAW': 'WITHDRAWN', 'COMPLETE': 'COMPLETED', 'CANCEL': 'CANCELLED', 'REVOKE': 'REVOKED'}.get(decision)
    if decision == 'REVIEW':
        result = 'BUSINESS_VALIDATION' if kind == 'obligation' else 'FINAL_APPROVAL'
    if decision == 'ACCEPT' and kind != 'obligation':
        result = 'ACCEPTED'
    return stage, result


def project(db, actor, event, subject):
    action = event['action']
    decision = normal_decision(action)
    data = retained.retained_object(event['new_value'])
    stage, next_stage = stage_and_result(db, event, data, decision)
    item = retained.project(event, subject, False)
    department = subject[3]
    if action.startswith('OWNERSHIP_'):
        item['event'] = 'Ownership change ' + DECISIONS[decision].lower()
    item.update(department_id=department, department=actor.units.get(department, {}).get('name'),
                stage=STAGES.get(stage), next_stage=RESULTS.get(next_stage), decision=DECISIONS[decision],
                stage_id=stage, decision_id=decision)
    return item


WORKFLOW_COLUMNS = {
    'when': lambda item: (retained.entry_time(item), retained.entry_date(item)),
    'actor': fields('actor', 'represented'),
    'record': fields('record_type', 'record_code', 'record_title', 'record_id'),
    'department': fields('department'),
    'stage': fields('stage', 'next_stage'),
    'decision': fields('event', 'decision'),
    'details': lambda item: ('Details', item['event'], item['record_code']),
}


def entries(db, actor, filters, *, columns=None, through=None):
    q, record_type, department, stage, decision, start, end = filters
    if not actor.roles & READ_ROLES:
        return
    included = column_predicate(columns or {}, WORKFLOW_COLUMNS)
    event = m.audit_log.c
    query = retained.event_query().where(predicate(record_type, decision), *retained.date_bounds(event, start, end))
    if through is not None:
        query = query.where(event.event_at <= through)
    subjects = {}
    term = q.casefold()
    with db.execute(retained.chronological(query, '', False)) as result:
        for row in result.yield_per(100).mappings():
            key = row['entity_type'], row['entity_id']
            try:
                if key[0] == 'evidence':
                    subject = evidence_subject(db, actor, row, retained.retained_object(row['new_value']))
                else:
                    if key not in subjects:
                        subjects[key] = retained.subject(db, actor, *key)
                    subject = subjects[key]
            except HTTPException as error:
                if error.status_code not in {403, 404}:
                    raise
                if key[0] != 'evidence':
                    subjects[key] = None
                continue
            if subject is None or (department and department != subject[3]):
                continue
            item = project(db, actor, row, subject)
            if stage and stage != item['stage_id']:
                continue
            if included is not None and not included(item):
                continue
            if retained.matches(item, term) or term in ' '.join(
                item[key] for key in ('department', 'stage', 'next_stage', 'decision') if item[key]
            ).casefold():
                yield item


def install(app, get_db, current):
    @app.get('/api/approval-workflow-log')
    def workflow_page(filters=Depends(selection), older: str = Query('', max_length=80),
                      newer: str = Query('', max_length=80), page_size: int = Query(retained.PAGE_SIZE, ge=1, le=100),
                      through: str = Query('', max_length=40), columns=Depends(column_query), db=Depends(get_db), actor=Depends(current)):
        if older and newer:
            raise HTTPException(422, 'Open one workflow page at a time.')
        through = retained.log_cutoff(through)
        source = entries(db, actor, filters, columns=columns, through=through)
        if columns.options_for:
            projections = {**WORKFLOW_COLUMNS, 'when': retained.entry_date,
                           'record': fields('record_type', 'record_code', 'record_title')}
            return column_choices(source, columns.options_for, projections)
        rows, page = retained.page_matching_entries(source, older, newer, page_size, through)
        allowed_units = {unit['id']: unit['name'] for unit in actor.units.values() if actor.covers(unit['id'], READ_ROLES)}
        # Some authorised records are visible through participation in a related department.
        # Include those options only after the event has passed the same record check.
        for row in rows:
            if row['department_id'] and row['department']:
                allowed_units[row['department_id']] = row['department']
        return JSONResponse(jsonable_encoder({
            'items': [{key: value for key, value in row.items() if key not in {'reason', 'path'}} for row in rows],
            'types': options({key: label for key, (label, _) in RECORD_TYPES.items()}),
            'departments': options(dict(sorted(allowed_units.items(), key=lambda pair: pair[1].casefold()))),
            'stages': options(STAGES), 'decisions': options(DECISIONS), **page,
        }), headers=retained.NO_CACHE)

    @app.get('/api/approval-workflow-log/export')
    def export_workflow(filters=Depends(selection), columns=Depends(column_query), db=Depends(get_db), actor=Depends(current)):
        rows = retained.take_entries(entries(db, actor, filters, columns=columns), retained.EXPORT_LIMIT + 1)
        if len(rows) > retained.EXPORT_LIMIT:
            raise HTTPException(422, f'This export exceeds {retained.EXPORT_LIMIT:,} entries. Narrow the dates or filters.')
        headers = ('When (IST)', 'Actor', 'On behalf of', 'Record type', 'Reference', 'Record', 'Department',
                   'Event', 'Decision', 'Stage', 'Next stage or result', 'Recorded changes', 'Reason', 'Event ID')
        values = [(item['when'].astimezone(retained.BANK_ZONE).isoformat(timespec='seconds'),
                   item['actor'], item['represented'], item['record_type'], item['record_code'],
                   item['record_title'], item['department'], item['event'], item['decision'], item['stage'],
                   item['next_stage'], retained.change_lines(item), item['reason'], item['id']) for item in rows]
        audit(db, actor, 'workflow_report', 'log', 'EXPORTED', new={'count': len(rows)})
        return Response(csv_bytes(('Approval Workflow Log', headers, values)), media_type='text/csv', headers={
            **retained.NO_CACHE, 'Content-Disposition': 'attachment; filename="compliance-approval-workflow-log.csv"',
            'X-Source-Records': str(len(rows)),
        })

    @app.get('/api/approval-workflow-log/{identifier}')
    def workflow_detail(identifier: str, db=Depends(get_db), actor=Depends(current)):
        if actor.roles & READ_ROLES:
            row = db.execute(retained.event_query().where(m.audit_log.c.id == identifier, predicate())).mappings().first()
            if row is not None:
                kind, record_id = row['entity_type'], row['entity_id']
                try:
                    subject = (evidence_subject(db, actor, row, retained.retained_object(row['new_value']))
                               if kind == 'evidence' else retained.subject(db, actor, kind, record_id))
                except HTTPException as error:
                    if error.status_code not in {403, 404}:
                        raise
                else:
                    return JSONResponse(jsonable_encoder(project(db, actor, row, subject)), headers=retained.NO_CACHE)
        raise HTTPException(404, 'Workflow event not found in your authorised area.')
