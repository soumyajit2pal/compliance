"""Compile Excel hierarchy columns into same-edition clause references."""
import hashlib
import json
import re

from .import_template import CLAUSES_SHEET, HIERARCHY_FIELDS, canonical_header

GENERATED_SHEET = 'Generated headings'
PATH_KEYS = tuple(field[0] for field in HIERARCHY_FIELDS)


def path_for(data):
    chapter, section, paragraph, subparagraph, item = (data.get(key, '') for key in PATH_KEYS)
    return chapter, section, paragraph, subparagraph.removeprefix('(').removesuffix(')'), item.removeprefix('(').removesuffix(')')


def source_number(path):
    paragraph, subparagraph, item = path[2:]
    suffix = ''.join(f'({value})' for value in (subparagraph, item) if value)
    return paragraph + suffix


def heading_for(path):
    if path[4]:
        return ''
    if path[3]:
        return f'Subparagraph {source_number(path)}'
    if path[2]:
        return f'Paragraph {path[2]}'
    return path[1] or path[0]


def key_for(group, path):
    encoded = json.dumps([group, path], ensure_ascii=False).encode()
    return 'PATH-' + hashlib.sha256(encoded).hexdigest()


def inputs(rows):
    for sheet, number, raw in rows:
        if sheet not in {CLAUSES_SHEET, GENERATED_SHEET}:
            continue
        data = {canonical_header(k): str(v).strip() if v is not None else '' for k, v in raw.items()}
        path = path_for(data)
        if any(data.get(key) for key in PATH_KEYS):
            yield (sheet, number), raw, data, path


def valid_path(path):
    chapter, section, paragraph, subparagraph, item = path
    return bool(chapter and (paragraph or not (subparagraph or item)))


def expand(rows):
    """Retain original rows and persist generated headings for review and loading."""
    entries = list(inputs(rows))
    explicit = {(data.get('import_reference'), path) for _, _, data, path in entries}
    generated = {}
    for _, _, data, path in entries:
        group = data.get('import_reference')
        if not group or not valid_path(path):
            continue
        for index, value in enumerate(path):
            if not value:
                continue
            parent = path[:index + 1] + ('',) * (len(path) - index - 1)
            key = (group, parent)
            if parent != path and key not in explicit and key not in generated:
                generated[key] = {'import_reference': group, **dict(zip(PATH_KEYS, parent))}
    return [*rows, *((GENERATED_SHEET, index, raw) for index, raw in enumerate(generated.values(), 1))]


def project(rows):
    entries = list(inputs(rows))
    references = {}
    duplicate_paths = set()
    for _, _, data, path in entries:
        key = (data.get('import_reference'), path)
        if key in references:
            duplicate_paths.add(key)
        references[key] = data.get('clause_import_reference') or key_for(*key)

    projected = {}
    for location, raw, data, path in entries:
        group = data.get('import_reference')
        errors = []
        if not valid_path(path):
            errors.append('Enter Chapter. Subparagraph and Item also require Paragraph.')
        if any(data.get(key) and not re.fullmatch(r'(?:[\w.-]+|\([\w.-]+\))', data[key]) for key in PATH_KEYS[3:]):
            errors.append('Enter just the Subparagraph and Item labels, for example (1) and (i).')
        if any(isinstance(value, float) for key, value in raw.items() if canonical_header(key) in PATH_KEYS):
            errors.append('Enter hierarchy numbers as text to preserve values such as 5.10.')
        if data.get('parent_import_reference') or data.get('source_clause_reference'):
            errors.append('Leave Parent clause reference and Source clause / para number blank when using hierarchy columns.')
        if (group, path) in duplicate_paths:
            errors.append('Multiple rows use this chapter, section, paragraph, subparagraph and item path.')

        index = max((i for i, value in enumerate(path) if value), default=0)
        ancestor = path[:index] + ('',) * (len(path) - index)
        heading = heading_for(path)
        generated = location[0] == GENERATED_SHEET
        if index == 4 and not data.get('heading'):
            errors.append('Enter a Clause heading for this item.')
        projected[location] = ({
            **data,
            'clause_import_reference': data.get('clause_import_reference') or key_for(group, path),
            'parent_import_reference': references.get((group, ancestor), ''),
            'source_clause_reference': source_number(path),
            'heading': data.get('heading') or heading,
        }, errors, generated)
    return projected
