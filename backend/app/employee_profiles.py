"""Employee-master lookup/retries; source-aware department review governs changes."""
import asyncio
import json
import logging
import random
import re
import ssl
from datetime import timedelta
from urllib.parse import urlsplit
import httpx
import sqlalchemy as sa
from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from . import models as m
from .directory import cipher
from .events import audit, new_id, now

LOG=logging.getLogger('cbd.employee_profiles')
CODE='EMPLOYEE_API'
DEFAULTS=dict(enabled=True,endpoint='https://app.mahabank.co.in/generic/master/emp',
    userid_prefix='b0',timeout_seconds=3,retry_seconds=300,max_retry_seconds=3600,
    auth_type='NONE',api_key_header='X-API-Key',ca_certificate_pem='',department_code_map={},revision='default')
FIELDS={'employee_name':('empName',250),'designation':('designation',250),
    'branch_code':('branchCode',40),'branch_name':('branchName',250),
    'current_branch_code':('currBranch',40),'zone_code':('zoneCode',40),'zone_name':('zoneName',250),
    'department_code':('deptCode',100),'department_name':('deptName',250),'employee_status':('status',40)}
WARNING='Employee details could not be fully refreshed. You can continue using your existing profile. We will retry automatically.'


def load_config(db,settings):
    cfg={**DEFAULTS,'secret':''}
    row=db.execute(sa.select(m.directory_configuration).where(m.directory_configuration.c.code==CODE)).mappings().first()
    if row:
        try:
            stored=json.loads(row['configuration'])
            if not isinstance(stored,dict):raise ValueError()
            if any(type(stored.get(k,v)) is not type(v) for k,v in DEFAULTS.items()):raise ValueError()
            cfg.update({k:v for k,v in stored.items() if k in DEFAULTS})
            cfg['has_secret']=bool(row['secret_cipher'])
            if row['secret_cipher']:cfg['secret']=cipher(settings).decrypt(row['secret_cipher'].encode()).decode()
        except (ValueError,TypeError,InvalidToken):cfg['configuration_error']=True
    return cfg


def public_config(cfg):
    return {k:v for k,v in cfg.items() if k not in {'secret','ca_certificate_pem'}} | {
        'has_secret':bool(cfg.get('has_secret') or cfg.get('secret')),
        'has_custom_ca':bool(cfg.get('ca_certificate_pem'))}


def validate_config(cfg,settings):
    try:
        u=urlsplit(cfg['endpoint'])
        valid=(u.scheme=='https' and u.hostname in settings.employee_api_allowed_hosts and
            not u.username and not u.password and u.port in {None,443} and not u.query and not u.fragment and
            bool(u.path) and not re.search(r'[\s\\\x00-\x1f]',cfg['endpoint']))
    except (ValueError,TypeError):valid=False
    if not valid:raise HTTPException(422,'Use an HTTPS employee endpoint on a server-approved host, without credentials, query parameters or a fragment.')
    if not re.fullmatch('[a-zA-Z][a-zA-Z0-9]{0,9}',cfg['userid_prefix']):raise HTTPException(422,'Use a 1–10 character user ID prefix beginning with a letter.')
    if not 1<=cfg['timeout_seconds']<=10 or not 30<=cfg['retry_seconds']<=3600 or not cfg['retry_seconds']<=cfg['max_retry_seconds']<=86400:
        raise HTTPException(422,'Use a 1–10 second timeout and a retry delay of 30–3,600 seconds, capped at no more than 86,400 seconds.')
    if cfg['auth_type'] not in {'NONE','BEARER','API_KEY'}:raise HTTPException(422,'Choose a supported authentication method.')
    if cfg['auth_type']=='API_KEY' and (not re.fullmatch(r'[A-Za-z][A-Za-z0-9-]{0,79}',cfg['api_key_header']) or cfg['api_key_header'].lower() in {'host','authorization','cookie','connection','content-length','proxy-authorization'}):
        raise HTTPException(422,'Choose a valid dedicated API key header.')
    if cfg.get('secret') and (len(cfg['secret'])>4000 or re.search(r'[\x00-\x1f\x7f]',cfg['secret'])):raise HTTPException(422,'The API credential contains invalid characters or is too long.')
    if cfg['enabled'] and cfg['auth_type']!='NONE' and not cfg.get('secret'):raise HTTPException(422,'Enter an API credential, or retain a usable saved credential.')
    if cfg.get('configuration_error'):raise HTTPException(422,'Re-save the API settings and credential to repair the configuration.')
    mapping=cfg.get('department_code_map',{})
    if not isinstance(mapping,dict) or len(mapping)>500 or any(not isinstance(v,str) or not v.strip() or len(v)>100 or re.search(r'[\x00-\x1f\x7f]',v) for pair in mapping.items() for v in pair):
        raise HTTPException(422,'Department mappings require up to 500 exact, non-empty LDAP-code/API-code pairs, each at most 100 characters.')


