"""QualityOps-style encrypted login; private key stays on the API server.

AES-256-GCM protects credentials; RSA-OAEP/SHA-256 wraps the fresh AES key.
A signed two-minute challenge is consumed atomically in Oracle before login,
including failed authentication. TLS is still required outside loopback UAT.
"""
import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from . import models as m
from .events import new_id
from .schemas import Login

ALGORITHM = 'RSA-OAEP-256+A256GCM'
LIFETIME = 120
INVALID = 'Invalid or expired encrypted login. Please try signing in again.'


class EncryptedLogin(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    key_id: str = Field(min_length=64, max_length=64)
    challenge: str = Field(min_length=1, max_length=2048)
    wrapped_key: str = Field(min_length=1, max_length=1024)
    iv: str = Field(min_length=1, max_length=32)
    ciphertext: str = Field(min_length=1, max_length=12000)


def load_material(filename):
    try:
        if not filename:
            raise ValueError('Missing key configuration')
        path = Path(filename)
        stat = path.stat()
        if stat.st_size > 16384 or (os.name != 'nt' and stat.st_mode & 0o077):
            raise ValueError('Private key permissions must be owner-only')
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 3072:
            raise ValueError('RSA key must be at least 3072 bits')
        public = key.public_key().public_bytes(serialization.Encoding.DER,
                                               serialization.PublicFormat.SubjectPublicKeyInfo)
        return key, public, hashlib.sha256(public).hexdigest()
    except (OSError, ValueError, TypeError) as exc:
        raise RuntimeError('Configure an owner-only RSA login key (3072+ bits) with LOGIN_ENCRYPTION_PRIVATE_KEY_FILE.') from exc


def _b64url(data):
    return base64.urlsafe_b64encode(data).decode('ascii').rstrip('=')


def _signature(secret, body):
    return hmac.new(secret.encode(), b'cbd-login-challenge-v1\x00' + body.encode(), hashlib.sha256).digest()


def public_login_key(material, secret):
    _, public, key_id = material
    at = int(time.time())
    claims = {'purpose': 'login-encryption', 'key_id': key_id, 'jti': new_id(),
              'iat': at, 'exp': at + LIFETIME}
    body = _b64url(json.dumps(claims, separators=(',', ':')).encode())
    return {'algorithm': ALGORITHM, 'key_id': key_id,
            'public_key': base64.b64encode(public).decode('ascii'),
            'challenge': body + '.' + _b64url(_signature(secret, body)), 'expires_in': LIFETIME}


def _claims(challenge, secret, key_id):
    body, signature = challenge.split('.')
    decode = lambda value: base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)
    if not hmac.compare_digest(decode(signature), _signature(secret, body)):
        raise ValueError('Invalid signature')
    data = json.loads(decode(body))
    at = int(time.time())
    if (not isinstance(data, dict) or data.get('purpose') != 'login-encryption'
            or data.get('key_id') != key_id or not isinstance(data.get('jti'), str)
            or len(data['jti']) != 36 or type(data.get('iat')) is not int
            or type(data.get('exp')) is not int or data['iat'] > at
            or data['exp'] <= at or data['exp'] - data['iat'] != LIFETIME):
        raise ValueError('Invalid challenge')
    return data


def record_challenge(db, claims):
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    db.execute(m.used_login_challenge.delete().where(m.used_login_challenge.c.expires_at < cutoff))
    db.execute(m.used_login_challenge.insert().values(id=claims['jti'],
        expires_at=datetime.fromtimestamp(claims['exp'], timezone.utc).replace(tzinfo=None)))


def consume_challenge(engine, claims):
    try:
        # Separate transaction: password failures must not release a challenge.
        # The primary key also arbitrates separate workers and replicas.
        with engine.begin() as db:
            record_challenge(db, claims)
    except IntegrityError as exc:
        raise HTTPException(400, INVALID) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(503, 'Secure login is temporarily unavailable. Please try again.') from exc


def decrypt_envelope(envelope, material, secret, consume):
    key, _, key_id = material
    try:
        if envelope.key_id != key_id:
            raise ValueError('Invalid key')
        claims = _claims(envelope.challenge, secret, key_id)
        decode = lambda value: base64.b64decode(value, validate=True)
        wrapped, iv, ciphertext = map(decode, (envelope.wrapped_key, envelope.iv, envelope.ciphertext))
        if len(iv) != 12 or len(wrapped) != key.key_size // 8:
            raise ValueError('Invalid envelope')
        aes_key = key.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                                                    algorithm=hashes.SHA256(), label=None))
        if len(aes_key) != 32:
            raise ValueError('Invalid AES key')
        plaintext = AESGCM(aes_key).decrypt(iv, ciphertext, envelope.challenge.encode())
        credentials = Login.model_validate_json(plaintext)
    except Exception as exc:
        raise HTTPException(400, INVALID) from exc
    consume(claims)
    return credentials


async def encrypted_login_credentials(request: Request):
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise HTTPException(415, 'An encrypted JSON login payload is required.')
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 20000:
            raise HTTPException(413, 'Login payload is too large.')
    try:
        envelope = EncryptedLogin.model_validate_json(body)
    except (ValidationError, ValueError) as exc:
        # Never return Pydantic input values, credentials or cryptographic errors.
        raise HTTPException(400, 'An encrypted JSON login payload is required.') from exc
    return await run_in_threadpool(decrypt_envelope, envelope, request.app.state.login_material,
                                   request.app.state.settings.secret, request.app.state.consume_login_challenge)
