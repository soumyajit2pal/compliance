"""Administrator-maintained reference data; identities and audit history are retained."""
from datetime import date
from typing import Literal
import re
import sqlalchemy as sa
from fastapi import HTTPException
from pydantic import Field, ValidationError, field_validator, model_validator
from . import models as m, repository as repo
from .schemas import Input
from .events import audit, new_id


class MasterChange(Input):
    values: dict = Field(min_length=1, max_length=25)
    reason: str = Field(min_length=5, max_length=2000)


class Record(Input):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=250)
    active_flag: bool = True

    @field_validator('code')
    @classmethod
    def valid_code(cls, value):
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', value):
            raise ValueError('Use letters, numbers, dots, slashes, underscores or hyphens for the code.')
        return value.upper()


class DatedRecord(Record):
    effective_from: date
    effective_to: date | None = None

    @model_validator(mode='after')
    def dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError('Effective to must be later than Effective from (the end date is exclusive).')
        return self


class Organisation(DatedRecord):
    code: str = Field(min_length=1, max_length=30)
    unit_type: Literal['BANK', 'HO', 'VERTICAL', 'DEPARTMENT', 'ZONE', 'REGION', 'BRANCH']
    parent_org_unit_id: str | None = None


class Domain(DatedRecord):
    code: str = Field(min_length=1, max_length=30)
    active_flag: bool = False
    description: str = Field(min_length=1, max_length=10000)
    scheme_id: str
    parent_domain_id: str | None = None
    display_sequence: int = Field(default=1, ge=0, le=1000000)
    domain_owner_unit_id: str | None = None

    @model_validator(mode='after')
    def ownership(self):
        if not self.code.startswith('REG-'):
            raise ValueError('Regulatory domain codes must start with REG-.')
        if self.active_flag and not self.domain_owner_unit_id:
            raise ValueError('Assign an owning department before enabling review submissions.')
        return self


class Regulator(DatedRecord):
    code: str = Field(min_length=1, max_length=20)
    regulator_type: str = Field(min_length=1, max_length=40)
    jurisdiction: str = Field(min_length=1, max_length=100)
    parent_regulator_id: str | None = None


class InstrumentType(Record):
    code: str = Field(min_length=1, max_length=20)
    authority_level: int | None = Field(default=None, ge=0, le=1000000)
    creates_obligation_flag: bool = True
    impact_assessment_required_flag: bool = True


class Category(Record):
    code: str = Field(min_length=1, max_length=20)


class Frequency(Record):
    code: str = Field(min_length=1, max_length=30)
    schedule_rule: str | None = Field(default=None, max_length=250)


class Confidentiality(Record):
    code: str = Field(min_length=1, max_length=30)
    rank_number: int = Field(ge=0, le=1000000)


