"""Dependency-aware workbook imports using existing staging and repository rules.

Source rows stay immutable. Batch reconciliation notes hold the versioned source
manifest; validation JSON records workbook references and their resolved lineage.
No business target or document row is created before independently validated load.
"""
import hashlib
import json
from collections import Counter, defaultdict, deque

import sqlalchemy as sa
from fastapi import HTTPException

from . import models as m, repository as repo,business_ids, combined_family_links, import_hierarchy, notification_families
from .access import actor_for
from .events import audit, new_id, now
from .import_template import canonical_header, CLAUSES_SHEET, CLAUSE_FIELDS, FIELDS, FAMILY_FIELDS
from .schemas import ClauseInput, InstrumentInput, FamilyLinkInput
from .source_documents import inspect_source, preserve_bytes, save_document
from .storage import stored_path
from .upload_policy import MAX_ATTACHMENTS, MAX_BUNDLE_MIB, MIB

FORMAT = 'regulatory-clauses-v1'
MAX_BUNDLE_BYTES = MAX_BUNDLE_MIB * MIB
FLAGS = {key for key, *_ in CLAUSE_FIELDS if key.endswith('_flag')}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def canonical(raw):
    return {canonical_header(k): str(v).strip() if v is not None else '' for k, v in raw.items()}


def manifest(batch):
    try:
        data = json.loads(batch.get('reconciliation_notes') or '{}')
        return data if isinstance(data, dict) and data.get('format') == FORMAT else None
    except (ValueError, TypeError):
        return None


def is_combined(rows, attachments=()):
    return bool(attachments) or any(
        any(canonical(raw).get(k) for k in ('import_reference', 'source_file_name', 'source_edition', 'existing_instrument_code', *FAMILY_FIELDS))
        or (sheet == CLAUSES_SHEET and not canonical(raw).get('instrument_version_id'))
        for sheet, _, raw in rows)


def read_attachment(storage, attachment):
    path = stored_path(storage, attachment['id'], attachment['file_name'], staging=attachment.get('kind') != 'document')
    if not path.is_file():
        raise HTTPException(409, 'An imported source file is unavailable. Contact the repository administrator.')
    data = path.read_bytes()
    if len(data) != attachment['file_size'] or hashlib.sha256(data).hexdigest() != attachment['file_hash']:
        raise HTTPException(409, 'An imported source file failed its integrity check.')
    return path, data


def batch_rows(db, identifier, *, lock=False):
    query = sa.select(m.migration_row).where(m.migration_row.c.batch_id == identifier).order_by(
        m.migration_row.c.sheet_name, m.migration_row.c.row_number)
    if lock:
        query = query.with_for_update()
    return [dict(r) for r in db.execute(query).mappings()]


def row_data(rows):
    return [(r['sheet_name'], r['row_number'], json.loads(r['source_payload'])) for r in rows]


def referenced_files(rows):
    return {canonical(raw).get('source_file_name') for _, _, raw in rows if canonical(raw).get('source_file_name')}


def reuse_existing_headings(clauses, existing, parent_refs):
    if not existing:
        return
    candidates = defaultdict(list)
    for row in existing:
        reference = row['source_clause_reference']
        candidates[(row['parent_clause_id'], reference, None if reference else row['heading'])].append(row)
    resolved = {ref: row['id'] for ref, row in parent_refs.items()}
    for row in sorted(clauses, key=lambda item: item.get('load_order', len(clauses))):
        parent = row['parent_reference']
        if not row.get('hierarchy_path') or row['errors'] or (parent and parent not in resolved):
            continue
        values = row['normalised']
        reference = values['source_clause_reference']
        matches = candidates[(resolved.get(parent), reference, None if reference else values['heading'])]
        if matches and not row.get('generated_heading'):
            row['errors'].append('This hierarchy path already contains a clause in the Draft. Edit the existing clause or import a different path.')
        elif len(matches) > 1:
            row['errors'].append('Multiple existing clauses match this generated parent. Use an explicit parent clause reference.')
        elif matches:
            row['existing_heading_id'] = matches[0]['id']
            resolved[row['clause_reference']] = matches[0]['id']


