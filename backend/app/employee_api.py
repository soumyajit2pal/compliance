"""Administrator-only employee API configuration, test and retry controls."""
from typing import Literal
from urllib.parse import urlsplit
import sqlalchemy as sa
from pydantic import BaseModel,ConfigDict,Field,StrictBool
from fastapi import Depends,HTTPException
from . import employee_profiles as ep,models as m
from .events import audit,now
from .ldap_ca_certificates import normalize_base64_certificate_bundle,CertificateValidationError


class Configuration(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled:StrictBool=True
    endpoint:str=Field(default=ep.DEFAULTS['endpoint'],max_length=1000)
    userid_prefix:str=Field(default='b0',max_length=10)
    timeout_seconds:int=Field(default=3,ge=1,le=10)
    retry_seconds:int=Field(default=300,ge=30,le=3600)
    max_retry_seconds:int=Field(default=3600,ge=30,le=86400)
    auth_type:Literal['NONE','BEARER','API_KEY']='NONE'
    api_key_header:str=Field(default='X-API-Key',max_length=80)
    secret:str=Field(default='',max_length=4000)
    clear_secret:StrictBool=False
    ca_action:Literal['keep','replace','remove']='keep'
    ca_data:str=Field(default='',max_length=1400000)


class TestConfiguration(Configuration):
    test_pf_no:str=Field(pattern=r'^[0-9]{1,40}$')


def candidate(payload,previous,settings):
    data=payload.model_dump(exclude={'test_pf_no','ca_action','ca_data','clear_secret'})
    data['secret']=payload.secret or ('' if payload.clear_secret else previous.get('secret',''))
    try:host_changed=urlsplit(data['endpoint']).hostname!=urlsplit(previous['endpoint']).hostname
    except ValueError:raise HTTPException(422,'Enter a valid HTTPS employee endpoint.') from None
    if host_changed and data['secret'] and not payload.secret:
        raise HTTPException(422,'Enter a new API credential when changing the endpoint host.')
    data['ca_certificate_pem']=previous.get('ca_certificate_pem','') if payload.ca_action=='keep' else ''
    if payload.ca_action=='replace':
        try:data['ca_certificate_pem']=normalize_base64_certificate_bundle(payload.ca_data)[0]
        except CertificateValidationError as exc:raise HTTPException(422,str(exc)) from None
    data['revision']=previous['revision']
    ep.validate_config(data,settings)
    return data


def install(app,get_db,current,settings):
    @app.get('/api/admin/employee-api')
    def get_settings(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        counts={r[0]:r[1] for r in db.execute(sa.select(m.employee_profile.c.sync_status,sa.func.count()).group_by(m.employee_profile.c.sync_status))}
        last=db.execute(sa.select(sa.func.max(m.employee_profile.c.last_attempt_at),sa.func.max(m.employee_profile.c.last_success_at))).one()
        return {**ep.public_config(ep.load_config(db,settings)),
            'allowed_hosts':settings.employee_api_allowed_hosts,'health':{'counts':counts,'last_attempt_at':last[0],'last_success_at':last[1]}}

    @app.put('/api/admin/employee-api')
    def put_settings(payload:Configuration,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        saved=ep.save_config(db,settings,candidate(payload,ep.load_config(db,settings),settings))
        audit(db,actor,'system',ep.CODE,'EMPLOYEE_API_CONFIGURED',new=ep.public_config(saved))
        return {'ok':True,'message':'Employee API settings saved. Existing access and last successful employee details are retained.'}

    @app.post('/api/admin/employee-api/test')
    def test_settings(payload:TestConfiguration,db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        cfg=candidate(payload,ep.load_config(db,settings),settings)
        if not cfg['enabled']:raise HTTPException(422,'Enable the API in the form before testing.')
        result=ep.lookup(cfg,payload.test_pf_no,settings)
        audit(db,actor,'system',ep.CODE,'EMPLOYEE_API_TESTED',new={'ok':not result['error'],'code':result['error'],'missing_fields':result['missing']})
        return {'ok':not result['error'],'code':result['error'],'missing_fields':result['missing'],
            'guidance':ep.failure_guidance(result['error']) if result['error'] else None,
            'message':'Connection and employee identity verified. No employee profile or settings were saved.' if not result['error'] else 'The lookup failed ('+result['error']+'). Existing sign-in and employee details remain available.'}

    @app.post('/api/admin/employee-api/retry')
    def retry(db=Depends(get_db),actor=Depends(current)):
        actor.require({'ADMIN'})
        if not ep.load_config(db,settings)['enabled']:raise HTTPException(422,'Enable the employee API before retrying.')
        rows=db.execute(m.employee_profile.update().where(m.employee_profile.c.sync_status!='SUCCESS').values(next_retry_at=now())).rowcount
        audit(db,actor,'system',ep.CODE,'EMPLOYEE_API_RETRY_QUEUED',new={'profiles':rows})
        return {'queued':rows,'message':'Pending employee lookups queued. The background worker checks every 30 seconds.'}
