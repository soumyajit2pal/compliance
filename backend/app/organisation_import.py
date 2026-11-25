"""Preview and atomically add organisation units from an Excel workbook."""
from collections import Counter
from copy import copy
from datetime import date, datetime
from graphlib import CycleError, TopologicalSorter
from hashlib import sha256
from io import BytesIO
from typing import get_args
from zipfile import ZipFile

from fastapi import Depends, File, Form, HTTPException, UploadFile
from . import upload_policy
from .upload_formats import validate_workbook
from fastapi.responses import Response
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from . import dropdowns, master_data, models as m
from .config import ROOT
from .events import audit, new_id
from .import_choices import current_master

KEY = 'organisational_unit'
CUSTOM_FORM = 'master.' + KEY
SHEET = 'Organisation units'
CHOICES_SHEET = 'Choices'
TEMPLATE = 'organisation-unit-import-template.xlsx'
STATUSES = ('active', 'inactive')
MAX_ROWS = 2000
IMPORT_PATH = '/api/admin/organisation-import'
COLUMNS = {
    'code': 'code', 'name': 'name', 'unit type': 'unit_type', 'parent code': 'parent_code',
    'effective from': 'effective_from', 'effective to': 'effective_to', 'status': 'status',
}


def workbook_template(db):
    parents = sorted((unit for unit in master_data.master_rows(db, m.organisational_unit)
                      if current_master(unit)), key=lambda unit: unit['code'].casefold())
    _, config = dropdowns.configuration(db)
    custom_fields = [(key, field) for key, field in config['fields'].items()
                     if field['form'] == CUSTOM_FORM and field['active']]

    with BytesIO() as output:
        book = load_workbook(ROOT / 'backend/templates' / TEMPLATE)
        try:
            sheet = book[SHEET]
            choices = book.create_sheet(CHOICES_SHEET)
            choices.freeze_panes = 'A2'
            choices.sheet_view.showGridLines = False

            def header(target, column, label, width):
                cell = target.cell(1, column, label)
                cell.data_type = 's'
                cell.font = copy(sheet['G1'].font)
                cell.fill = copy(sheet['G1'].fill)
                cell.alignment = copy(sheet['G1'].alignment)
                size = target.column_dimensions[get_column_letter(column)]
                size.width = width
                size.number_format = '@'

            def add_dropdown(target_column, formula):
                validation = DataValidation(type='list', formula1=formula, allow_blank=True, showErrorMessage=False)
                validation.add(f'{target_column}2:{target_column}{MAX_ROWS + 1}')
                sheet.add_data_validation(validation)

            def named_choices(name, target_column, source_column, count):
                col = get_column_letter(source_column)
                book.defined_names.add(DefinedName(name,
                    attr_text=f"'{CHOICES_SHEET}'!${col}$2:${col}${max(2, count + 1)}"))
                add_dropdown(target_column, name)

            sheet.data_validations.dataValidation.clear()
            unit_types = get_args(master_data.Organisation.model_fields['unit_type'].annotation)
            add_dropdown('C', '"' + ','.join(code for code in unit_types if code != 'BANK') + '"')
            add_dropdown('G', '"' + ','.join(status.title() for status in STATUSES) + '"')
            for column, label, width in [(1, 'Parent code', 30), (2, 'Organisation unit', 44), (3, 'Unit type', 24)]:
                header(choices, column, label, width)
            for row, unit in enumerate(parents, 2):
                for column, field in enumerate(('code', 'name', 'unit_type'), 1):
                    choices.cell(row, column, unit[field]).data_type = 's'
            named_choices('OrganisationParentCodes', 'D', 1, len(parents))

            for index, (key, field) in enumerate(custom_fields, 1):
                target_column = len(COLUMNS) + index
                source_column = 2 * index + 2
                header(sheet, target_column, 'Custom: ' + key, 52)
                header(choices, source_column, field['label'] + ' code', 30)
                header(choices, source_column + 1, field['label'], 44)
                active_options = [option for option in config['lists'][field['source']]['options'] if option['active']]
                for row, option in enumerate(active_options, 2):
                    choices.cell(row, source_column, option['code']).data_type = 's'
                    choices.cell(row, source_column + 1, option['label']).data_type = 's'
                named_choices(f'OrganisationCustom{index}', get_column_letter(target_column),
                              source_column, len(active_options))

            guide = book['How to fill']
            guide['B6'] = ('Select an existing Parent code or type the code of a parent in this workbook. '
                           'Use a Department parent for SUB_DEPARTMENT. Use BANK for direct bank children.')
            guide['B10'] = ('Published custom fields appear as columns. Use the option codes in their dropdowns. '
                            'Download a new workbook to refresh the parent and custom choices.')
            book.save(output)
        finally:
            book.close()
        return output.getvalue()