def save_config(db,settings,candidate):
    validate_config(candidate,settings)
    candidate={**candidate,'revision':new_id()}
    stored={k:candidate[k] for k in DEFAULTS}
    row=db.execute(sa.select(m.directory_configuration).where(m.directory_configuration.c.code==CODE).with_for_update()).mappings().first()
    values=dict(configuration=json.dumps(stored),secret_cipher=cipher(settings).encrypt(candidate['secret'].encode()).decode() if candidate.get('secret') else None)
    if row:db.execute(m.directory_configuration.update().where(m.directory_configuration.c.id==row['id']).values(**values))
    else:db.execute(m.directory_configuration.insert().values(id=new_id(),code=CODE,**values))
    # Configuration recovery wakes pending profiles; successful observations are retained.
    if candidate['enabled']:db.execute(m.employee_profile.update().where(m.employee_profile.c.sync_status!='SUCCESS').values(next_retry_at=now()))
    return candidate


def employee_number(username,cfg,ldap_profile=None):
    attributes=(ldap_profile or {}).get('attributes') or {}
    canonical=next((v for k,v in attributes.items() if k.lower()=='samaccountname'),None)
    if isinstance(canonical,(list,tuple)):canonical=canonical[0] if len(canonical)==1 else None
    account=canonical if isinstance(canonical,str) and canonical.strip() else username
    account=account.strip().rsplit('\\',1)[-1].split('@',1)[0].lower()
    prefix=cfg['userid_prefix'].lower()
    suffix=account[len(prefix):] if account.startswith(prefix) else ''
    return (account,suffix) if re.fullmatch(r'[0-9]{1,40}',suffix) else None


def parse_response(raw,pf):
    if not isinstance(raw,dict) or raw.get('pfNo')!=pf:raise ValueError('IDENTITY_MISMATCH')
    values={};missing=[]
    for name,(key,size) in FIELDS.items():
        value=raw.get(key)
        if value is None or value in ('','NA','N/A'):missing.append(name);continue
        if not isinstance(value,str) or len(value.strip())>size or re.search(r'[\x00-\x1f\x7f]',value):raise ValueError('INVALID_RESPONSE')
        value=value.strip()
        if not value:missing.append(name)
        else:values[name]=value
    # A name describes its matching code; never create a mixed-generation pair.
    for code,name in [('branch_code','branch_name'),('zone_code','zone_name'),('department_code','department_name')]:
        if code not in values or name not in values:
            values.pop(code,None);values.pop(name,None)
            missing.extend(n for n in (code,name) if n not in missing)
    return values,missing


