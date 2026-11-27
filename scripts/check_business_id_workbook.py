"""Read-only legacy workbook compatibility after contextual ID migration."""
import hashlib,json,sys
from collections import defaultdict
from pathlib import Path
from fastapi import HTTPException
import sqlalchemy as sa
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend.app import models as m,obligation_import as imports,obligations as service
from backend.app.config import load_settings
from backend.app.access import actor_for

settings=load_settings()
if settings.app_env!='uat':raise RuntimeError('UAT-only compatibility check.')
path=ROOT/'outputs/obligation-import-dummy-2026-11-01/obligation-import-dummy-UAT.xlsx'
data=path.read_bytes();groups=defaultdict(list)
for row in imports.parse(path.name,data):groups[row['raw']['import_reference']].append(row)
checks=[]
with sa.create_engine(settings.database_url,hide_parameters=True).connect() as db:
    actor=actor_for(db,db.execute(sa.select(m.user.c.id).where(m.user.c.username=='author')).scalar_one())
    for reference,rows in groups.items():
        payload=imports.map_payload(db,rows);source,edition,instrument=service.source(db,actor,payload.primary_clause_id)
        old=next(r['raw']['primary_clause_id'] for r in rows if r['sheet']=='Obligations')
        assert old in source['legacy_codes'] and source['approval_status']=='APPROVED'
        issue=None
        try:service.validate(db,actor,payload)
        except HTTPException as exc:issue=str(exc.detail)
        checks.append({'reference':reference,'legacy_clause_code':old,'canonical_clause_code':source['code'],
            'resolved_exact_clause_id':source['id'],'approved_source':True,'current_validation_issue':issue})
report={'file':str(path.relative_to(ROOT)),'sha256':hashlib.sha256(data).hexdigest(),
    'delivered_file_unchanged':hashlib.sha256(data).hexdigest()=='8afe4183d65bc4e40f4f0af643bb11e52cc41502d01d946c32a94996e00f5785',
    'cases':checks,'uploaded_or_loaded':False,'users_or_approvals_changed':False}
assert report['delivered_file_unchanged'] and len(checks)==3
(ROOT/'outputs/business-identifiers-2026-11-01/workbook-compatibility.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'file_unchanged':True,'legacy_references_resolved':len(checks),'current_gates':[r['current_validation_issue'] for r in checks]}))