def header_fields(cells, config):
    labels = [str(cell.value or '').strip().lower() for cell in cells]
    while labels and not labels[-1]:
        labels.pop()
    fields = []
    for label in labels:
        if label in COLUMNS:
            fields.append(COLUMNS[label])
        elif label.startswith('custom:'):
            key = label.split(':', 1)[1].strip()
            field = config['fields'].get(key, {})
            if field.get('form') != CUSTOM_FORM or not field['active']:
                raise HTTPException(422, f'Unknown or inactive custom column: {label}.')
            fields.append('custom:' + key)
        else:
            raise HTTPException(422, 'Keep the template column headings and use “Custom: field_key” for additional fields.')
    if len(fields) != len(set(fields)) or set(COLUMNS.values()) - set(fields):
        raise HTTPException(422, 'Keep each of the seven template columns exactly once.')
    return fields


def parse_workbook(data, config):
    book = None
    try:
        with ZipFile(BytesIO(data)) as archive:
            members = archive.infolist()
            if len(members) > 200 or sum(item.file_size for item in members) > 20 * 1024 * 1024:
                raise HTTPException(422, 'Use the template with up to 2,000 data rows.')
            if any('vbaproject' in entry.filename.lower() or entry.filename.startswith('xl/externalLinks/') for entry in members):
                raise HTTPException(422, 'Use an Excel workbook without macros or external links.')
        book = load_workbook(BytesIO(data), read_only=True, data_only=False, keep_links=False)
        if SHEET not in book.sheetnames or set(book.sheetnames) - {SHEET, 'How to fill', CHOICES_SHEET}:
            raise HTTPException(422, 'Put the data in the Organisation units worksheet of the template.')
        sheet = book[SHEET]
        sheet.reset_dimensions()
        rows = iter(sheet.iter_rows())
        fields = header_fields(next(rows, ()), config)
        records = []
        for number, cells in enumerate(rows, 2):
            if number > MAX_ROWS + 1:
                raise HTTPException(422, 'Keep data and formatting within the first 2,000 template rows.')
            if not any(cell.value is not None for cell in cells):
                continue
            if any(cell.value is not None for cell in cells[len(fields):]):
                records.append((number, {}, 'Every value needs a column heading.'))
            elif any(cell.data_type in {'f', 'e'} for cell in cells):
                records.append((number, {}, 'Replace formulas and Excel errors with plain values.'))
            else:
                records.append((number, {field: cell.value for field, cell in zip(fields, cells)}, None))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, 'The file could not be read. Save it as an Excel workbook using the template.') from exc
    finally:
        if book is not None:
            book.close()
    if not records:
        raise HTTPException(422, 'Add at least one organisation unit to the template.')
    return records


def validate_row(raw, config):
    code = raw.get('code')
    parent = raw.get('parent_code')
    if not isinstance(code, str) or not isinstance(parent, str) or not parent.strip():
        raise ValueError('Enter the unit code and parent code as text.')
    if len(parent.strip()) > 30:
        raise ValueError('Parent codes can contain up to 30 characters.')
    value = raw.get('status')
    status = (str(value).strip().lower() if value is not None else '') or 'active'
    if status not in STATUSES:
        raise ValueError('Choose Active or Inactive for Status.')
    dates = {key: raw.get(key) for key in ('effective_from', 'effective_to')}
    for key, value in dates.items():
        if isinstance(value, datetime):
            dates[key] = value.date()
        elif isinstance(value, str):
            dates[key] = value.strip() or None
        elif value is not None and not isinstance(value, date):
            raise ValueError('Enter an Excel date or use YYYY-MM-DD.')
    values = master_data.Organisation.model_validate(dict(
        code=code, name=raw.get('name'), unit_type=str(raw.get('unit_type') or '').strip().upper(),
        active_flag=status == 'active', **dates,
    )).model_dump()
    if values['unit_type'] == 'BANK':
        raise ValueError('Use the existing bank root as a parent. Add departments, zones or other child units here.')
    answers = {field.split(':', 1)[1]: str(value).strip().upper() for field, value in raw.items()
               if field.startswith('custom:') and value is not None and str(value).strip()}
    dropdowns.validate_answers(config, CUSTOM_FORM, answers)
    return values, parent.strip().upper(), answers


