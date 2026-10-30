"""Local UAT HTTPS provisioning and startup; never installs OS trust or changes Prod."""
import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
import ssl
import tempfile

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from dotenv import dotenv_values, set_key
from .config import ROOT, load_settings


@dataclass(frozen=True)
class LocalHTTPS:
    profile: Path
    host: str
    port: int
    cert_file: Path
    key_file: Path

    @property
    def origin(self):
        host = '[' + self.host + ']' if ':' in self.host else self.host
        return f'https://{host}:{self.port}'

    @property
    def origins(self):
        return tuple(dict.fromkeys((self.origin, f'https://localhost:{self.port}', f'https://127.0.0.1:{self.port}')))

    def public_config(self):
        return dict(host=self.host, port=self.port, origin=self.origin,
                    cert_file=str(self.cert_file), key_file=str(self.key_file))


def configuration(environ=None, root=ROOT):
    env = dict(os.environ if environ is None else environ)
    settings = load_settings(env, root=root)
    if settings.app_env != 'uat':
        raise RuntimeError('The local HTTPS launcher is UAT-only. Prod needs its approved TLS deployment.')
    if not settings.env_file:
        raise RuntimeError('Create and populate the selected UAT profile before configuring HTTPS.')
    values = {**dotenv_values(settings.env_file), **env}
    def path(name, default):
        value = (values.get(name) or default).strip()
        result = Path(value).expanduser()
        return (result if result.is_absolute() else root / result).resolve()
    host = values.get('UAT_HTTPS_HOST', '127.0.0.1').strip()
    if host not in {'localhost', '127.0.0.1', '::1'}:
        raise RuntimeError('Local HTTPS must bind to a loopback address.')
    try:
        port = int(values.get('UAT_HTTPS_PORT', '8010'))
        if not 1 <= port <= 65535: raise ValueError()
    except (TypeError, ValueError):
        raise RuntimeError('UAT_HTTPS_PORT must be between 1 and 65535.') from None
    cert = path('TLS_CERT_FILE', 'var/tls/localhost.crt')
    key = path('TLS_KEY_FILE', 'var/tls/localhost.key')
    login_key = path('LOGIN_ENCRYPTION_PRIVATE_KEY_FILE', 'var/login-private.pem')
    if cert == key or login_key in {cert, key}:
        raise RuntimeError('TLS certificate/key paths must be distinct from each other and the login encryption key.')
    return LocalHTTPS(settings.env_file, host, port, cert, key)


def validate(config):
    if not config.cert_file.is_file() or not config.key_file.is_file():
        raise RuntimeError('TLS files are missing. Run: .venv/bin/python -m backend.app.local_https setup')
    if os.name == 'posix' and config.key_file.stat().st_mode & 0o077:
        raise RuntimeError('The TLS private key must have owner-only permissions (chmod 600).')
    cert = x509.load_pem_x509_certificate(config.cert_file.read_bytes())
    now = datetime.now(timezone.utc)
    if not cert.not_valid_before_utc <= now < cert.not_valid_after_utc:
        raise RuntimeError('The localhost TLS certificate is not currently valid; provision or renew it.')
    try:
        names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        assert 'localhost' in names.get_values_for_type(x509.DNSName)
        assert ipaddress.ip_address('127.0.0.1') in names.get_values_for_type(x509.IPAddress)
    except (x509.ExtensionNotFound, AssertionError):
        raise RuntimeError('The certificate must include localhost and 127.0.0.1 subject alternative names.') from None
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(config.cert_file, config.key_file)
    return cert


def _write(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.tls-')
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), mode)
            output.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def provision(config, renew=False):
    if (config.cert_file.exists() or config.key_file.exists()) and not renew:
        validate(config)  # Refuse partial/invalid pairs; never overwrite an existing key implicitly.
    else:
        key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Compliance by Design localhost')])
        now = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),
                x509.IPAddress(ipaddress.ip_address('127.0.0.1')), x509.IPAddress(ipaddress.ip_address('::1'))]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=True,
                data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
                encipher_only=None, decipher_only=None), critical=True).sign(key, hashes.SHA256()))
        _write(config.key_file, key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()), 0o600)
        _write(config.cert_file, cert.public_bytes(serialization.Encoding.PEM), 0o644)
    cert = validate(config)
    for field, value in {'TLS_CERT_FILE': str(config.cert_file), 'TLS_KEY_FILE': str(config.key_file),
            'UAT_HTTPS_HOST': config.host, 'UAT_HTTPS_PORT': str(config.port),
            'SESSION_COOKIE_SECURE': 'true', 'CORS_ALLOWED_ORIGINS': ','.join(config.origins)}.items():
        set_key(config.profile, field, value, quote_mode='always')
    config.profile.chmod(0o600)
    return {'origin': config.origin, 'browser_url': f'https://localhost:{config.port}',
        'certificate_sha256': cert.fingerprint(hashes.SHA256()).hex(),
        'expires_at': cert.not_valid_after_utc.isoformat(), 'trust': 'Self-signed local certificate; browser trust is a separate client decision.'}


def serve(config):
    validate(config)
    from .runtime import runtime_settings
    import uvicorn
    runtime = runtime_settings()
    if not runtime.secure_cookie or not set(config.origins) <= set(runtime.origins):
        raise RuntimeError('Configure HTTPS origins and secure cookies with local_https setup before startup.')
    server = uvicorn.Config('backend.app.main:app', host=config.host, port=config.port,
        ssl_certfile=str(config.cert_file), ssl_keyfile=str(config.key_file),
        ssl_version=ssl.PROTOCOL_TLS_SERVER, proxy_headers=False)
    server.load()
    server.ssl.minimum_version = ssl.TLSVersion.TLSv1_2
    uvicorn.Server(server).run()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'config', 'serve'])
    parser.add_argument('--renew', action='store_true', help='Explicitly replace the local TLS certificate/key pair.')
    args = parser.parse_args()
    if args.renew and args.action != 'setup': parser.error('--renew is only valid with setup.')
    config = configuration()
    if args.action == 'setup': print(json.dumps(provision(config, args.renew), indent=2))
    elif args.action == 'config':
        validate(config)
        print(json.dumps(config.public_config()))
    else: serve(config)


if __name__ == '__main__': main()
