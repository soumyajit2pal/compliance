"""Match table filters and derive dropdown choices from the same scoped rows."""
import hashlib
import json
from datetime import date, datetime

from fastapi import HTTPException, Query


class ColumnSelection(dict):
    def __init__(self, filters=(), options_for=''):
        super().__init__(filters)
        self.options_for = options_for


def normalize(value):
    return ' '.join(str(value).casefold().split())


def column_query(columns: str = Query('', max_length=8192), options_for: str = Query('', max_length=80)):
    if not columns:
        return ColumnSelection(options_for=options_for)
    try:
        values = json.loads(columns)
    except ValueError:
        raise HTTPException(422, 'Column filters must be a JSON object.') from None
    if not isinstance(values, dict) or len(values) > 32:
        raise HTTPException(422, 'Column filters must contain up to 32 selections.')
    filters = {}
    for key, value in values.items():
        if isinstance(value, dict) and value.keys() == {'equals'}:
            selected = value['equals']
            terms = selected if isinstance(selected, list) else [selected]
            if any(not isinstance(term, str) or len(term) > 160 for term in terms):
                raise HTTPException(422, 'Choose valid values from the column filter.')
            choices = frozenset(normalize(term) for term in terms if term.strip())
            if choices:
                filters[key] = choices
        elif isinstance(value, str) and len(value) <= 160:
            if value.strip():
                filters[key] = normalize(value)
        else:
            raise HTTPException(422, 'Choose valid values from the column filter.')
    return ColumnSelection(filters, options_for)


def choice_label(value):
    if isinstance(value, (date, datetime)):
        return value.strftime('%d %b %Y')
    return ' '.join(str(value).split()) if value is not None else '—'


def choice_key(value):
    term = normalize(value)
    if len(term) > 160 or term.startswith('sha256:'):
        return 'sha256:' + hashlib.sha256(term.encode()).hexdigest()
    return term


def choice_labels(value):
    if isinstance(value, (tuple, list)):
        parts = [label for part in value if part is not None for label in choice_labels(part)]
        yield from parts or ['—']
    else:
        label = choice_label(value)
        if label:
            yield label


def column_predicate(filters, columns):
    if filters.keys() - columns.keys():
        raise HTTPException(422, 'A column filter does not belong to this table.')
    target = getattr(filters, 'options_for', '')
    checks = [(columns[key], term) for key, term in filters.items() if key != target]
    if not checks:
        return None

    def matches(row):
        for project, term in checks:
            value = project(row)
            if isinstance(term, frozenset):
                if not any(choice_key(label) in term for label in choice_labels(value)):
                    return False
            elif term not in normalize(search_text(value)):
                return False
        return True

    return matches


def filter_rows(rows, filters, columns):
    includes = column_predicate(filters, columns)
    return [row for row in rows if includes(row)] if includes else rows


def column_choices(rows, name, columns):
    if name not in columns:
        raise HTTPException(422, 'A column filter does not belong to this table.')
    project = columns[name]
    distinct = {}
    for row in rows:
        for label in choice_labels(project(row)):
            distinct.setdefault(choice_key(label), label)
    return {'options': [{'value': value, 'label': label}
                        for value, label in sorted(distinct.items(), key=lambda item: normalize(item[1]))]}


def search_text(values):
    if isinstance(values, (list, tuple)):
        return ' '.join(search_text(value) for value in values)
    if isinstance(values, (date, datetime)):
        return values.strftime('%d %b %Y') + ' ' + values.isoformat()
    return '—' if values is None else str(values)


def fields(*keys):
    return lambda row: tuple(row.get(key) for key in keys)


def label(value):
    return str(value or '').replace('_', ' ')


def version(value):
    text = str(value or '')
    return text + '.0' if text.isdecimal() else text
