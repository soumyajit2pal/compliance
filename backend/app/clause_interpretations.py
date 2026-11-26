"""Independent interpretation decisions linked to a retained source clause."""
from datetime import timedelta
from urllib.parse import urlencode

import sqlalchemy as sa
from fastapi import HTTPException

from . import models as m, repository as repo
from .access import actor_for
from .events import audit, history, new_id, now, notify

ENTITY = 'clause_interpretation'
request = m.clause_interpretation_request
workflow = m.workflow_instance
action = m.workflow_action
REVIEW = 'COMPLIANCE_REVIEW'
APPROVAL = 'FINAL_APPROVAL'


def proposals():
    return request.join(workflow, workflow.c.id == request.c.workflow_id)


def approved():
    return sa.select(request.c.clause_id, request.c.interpretation).select_from(proposals()).where(
        workflow.c.record_status == 'APPROVED')


def apply_approved(db, clauses):
    """Expose approved interpretation separately from immutable source data."""
    pending = {row['id']: row for row in clauses
               if not row.get('heading_only_flag') and row['approval_status'] == 'APPROVED' and row['interpretation_status'] != 'APPROVED'}
    ids = list(pending)
    for start in range(0, len(ids), 900):
        for identifier, interpretation in db.execute(approved().where(request.c.clause_id.in_(ids[start:start + 900]))):
            pending[identifier].update(internal_interpretation=interpretation, interpretation_status='APPROVED')
    return clauses


def path(instrument_id, clause, identifier='history'):
    return 'repository/' + instrument_id + '?' + urlencode({
        'tab': 'clauses', 'version': clause['instrument_version_id'], 'clause': clause['id'], 'interpretation': identifier,
    })


def context(db, actor, clause_id, lock=False):
    clause = repo.one(db, m.regulatory_clause, clause_id)
    edition, instrument = repo.read_version(db, actor, clause['instrument_version_id'], lock=lock)
    if lock:
        clause = repo.one(db, m.regulatory_clause, clause_id, lock=True)
    if edition['approval_status'] != 'APPROVED' or clause['approval_status'] != 'APPROVED':
        raise HTTPException(409, 'The clause and its source edition must first be approved.')
    return clause, edition, instrument


def next_decision(stage):
    return (('REVIEWER', 'REVIEW') if stage == REVIEW else ('APPROVER', 'APPROVE'))


def open_assignment(row):
    return sa.select(action).where(action.c.instance_id == row['id'], action.c.stage == row['current_stage'],
                                   action.c.decision.is_(None))


def register(db, actor, clause_id):
    clause, _, instrument = context(db, actor, clause_id)
    unit = instrument['regulatory_owner_unit_id']
    actor.require({'AUTHOR', 'REVIEWER', 'APPROVER', 'CCO'}, unit)
    rows = db.execute(sa.select(request, workflow.c.record_status, workflow.c.started_by,
        workflow.c.current_stage).select_from(proposals()).where(request.c.clause_id == clause_id)
        .order_by(request.c.created_at.desc(), request.c.id.desc())).mappings().all()
    entries = []
    for row in rows:
        tasks = [dict(task) for task in db.execute(sa.select(action).where(action.c.instance_id == row['workflow_id'])
            .order_by(action.c.acted_at.nulls_last(), action.c.stage)).mappings()]
        decisions = []
        assignment = None
        if row['record_status'] == 'OPEN':
            role, decision = next_decision(row['current_stage'])
            assignment = next((task for task in tasks if not task['decision'] and task['stage'] == row['current_stage']), None)
            if row['started_by'] == actor.id and actor.covers(unit, {'AUTHOR'}):
                decisions = ['WITHDRAW']
            elif assignment and assignment['assignee_user_id'] == actor.id and actor.covers(unit, {role}):
                decisions = [decision, 'RETURN', 'REJECT']
        entries.append({**row, 'decisions': decisions, 'assigned_to': assignment and assignment['assignee_user_id'],
                        'decisions_history': [task for task in tasks if task['decision']]})
    can_submit = (not clause.get('heading_only_flag') and actor.covers(unit, {'AUTHOR'}) and clause['interpretation_status'] != 'APPROVED'
                  and not any(row['record_status'] in {'OPEN', 'APPROVED'} for row in rows))
    return {'clause_id': clause_id, 'requests': entries, 'can_submit': can_submit}


def submit(db, actor, clause_id, payload):
    clause, edition, instrument = context(db, actor, clause_id, lock=True)
    unit = instrument['regulatory_owner_unit_id']
    actor.require({'AUTHOR'}, unit)
    if clause.get('heading_only_flag'):
        raise HTTPException(422, 'Document headings only group clauses and do not require an interpretation.')
    existing = db.execute(sa.select(request.c.id).select_from(proposals()).where(request.c.clause_id == clause_id,
        workflow.c.record_status.in_(('OPEN', 'APPROVED')))).first()
    if clause['interpretation_status'] == 'APPROVED' or existing:
        raise HTTPException(409, 'This clause already has an interpretation in review or approved.')
    reviewer = repo.eligible(db, payload.reviewer_id, 'REVIEWER', unit, (actor.id,))
    approver = repo.eligible(db, payload.approver_id, 'APPROVER', unit, (actor.id, payload.reviewer_id))
    for recipient in (reviewer, approver):
        repo.read_version(db, recipient, edition['id'])
    identifier, workflow_id, at = new_id(), new_id(), now()
    db.execute(workflow.insert().values(id=workflow_id, workflow_type='CLAUSE_INTERPRETATION', entity_type=ENTITY,
        entity_id=identifier, current_stage=REVIEW, started_by=actor.id, started_at=at))
    db.execute(request.insert().values(id=identifier, clause_id=clause_id, workflow_id=workflow_id,
        interpretation=payload.interpretation, reason=payload.comments))
    db.execute(action.insert(), [dict(id=new_id(), instance_id=workflow_id, stage=stage, assignee_user_id=recipient,
        due_at=at + timedelta(days=3)) for stage, recipient in [(REVIEW, reviewer.id), (APPROVAL, approver.id)]])
    history(db, actor, ENTITY, identifier, None, 'IN_REVIEW', payload.comments)
    audit(db, actor, ENTITY, identifier, 'SUBMITTED', new={'clause_id': clause_id, 'version_id': edition['id'],
        'workflow_id': workflow_id}, reason=payload.comments)
    notify(db, ENTITY, identifier, reviewer.id, 'REVIEW_ASSIGNED', workflow_id + ':REVIEW')
    return {'id': identifier, 'action_path': path(instrument['id'], clause, identifier)}