def plan(db, uploader, rows, sources, *, batch_id=None, loaded_targets=None, storage=None, check_attached=False):
    from .migration_service import normalise
    results = []
    hierarchy = import_hierarchy.project(rows)
    groups = defaultdict(list)
    records = defaultdict(list)
    loaded_targets = loaded_targets or {}
    source_by_name = {s['file_name']: s for s in sources}
    reserved = set()
    has_clauses = any(sheet == CLAUSES_SHEET or canonical(raw).get('entity_type') == 'clause' for sheet, _, raw in rows)
    prior = sa.select(m.migration_row.c.validation_errors).where(
        m.migration_row.c.validation_status.in_(['CONTENT_VALIDATION_PENDING', 'MIGRATION_READY', 'LOADED']))
    if batch_id:
        prior = prior.where(m.migration_row.c.batch_id != batch_id)
    for value in db.execute(prior).scalars():
        previous = json.loads(value or '{}')
        existing_target = previous.get('entity_type') == 'instrument' and previous.get('normalised', {}).get('version_id')
        if not previous.get('errors') and previous.get('fingerprint') and not existing_target:
            reserved.add(previous['fingerprint'])
    for sheet, number, raw in rows:
        data = canonical(raw)
        duplicate_headers = len(data) != len(raw)
        kind = 'clause' if sheet in {CLAUSES_SHEET, import_hierarchy.GENERATED_SHEET} else data.get('entity_type', 'instrument').lower()
        generated = False
        hierarchy_errors = []
        if (sheet, number) in hierarchy:
            data, hierarchy_errors, generated = hierarchy[sheet, number]
        reference = data.get('import_reference', '')
        if not reference and kind == 'instrument':
            reference = f'row:{sheet}:{number}'
        result = {'entity_type': kind, 'normalised': {}, 'errors': [], 'load_available': True,
            'group_reference': reference, 'sheet_name': sheet, 'row_number': number,
            'clause_reference': data.get('clause_import_reference', ''),
            'parent_reference': data.get('parent_import_reference', ''), 'source': raw}
        result['errors'].extend(hierarchy_errors)
        if (sheet, number) in hierarchy:
            result['hierarchy_path'] = list(import_hierarchy.path_for(data))
        if generated:
            result['generated_heading'] = True
        results.append(result)
        groups[reference].append(result)
        if kind == 'instrument':
            records[reference].append(result)
        if reference in loaded_targets:
            result['loaded_group'] = True
            continue
        if duplicate_headers:
            result['errors'].append('Duplicate columns refer to the same field')
        if kind == 'instrument' and not data.get('import_reference'):
            if has_clauses:
                result['errors'].append('Enter an Import reference for each Regulatory records row when the workbook contains Clauses')
            elif any(data.get(key) for key in FAMILY_FIELDS):
                result['errors'].append('Enter an Import reference for every record with a notification relationship')
        if not reference or len(reference) > 100:
            result['errors'].append('Enter an Import reference up to 100 characters')
        allowed = {f[0] for f in (CLAUSE_FIELDS if kind == 'clause' else FIELDS)} | {'entity_type'}
        unknown = [str(k) for k, v in data.items() if v and k not in allowed]
        if unknown:
            result['errors'].append('Unsupported populated columns: ' + ', '.join(unknown))
        if kind == 'instrument':
            existing = data.get('existing_instrument_code')
            edition = data.get('source_edition') or '1.0'
            result['edition_number'] = edition
            if existing:
                if not data.get('source_edition'):
                    result['errors'].append('Enter the exact Source edition for an existing Draft target')
                if len(existing)>200 or len(edition)>100:
                    result['errors'].append('Existing instrument code or Source edition is too long')
                    continue
                try:
                    target = business_ids.resolve(db,'instrument',existing)
                    if not target:
                        raise HTTPException(422, 'Existing instrument was not found in your authorised area')
                    instrument = repo.read_instrument(db, uploader, target)
                    version = db.execute(sa.select(m.instrument_version).where(
                        m.instrument_version.c.instrument_id == target, m.instrument_version.c.version_number == edition)).mappings().first()
                    if not version or version['approval_status'] != 'DRAFT' or version['created_by'] != uploader.id:
                        raise HTTPException(422, 'Existing target must be a Draft edition created by the uploading Author')
                    if any(data.get(k) for k in {f[0] for f in FIELDS} - {
                            'import_reference', 'source_edition', 'existing_instrument_code', 'source_record_id'}):
                        result['errors'].append('For an existing Draft, fill only Import reference, Source edition, Existing instrument code and optional Existing register reference')
                    existing_clauses = [dict(r) for r in db.execute(sa.select(m.regulatory_clause).where(
                        m.regulatory_clause.c.instrument_version_id == version['id']).order_by(m.regulatory_clause.c.id)).mappings()]
                    result['normalised'] = {'version_id': version['id'], 'instrument_id': target,
                        'title': instrument['title'], 'source_document_id': version['source_document_id']}
                    result['target_snapshot'] = digest([dict(version), instrument, existing_clauses])
                    result['existing_parents'] = {r['code']: {'id': r['id'], 'clause_level': r['clause_level']} for r in existing_clauses}
                    old_codes=business_ids.aliases(db,'clause',[r['id'] for r in existing_clauses])
                    for row in existing_clauses:
                        for code in old_codes.get(row['id'],[]):result['existing_parents'][code]={'id':row['id'],'clause_level':row['clause_level']}
                    result['existing_signatures'] = {digest([r['source_clause_reference'], r['heading'], r['clause_text']]) for r in existing_clauses}
                    result['existing_clauses'] = existing_clauses
                    result['fingerprint'] = digest(['existing-edition', version['id']])
                except HTTPException as exc:
                    result['errors'].append(str(exc.detail))
            else:
                if edition != '1.0':
                    result['errors'].append('New regulatory records start at source edition 1.0')
                filename = data.get('source_file_name')
                attachment = source_by_name.get(filename) if filename else None
                if filename and data.get('source_document_id'):
                    result['errors'].append('Choose Source file name or Source document ID, not both')
                if filename and not attachment:
                    result['errors'].append('Source file name does not match an attached file: ' + filename)
                checked = normalise(db, raw, source_attachment=attachment)
                result['normalised'] = checked['normalised']
                result['errors'].extend(checked['errors'])
                result['fingerprint'] = checked['fingerprint']
                if attachment:
                    result['source_attachment'] = attachment
        elif kind == 'clause':
            values = {key: data.get(key) or None for key in ('heading', 'source_clause_reference',
                'source_page_reference', 'clause_text', 'internal_interpretation')}
            # Identifiers are trimmed; regulatory wording retains its source whitespace.
            for key in ('clause_text', 'internal_interpretation'):
                original = next((v for k, v in raw.items() if canonical_header(k) == key), None)
                values[key] = str(original) if original is not None and str(original).strip() else None
            if generated:
                values.update(heading_only_flag=True, mandatory_flag=False,
                              clause_text=values['source_clause_reference'] or values['heading'])
            for key in (('heading',) if generated else ('heading', 'source_page_reference', 'clause_text')):
                if not values[key]:
                    result['errors'].append('Missing ' + {'heading': 'Clause heading', 'source_page_reference': 'Source page reference', 'clause_text': 'Original regulatory text'}[key])
            for key in FLAGS:
                value = data.get(key, '').casefold()
                if value:
                    if value not in {'yes', 'no', 'true', 'false', '1', '0'}:
                        result['errors'].append(key.removesuffix('_flag').title() + ' must be Yes or No')
                    else:
                        values[key] = value in {'yes', 'true', '1'}
            try:
                result['normalised'] = ClauseInput(**values).model_dump(
                    exclude=set() if generated else {'heading_only_flag'})
            except Exception:
                result['errors'].append('Invalid clause field length or required value')
            if not result['clause_reference'] or len(result['clause_reference']) > 100:
                result['errors'].append('Enter a Clause import reference up to 100 characters')
            if len(result['parent_reference']) > 100:
                result['errors'].append('Parent clause reference must be at most 100 characters')
            if any(isinstance(v, float) for k, v in raw.items() if canonical_header(k) == 'source_clause_reference'):
                result['errors'].append('Enter Source clause / para number as text to preserve numbering such as 5.10')
            if any(str(values.get(k) or '').casefold().startswith('example only') for k in ('heading','clause_text')):
                result['errors'].append('Replace example clauses with actual source wording before importing')
        else:
            result['errors'].append('Combined imports support regulatory records and clauses only')

    checked_files = {}
    for result in results:
        if result['entity_type'] != 'instrument' or result.get('loaded_group'):
            continue
        source = result.get('source_attachment')
        document_id = result['normalised'].get('source_document_id')
        if not source and document_id and len(document_id)<=100:
            document = db.execute(sa.select(m.document).where(m.document.c.id == document_id)).mappings().first()
            if document and document['storage_uri'] == 'portal://' + document_id:
                source = {k: document[k] for k in ('id','file_name','content_type','file_size','file_hash')}
                source['kind'] = 'document'
                result['source_document'] = source
            else:
                result['errors'].append('Source document must be a locally stored portal source')
        if storage and source and (check_attached or source.get('kind') == 'document'):
            if source['id'] not in checked_files:
                try:
                    read_attachment(storage, source)
                    checked_files[source['id']] = None
                except HTTPException as exc:
                    checked_files[source['id']] = str(exc.detail)
            if checked_files[source['id']]:
                result['errors'].append(checked_files[source['id']])
    identities = Counter(r.get('fingerprint') for r in results if r['entity_type'] == 'instrument' and not r.get('loaded_group') and r.get('fingerprint'))
    for reference, members in groups.items():
        if reference in loaded_targets:
            continue
        headers = records[reference]
        clauses = [r for r in members if r['entity_type'] == 'clause']
        if len(headers) != 1:
            for r in members:
                r['errors'].append('Import reference must identify exactly one Regulatory records row')
            continue
        record = headers[0]
        fingerprint = record.get('fingerprint')
        if fingerprint and (identities[fingerprint] > 1 or (fingerprint in reserved and not record['normalised'].get('version_id'))):
            record['errors'].append('Duplicate regulatory record or Draft target in the imported population')
        if record['normalised'].get('version_id') and not clauses:
            record['errors'].append('Add at least one clause for the existing Draft target')
        clause_refs = defaultdict(list)
        for clause in clauses:
            clause_refs[clause['clause_reference']].append(clause)
        existing_parents = record.get('existing_parents', {})
        edges, indegree = defaultdict(list), {id(r): 0 for r in clauses}
        local_signatures = set()
        for clause in clauses:
            if len(clause_refs[clause['clause_reference']]) != 1:
                clause['errors'].append('Duplicate Clause import reference within this edition')
            if clause['clause_reference'] in existing_parents:
                clause['errors'].append('Clause import reference conflicts with an existing permanent clause code')
            child_edition = canonical(clause['source']).get('source_edition')
            if child_edition and child_edition != record['edition_number']:
                clause['errors'].append('Clause source edition must match its Regulatory records row')
            parent = clause['parent_reference']
            if parent:
                parents = clause_refs.get(parent, [])
                if len(parents) == 1:
                    indegree[id(clause)] += 1
                    edges[id(parents[0])].append(clause)
                elif parent in existing_parents:
                    clause['normalised']['parent_clause_id'] = existing_parents[parent]['id']
                    clause['depth'] = existing_parents[parent]['clause_level'] + 1
                else:
                    clause['errors'].append('Parent clause reference is missing, ambiguous or outside this record and edition')
            values = clause['normalised']
            signature = digest([values.get('source_clause_reference'), values.get('heading'), values.get('clause_text')])
            clause['fingerprint'] = digest(['combined-clause', fingerprint, clause.get('hierarchy_path') or signature])
            if not clause.get('hierarchy_path') and signature in local_signatures:
                clause['errors'].append('Duplicate clause content in the target edition or imported population')
            if not clause.get('hierarchy_path'):
                local_signatures.add(signature)
        queue = deque(r for r in clauses if not indegree[id(r)])
        order = 0
        while queue:
            clause = queue.popleft()
            clause['load_order'] = order
            clause.setdefault('depth', 1)
            order += 1
            for child in edges[id(clause)]:
                child['depth'] = clause['depth'] + 1
                indegree[id(child)] -= 1
                if not indegree[id(child)]:
                    queue.append(child)
        reuse_existing_headings(clauses, record.get('existing_clauses'), existing_parents)
        for clause in clauses:
            if indegree[id(clause)]:
                clause['errors'].append('Parent clause hierarchy contains a cycle or depends on one')
            values = clause['normalised']
            signature = digest([values.get('source_clause_reference'), values.get('heading'), values.get('clause_text')])
            if clause.get('existing_heading_id'):
                clause['fingerprint'] = None
            elif (not clause.get('hierarchy_path') and signature in record.get('existing_signatures', ())) or clause['fingerprint'] in reserved:
                clause['errors'].append('Duplicate clause content in the target edition or imported population')
        for r in members:
            r['edition_number'] = record['edition_number']
            r['errors'] = sorted(set(r['errors']))
        if any(r['errors'] for r in members):
            for r in members:
                if not r['errors']:
                    r['errors'].append('This record and its clauses are pending corrections in another row of the group')
    combined_family_links.validate_links(db, uploader, records, groups, loaded_targets, canonical)
    for r in results:
        r.pop('source', None)
        r.pop('existing_parents', None)
        r.pop('existing_signatures', None)
        r.pop('existing_clauses', None)
    return results


