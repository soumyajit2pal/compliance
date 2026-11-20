"""Read-only certificate-verified normal UAT leave-route/authentication check."""
import json,ssl,sys,urllib.request,urllib.error,hashlib,re
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
    required=['/api/delegations','/api/delegations/options','/api/delegations/{identifier}','/api/delegations/{identifier}/decision','/api/controls','/api/control-mappings','/api/actions','/api/evidence-library','/api/team-overview']
    paths=get('/openapi.json')['paths'];result={'observed_at':datetime.now(timezone.utc).isoformat(),'origin':base,'certificate_verified':True,'health':get('/api/health'),'missing_routes':[p for p in required if p not in paths],'unauthenticated':{}}
    for path in ['/api/delegations','/api/delegations/options','/api/controls','/api/control-mappings','/api/evidence-library','/api/actions','/api/team-overview']:
        try:get(path);status=200
        except urllib.error.HTTPError as error:status=error.code
        result['unauthenticated'][path]=status
    # Verify the normal service serves the same freshly built HTML and assets.
    root=Path(__file__).resolve().parents[1];built=(root/'frontend/dist/index.html').read_bytes()
    with urllib.request.urlopen(base+'/',context=context,timeout=15) as response:served=response.read()
    assets={}
    for asset in re.findall(r'(?:src|href)="(/assets/[^"]+)"',served.decode()):
        with urllib.request.urlopen(base+asset,context=context,timeout=15) as response:body=response.read()
        local=root/'frontend/dist'/asset.removeprefix('/assets/')
        assets[asset]={'matches_build':local.exists() and hashlib.sha256(body).hexdigest()==hashlib.sha256(local.read_bytes()).hexdigest()}
    result['frontend']={'index_matches_build':built==served,'index_sha256':hashlib.sha256(served).hexdigest(),'assets':assets}
    result['ok']=not result['missing_routes'] and all(s==401 for s in result['unauthenticated'].values()) and built==served and bool(assets) and all(a['matches_build'] for a in assets.values())
    return result
if __name__=='__main__':
    result=check();print(json.dumps(result,indent=2));sys.exit(0 if result['ok'] else 1)
