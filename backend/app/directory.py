"""QA Portal LDAP settings, verified transport and UAT-only onboarding mock."""
import base64
import hashlib
import hmac
import json
import re
import ssl
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from ldap3 import Server, Connection, Tls, SUBTREE, BASE, ALL_ATTRIBUTES, ALL_OPERATIONAL_ATTRIBUTES
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.dn import escape_rdn
from ldap3.core.exceptions import LDAPException
import sqlalchemy as sa
from . import models as m
from .events import new_id
from .ldap_profile import public_attributes
from .ldap_ca_certificates import (
    CertificateValidationError, normalize_base64_certificate_bundle, safe_certificate_name,
)

DEFAULTS = {
    'enabled': False, 'server_uri': '', 'use_ssl': True, 'start_tls': False,
    'base_dn': '', 'bind_dn': '', 'bind_password': '',
    'user_dn_template': '', 'user_search_filter': '(sAMAccountName={username})',
    'ca_cert_file': '', 'ca_certificate_pem': '', 'ca_certificate_name': '',
    'ca_certificate_metadata': [], 'attr_full_name': 'displayName',
    'attr_email': 'mail', 'attr_department': 'department',
    'attr_department_code': '', 'attr_department_name': '',
}


class DirectoryTls(Tls):
    """Native chain/hostname validation, SNI and explicitly trusted issuing CAs."""
    def wrap_socket(self, connection, do_handshake=False):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        if self.ca_certs_file or self.ca_certs_data:
            context.load_verify_locations(cafile=self.ca_certs_file, cadata=self.ca_certs_data)
            context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
        else:
            context.load_default_certs(ssl.Purpose.SERVER_AUTH)
        connection.socket = context.wrap_socket(connection.socket, server_side=False,
            do_handshake_on_connect=do_handshake, server_hostname=connection.server.host)


class DirectoryError(HTTPException):
    def __init__(self, code, message, guidance):
        super().__init__(503, {'code': code, 'message': message, 'guidance': guidance})


def cipher(settings):
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.secret.encode()).digest()))


def normalized(cfg):
    result = {**DEFAULTS, **{k: v for k, v in cfg.items() if k in DEFAULTS}}
    if 'enabled' not in cfg:
        result['enabled'] = bool(result['server_uri'])
    # Existing saved ldap:// rows always used StartTLS. Preserve their behavior.
    if 'use_ssl' not in cfg and 'start_tls' not in cfg:
        result['start_tls'] = result['server_uri'].startswith('ldap://')
    return result


def load_directory(db, settings):
    row = db.execute(sa.select(m.directory_configuration).where(
        m.directory_configuration.c.code == 'LDAP')).mappings().first()
    cfg = normalized(settings.ldap)
    cfg['source'] = 'environment'
    if row:
        try:
            stored = json.loads(row['configuration'])
            if not isinstance(stored, dict): raise ValueError()
            cfg = normalized(stored)
        except (TypeError, ValueError) as exc:
            raise DirectoryError('LDAP_CONFIGURATION_INVALID', 'Saved LDAP configuration is invalid.',
                                 'Ask the administrator to restore the directory settings.') from exc
        cfg['source'] = 'database'
        cfg['bind_password_configured'] = bool(row['secret_cipher'])
        try:
            cfg['bind_password'] = cipher(settings).decrypt(row['secret_cipher'].encode()).decode() if row['secret_cipher'] else ''
        except (InvalidToken, ValueError):
            # Keep the Admin screen available after deployment-key rotation.
            cfg['bind_password'] = ''
            cfg['bind_password_unavailable'] = True
    return cfg