def stage(db, actor, filename, data, rows, source_system, storage, source_files):
    if len(source_files) > MAX_ATTACHMENTS or len(data) + sum(len(v) for _, v in source_files) > MAX_BUNDLE_BYTES:
        raise HTTPException(422, f'Import up to {MAX_ATTACHMENTS} source files and {MAX_BUNDLE_MIB} MiB in total.')
    sources, filenames = [], set()
    for name, content in source_files:
        details = inspect_source(name, content)
        if details['file_name'].casefold() in filenames:
            raise HTTPException(422, 'Attached source filenames must be unique, including letter case.')
        filenames.add(details['file_name'].casefold())
        sources.append({'id': new_id(), **details})
    unused = {s['file_name'] for s in sources} - referenced_files(rows)
    if unused:
        raise HTTPException(422, 'These source files are not referenced in Regulatory records: ' + ', '.join(sorted(unused)))
    workbook_hash = hashlib.sha256(data).hexdigest()
    bundle_hash = digest([workbook_hash, sorted((s['file_name'], s['file_hash']) for s in sources)])
    if db.execute(sa.select(m.migration_batch.c.id).where(m.migration_batch.c.file_hash == bundle_hash)).first():
        raise HTTPException(409, 'This exact workbook and source bundle has already been staged. Open its existing batch.')
    if any(sheet == import_hierarchy.GENERATED_SHEET for sheet, _, _ in rows):
        raise HTTPException(422, 'Generated headings is reserved for headings created by the portal.')
    rows = import_hierarchy.expand(rows)
    profiles = plan(db, actor, rows, sources, storage=storage)
    identifier = new_id()
    notes = {'format': FORMAT, 'workbook_sha256': workbook_hash, 'sources': sources}
    db.execute(m.migration_batch.insert().values(id=identifier, code='MIG-' + identifier[:12], source_file=filename,
        file_hash=bundle_hash, uploaded_by=actor.id, uploaded_at=now(), source_count=len(rows),
        pending_count=len(rows), record_status='PROFILED', reconciliation_notes=json.dumps(notes)))
    for (sheet, number, raw), profile in zip(rows, profiles):
        legacy = hashlib.sha256((bundle_hash + ':' + sheet + ':' + str(number)).encode()).hexdigest()
        db.execute(m.migration_row.insert().values(id=new_id(), batch_id=identifier, sheet_name=sheet,
            row_number=number, source_system=source_system, legacy_id=legacy, source_payload=json.dumps(raw, default=str),
            validation_status='CORRECTION_REQUIRED' if profile['errors'] else 'CONTENT_VALIDATION_PENDING',
            validation_errors=json.dumps(profile)))
    preserve_bytes(db, storage, identifier, filename, data, staging=True)
    for source, (_, content) in zip(sources, source_files):
        preserve_bytes(db, storage, source['id'], source['file_name'], content, staging=True)
    audit(db, actor, 'migration', identifier, 'SOURCE_STAGED', new={
        'file': filename, 'sha256': bundle_hash, 'rows': len(rows), **notes})
    return {'id': identifier}


