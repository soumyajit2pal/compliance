"""Current Regulatory Library progress over authorised source and delivery records."""

import sqlalchemy as sa

from . import delivery, models as m, notification_families
from .access import READ_ROLES, REGULATORY_ROLES
from .obligation_workspace import current, response
from .regulation_registers import selected


def in_force(row, day):
    return row['effective_from'] <= day and (not row['effective_to'] or day < row['effective_to'])


def owner_responses(db, owner_ids):
    task = m.workflow_action.c
    workflow = m.workflow_instance.c
    validation = m.obligation_validation_task.c
    change = m.owner_change_assignment.c
    results = {}
    for start in range(0, len(owner_ids), 900):
        batch = owner_ids[start:start + 900]
        direct = sa.select(validation.owner_id, validation.task_id).where(validation.owner_id.in_(batch))
        replacements = sa.select(change.applied_owner_id, change.task_id).where(
            change.applied_owner_id.in_(batch), change.previous_owner_id.is_(None))
        links = direct.union(replacements).subquery()
        query = sa.select(links.c.owner_id, task.decision, workflow.record_status.label('workflow_status')).join(
            m.workflow_action, task.id == links.c.task_id).join(
            m.workflow_instance, workflow.id == task.instance_id).order_by(task.created_at, task.id)
        for row in db.execute(query).mappings():
            results[row['owner_id']] = dict(row)
    return results


def period_evidence(db, actor, action_ids):
    link = m.evidence_link.c
    evidence = m.evidence_item.c
    candidates = sa.select(link.action_id, evidence.id, evidence.code, evidence.title,
        evidence.period_from, evidence.period_to, evidence.evidence_status).join(
        m.evidence_item, evidence.id == link.evidence_id).where(
        evidence.evidence_status.in_(['SUBMITTED', 'ACCEPTED', 'REJECTED']))
    visible = {}
    for start in range(0, len(action_ids), 900):
        for row in db.execute(candidates.where(link.action_id.in_(action_ids[start:start + 900]))).mappings():
            identifier = row['id']
            if identifier in visible:
                continue
            try:
                delivery.evidence_read(db, actor, identifier, action_id=row['action_id'])
            except delivery.HTTPException:
                continue
            status = row['evidence_status']
            visible[identifier] = stage_record(row, status, status == 'ACCEPTED', 'code', 'title', 'period_from', 'period_to')
    return sorted(visible.values(), key=lambda row: row['code'])


def stage_record(row, status, completed, *fields):
    return {'id': row['id'], 'status': status, 'completed': completed, **{field: row[field] for field in fields}}


def obligation_population(rows, day):
    """Keep one authorised current revision per obligation code."""
    by_code = {}
    priorities = {}
    for row in rows:
        active = row['record_status'] == 'ACTIVE' and row['approval_status'] == 'APPROVED' and in_force(row, day)
        pending = (row['record_status'] == 'DRAFT'
                   and row['approval_status'] in {'DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED'}
                   and (not row['effective_to'] or day < row['effective_to']))
        if not (active or pending):
            continue
        priority = (active, row['version_number'])
        if priority > priorities.get(row['code'], (False, 0)):
            by_code[row['code']] = row
            priorities[row['code']] = priority
    return {row['id']: row for row in by_code.values()}


def build(db, actor, instrument, versions, clauses, links):
    clauses = [row for row in clauses if not row.get('heading_only_flag')]
    day = delivery.today()
    rows = selected(db, m.compliance_obligation, m.compliance_obligation.c.id, [link['id'] for link in links])
    return build_for_sources(db, actor, [instrument], versions, clauses, obligation_population(rows, day), day)


