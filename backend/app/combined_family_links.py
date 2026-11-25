"""Validate workbook notification links and assign their existing decision workflow."""
from collections import defaultdict, deque
import json

import sqlalchemy as sa
from fastapi import HTTPException

from . import business_ids, models as m, repository as repo
from .access import actor_for, can_read_instrument
from .employee_identity import blocked
from .import_template import FAMILY_FIELDS, FAMILY_RELATIONSHIPS, import_date


def validate_links(db, uploader, records, groups, loaded_targets, canonical):
    dependencies = {}
    linked_groups = set()
    for reference, headers in records.items():
        if len(headers) != 1 or reference in loaded_targets:
            continue
        record = headers[0]
        data = canonical(record['source'])
        parent_ref = data.get('family_parent_reference', '')
        relationship = data.get('family_relationship_type', '').upper()
        effective_from = data.get('family_effective_from', '')
        if not any(data.get(key) for key in FAMILY_FIELDS):
            continue
        linked_groups.add(reference)
        if record['errors']:
            continue
        errors = record['errors']
        if not all((parent_ref, relationship, effective_from)):
            errors.append('Fill Parent notification, Relationship and Relationship effective date together.')
            continue
        if relationship not in FAMILY_RELATIONSHIPS:
            errors.append('Relationship must be Amends, Clarifies, Supersedes or Repeals.')
            continue
        try:
            when = import_date(effective_from)
        except ValueError:
            errors.append('Invalid Relationship effective date. Use DD/MM/YYYY or YYYY-MM-DD.')
            continue
        if parent_ref == reference:
            errors.append('Choose a different parent notification.')
            continue
        if len(parent_ref) > 200:
            errors.append('Parent notification must be an import reference or portal instrument code up to 200 characters.')
            continue
        same_batch = parent_ref in records
        try:
            if same_batch and len(records[parent_ref]) != 1:
                raise HTTPException(422, 'Parent notification matches more than one Regulatory records row.')
            parent_id = (loaded_targets.get(parent_ref) or records[parent_ref][0]['normalised'].get('instrument_id')) if same_batch else business_ids.resolve(db, 'instrument', parent_ref)
            if parent_id:
                parent = repo.read_instrument(db, uploader, parent_id)
                uploader.require({'AUTHOR'}, parent['regulatory_owner_unit_id'])
            elif same_batch:
                parent = records[parent_ref][0]['normalised']
            else:
                raise HTTPException(422, 'Parent notification was not found. Enter its workbook Import reference or existing portal instrument code.')
        except HTTPException as exc:
            errors.append(str(exc.detail))
            continue
        if parent.get('regulator_id') and parent['regulator_id'] != record['normalised']['regulator_id']:
            errors.append('The parent notification and this record must have the same regulator.')
            continue
        record['family_link'] = {'parent_reference': parent_ref, 'relationship_type': relationship,
                                 'effective_from': when.isoformat()}
        if same_batch:
            dependencies[reference] = parent_ref
        else:
            record['family_link']['parent_id'] = parent_id

    # Traverse across complete import groups; clause hierarchy stays within its edition.
    children = defaultdict(list)
    for child, parent in dependencies.items():
        children[parent].append(child)
    queue = deque(reference for reference in groups if reference not in dependencies)
    ordered = set()
    while queue:
        reference = queue.popleft()
        ordered.add(reference)
        for child in children[reference]:
            if any(row['errors'] for row in groups[reference]):
                records[child][0]['errors'].append('Resolve the parent notification’s import findings before loading this relationship.')
            queue.append(child)
    for reference in dependencies.keys() - ordered:
        records[reference][0]['errors'].append('Parent notification references contain a cycle or depend on one.')
    for reference in linked_groups:
        if any(row['errors'] for row in groups[reference]):
            for row in groups[reference]:
                if not row['errors']:
                    row['errors'].append('This record and its clauses are pending corrections in another row of the group')


def assignees(db, uploader, rows):
    profiles = {profile['group_reference']: (row, profile)
                for row in rows if row['target_entity_type'] == 'instrument'
                or row['validation_status'] == 'MIGRATION_READY'
                for profile in [json.loads(row['validation_errors'])] if profile['entity_type'] == 'instrument'}
    links = []
    for row, profile in profiles.values():
        link = profile.get('family_link')
        if row['validation_status'] != 'MIGRATION_READY' or not link:
            continue
        if link.get('parent_id'):
            parent = repo.read_instrument(db, uploader, link['parent_id'])
        else:
            parent_group = profiles.get(link['parent_reference'])
            if not parent_group:
                raise HTTPException(409, 'The parent notification is unavailable. Refresh the validation preview.')
            parent_row, parent_profile = parent_group
            parent_id = parent_row['target_entity_id'] or parent_profile['normalised'].get('instrument_id')
            parent = repo.read_instrument(db, uploader, parent_id) if parent_id else parent_profile['normalised']
        links.append((profile['normalised'], parent))
    result = {'reviewers': [], 'approvers': []}
    if not links:
        return result
    ranks = dict(db.execute(sa.select(m.confidentiality_class.c.id, m.confidentiality_class.c.rank_number)).all())
    candidates = db.execute(sa.select(m.user.c.id, m.user.c.full_name, m.user.c.username)
        .where(m.user.c.id != uploader.id, m.user.c.active_flag == 1,
            m.user.c.needs_email_confirmation_flag == 0, m.user.c.needs_department_selection_flag == 0,
            m.user.c.id.in_(sa.select(m.user_role.c.user_id).join(m.role, m.role.c.id == m.user_role.c.role_id)
                .where(m.role.c.active_flag == 1, m.role.c.code.in_(('REVIEWER', 'APPROVER')))))
        .order_by(m.user.c.full_name, m.user.c.username)).mappings()
    for user in candidates:
        try:
            candidate = actor_for(db, user['id'])
        except HTTPException as exc:
            if exc.status_code == 401:
                continue
            raise
        if blocked(candidate.user):
            continue
        if not all(can_read_instrument(candidate, record, ranks[record['confidentiality_class_id']])
                   for link in links for record in link):
            continue
        for role, key in [('REVIEWER', 'reviewers'), ('APPROVER', 'approvers')]:
            if all(candidate.covers(child['regulatory_owner_unit_id'], {role}) for child, _ in links):
                result[key].append(dict(user))
    return result