def preview(batch, rows):
    notes = manifest(batch)
    grouped = defaultdict(list)
    for row in rows:
        grouped[row['profile'].get('group_reference', '')].append(row)
    groups = []
    for reference, members in grouped.items():
        record = next((r for r in members if r['profile']['entity_type'] == 'instrument'), None)
        profiles = [r['profile'] for r in members]
        groups.append({'reference': reference, 'title': record['profile'].get('normalised', {}).get('title', reference) if record else reference,
            'edition_number': profiles[0].get('edition_number'),
            'existing_draft': bool(record and record['profile'].get('normalised', {}).get('version_id')),
            'status': members[0]['validation_status'] if len({r['validation_status'] for r in members}) == 1 else 'CORRECTION_REQUIRED',
            'row_ids': [r['id'] for r in members],
            'clause_row_ids': [r['id'] for r in sorted(members, key=lambda r: r['profile'].get('load_order', 100000)) if r['profile']['entity_type'] == 'clause']})
        if record and record['profile'].get('family_link'):
            groups[-1]['family_link'] = record['profile']['family_link']
            groups[-1]['family_proposal'] = record['profile'].get('family_proposal')
    sources = {s['id']: s for s in notes['sources']}
    for row in rows:
        source = row['profile'].get('source_document')
        if source:
            sources[source['id']] = source
    return {'combined': True, 'sources': list(sources.values()), 'workbook_sha256': notes['workbook_sha256'],
        'groups': groups, 'entity_counts': dict(Counter(r['profile']['entity_type'] for r in rows))}