def build_for_sources(db, actor, instruments, versions, clauses, obligations, day, *, family=False):
    versions_by_instrument = {}
    for version in versions:
        versions_by_instrument.setdefault(version['instrument_id'], []).append(version)
    effective_editions = {}
    for instrument in instruments:
        edition = notification_families.approved_source(versions_by_instrument.get(instrument['id'], []),
            instrument['id'], day, instrument['current_version_id'])
        if edition:
            effective_editions[edition['id']] = instrument['id']
    from .clause_interpretations import apply_approved
    edition_clauses = apply_approved(db, [row for row in clauses if row['instrument_version_id'] in effective_editions])
    considered_versions = [row for row in versions if row['approval_status'] in {'DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED'}]

    def in_scope(row, unit):
        parent = obligations[row['obligation_id']]
        return not unit or actor.covers(unit, READ_ROLES) or actor.covers(parent['regulatory_owner_unit_id'], REGULATORY_ROLES)

    owners = [row for row in selected(db, m.obligation_owner, m.obligation_owner.c.obligation_id, obligations)
              if current(row) and in_force(row, day) and row['user_id'] and in_scope(row, row['org_unit_id'])
              and row['owner_role'] != 'COMPLIANCE_REVIEWER'
              and not (row['owner_role'] == 'REGULATORY' and row['user_id'] == obligations[row['obligation_id']]['created_by'])]
    decisions = owner_responses(db, [row['id'] for row in owners])
    owner_records = []
    for row in owners:
        decision = decisions.get(row['id'], {})
        outcome = response({**row, 'validation_decision': decision.get('decision'), 'validation_task': decision})
        status = {'ACCEPT': 'ACCEPTED', 'OBJECT': 'CHANGES_REQUESTED', 'PENDING': 'AWAITING_RESPONSE'}.get(outcome, 'AWAITING_VALIDATION')
        owner_records.append(stage_record(row, status, outcome == 'ACCEPT', 'obligation_id', 'org_unit_id', 'user_id', 'owner_role'))
    applicability = [row for row in selected(db, m.obligation_applicability, m.obligation_applicability.c.obligation_id, obligations)
                     if row['approval_status'] not in {'REJECTED', 'WITHDRAWN'} and in_force(row, day) and in_scope(row, row['org_unit_id'])]
    actions = [row for row in selected(db, m.action, m.action.c.obligation_id, obligations)
               if row['record_status'] not in {'DRAFT', 'CANCELLED'} and in_scope(row, row['owner_unit_id'])
               and (not row['period_from'] or row['period_from'] <= day)]
    records = {
        'editions': [stage_record(row, row['approval_status'], row['approval_status'] == 'APPROVED',
                                  'version_number', 'effective_from', 'instrument_id') for row in considered_versions],
        'clauses': [{**stage_record(row, row['interpretation_status'] if row['approval_status'] == 'APPROVED' else row['approval_status'],
                                  row['approval_status'] == 'APPROVED' and row['interpretation_status'] == 'APPROVED',
                                  'instrument_version_id', 'code', 'heading', 'source_clause_reference'),
                     'instrument_id': effective_editions[row['instrument_version_id']]} for row in edition_clauses],
        'obligations': [stage_record(row, 'ACTIVE' if row['record_status'] == 'ACTIVE' else
                                      'AWAITING_ACTIVATION' if row['approval_status'] == 'APPROVED' else row['approval_status'],
                                      row['record_status'] == 'ACTIVE', 'code', 'title', 'version_number')
                        for row in obligations.values()],
        'owners': owner_records,
        'applicability': [stage_record(row, row['approval_status'], row['approval_status'] == 'APPROVED',
                                       'obligation_id', 'org_unit_id', 'legal_entity_id', 'applicability_status', 'effective_from')
                          for row in applicability],
        'evidence': period_evidence(db, actor, [row['id'] for row in actions if row['period_from']]),
    }
    result = {
        'implementation_progress': {key: {'completed': sum(row['completed'] for row in rows), 'total': len(rows)}
                                    for key, rows in records.items()},
        'implementation_progress_records': records,
    }
    if family:
        open_actions = sorted([row for row in actions if row['record_status'] in delivery.OPEN],
                              key=lambda row: (row['current_due_date'], row['code']))
        result['open_actions'] = [
            {**stage_record(row, row['record_status'], False, 'code', 'description', 'current_due_date', 'owner_unit_id'),
             'overdue': row['current_due_date'] < day} for row in open_actions
        ]
    return result
