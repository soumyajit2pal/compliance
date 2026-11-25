"""Load SMTP bootstrap values or the encrypted, revisioned Admin configuration."""
from ipaddress import ip_address
import json
import re
from typing import Literal
from urllib.parse import urlsplit

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator
import sqlalchemy as sa

from . import models as m
from .directory import cipher
from .events import new_id

CODE = 'SMTP'
MAILBOX = re.compile(r"[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*@"
                    r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}")
HOST = re.compile(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?')
TIME = re.compile(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]')


class Settings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool = False
    host: str = Field('', max_length=253)
    port: int = Field(587, ge=1, le=65535)
    transport: Literal['STARTTLS', 'TLS', 'PLAIN'] = 'STARTTLS'
    username: str = Field('', max_length=250)
    from_address: str = Field('', max_length=254)
    from_name: str = Field('Compliance by Design', max_length=150)
    portal_url: str = Field('', max_length=500)
    timeout_seconds: int = Field(15, ge=3, le=30)
    digest_enabled: bool = True
    digest_time: str = Field('09:00', max_length=5)
    revision: str = Field('environment', max_length=36)

    @field_validator('host', 'username', 'from_address', 'from_name', 'portal_url', 'digest_time', mode='before')
    @classmethod
    def trim_setting(cls, value):
        return value.strip() if isinstance(value, str) else value


class SettingsUpdate(Settings):
    password: SecretStr = SecretStr('')
    clear_password: bool = False


def mailbox(value):
    return bool(value and len(value) <= 254 and MAILBOX.fullmatch(value)
                and all(HOST.fullmatch(part) for part in value.rsplit('@', 1)[1].split('.'))
                and len(value.rsplit('@', 1)[0]) <= 64)


def valid_host(value):
    try:
        ip_address(value)
        return '%' not in value
    except ValueError:
        return bool(value and all(HOST.fullmatch(part) for part in value.rstrip('.').split('.')))


def validate(cfg, environment):
    if any(re.search(r'[\x00-\x1f\x7f]', cfg[key]) for key in ('from_name', 'username', 'password', 'portal_url')):
        return 'Use single-line values for the sender, credential and portal URL.'
    if not TIME.fullmatch(cfg['digest_time']):
        return 'Enter a daily digest time in HH:MM (India Standard Time).'
    if cfg['host'] and not valid_host(cfg['host']):
        return 'Enter the SMTP relay hostname or IP address.'
    if cfg['from_address'] and not mailbox(cfg['from_address']):
        return 'Enter a valid sender email address.'
    if cfg['portal_url']:
        try:
            u = urlsplit(cfg['portal_url'])
            local_uat = environment == 'uat' and u.hostname in {'localhost', '127.0.0.1', '::1'}
            if not (u.hostname and valid_host(u.hostname) and (u.scheme == 'https' or (u.scheme == 'http' and local_uat))
                    and u.netloc and not (u.username or u.password or u.query or u.fragment)
                    and '\\' not in cfg['portal_url'] and not re.search(r'\s', cfg['portal_url'])):
                raise ValueError()
            _ = u.port
        except ValueError:
            return 'Enter the portal HTTPS URL without credentials, query parameters or a fragment.'
    if cfg['enabled'] and not (cfg['host'] and cfg['from_address'] and cfg['portal_url']):
        return 'Enter a relay, sender email and portal URL to enable delivery.'
    if cfg['transport'] == 'PLAIN' and (cfg['username'] or cfg['password']):
        return 'SMTP authentication requires STARTTLS or TLS.'
    if cfg['enabled'] and bool(cfg['username']) != bool(cfg['password']):
        return 'Enter both the SMTP username and password for an authenticated relay.'
    return None


def load(db, runtime, *, lock=False):
    rows = m.directory_configuration.c
    query = sa.select(m.directory_configuration).where(rows.code == CODE)
    row = db.execute(query.with_for_update() if lock else query).mappings().first()
    env = runtime.smtp
    source = 'Saved configuration' if row else 'Environment'
    try:
        if row:
            cfg = Settings.model_validate_json(row['configuration']).model_dump()
            secret = cipher(runtime).decrypt(row['secret_cipher'].encode()).decode() if row['secret_cipher'] else ''
        else:
            mode = {'true', '1', 'yes', 'on'}
            tls = env.get('SMTP_SSL', 'false').strip().lower() in mode
            starttls = env.get('SMTP_STARTTLS', str(not tls)).strip().lower() in mode
            if tls and starttls:
                raise ValueError('Choose one SMTP TLS mode.')
            cfg = Settings.model_validate(dict(enabled=env.get('SMTP_ENABLED', 'false'), host=env.get('SMTP_HOST', ''),
                port=env.get('SMTP_PORT', 587), transport='TLS' if tls else 'STARTTLS' if starttls else 'PLAIN',
                username=env.get('SMTP_USERNAME', ''), from_address=env.get('SMTP_FROM_ADDRESS', ''),
                from_name=env.get('SMTP_FROM_NAME', 'Compliance by Design'), portal_url=env.get('PORTAL_BASE_URL', ''),
                timeout_seconds=env.get('SMTP_TIMEOUT_SECONDS', 15), digest_enabled=env.get('APPROVAL_REMINDERS_ENABLED', 'true'),
                digest_time=env.get('APPROVAL_REMINDER_TIME', '09:00'))).model_dump()
            secret = env.get('SMTP_PASSWORD', '')
        cfg['password'] = secret
        cfg['problem'] = validate(cfg, runtime.environment)
    except (ValidationError, ValueError, TypeError, InvalidToken):
        # Keep revision available if the credential needs replacement after key rotation.
        if 'cfg' not in locals():
            cfg = Settings(revision='unreadable' if row else 'environment').model_dump()
        cfg.update(password='', problem='Repair the SMTP configuration or re-enter its credential.')
    return cfg | {'source': source, 'ca_file': env.get('SMTP_CA_CERTS_FILE') or None}


def public(cfg, runtime):
    return {key: cfg[key] for key in Settings.model_fields} | {
        'has_password': bool(cfg['password']), 'source': cfg['source'], 'problem': cfg['problem'],
        'ready': cfg['enabled'] and not cfg['problem'], 'worker_mode': runtime.notification_worker_mode,
        'test_ready': not cfg['problem'] and not validate(cfg | {'enabled': True}, runtime.environment),
        'custom_ca': bool(cfg['ca_file']),
    }


def save(db, runtime, update):
    # A migration-seeded lock also serialises the first saved revision.
    db.execute(sa.select(m.id_counter.c.id).where(m.id_counter.c.entity_type == 'mail-settings').with_for_update()).scalar_one()
    previous = load(db, runtime, lock=True)
    if update.revision != previous['revision']:
        raise HTTPException(409, 'Email settings changed. Refresh and try again.')
    candidate = update.model_dump(exclude={'password', 'clear_password'})
    password = update.password.get_secret_value()
    if len(password) > 1000:
        raise HTTPException(422, 'Use an SMTP password of up to 1,000 characters.')
    if password and update.clear_password:
        raise HTTPException(422, 'Choose either a new password or removal of the saved password.')
    same_relay = all(candidate[key] == previous[key] for key in ('host', 'port', 'transport', 'username'))
    candidate['password'] = password or (previous['password'] if same_relay and not update.clear_password else '')
    error = validate(candidate, runtime.environment)
    if error:
        raise HTTPException(422, error)
    candidate['revision'] = new_id()
    values = {'configuration': json.dumps({k: candidate[k] for k in Settings.model_fields}),
              'secret_cipher': cipher(runtime).encrypt(candidate['password'].encode()).decode() if candidate['password'] else None}
    table = m.directory_configuration
    if previous['source'] == 'Environment':
        db.execute(table.insert().values(id=new_id(), code=CODE, **values))
    else:
        db.execute(table.update().where(table.c.code == CODE).values(**values))
    return public(candidate | {'source': 'Saved configuration', 'problem': None, 'ca_file': previous['ca_file']}, runtime)