async def _request(cfg,pf,transport=None):
    context=ssl.create_default_context()
    if cfg.get('ca_certificate_pem'):context.load_verify_locations(cadata=cfg['ca_certificate_pem'])
    headers={'Accept':'application/json'}
    if cfg['auth_type']=='BEARER':headers['Authorization']='Bearer '+cfg['secret']
    if cfg['auth_type']=='API_KEY':headers[cfg['api_key_header']]=cfg['secret']
    # No redirects, proxy credentials or unverified TLS, including admin connection tests.
    async with httpx.AsyncClient(verify=context,follow_redirects=False,trust_env=False,
            timeout=cfg['timeout_seconds'],transport=transport) as client:
        async with client.stream('GET',cfg['endpoint'],params={'pf_no':pf},headers=headers) as response:
            if response.status_code!=200:return {},[],('HTTP_'+str(response.status_code))
            if 'application/json' not in response.headers.get('content-type','').lower():return {},[],'INVALID_RESPONSE'
            body=bytearray()
            async for block in response.aiter_bytes():
                body.extend(block)
                if len(body)>16384:return {},[],'RESPONSE_TOO_LARGE'
            values,missing=parse_response(json.loads(body),pf)
            return values,missing,None


def lookup(cfg,pf,settings,transport=None):
    started=now();values={};missing=[];error=None
    try:
        validate_config(cfg,settings)
        # Total deadline covers DNS, TLS, headers and the complete bounded response.
        values,missing,error=asyncio.run(asyncio.wait_for(_request(cfg,pf,transport),timeout=cfg['timeout_seconds']))
    except (TimeoutError,httpx.TimeoutException):error='TIMEOUT'
    except httpx.TransportError:error='CONNECTION_FAILED'
    except HTTPException:error='CONFIGURATION_INVALID'
    except ValueError as exc:error=str(exc) if str(exc) in {'IDENTITY_MISMATCH','INVALID_RESPONSE'} else 'INVALID_RESPONSE'
    except (ssl.SSLError,TypeError,KeyError):error='CONFIGURATION_INVALID'
    return dict(started=started,revision=cfg['revision'],pf_no=pf,values=values,missing=missing,error=error)


def prepare_login(db,settings,username,ldap_profile=None):
    cfg=load_config(db,settings)
    if not cfg['enabled']:return None
    identity=employee_number(username,cfg,ldap_profile)
    if not identity:return None
    account,pf=identity
    return dict(account=account,cfg=cfg,outcome=lookup(cfg,pf,settings))


def apply_outcome(db,user,cfg,outcome,account,*,lease_token=None,from_login=False):
    """Caller holds the user lock. All profile updates and audit commit with login."""
    t=m.employee_profile
    row=db.execute(sa.select(t).where(t.c.user_id==user['id']).with_for_update()).mappings().first()
    if row and (row['attempt_started_at']>outcome['started'] or (lease_token and row['lease_token']!=lease_token)):return False
    if row and row['pf_no']!=outcome['pf_no']:
        # An established identity cannot be silently rebound by an admin prefix change.
        outcome={**outcome,'values':{},'missing':[],'error':'PF_MAPPING_CHANGED'}
    error=outcome['error'];values=outcome['values'] if not error else {}
    status='FAILED' if error else 'PARTIAL' if outcome['missing'] else 'SUCCESS'
    at=now();count=min((row['retry_count'] if row else 0)+1,1000) if status!='SUCCESS' else 0
    delay=min(cfg['max_retry_seconds'],cfg['retry_seconds']*2**min(count-1,12)) if count else 0
    changes=dict(**values,account_name=account,sync_status=status,last_error_code=error,
        missing_fields=json.dumps(outcome['missing']),last_attempt_at=at,attempt_started_at=outcome['started'],
        retry_count=count,next_retry_at=at+timedelta(seconds=delay+random.uniform(0,min(delay*.1,30))) if count else None,
        lease_token=None,lease_until=None)
    if status=='SUCCESS':changes['last_success_at']=at
    if row:db.execute(t.update().where(t.c.id==row['id']).values(**changes));identifier=row['id']
    else:
        identifier=new_id();db.execute(t.insert().values(id=identifier,user_id=user['id'],pf_no=outcome['pf_no'],**changes))
    before={k:row[k] for k in [*FIELDS,'sync_status','last_error_code','missing_fields']} if row else None
    after={k:changes.get(k,row[k] if row else None) for k in [*FIELDS,'sync_status','last_error_code','missing_fields']}
    if before!=after:audit(db,None,'employee_profile',identifier,'EMPLOYEE_PROFILE_SYNCED',old=before,new=after)
    from .employee_departments import observe_api
    observe_api(db,user,cfg,{**outcome,'values':values},from_login=from_login)
    return True


