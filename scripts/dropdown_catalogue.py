"""Inventory shipped portal choice controls. The build rejects unregistered changes."""
import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'backend/app/dropdown_catalogue.json'
# Runtime names produced by a parametrised helper, a repeated row or the master schema.
DYNAMIC = {
    'ui/dropdown-fields.ts': {"'custom.'+key": ''},
    'features/masters.ts': {'f.name': 'unit_type criticality parent_org_unit_id parent_regulator_id parent_process_id parent_domain_id scheme_id owner_unit_id domain_owner_unit_id channel_id customer_segment_id'},
    'features/obligations.ts': {"key(name+'_id')": 'product_id channel_id customer_segment_id geography_id', 'name': ''},
    'features/delivery.ts': {'key': ''},
    'features/regulation-registers.ts': {'name': ''},
    'src/components/obligation-workspace.tsx': {
        'name': 'department assessment role response legal_entity owner assignment_approval assessment_approval',
    },
    'features/obligation-setup.ts': {"'wizard_scope_process_'+index": 'wizard_scope_process'},
}
def collect():
    found = defaultdict(set)
    root = ROOT / 'frontend'
    for directory, folders, files in os.walk(root):
        folders[:] = sorted(f for f in folders if f not in {
            'node_modules','dist','public','outputs','guides','tests','assets','.git'})
        for filename in sorted(files):
            p = Path(directory) / filename
            if p.suffix not in {'.ts','.tsx','.js','.jsx','.html'}:
                continue
            path = p.relative_to(ROOT / 'frontend').as_posix()
            if path in {'ui/components.ts','ui/organisation-select.ts','ui/reference-options.ts','ui/searchable-select.ts','src/components/searchable-select.tsx'}:
                continue
            source = p.read_text()
            def add(name):
                found[name].add(path)
            for match in re.finditer(r'(?<![\w.])(?:organisationUnitSelect|referenceSelect|fixedSelect|select)\(\s*([^,\n]+?)\s*,', source):
                arg = match[1]
                if arg in DYNAMIC.get(path, {}):
                    for key in DYNAMIC[path][arg].split(): add(key)
                elif re.fullmatch(r"(?:key\()?'([\w-]+)'\)?", arg):
                    add(arg.split("'")[1])
                else:
                    raise ValueError(f'{path}: register the choice source for {arg}')
            if path in ('features/obligations.ts','features/delivery.ts','features/regulation-registers.ts'):
                for name in re.findall(r"(?<![\w.])(?:filter|selected)\('([\w-]+)'", source): add(name)
            for tag in re.findall(r'<(?:select|SearchableSelectField)\b([^>]+)>', source):
                key = re.search(r'\bdata-choice-key="([\w-]+)"', tag) or re.search(r'\bname="([\w-]+)"', tag) or re.search(r'\bid="([\w-]+)"', tag)
                if key: add(key[1])
                elif 'name={name}' in tag and path=='src/components/obligation-workspace.tsx':
                    for name in DYNAMIC[path]['name'].split(): add(name)
                else: raise ValueError(f'{path}: give the dropdown a stable data-choice-key or name')
    return {key:sorted(paths) for key,paths in sorted(found.items())}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write',action='store_true')
    args=parser.parse_args()
    data=json.dumps(collect(),indent=2)+'\n'
    if args.write: DEST.write_text(data)
    elif DEST.read_text()!=data: raise SystemExit('Dropdown inventory changed. Run python3 scripts/dropdown_catalogue.py --write and review its sources.')
