"""Fill the trusted workbook layout with a per-download Oracle choice snapshot.

Only Choices, its validation ranges and two guidance rows are replaced. Other
OpenXML parts stay byte-for-byte intact. Database text is written as literal
inline strings, including values beginning with Excel formula characters.
"""
import io
import math
import posixpath
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from .config import ROOT
from .import_choices import database_choices
from .import_template import CHOICE_LABELS, FIELDS, MULTI_VALUE_FIELDS, GUIDE_REFRESH_ROW

S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS = {'s': S}


def _tag(name):
    return '{' + S + '}' + name


def _literal(row, address, value, style=None):
    cell = ET.SubElement(row, _tag('c'), {'r': address, 't': 'inlineStr'})
    if style is not None:
        cell.set('s', style)
    text = ET.SubElement(ET.SubElement(cell, _tag('is')), _tag('t'))
    text.text = str(value)
    text.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')


def _sheet_paths(archive):
    relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): posixpath.normpath(r.get('Target').lstrip('/')
        if r.get('Target').startswith('/') else 'xl/' + r.get('Target'))
        for r in relationships.findall('{' + P + '}Relationship')}
    workbook = ET.fromstring(archive.read('xl/workbook.xml'))
    return {sheet.get('name'): targets[sheet.get('{' + R + '}id')]
        for sheet in workbook.findall('s:sheets/s:sheet', NS)}


def fill_choices(layout, values, generated_at=None):
    """Populate a trusted layout; an empty database list stays empty."""
    generated_at = generated_at or datetime.now(timezone.utc)
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(layout)) as source:
        paths = _sheet_paths(source)
        choices = ET.fromstring(source.read(paths['Choices']))
        data = choices.find('s:sheetData', NS)
        styled_row = data.find("s:row[@r='2']", NS)
        styles = {cell.get('r').rstrip('0123456789'): cell.get('s') for cell in styled_row}
        widths = {chr(64 + int(col.get('min'))): float(col.get('width', 30))
            for col in choices.findall('s:cols/s:col', NS)}
        for row in list(data):
            if row.get('r') != '1':
                data.remove(row)
        row_count = max((len(values[label]) for label in CHOICE_LABELS), default=0)
        if row_count > 1048575:
            raise ValueError('Too many database choices for an Excel sheet')
        for index in range(max(1, row_count)):
            entries = [(chr(65 + col), values[label][index]) for col, label in enumerate(CHOICE_LABELS)
                if index < len(values[label])]
            height = max([42] + [16 * math.ceil(max(1, len(value)) / max(1, widths.get(col, 30) - 3)) for col, value in entries])
            row = ET.SubElement(data, _tag('row'), {'r': str(index + 2), 'ht': str(height), 'customHeight': '1'})
            for col, value in entries:
                _literal(row, f'{col}{index + 2}', value, styles.get(col))
        dimension = choices.find('s:dimension', NS)
        if dimension is not None:
            last_choice_column=chr(64+len(CHOICE_LABELS))
            dimension.set('ref', f'A1:{last_choice_column}{max(2, row_count + 1)}')

        records = ET.fromstring(source.read(paths['Regulatory records']))
        validations = records.find('s:dataValidations', NS)
        for validation in list(validations):
            validations.remove(validation)
        validations.set('count', str(len(CHOICE_LABELS)-len(MULTI_VALUE_FIELDS)))
        for index, label in enumerate(CHOICE_LABELS):
            # Excel's ordinary list validation accepts one choice per cell. The
            # additional-domain field is a semicolon-delimited multi-value list.
            if label in MULTI_VALUE_FIELDS: continue
            field = next(i for i, item in enumerate(FIELDS) if item[1] == label)
            col, choice_col = chr(65 + field), chr(65 + index)
            validation = ET.SubElement(validations, _tag('dataValidation'), {
                'type': 'list', 'sqref': f'{col}2:{col}10001', 'allowBlank': '1',
                'showErrorMessage': '0', 'showDropDown': '0'})
            ET.SubElement(validation, _tag('formula1')).text = (
                f'INDIRECT("\'Choices\'!${choice_col}$2:${choice_col}${max(2, len(values[label]) + 1)}")')

        guide = ET.fromstring(source.read(paths['How to fill']))
        guide_data = guide.find('s:sheetData', NS)
        style_row = guide_data.find(f"s:row[@r='{GUIDE_REFRESH_ROW}']", NS)
        guide_styles = [cell.get('s') for cell in style_row]
        for row in list(guide_data):
            if row.get('r') in {str(GUIDE_REFRESH_ROW), str(GUIDE_REFRESH_ROW + 1)}:
                guide_data.remove(row)
        for number, items in [(GUIDE_REFRESH_ROW, ['Database choices',
                'Refreshed from Oracle: ' + generated_at.strftime('%d/%m/%Y %H:%M UTC'),
                'These choices are a snapshot at download time. Import checks the current database again.']),
                (GUIDE_REFRESH_ROW + 1, ['Refresh the lists', 'Download a fresh template when starting a new import.',
                'Choose an interpretation owner for the selected department. A listed person may cover only some departments.'])]:
            row = ET.SubElement(guide_data, _tag('row'), {'r': str(number), 'ht': '60', 'customHeight': '1'})
            for index, value in enumerate(items):
                _literal(row, chr(65 + index) + str(number), value, guide_styles[index])
        # Preserve monotonically ordered worksheet rows.
        guide_data[:] = sorted(guide_data, key=lambda row: int(row.get('r')))
        replacements = {paths['Choices']: choices, paths['Regulatory records']: records, paths['How to fill']: guide}
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as target:
            for item in source.infolist():
                target.writestr(item, ET.tostring(replacements[item.filename], encoding='utf-8', xml_declaration=True)
                    if item.filename in replacements else source.read(item.filename))
    return output.getvalue()


def download_workbook(db, actor):
    values = database_choices(db, actor)
    layout = (ROOT / 'backend/templates/instrument-import-template.xlsx').read_bytes()
    return fill_choices(layout, values)
