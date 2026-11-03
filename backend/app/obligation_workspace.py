"""Read-only assessment/assignment projections over already authorised obligation groups."""


def current(row):
    return not row.get('ended_by_change_id') and row.get('approval_status') not in {'WITHDRAWN', 'REJECTED'}


def response(row):
    if not current(row):
        return None
    decision = row.get('validation_decision')
    task = row.get('validation_task') or {}
    if decision == 'OBJECT':
        return 'OBJECT'
    if decision == 'PENDING' and task.get('workflow_status') == 'OPEN':
        return 'PENDING'
    if decision == 'ACCEPT' and row.get('approval_status') != 'DRAFT' and task.get('workflow_status') not in {'RETURNED', 'WITHDRAWN', 'REJECTED'}:
        return 'ACCEPT'
    return None


def workspace_rows(groups, perspective, filters, actor_id):
    """Keep gaps explicit and apply all row filters before pagination and totals.

    A department with recorded owners and no assessment is unassessed, never
    implicitly applicable. Missing owner rows describe required roles only;
    they do not create assignments or invent a Control owner's department.
    """
    if filters.get('response') and filters['response'] not in {'PENDING', 'ACCEPT', 'OBJECT'}:
        from fastapi import HTTPException
        raise HTTPException(422, 'Choose a listed owner response.')
    result = []
    for group in groups:
        obligation = group['obligation']
        context = {key: group[key] for key in ['obligation', 'source']}
        departments = group['departments']
        owners = [row for unit in departments for row in unit['owners']]
        candidates = []
        if perspective == 'applicability':
            scopes = [*departments]
            if group.get('unallocated_assessments'):
                scopes.append({'id': None, 'name': None, 'assessments': group['unallocated_assessments'], 'owners': []})
            if not scopes:
                scopes = [{'id': obligation.get('business_owner_unit_id'), 'name': None, 'assessments': [], 'owners': []}]
            for unit in scopes:
                assessments = unit['assessments']
                missing = {'id': 'missing-assessment:' + obligation['id'] + ':' + str(unit['id']), 'org_unit_id': unit['id']}
                candidates_for_unit = [(row, False) for row in assessments]
                if not any(current(row) for row in assessments):
                    candidates_for_unit.append((missing, True))
                for row, gap in candidates_for_unit:
                    candidates.append(({**row, **context, 'department_name': unit['name'], 'kind': 'MISSING_ASSESSMENT' if gap else 'ASSESSMENT'}, unit))
        else:
            for unit in departments:
                for row in unit['owners']:
                    candidates.append(({**row, **context, 'department_name': unit['name'], 'kind': 'ASSIGNMENT' if row.get('user_id') else 'MISSING_OWNER'}, unit))
            for role in ['REGULATORY', 'BUSINESS', 'CONTROL', 'COMPLIANCE_REVIEWER']:
                selected = [row for row in owners if current(row) and row['owner_role'] == role and (role not in {'REGULATORY', 'BUSINESS'} or row.get('primary_owner_flag'))]
                if selected:
                    continue
                unit_id = obligation.get('business_owner_unit_id') if role == 'BUSINESS' else obligation.get('regulatory_owner_unit_id') if role in {'REGULATORY', 'COMPLIANCE_REVIEWER'} else None
                unit = next((unit for unit in departments if unit['id'] == unit_id), {'id': unit_id, 'name': None, 'assessments': [], 'owners': []})
                candidates.append(({'id': 'missing-owner:' + obligation['id'] + ':' + role, **context, 'kind': 'MISSING_OWNER', 'owner_role': role, 'primary_owner_flag': int(role in {'REGULATORY', 'BUSINESS'}), 'org_unit_id': unit_id, 'department_name': unit['name']}, unit))
        for row, unit in candidates:
            if filters.get('history') != '1' and not current(row):
                continue
            gap = row['kind'].startswith('MISSING_')
            if filters.get('gap') == '1' and not gap:
                continue
            if filters.get('department') and row.get('org_unit_id') != filters['department']:
                continue
            assessment_values = {'applicability_status': filters.get('assessment'), 'legal_entity_id': filters.get('legal_entity'), 'approval_status': filters.get('assessment_approval') or (filters.get('approval') if perspective == 'applicability' else None)}
            owner_values = {'owner_role': filters.get('role'), 'user_id': filters.get('owner'), 'approval_status': filters.get('assignment_approval') or (filters.get('approval') if perspective == 'accountability' else None)}
            def matches(value, values):
                return all(str(value.get(key) or '') == expected for key, expected in values.items() if expected)
            if any(assessment_values.values()) and not any(matches(value, assessment_values) for value in ([row] if perspective == 'applicability' else unit['assessments'])):
                continue
            if any(owner_values.values()) and not any(matches(value, owner_values) for value in ([row] if perspective == 'accountability' else unit['owners'])):
                continue
            owner_candidates = [row] if perspective == 'accountability' else unit['owners']
            if (filters.get('response') or filters.get('mine') == '1') and not any(
                matches(value, owner_values) and (not filters.get('response') or response(value) == filters['response']) and
                (filters.get('mine') != '1' or current(value) and value.get('user_id') == actor_id) for value in owner_candidates
            ):
                continue
            needle = filters.get('q', '').strip().casefold()
            if needle and needle not in str(row).casefold():
                continue
            row['retained'] = not current(row)
            result.append(row)
    return result


def workspace_summary(rows, perspective):
    if perspective == 'applicability':
        return {
            'assessments': sum(row['kind'] == 'ASSESSMENT' and not row['retained'] for row in rows),
            'partial': sum(row.get('applicability_status') == 'PARTIALLY_APPLICABLE' and not row['retained'] for row in rows),
            'exclusions': sum(row.get('applicability_status') == 'NOT_APPLICABLE' and not row['retained'] for row in rows),
            'unassessed': sum(row['kind'] == 'MISSING_ASSESSMENT' for row in rows),
        }
    return {
        'awaiting': sum(response(row) == 'PENDING' for row in rows),
        'accepted': sum(response(row) == 'ACCEPT' for row in rows),
        'objected': sum(response(row) == 'OBJECT' for row in rows),
        'missing': sum(row['kind'] == 'MISSING_OWNER' and not row['retained'] for row in rows),
    }


def workspace_groups(rows):
    """Group all matching children before pagination; revision IDs remain distinct."""
    groups = {}
    for row in rows:
        identifier = row['obligation']['id']
        if identifier not in groups:
            groups[identifier] = {'obligation': row['obligation'], 'source': row['source'], 'records': []}
        groups[identifier]['records'].append({key: value for key, value in row.items() if key not in {'obligation', 'source'}})
    return list(groups.values())


def workspace_counts(rows, groups, perspective):
    """Result counts include retained matches; summary tiles describe current records."""
    counts = {'obligations': len(groups), 'records': len(rows)}
    if perspective == 'applicability':
        counts.update(assessments=sum(row['kind'] == 'ASSESSMENT' for row in rows),
                      unassessed=sum(row['kind'] == 'MISSING_ASSESSMENT' for row in rows))
    else:
        counts.update(assignments=sum(row['kind'] == 'ASSIGNMENT' for row in rows),
                      missing=sum(row['kind'] == 'MISSING_OWNER' for row in rows))
    return counts
