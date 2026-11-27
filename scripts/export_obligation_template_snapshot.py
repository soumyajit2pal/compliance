"""Read-only UAT download of the current obligation template for review."""
import sys,json,hashlib
from pathlib import Path
import sqlalchemy as sa
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from backend.app.config import load_settings
from backend.app.access import actor_for
from backend.app import models as m,obligation_import

settings=load_settings()
if settings.app_env!='uat':raise RuntimeError('UAT-only template preview.')
with sa.create_engine(settings.database_url,hide_parameters=True).connect() as db:
    actor=actor_for(db,db.execute(sa.select(m.user.c.id).where(m.user.c.username=='author')).scalar_one())
    content=obligation_import.template(db,actor)
directory=ROOT/'outputs/obligation-template-labels-2026-11-01'
(directory/'obligation-import-template.xlsx').write_bytes(content)
(directory/'snapshot.json').write_text(json.dumps({'environment':'uat','sha256':hashlib.sha256(content).hexdigest(),'database_writes':False,'bytes':len(content)},indent=2))
print('Read-only UAT template snapshot saved.')