def public_directory(cfg):
    result = {k: cfg.get(k, default) for k, default in DEFAULTS.items()
              if k not in {'bind_password', 'ca_cert_file', 'ca_certificate_pem', 'ca_certificate_metadata'}}
    source = 'uploaded' if cfg.get('ca_certificate_pem') else 'server_file' if cfg.get('ca_cert_file') else 'system_trust'
    metadata = cfg.get('ca_certificate_metadata') or []
    result.update(source=cfg.get('source', 'environment'), ca_certificate_source=source,
        ca_certificate_name=safe_certificate_name(cfg.get('ca_certificate_name') or cfg.get('ca_cert_file')) if source != 'system_trust' else '',
        ca_certificate_count=len(metadata), ca_certificates=metadata,
        has_bind_password=bool(cfg.get('bind_password_configured') or cfg.get('bind_password')),
        bind_password_unavailable=bool(cfg.get('bind_password_unavailable')))
    return result


def safe_directory_audit(cfg):
    public = public_directory(cfg)
    return {k: v for k, v in public.items() if k not in {'ca_certificates', 'bind_dn'}} | {
        'bind_dn_configured': bool(cfg.get('bind_dn')),
        'ca_certificate_fingerprints': [c['fingerprint_sha256'] for c in public['ca_certificates']],
    }


def endpoint(cfg):
    uri = cfg.get('server_uri', '')
    return urlparse(uri if '://' in uri else ('ldaps://' if cfg.get('use_ssl', True) else 'ldap://') + uri)


def validate_directory(cfg):
    if not cfg.get('enabled', True): return
    try:
        p = endpoint(cfg)
        valid = (p.scheme in {'ldap', 'ldaps'} and p.hostname and not p.username and not p.password
                 and p.path in {'', '/'} and not p.query and not p.fragment and 0 < (p.port or 389) <= 65535)
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(422, 'Use an ldaps://host:636 or ldap://host:389 endpoint, or a hostname with TLS / SSL selected.')
    search_bind = bool(cfg.get('bind_dn') and cfg.get('base_dn'))
    if search_bind:
        if not cfg.get('bind_password'):
            raise HTTPException(422, 'Enter the read-only bind password. Leave blank only to retain a usable saved password.')
        template = cfg.get('user_search_filter', '')
    elif cfg.get('user_dn_template'):
        template = cfg['user_dn_template']
    else:
        raise HTTPException(422, 'Configure a base DN and read-only bind account, or a direct user DN template.')
    if template.count('{username}') != 1 or re.search(r'[{}]', template.replace('{username}', '')):
        raise HTTPException(422, 'The selected username pattern must include {username} exactly once, with no other placeholders.')
    for name in ('attr_full_name', 'attr_email', 'attr_department','attr_department_code','attr_department_name'):
        if name in {'attr_department_code','attr_department_name'} and not cfg.get(name):continue
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9;-]*', cfg.get(name, DEFAULTS[name])):
            raise HTTPException(422, 'Enter valid directory profile attribute names.')


def prepare_directory(values, previous):
    """Resolve unsaved input without accepting client-side filesystem paths."""
    candidate = normalized(values)
    candidate['bind_password'] = values.get('bind_password') or previous.get('bind_password', '')
    for name in ('ca_cert_file', 'ca_certificate_pem', 'ca_certificate_name', 'ca_certificate_metadata'):
        candidate[name] = previous.get(name, DEFAULTS[name])
    action = values.get('ca_certificate_action', 'keep')
    data = values.get('ca_certificate_data')
    try:
        if action == 'replace':
            pem, metadata = normalize_base64_certificate_bundle(data or '')
            candidate.update(ca_cert_file='', ca_certificate_pem=pem,
                ca_certificate_name=safe_certificate_name(values.get('ca_certificate_name')),
                ca_certificate_metadata=metadata)
        elif action == 'remove':
            candidate.update(ca_cert_file='', ca_certificate_pem='', ca_certificate_name='', ca_certificate_metadata=[])
        elif action != 'keep' or data is not None:
            raise CertificateValidationError('Certificate data is allowed only for an explicit replacement.')
    except CertificateValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    validate_directory(candidate)
    return candidate


