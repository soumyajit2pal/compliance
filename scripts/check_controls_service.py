"""Read-only normal HTTPS UAT route/authentication checks; no sign-in or business writes."""
import json,ssl,sys,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.app.local_https import configuration
from backend.app.runtime import runtime_settings

def check():
    if runtime_settings().environment!='uat':raise RuntimeError('This check refuses Prod.')
    tls=configuration();context=ssl.create_default_context(cafile=str(tls.cert_file));base='https://localhost:'+str(tls.port)
    def get(path):
        with urllib.request.urlopen(base+path,context=context,timeout=15) as response:return json.load(response)
    required=['/api/controls','/api/controls/{identifier}/revisions','/api/control-mappings','/api/action-control-options','/api/actions/{identifier}/control-results','/api/control-results/{identifier}/decision','/api/evidence-library','/api/evidence-library/export']
    paths=get('/openapi.json')['paths'];result={'observed_at':datetime.now(timezone.utc).isoformat(),'origin':base,'certificate_verified':True,'health':get('/api/health'),'missing_routes':[p for p in required if p not in paths],'unauthenticated':{}}
    for path in ['/api/controls','/api/control-mappings','/api/evidence-library','/api/actions','/api/team-overview']:
        try:get(path);status=200
        except urllib.error.HTTPError as error:status=error.code
        result['unauthenticated'][path]=status
    result['ok']=not result['missing_routes'] and all(s==401 for s in result['unauthenticated'].values())
    return result
if __name__=='__main__':
    result=check();print(json.dumps(result,indent=2));sys.exit(0 if result['ok'] else 1)
