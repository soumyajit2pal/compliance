"""Runtime-only settings layered over the same two Alembic profiles."""
import os
from pathlib import Path
from dataclasses import dataclass, field
from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from .config import load_settings, ROOT

@dataclass(frozen=True)
class RuntimeSettings:
    environment: str
    database_url: str = field(repr=False)
    secret: str = field(repr=False)
    origins: tuple[str, ...] = ()
    secure_cookie: bool = True
    storage: Path = ROOT / 'var/documents'
    max_minutes: int = 480
    idle_minutes: int = 30
    ldap: dict = field(default_factory=dict, repr=False)
    demo_login_enabled: bool = False
    ldap_mock_enabled: bool = False
    ldap_mock_password: str = field(default='', repr=False)
    ldap_mock_username_prefix: str = 'bmock'
    login_private_key_file: Path | None = field(default=None, repr=False)
    log_dir: Path = ROOT / 'var/logs'
    log_file_name: str = 'app.log'
    log_max_bytes: int = 10 * 1024 * 1024
    log_backup_count: int = 5
    deep_logging: bool = False
    slow_request_ms: int = 2000

    def __post_init__(self):
        if self.ldap_mock_enabled:
            if self.environment != 'uat':
                raise RuntimeError('LDAP mock authentication cannot be enabled in Prod.')
            if len(self.ldap_mock_password) < 12:
                raise RuntimeError('LDAP_MOCK_PASSWORD must contain at least 12 characters.')
            import re
            if not re.fullmatch(r'[a-z][a-z0-9._-]{2,39}', self.ldap_mock_username_prefix):
                raise RuntimeError('LDAP_MOCK_USERNAME_PREFIX must be 3–40 lowercase username characters.')


def runtime_settings():
    s = load_settings()
    values = dict(dotenv_values(s.env_file)) if s.env_file else {}
    values.update(os.environ)
    secret = values.get('SECRET_KEY', '')
    local = ROOT / 'var/session-secret'
    if not secret and s.app_env == 'uat' and local.exists():
        secret = local.read_text().strip()
    if len(secret) < 48:
        raise RuntimeError('Set SECRET_KEY to at least 48 random characters before starting the API.')
    origins = tuple(x.strip().rstrip('/') for x in values.get('CORS_ALLOWED_ORIGINS',
        'http://127.0.0.1:8010,http://localhost:8010' if s.app_env == 'uat' else '').split(',') if x.strip())
    secure = values.get('SESSION_COOKIE_SECURE', 'true' if s.app_env == 'prod' else 'false').lower() == 'true'
    url = values.get('RUNTIME_DATABASE_URL') or (s.database_url if s.app_env == 'uat' else '')
    if url:
        parsed=make_url(url)
        if not (parsed.drivername=='oracle+oracledb' and parsed.username and parsed.host and parsed.query.get('service_name')):
            raise RuntimeError('RUNTIME_DATABASE_URL must identify an Oracle Thin-driver account and service.')
    if not url or (s.app_env == 'prod' and (not secure or not origins or any(not x.startswith('https://') for x in origins)
            or make_url(url).username.upper() == make_url(s.database_url).username.upper())):
        raise RuntimeError('Prod requires HTTPS origins, secure cookies and a separate restricted RUNTIME_DATABASE_URL.')
    def server_path(name, default):
        raw = values.get(name, default)
        if not raw or not raw.strip():
            raise RuntimeError(f'{name} must identify a server directory.')
        path = Path(raw.strip()).expanduser()
        if s.app_env == 'prod' and (name not in values or not path.is_absolute()):
            raise RuntimeError(f'Prod requires an explicit absolute {name}.')
        return (path if path.is_absolute() else ROOT / path).resolve()
    def positive_integer(name, default, maximum):
        try:
            value = int(values.get(name, default))
            if not 1 <= value <= maximum: raise ValueError()
            return value
        except (TypeError, ValueError):
            raise RuntimeError(f'{name} must be an integer between 1 and {maximum}.') from None
    storage = server_path('UPLOAD_STORAGE_ROOT', 'var/documents')
    log_dir = server_path('LOG_DIR', 'var/logs')
    if storage.is_relative_to(log_dir) or log_dir.is_relative_to(storage):
        raise RuntimeError('LOG_DIR and UPLOAD_STORAGE_ROOT must be separate directories, with neither inside the other.')
    import re
    log_name = values.get('LOG_FILE_NAME', 'app.log')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', log_name) or '..' in log_name:
        raise RuntimeError('LOG_FILE_NAME must be a simple filename without directories.')
    deep = values.get('DEEP_LOGGING', 'false').strip().lower()
    if deep not in {'true','false','1','0','yes','no','on','off'}:
        raise RuntimeError('DEEP_LOGGING must be true or false.')
    ldap = {k.lower().removeprefix('ldap_'): values.get(k, '') for k in [
        'LDAP_SERVER_URI','LDAP_BASE_DN','LDAP_BIND_DN','LDAP_BIND_PASSWORD','LDAP_CA_CERT_FILE',
        'LDAP_USER_DN_TEMPLATE','LDAP_USER_SEARCH_FILTER',
        'LDAP_ATTR_FULL_NAME','LDAP_ATTR_EMAIL','LDAP_ATTR_DEPARTMENT',
        'LDAP_ATTR_DEPARTMENT_CODE','LDAP_ATTR_DEPARTMENT_NAME']}
    ldap['user_search_filter'] = ldap['user_search_filter'] or '(sAMAccountName={username})'
    ldap['enabled'] = values.get('LDAP_ENABLED', str(bool(ldap['server_uri']))).lower() == 'true'
    ldap['use_ssl'] = values.get('LDAP_USE_SSL', 'true').lower() == 'true'
    # Retain this portal's existing StartTLS default for ldap:// bootstrap URLs.
    ldap['start_tls'] = values.get('LDAP_START_TLS', 'true').lower() == 'true'
    ldap['attr_full_name'] = ldap['attr_full_name'] or 'displayName'
    ldap['attr_email'] = ldap['attr_email'] or 'mail'
    ldap['attr_department'] = ldap['attr_department'] or 'department'
    key_file = values.get('LOGIN_ENCRYPTION_PRIVATE_KEY_FILE', '')
    key_path = Path(key_file).expanduser() if key_file else None
    if key_path is not None and not key_path.is_absolute(): key_path = ROOT / key_path
    return RuntimeSettings(s.app_env, url, secret, origins, secure, storage,
        int(values.get('SESSION_MAX_MINUTES',480)),int(values.get('SESSION_IDLE_MINUTES',30)),ldap,
        s.app_env == 'uat' and values.get('UAT_DEMO_LOGIN_ENABLED','true').lower() == 'true',
        values.get('LDAP_MOCK_ENABLED', 'false').lower() == 'true',
        values.get('LDAP_MOCK_PASSWORD', ''),
        values.get('LDAP_MOCK_USERNAME_PREFIX', 'bmock').strip().lower(),key_path,
        log_dir, log_name, positive_integer('LOG_MAX_BYTES',10485760,1073741824),
        positive_integer('LOG_BACKUP_COUNT',5,100),deep in {'true','1','yes','on'},
        positive_integer('SLOW_REQUEST_MS',2000,3600000))