def fresh_plan(db, batch, rows, storage):
    notes = manifest(batch)
    if storage:
        workbook = stored_path(storage, batch['id'], batch['source_file'], staging=True)
        if not workbook.is_file() or hashlib.sha256(workbook.read_bytes()).hexdigest() != notes['workbook_sha256'] or digest([
                notes['workbook_sha256'], sorted((s['file_name'], s['file_hash']) for s in notes['sources'])]) != batch['file_hash']:
            raise HTTPException(409, 'The original workbook or source manifest failed its integrity check.')
    return plan(db, actor_for(db, batch['uploaded_by']), row_data(rows), notes['sources'],
        batch_id=batch['id'], loaded_targets=loaded_targets(rows), storage=storage, check_attached=True)


def loaded_targets(rows):
    return {json.loads(row['validation_errors'])['group_reference']: row['target_entity_id'] for row in rows
            if row['validation_status'] == 'LOADED' and row['target_entity_type'] == 'instrument'}


def reprofile(db, actor, batch, storage):
    from . import migration_work
    if actor.id != batch['uploaded_by']:
        raise HTTPException(403, 'Only the uploading Author can refresh this combined import.')
    rows = batch_rows(db, batch['id'], lock=True)
    profiles = fresh_plan(db, batch, rows, storage)
    count = 0
    for row, profile in zip(rows, profiles):
        if row['validation_status'] == 'LOADED':
            continue
        db.execute(m.migration_row.update().where(m.migration_row.c.id == row['id']).values(
            validation_status='CORRECTION_REQUIRED' if profile['errors'] else 'CONTENT_VALIDATION_PENDING',
            validation_errors=json.dumps(profile)))
        count += 1
    audit(db, actor, 'migration', batch['id'], 'SOURCE_REPROFILED', new={'rows': count})
    migration_work.request_review(db, batch['id'], actor.id,
        already_pending=any(row['validation_status'] == migration_work.PENDING for row in rows))
    return {'profiled': count}