def decide(db, actor, identifier, payload):
    proposal = repo.one(db, request, identifier)
    _, _, instrument = context(db, actor, proposal['clause_id'], lock=True)
    unit = instrument['regulatory_owner_unit_id']
    row = repo.one(db, workflow, proposal['workflow_id'], lock=True)
    if row['record_status'] != 'OPEN':
        raise HTTPException(409, 'This interpretation decision has already closed.')
    task = db.execute(open_assignment(row).with_for_update()).mappings().first()
    if not task:
        raise HTTPException(409, 'The assigned decision is no longer available.')
    role, expected = next_decision(row['current_stage'])
    choice = payload.decision
    if choice == 'WITHDRAW':
        actor.require({'AUTHOR'}, unit)
        if row['started_by'] != actor.id:
            raise HTTPException(403, 'Only the Author who submitted this interpretation can withdraw it.')
    else:
        actor.require({role}, unit)
        if task['assignee_user_id'] != actor.id:
            raise HTTPException(403, 'Only the named recipient can decide on this interpretation.')
        reviewers = db.execute(sa.select(action.c.acted_by).where(action.c.instance_id == row['id'],
            action.c.stage == REVIEW, action.c.decision == 'REVIEW')).scalars().all() if role == 'APPROVER' else []
        if role == 'APPROVER' and not reviewers:
            raise HTTPException(409, 'Independent Compliance review must finish first.')
        repo.eligible(db, actor.id, role, unit, (row['started_by'], *reviewers))
        if choice not in {expected, 'RETURN', 'REJECT'}:
            raise HTTPException(409, 'This decision does not match the current interpretation stage.')
    at = now()
    db.execute(action.update().where(action.c.id == task['id']).values(decision=choice,
        comments=payload.comments, acted_by=actor.id, acted_at=at))
    previous = 'IN_REVIEW' if role == 'REVIEWER' else 'REVIEWED'
    status = {'REVIEW': 'REVIEWED', 'APPROVE': 'APPROVED', 'RETURN': 'RETURNED',
              'REJECT': 'REJECTED', 'WITHDRAW': 'WITHDRAWN'}[choice]
    if choice == 'REVIEW':
        db.execute(workflow.update().where(workflow.c.id == row['id']).values(current_stage=APPROVAL))
        recipient = db.execute(sa.select(action.c.assignee_user_id).where(action.c.instance_id == row['id'],
            action.c.stage == APPROVAL, action.c.decision.is_(None))).scalar_one()
        notify(db, ENTITY, identifier, recipient, 'APPROVAL_ASSIGNED', row['id'] + ':APPROVAL')
    else:
        db.execute(workflow.update().where(workflow.c.id == row['id']).values(current_stage='CLOSED',
            record_status=status, completed_at=at))
        notify(db, ENTITY, identifier, row['started_by'], choice, row['id'] + ':' + choice)
    history(db, actor, ENTITY, identifier, previous, status, payload.comments)
    audit(db, actor, ENTITY, identifier, choice, old={'status': previous}, new={'status': status}, reason=payload.comments)
    return {'status': status}


def tasks(db, actor, visible):
    rows = db.execute(sa.select(action, request.c.clause_id, request.c.id.label('interpretation_id'),
        m.regulatory_clause.c.instrument_version_id, m.instrument_version.c.instrument_id,
        m.regulatory_clause.c.code.label('clause_code')).select_from(proposals()
        .join(action, action.c.instance_id == workflow.c.id)
        .join(m.regulatory_clause, m.regulatory_clause.c.id == request.c.clause_id)
        .join(m.instrument_version, m.instrument_version.c.id == m.regulatory_clause.c.instrument_version_id))
        .where(workflow.c.record_status == 'OPEN', workflow.c.current_stage == action.c.stage,
            action.c.assignee_user_id == actor.id, action.c.decision.is_(None), workflow.c.started_by != actor.id)).mappings()
    return [{**row, 'kind': 'DECISION', 'workflow_kind': 'CLAUSE_INTERPRETATION',
             'title': 'Bank interpretation · ' + row['clause_code'],
             'action_path': path(row['instrument_id'], {'id': row['clause_id'],
                 'instrument_version_id': row['instrument_version_id']}, row['interpretation_id'])}
            for row in rows if row['instrument_id'] in visible
            and actor.covers(visible[row['instrument_id']]['regulatory_owner_unit_id'], {next_decision(row['stage'])[0]})]