def save_directory(db, settings, candidate):
    values = {k: candidate[k] for k in DEFAULTS if k != 'bind_password'}
    secret = candidate['bind_password']
    encrypted = cipher(settings).encrypt(secret.encode()).decode() if secret else None
    existing = db.execute(sa.select(m.directory_configuration.c.id).where(
        m.directory_configuration.c.code == 'LDAP')).scalar_one_or_none()
    if existing:
        db.execute(m.directory_configuration.update().where(m.directory_configuration.c.id == existing)
                   .values(configuration=json.dumps(values), secret_cipher=encrypted))
    else:
        db.execute(m.directory_configuration.insert().values(id=new_id(), code='LDAP',
                   configuration=json.dumps(values), secret_cipher=encrypted))
    return {**candidate, 'source': 'database'}


def mock_profile(settings, username, password):
    if not settings.ldap_mock_enabled or settings.environment != 'uat': return None, False
    prefix = settings.ldap_mock_username_prefix
    if not username.casefold().startswith(prefix.casefold()): return None, False
    if not password or not hmac.compare_digest(password.encode(), settings.ldap_mock_password.encode()):
        return None, True
    suffix = username[len(prefix):].strip('-_. ').replace('-', ' ').replace('_', ' ').title()
    full_name = 'Mock LDAP ' + (suffix or username)
    email = username + '@mock-ldap.test'
    return {'full_name': full_name, 'email': email, 'department': 'UAT mock department',
            'department_code':'DEMO-001','ldap_department_name':'UAT mock department',
            'source': 'uat_mock', 'distinguished_name': None, 'attributes_available': True,
            'attributes': {'uid': [username], 'displayName': [full_name], 'mail': [email],
                           'departmentCode':['DEMO-001'],'department':['UAT mock department']}}, True