def validate(db, actor, batch, storage):
    rows = batch_rows(db, batch['id'], lock=True)
    profiles = fresh_plan(db, batch, rows, storage)
    count = 0
    for row, profile in zip(rows, profiles):
        if row['validation_status'] == 'LOADED':
            continue
        status = 'CORRECTION_REQUIRED'
        if not profile['errors']:
            profile.update(validated_by=actor.id, validated_at=now().isoformat())
            status = 'MIGRATION_READY'
            count += 1
        db.execute(m.migration_row.update().where(m.migration_row.c.id == row['id']).values(
            validation_status=status, validation_errors=json.dumps(profile)))
    audit(db, actor, 'migration', batch['id'], 'CONTENT_VALIDATED', new={'ready_rows': count})
    return {'validated': count}


def approval_snapshot(profile):
    return {k: v for k, v in profile.items() if k not in {'validated_by', 'validated_at'}}


def load(db, actor, batch, storage, payload=None):
    if actor.id != batch['uploaded_by']:
        raise HTTPException(403, 'Only the uploading Author can load this combined import.')
    rows = batch_rows(db, batch['id'], lock=True)
    selected = {json.loads(r['validation_errors'])['group_reference'] for r in rows if r['validation_status'] == 'MIGRATION_READY'}
    if not selected:
        raise HTTPException(409, 'No complete migration-ready groups. Correct errors and obtain independent content validation first.')
    for version_id in sorted({json.loads(r['validation_errors']).get('normalised', {}).get('version_id')
            for r in rows if r['validation_status'] == 'MIGRATION_READY'} - {None}):
        repo.read_version(db, actor, version_id, lock=True)
    profiles = fresh_plan(db, batch, rows, storage)
    groups = defaultdict(list)
    for row, profile in zip(rows, profiles):
        if profile.get('group_reference') in selected:
            previous = json.loads(row['validation_errors'])
            if row['validation_status'] != 'MIGRATION_READY' or profile['errors'] or not previous.get('validated_by') or previous['validated_by'] == actor.id or approval_snapshot(profile) != approval_snapshot(previous):
                raise HTTPException(409, f"{row['sheet_name']} row {row['row_number']} changed eligibility. Refresh validation preview and obtain independent content validation again.")
            groups[profile['group_reference']].append((row, profile))
    relationships = [(row, profile) for members in groups.values() for row, profile in members if profile.get('family_link')]
    if relationships and (not payload or not payload.reviewer_id or not payload.approver_id
                          or len({actor.id, payload.reviewer_id, payload.approver_id}) != 3):
        raise HTTPException(422, 'Choose an independent Compliance Reviewer and Final Approver for the notification proposals.')
    # Verify every selected file before making any business target.
    for members in groups.values():
        for _, profile in members:
            if profile.get('source_attachment'):
                read_attachment(storage, profile['source_attachment'])
    instruments = loaded_targets(rows)
    updates = {}
    for reference, members in groups.items():
        record_row, record = next((r, p) for r, p in members if p['entity_type'] == 'instrument')
        values = dict(record['normalised'])
        if values.get('version_id'):
            instrument_id, version_id = values['instrument_id'], values['version_id']
        else:
            attachment = record.get('source_attachment')
            if attachment:
                _, content = read_attachment(storage, attachment)
                document = save_document(db, actor, storage, attachment['file_name'], content,
                    values['regulatory_owner_unit_id'], values['confidentiality_class_id'])
                values['source_document_id'] = document['id']
            created = repo.create_instrument(db, actor, InstrumentInput(**values),imported=True)
            instrument_id, version_id = created['id'], created['version_id']
        instruments[reference] = instrument_id
        loaded_document_id = values['source_document_id']
        targets = {record_row['id']: ('instrument', instrument_id)}
        clause_ids = {}
        for row, profile in sorted(members, key=lambda pair: pair[1].get('load_order', -1)):
            if profile['entity_type'] != 'clause':
                continue
            if profile.get('existing_heading_id'):
                clause_ids[profile['clause_reference']] = profile['existing_heading_id']
                targets[row['id']] = ('clause', profile['existing_heading_id'])
                continue
            values = dict(profile['normalised'])
            if profile['parent_reference'] in clause_ids:
                values['parent_clause_id'] = clause_ids[profile['parent_reference']]
            created = repo.add_clause(db, actor, version_id, ClauseInput(**values),
                                      generated_heading=profile.get('generated_heading', False))
            clause_ids[profile['clause_reference']] = created['id']
            targets[row['id']] = ('clause', created['id'])
        for row, profile in members:
            kind, target = targets[row['id']]
            previous = json.loads(row['validation_errors'])
            previous.update(target_instrument_id=instrument_id, target_version_id=version_id,
                loaded_source_document_id=loaded_document_id)
            updates[row['id']] = (kind, target, previous)
    for row, profile in relationships:
        link = profile['family_link']
        child_id = instruments[profile['group_reference']]
        parent_id = link.get('parent_id') or instruments.get(link['parent_reference'])
        if not parent_id:
            raise HTTPException(409, 'The parent notification is unavailable. Refresh the validation preview and try again.')
        proposal = notification_families.propose_link(db, actor, parent_id, FamilyLinkInput(
            child_id=child_id, relationship_type=link['relationship_type'], effective_from=link['effective_from'],
            reviewer_id=payload.reviewer_id, approver_id=payload.approver_id,
            basis=f"Reviewed import {batch['code']}, Regulatory records row {row['row_number']}. Parent notification {link['parent_reference']}."))
        updates[row['id']][2]['family_proposal'] = {'id': proposal['id'], 'instrument_id': child_id}
    for identifier, (kind, target, lineage) in updates.items():
        db.execute(m.migration_row.update().where(m.migration_row.c.id == identifier).values(
            validation_status='LOADED', target_entity_type=kind, target_entity_id=target,
            loaded_at=now(), validation_errors=json.dumps(lineage)))
    loaded = db.execute(sa.select(sa.func.count()).select_from(m.migration_row).where(
        m.migration_row.c.batch_id == batch['id'], m.migration_row.c.validation_status == 'LOADED')).scalar_one()
    db.execute(m.migration_batch.update().where(m.migration_batch.c.id == batch['id']).values(
        loaded_count=loaded, pending_count=batch['source_count'] - loaded,
        record_status='LOADED' if loaded == batch['source_count'] else 'PARTIALLY_LOADED'))
    result = {'loaded': len(updates), 'groups': len(groups)}
    if relationships:
        result['family_proposals'] = len(relationships)
    audit(db, actor, 'migration', batch['id'], 'DRAFT_ROWS_LOADED',
        new={'loaded_rows': result['loaded'], 'groups': result['groups'], 'family_proposals': len(relationships)})
    return result
