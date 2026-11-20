"""Read-only schema and population evidence, without connection secrets."""
from pathlib import Path
import sys,json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import sqlalchemy as sa
from backend.app.config import load_settings
from backend.app import models as m

def check():
 s=load_settings()
 if s.app_env!='uat':raise RuntimeError('This evidence script refuses Prod.')
 engine=sa.create_engine(s.database_url,hide_parameters=True)
 try:
  with engine.connect() as db:
   inspector=sa.inspect(db);names=set(inspector.get_table_names());missing=[];shape=[]
   for name,t in m.metadata.tables.items():
    if name not in names:missing.append(name);continue
    actual={c['name'] for c in inspector.get_columns(name)};expected=set(t.c.keys())
    if actual!=expected:shape.append({'table':name,'missing':sorted(expected-actual),'extra':sorted(actual-expected)})
   invalid=[dict(r) for r in db.execute(sa.text("select object_name,object_type from user_objects where status='INVALID'")).mappings()]
   errors=[dict(r) for r in db.execute(sa.text("select name,line,text from user_errors where name like 'CBD_%' order by name,sequence")).mappings()]
   counts={t:db.execute(sa.select(sa.func.count()).select_from(getattr(m,t))).scalar_one() for t in ['regulatory_instrument','instrument_version','regulatory_clause','compliance_obligation','action','evidence_item','action_submission','action_evidence_decision','action_validation','control','obligation_control_map','control_execution','action_control_link','action_control_result','leave_delegation']}
   return dict(environment='uat',revision=db.execute(sa.text('select version_num from cbd_alembic_version')).scalar_one(),model_tables=len(m.metadata.tables),model_columns=sum(len(t.c) for t in m.metadata.tables.values()),model_foreign_keys=sum(len(t.foreign_key_constraints) for t in m.metadata.tables.values()),missing_tables=missing,column_differences=shape,invalid_objects=invalid,compile_errors=errors,business_counts=counts)
 finally:engine.dispose()
if __name__=='__main__':print(json.dumps(check(),indent=2,default=str))
