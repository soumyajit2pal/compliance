"""Read-only checks on the normal local HTTPS UAT service; no credentials."""
from pathlib import Path
import sys,json,ssl,urllib.request,urllib.error
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import sqlalchemy as sa
from backend.app.local_https import configuration
from backend.app.runtime import runtime_settings
from backend.app import models as m

if __name__=='__main__':
 cfg=runtime_settings();tls=configuration();context=ssl.create_default_context(cafile=str(tls.cert_file));base='https://localhost:'+str(tls.port)
 def get(path):
  with urllib.request.urlopen(base+path,context=context,timeout=15) as response:return json.load(response)
 result={'observed_at':datetime.now(timezone.utc).isoformat(),'origin':base,'health':get('/api/health')}
 paths=get('/openapi.json')['paths'];required=['/api/actions','/api/actions/{identifier}/evidence','/api/actions/{identifier}/decision','/api/action-extensions/{identifier}/decision','/api/team-overview','/api/team-overview/export']
 result['delivery_routes_present']=all(path in paths for path in required)
 for path in ['/api/actions','/api/team-overview']:
  try:get(path);result[path]=200
  except urllib.error.HTTPError as exc:result[path]=exc.code
 engine=sa.create_engine(cfg.database_url,hide_parameters=True)
 try:
  with engine.connect() as db:
   row=db.execute(sa.select(m.audit_log.c.event_at,m.audit_log.c.new_value).where(m.audit_log.c.entity_type=='delivery_monitoring',m.audit_log.c.action=='SWEEP_COMPLETED').order_by(m.audit_log.c.event_at.desc()).limit(1)).mappings().first()
   result['reminders']={'enabled':cfg.reminders_enabled,'interval_seconds':cfg.reminder_interval_seconds,'latest_sweep_utc':str(row['event_at']) if row else None,'latest_sweep_result':json.loads(row['new_value']) if row else None}
 finally:engine.dispose()
 result['ok']=result['health'].get('release')=='Weeks 1–5' and result['delivery_routes_present'] and all(result[p]==401 for p in ['/api/actions','/api/team-overview']) and bool(result['reminders']['latest_sweep_utc'])
 print(json.dumps(result,indent=2))
