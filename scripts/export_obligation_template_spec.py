"""Export the shared obligation Excel labels for the trusted layout builder."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend.app.obligation_import_template import FIELDS,CHOICE_KEYS,CHOICE_LABELS
directory=ROOT/'outputs/obligation-template-labels-2026-11-01';directory.mkdir(parents=True,exist_ok=True)
(directory/'template-spec.json').write_text(json.dumps({'fields':FIELDS,'choice_keys':CHOICE_KEYS,'choice_labels':CHOICE_LABELS},ensure_ascii=False,indent=2))
