"""Export workbook layout labels only. Choice values come from Oracle at download."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.import_template import (
    FIELDS, CLAUSE_FIELDS, CLAUSE_GUIDE_CONDITIONS, GUIDE_TITLE, CHOICE_LABELS,
    MULTI_VALUE_FIELDS, GUIDE_REFRESH_ROW, FAMILY_RELATIONSHIPS,
)

catalog = {
    'title': GUIDE_TITLE,
    'fields': [dict(key=k, label=label, required=required, guidance=guide, example=example)
               for k, label, required, guide, example in FIELDS],
    'multi_value_fields': sorted(MULTI_VALUE_FIELDS),
    'family_relationships': [value.title() for value in FAMILY_RELATIONSHIPS],
    'clause_fields': [dict(key=k, label=label, required=required, guidance=guide, example=example)
               for k, label, required, guide, example in CLAUSE_FIELDS],
    'clause_conditions': CLAUSE_GUIDE_CONDITIONS,
    'refresh_row': GUIDE_REFRESH_ROW,
    'choices': {label: [] for label in CHOICE_LABELS},
}
print(json.dumps(catalog, indent=2))