def authenticate_directory(db, settings, username, password, *, config_override=None, allow_mock=True):
    if not username or not password: return None
    if allow_mock:
        profile, handled = mock_profile(settings, username, password)
        if handled: return profile
    cfg = config_override if config_override is not None else load_directory(db, settings)
    # Unknown names in mock-only UAT are ordinary rejected identities.
    if not cfg.get('enabled') or (settings.ldap_mock_enabled and not cfg.get('server_uri')):
        return None
    try:
        validate_directory(cfg)
    except HTTPException as exc:
        raise DirectoryError('LDAP_NOT_CONFIGURED', 'LDAP configuration is incomplete.',
                             'Ask the administrator to review the directory settings and bind password.') from exc
    p = endpoint(cfg)
    service = conn = None
    stage = 'connect'
    try:
        if cfg.get('ca_cert_file') and not cfg.get('ca_certificate_pem') and not Path(cfg['ca_cert_file']).is_file():
            raise DirectoryError('LDAP_NOT_CONFIGURED', 'The configured CA certificate is unavailable.',
                                 'Ask the administrator to upload the approved CA certificate again.')
        tls = DirectoryTls(validate=ssl.CERT_REQUIRED, version=ssl.PROTOCOL_TLS_CLIENT,
            ca_certs_file=None if cfg.get('ca_certificate_pem') else cfg.get('ca_cert_file') or None,
            ca_certs_data=cfg.get('ca_certificate_pem') or None)
        server = Server(p.hostname, port=p.port or (636 if p.scheme == 'ldaps' else 389),
            use_ssl=p.scheme == 'ldaps', tls=tls, connect_timeout=5, get_info=None)

        def connect(dn, pw):
            c = Connection(server, user=dn, password=pw, auto_referrals=False,
                           receive_timeout=8, raise_exceptions=False)
            try:
                c.open()
                if p.scheme == 'ldap' and cfg.get('start_tls') and not c.start_tls():
                    raise DirectoryError('LDAP_TLS_ERROR', 'LDAP StartTLS negotiation failed.',
                                         'Check directory TLS support and the trusted CA certificate.')
                return c
            except Exception:
                c.unbind()
                raise

        attributes = list(dict.fromkeys([ALL_ATTRIBUTES, ALL_OPERATIONAL_ATTRIBUTES] +
            [cfg[k] for k in ('attr_full_name', 'attr_email', 'attr_department','attr_department_code','attr_department_name') if cfg.get(k)] + ['cn']))
        profile = {'full_name': username, 'email': None, 'department': None,
                   'department_code':None,'ldap_department_name':None,
                   'source': 'ldap', 'distinguished_name': None,
                   'attributes_available': False, 'attributes': {}}

        def enrich(entry):
            returned = public_attributes(entry.entry_attributes_as_dict)
            profile.update(distinguished_name=entry.entry_dn,
                           attributes_available=True, attributes=returned)
            attrs = {k.casefold(): v for k, v in returned.items()}
            for key, name in [('full_name', 'attr_full_name'), ('email', 'attr_email'), ('department', 'attr_department')]:
                value = attrs.get(cfg[name].casefold()) or (attrs.get('cn') if key == 'full_name' else None)
                if value:
                    value = value[0] if isinstance(value, list) else value
                    if isinstance(value, (str, int, float, bool)): profile[key] = str(value)
            def single(name):
                value=attrs.get(name.casefold()) if name else None
                if isinstance(value,(list,tuple)):
                    if len(value)!=1:return None
                    value=value[0]
                return str(value) if isinstance(value,(str,int)) and not isinstance(value,bool) else None
            profile['department_code']=single(cfg.get('attr_department_code',''))
            profile['ldap_department_name']=single(cfg.get('attr_department_name') or cfg['attr_department'])

        if cfg.get('bind_dn') and cfg.get('base_dn'):
            stage = 'service_bind'
            service = connect(cfg['bind_dn'], cfg['bind_password'])
            if not service.bind():
                raise DirectoryError('LDAP_SERVICE_BIND_FAILED', 'LDAP lookup service could not sign in.',
                                     'Ask the administrator to check the read-only bind account.')
            stage = 'search'
            search = cfg['user_search_filter'].replace('{username}', escape_filter_chars(username))
            searched = service.search(cfg['base_dn'], search, SUBTREE, attributes=attributes, size_limit=2)
            if service.result.get('result') not in (0,):
                raise DirectoryError('LDAP_SEARCH_FAILED', 'LDAP directory lookup failed.',
                                     'Ask the administrator to check the base DN and search permissions.')
            if not searched or len(service.entries) != 1: return None
            entry = service.entries[0]
            dn = entry.entry_dn
            enrich(entry)
        else:
            dn = cfg['user_dn_template'].replace('{username}', escape_rdn(username))
            profile['distinguished_name'] = dn
        stage = 'user_bind'
        conn = connect(dn, password)
        if not conn.bind():
            # LDAP invalidCredentials, including AD account-policy subcodes,
            # stays an ordinary authentication rejection without raw diagnostics.
            if conn.result.get('result') in (0, 49): return None
            raise DirectoryError('LDAP_BIND_FAILED', 'LDAP could not complete user authentication.',
                                 'Ask the administrator to test the directory connection.')
        if not service:
            try:
                if conn.search(dn, '(objectClass=*)', BASE, attributes=attributes) and conn.entries:
                    enrich(conn.entries[0])
            except LDAPException:
                pass  # An authenticated user may lack permission to read profile data.
        return profile
    except DirectoryError:
        raise
    except (LDAPException, ssl.SSLError, OSError, ValueError) as exc:
        code = 'LDAP_TLS_ERROR' if isinstance(exc, ssl.SSLError) or 'ssl' in type(exc).__name__.lower() else 'LDAP_CONNECTION_FAILED'
        raise DirectoryError(code, 'LDAP connection could not be completed.',
                             'Check network access, directory availability, hostname and CA trust. Operation: ' + stage + '.') from exc
    finally:
        for connection in (conn, service):
            if connection:
                try: connection.unbind()
                except LDAPException: pass