class Process(Record):
    parent_process_id: str | None = None
    owner_unit_id: str
    criticality: Literal['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] = 'MEDIUM'


# A single allowlist drives validation, API metadata and the shared frontend form.
DEFINITIONS = {
    'regulatory_domain': ('Regulatory domain', Domain, 'parent_domain_id', 'domain_level'),
    'regulator': ('Regulator', Regulator, 'parent_regulator_id', None),
    'instrument_type': ('Instrument type', InstrumentType, None, None),
    'obligation_category': ('Obligation category', Category, None, None),
    'frequency': ('Frequency', Frequency, None, None),
    'evidence_type': ('Evidence type', Record, None, None),
    'confidentiality_class': ('Confidentiality class', Confidentiality, None, None),
    'process': ('Process', Process, 'parent_process_id', None),
    'role': ('Application role', Record, None, None),
    'organisational_unit': ('Organisation unit', Organisation, 'parent_org_unit_id', 'level_number'),
}
REFERENCES = {
    'parent_org_unit_id': 'organisational_unit', 'domain_owner_unit_id': 'organisational_unit',
    'owner_unit_id': 'organisational_unit', 'scheme_id': 'taxonomy_scheme',
    'parent_domain_id': 'regulatory_domain', 'parent_regulator_id': 'regulator',
    'parent_process_id': 'process',
}
LABELS = {
    'active_flag': 'Active', 'creates_obligation_flag': 'Creates obligations',
    'impact_assessment_required_flag': 'Impact assessment required', 'rank_number': 'Sensitivity rank',
    'domain_owner_unit_id': 'Owning department', 'owner_unit_id': 'Owner organisation',
    'scheme_id': 'Taxonomy scheme', 'parent_org_unit_id': 'Parent organisation',
    'parent_domain_id': 'Parent domain', 'parent_regulator_id': 'Parent regulator',
    'parent_process_id': 'Parent process',
}


def catalogue():
    result = []
    for key, (label, model, parent, _level) in DEFINITIONS.items():
        schema = model.model_json_schema()
        fields = []
        for name, spec in schema['properties'].items():
            if key == 'role' and name == 'active_flag':
                continue  # Role codes/activation are part of the deployed permission model.
            details = next((s for s in spec.get('anyOf', []) if s.get('type') != 'null'), spec)
            kind = 'reference' if name in REFERENCES else (
                'select' if 'enum' in details else 'date' if details.get('format') == 'date' else
                'checkbox' if details.get('type') == 'boolean' else
                'number' if details.get('type') == 'integer' else 'textarea' if name == 'description' else 'text')
            fields.append(dict(name=name, label=LABELS.get(name, name.replace('_', ' ').capitalize()),
                kind=kind, required=name in schema.get('required', []),
                source=REFERENCES.get(name), choices=details.get('enum', []),
                default=spec.get('default'), max_length=details.get('maxLength'),
                minimum=details.get('minimum'), maximum=details.get('maximum'),
                immutable=name == 'code'))
        result.append(dict(key=key, label=label, fields=fields, parent_field=parent,
            can_create=key != 'role', note='Application role codes and activation are deployment-controlled; role names can be edited.' if key == 'role' else ''))
    return result


def _tree_values(rows, identifier, values, parent_field, level_field):
    """Validate the whole proposed graph and calculate descendants after a move."""
    nodes = {row['id']: dict(row) for row in rows}
    nodes[identifier] = {**nodes.get(identifier, {}), **values, 'id': identifier}
    levels = {}
    def depth(key, path):
        if key in levels:
            return levels[key]
        if key in path:
            raise HTTPException(422, 'A record cannot be its own parent or a descendant’s child.')
        parent = nodes[key].get(parent_field)
        if parent and parent not in nodes:
            raise HTTPException(422, 'The selected parent no longer exists. Refresh and select another parent.')
        levels[key] = depth(parent, path | {key}) + 1 if parent else (1 if level_field == 'domain_level' else 0)
        return levels[key]
    for key in nodes:
        depth(key, set())
    return nodes, levels


def save(db, actor, key, payload, identifier=None):
    actor.require({'ADMIN'})
    if key not in DEFINITIONS:
        raise HTTPException(404, 'This master is not editable.')
    _label, model, parent_field, level_field = DEFINITIONS[key]
    table = getattr(m, key)
    # Lock the existing graph in a consistent order before any parent mutation.
    rows = [dict(r) for r in db.execute(sa.select(table).order_by(table.c.id).with_for_update()).mappings()]
    old = next((r for r in rows if r['id'] == identifier), None) if identifier else None
    if identifier and not old:
        raise HTTPException(404, 'Record not found.')
    if key == 'role' and not old:
        raise HTTPException(422, 'Application roles are deployment-controlled; edit an existing role name.')
    if key == 'role' and set(payload.values) - {'name', 'code'}:
        raise HTTPException(422, 'Only an application role’s display name can be edited.')
    if old and 'code' in payload.values and payload.values['code'] != old['code']:
        raise HTTPException(422, 'Codes are permanent. Edit the name or add a new record.')
    if key == 'regulator' and old and old['approval_status'] != 'DRAFT':
        raise HTTPException(409, 'This regulator is governed by retained approval history and cannot be edited here.')
    unknown = set(payload.values) - set(model.model_fields)
    if unknown:
        raise HTTPException(422, 'Unsupported master fields: ' + ', '.join(sorted(unknown)))
    merged = {k: old[k] for k in model.model_fields if old and k in old}
    merged.update(payload.values)
    try:
        values = model.model_validate(merged).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, '; '.join(str(e['msg']) for e in exc.errors())) from exc
    if old:
        # Historic codes can use mixed case (for example MoF). Creation
        # normalisation must never rewrite a permanent existing identity.
        values['code'] = old['code']
    if any(r['code'].upper() == values['code'].upper() and r['id'] != identifier for r in rows):
        raise HTTPException(409, 'This code already exists. Choose a unique code.')
    if key == 'organisational_unit' and old and old['code'] == 'BANK' and (
        values['unit_type'] != 'BANK' or values['parent_org_unit_id'] or not values['active_flag'] or
        values['effective_from'] != old['effective_from'] or values['effective_to'] != old['effective_to']):
        raise HTTPException(422, 'The BANK root must retain its type, active status and effective dates, with no parent.')
    for field, source in REFERENCES.items():
        if field not in values or not values[field]:
            continue
        if old and old.get(field) == values[field]:
            continue  # Existing retained references stay editable by name.
        reference = repo.active(db, getattr(m, source), values[field])
        if field == 'domain_owner_unit_id' and reference['unit_type'] != 'DEPARTMENT':
            raise HTTPException(422, 'Select an active department as the domain owner.')
    if key == 'regulatory_domain' and values['active_flag']:
        owner = repo.active(db, m.organisational_unit, values['domain_owner_unit_id'])
        if owner['unit_type'] != 'DEPARTMENT':
            raise HTTPException(422, 'Select an active department as the domain owner.')
    identifier = identifier or new_id()
    changed = {identifier}
    levels = {}
    if parent_field:
        nodes, levels = _tree_values(rows, identifier, values, parent_field, level_field)
        if key == 'organisational_unit' and not values['active_flag'] and any(
            r.get(parent_field) == identifier and r['active_flag'] for r in nodes.values()):
            raise HTTPException(422, 'Deactivate or move active child units before deactivating their parent.')
        if key == 'regulatory_domain' and any(r.get(parent_field) and nodes[r[parent_field]]['scheme_id'] != r['scheme_id'] for r in nodes.values()):
            raise HTTPException(422, 'Parent and child domains must use the same taxonomy scheme.')
        if level_field:
            values[level_field] = levels[identifier]
    if old:
        db.execute(table.update().where(table.c.id == identifier).values(**values))
    else:
        if key == 'regulator':
            values.update(approval_status='DRAFT', created_by=actor.id)
        db.execute(table.insert().values(id=identifier, **values))
    if level_field:
        affected = {identifier}
        while True:
            descendants = {r['id'] for r in rows if r.get(parent_field) in affected}
            if descendants <= affected:
                break
            affected.update(descendants)
        for row in rows:
            if row['id'] != identifier and row['id'] in affected and row[level_field] != levels[row['id']]:
                db.execute(table.update().where(table.c.id == row['id']).values(**{level_field: levels[row['id']]}))
                changed.add(row['id'])
                audit(db, actor, key, row['id'], 'MASTER_LEVEL_UPDATED', old={level_field: row[level_field]},
                    new={level_field: levels[row['id']]}, reason=payload.reason)
    audit(db, actor, key, identifier, 'MASTER_UPDATED' if old else 'MASTER_CREATED',
        old=old, new=values, reason=payload.reason)
    return {'id': identifier, 'records': [dict(row) for row in db.execute(
        sa.select(table).where(table.c.id.in_(changed)).order_by(table.c.id)).mappings()]}