def complete_login(db,settings,user,prepared):
    if not prepared:return
    cfg=load_config(db,settings)
    if not cfg['enabled']:return
    outcome=prepared['outcome']
    if cfg['revision']!=outcome['revision']:outcome={**outcome,'values':{},'missing':[],'error':'CONFIGURATION_CHANGED'}
    return apply_outcome(db,user,cfg,outcome,prepared['account'],from_login=True)


def public_profile(db,user_id,settings):
    row=db.execute(sa.select(m.employee_profile).where(m.employee_profile.c.user_id==user_id)).mappings().first()
    if not row:return None
    enabled=load_config(db,settings)['enabled']
    result={k:row[k] for k in ['pf_no',*FIELDS,'sync_status','last_attempt_at','last_success_at','next_retry_at','last_error_code']}
    result.update(stale=row['sync_status']!='SUCCESS',retry_enabled=enabled,
        warning=WARNING if enabled and row['sync_status']!='SUCCESS' else None,
        missing_fields=json.loads(row['missing_fields'] or '[]'))
    user=db.execute(sa.select(m.user).where(m.user.c.id==user_id)).mappings().one()
    from .ldap_department import blocked
    if result['warning'] and blocked(user):result['warning']='Employee profile refresh is pending. Existing department and access restrictions remain in place; automatic retries continue.'
    return result


def retry_batch(engine,settings,limit=10):
    """Durable leases allow multiple workers; HTTP never holds a profile/user lock."""
    t=m.employee_profile;completed=0
    with engine.begin() as db:
        cfg=load_config(db,settings)
        if not cfg['enabled']:return 0
        at=now()
        ids=db.execute(sa.select(t.c.id).join(m.user,t.c.user_id==m.user.c.id).where(
            m.user.c.active_flag==1,t.c.next_retry_at<=at,sa.or_(t.c.lease_until.is_(None),t.c.lease_until<at))
            .order_by(t.c.next_retry_at).limit(limit)).scalars().all()
    for identifier in ids:
        with engine.begin() as db:
            row=db.execute(sa.select(t).where(t.c.id==identifier).with_for_update(skip_locked=True)).mappings().first()
            at=now()
            if not row or not row['next_retry_at'] or row['next_retry_at']>at or (row['lease_until'] and row['lease_until']>=at):continue
            token=new_id();snapshot=dict(row)
            db.execute(t.update().where(t.c.id==identifier).values(lease_token=token,lease_until=at+timedelta(seconds=60)))
        outcome=lookup(cfg,snapshot['pf_no'],settings)
        with engine.begin() as db:
            user=db.execute(sa.select(m.user).where(m.user.c.id==snapshot['user_id']).with_for_update()).mappings().one()
            current=load_config(db,settings)
            if not user['active_flag'] or not current['enabled'] or current['revision']!=cfg['revision']:
                db.execute(t.update().where(t.c.id==identifier,t.c.lease_token==token).values(lease_token=None,lease_until=None));continue
            completed+=int(apply_outcome(db,user,cfg,outcome,snapshot['account_name'],lease_token=token))
    return completed


async def worker(engine,settings):
    while True:
        try:await asyncio.to_thread(retry_batch,engine,settings)
        except Exception:
            # Exception objects can contain URLs or DB bind values; retain a safe operational signal.
            LOG.error('Employee profile retry sweep failed; pending records remain queued.')
        await asyncio.sleep(30)