def plan_import(existing_rows, source_rows, config):
    existing = {row['code'].upper(): row for row in existing_rows}
    counts = Counter(str(raw.get('code') or '').strip().upper() for _, raw, _ in source_rows)
    errors = []
    candidates = {}
    for number, raw, error in source_rows:
        code = str(raw.get('code') or '').strip().upper()[:30]
        try:
            if error:
                raise ValueError(error)
            values, parent, answers = validate_row(raw, config)
            code = values['code']
            if counts[code] > 1:
                raise ValueError('This unit code occurs more than once in the workbook.')
            if code in existing or code == 'BANK':
                raise ValueError('This code already belongs to the hierarchy. Use Edit to update an existing unit.')
            candidates[code] = (number, values, parent, answers)
        except ValidationError as exc:
            errors.append({'row': number, 'code': code, 'message': '. '.join(
                f"{str(err['loc'][0]).replace('_', ' ').capitalize()}: {err['msg']}" if err['loc'] else str(err['msg'])
                for err in exc.errors())})
        except (HTTPException, ValueError) as exc:
            errors.append({'row': number, 'code': code, 'message': exc.detail if isinstance(exc, HTTPException) else str(exc)})

    graph = TopologicalSorter({code: [parent] if parent in candidates else []
        for code, (_, _, parent, _) in candidates.items()})
    try:
        graph.prepare()
    except CycleError:
        pass  # Ready rows can still be previewed. Cyclic or blocked rows are listed below.
    processed = set()
    planned = []
    resolved = dict(existing)
    while graph.is_active():
        ready = graph.get_ready()
        for code in ready:
            processed.add(code)
            number, values, parent, answers = candidates[code]
            parent_row = resolved.get(parent)
            if not parent_row or not current_master(parent_row):
                errors.append({'row': number, 'code': code, 'message': f'Parent {parent!r} must exist and be active and effective today.'})
                continue
            try:
                master_data.validate_organisation_parent(values['unit_type'], parent_row)
            except HTTPException as exc:
                errors.append({'row': number, 'code': code, 'message': exc.detail})
                continue
            record = dict(values, id=new_id(), parent_org_unit_id=parent_row['id'], level_number=parent_row['level_number'] + 1)
            resolved[code] = record
            planned.append((number, record, parent, answers))
        graph.done(*ready)
    for code in candidates.keys() - processed:
        errors.append({'row': candidates[code][0], 'code': code, 'message': 'This row has a circular parent chain.'})
    return planned, sorted(errors, key=lambda error: error['row'])


def read_upload(db, file):
    if not (file.filename or '').lower().endswith('.xlsx'):
        raise HTTPException(422, 'Choose an Excel workbook (.xlsx) from the template.')
    limits,_ = upload_policy.configuration(db)
    data = upload_policy.read_file(file, limits.organisation_mib)
    validate_workbook(data)
    return data


def evaluate(db, data, *, lock=False):
    if lock:
        master_data.master_rows(db, m.organisational_unit, lock=True)
    # Read again after waiting for a competing hierarchy edit or import.
    existing = master_data.master_rows(db, m.organisational_unit)
    _, config = dropdowns.configuration(db, lock=lock)
    source = parse_workbook(data, config)
    planned, errors = plan_import(existing, source, config)
    result = {'total': len(source), 'ready': len(planned), 'errors': errors,
        'rows': [{'row': number, 'code': values['code'], 'name': values['name'], 'parent_code': parent,
                  'unit_type': values['unit_type'], 'active_flag': values['active_flag'],
                  'effective_from': values['effective_from'], 'effective_to': values['effective_to']}
                 for number, values, parent, _ in sorted(planned, key=lambda entry: entry[0])],
        'file_hash': sha256(data).hexdigest(), 'imported': 0}
    return result, planned


def install(app, get_db, current):
    @app.get(IMPORT_PATH + '/template')
    def template(db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        return Response(workbook_template(db), media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={'Content-Disposition': f'attachment; filename="{TEMPLATE}"', 'Cache-Control': 'private, no-store'})

    @app.post(IMPORT_PATH + '/preview')
    def preview(file: UploadFile = File(...), db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        result, _ = evaluate(db, read_upload(db, file))
        return result

    @app.post(IMPORT_PATH)
    def load(file: UploadFile = File(...), file_hash: str = Form(..., pattern=r'^[0-9a-f]{64}$'),
             reason: str = Form(..., min_length=5, max_length=2000), db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        data = read_upload(db, file)
        if sha256(data).hexdigest() != file_hash:
            raise HTTPException(409, 'The workbook changed. Preview the updated file before importing.')
        reason = reason.strip()
        if len(reason) < 5:
            raise HTTPException(422, 'Provide a reason for the import (at least 5 characters).')
        result, planned = evaluate(db, data, lock=True)
        if result['errors']:
            return result
        try:
            for _, record, _, answers in planned:
                db.execute(m.organisational_unit.insert().values(**record))
                audit(db, actor, KEY, record['id'], 'MASTER_CREATED', new=record, reason=reason)
                if answers:
                    dropdowns.save_answers(db, actor, CUSTOM_FORM, record['id'], answers, reason)
        except IntegrityError as exc:
            raise HTTPException(409, 'The hierarchy changed during the import. Preview the workbook again.') from exc
        master_data.refresh_dropdown_options(db, KEY)
        result['imported'] = len(planned)
        return result
