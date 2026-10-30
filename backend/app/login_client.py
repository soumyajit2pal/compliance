"""Public-key login client for scripts/tests; no access to server private keys."""
import base64
import json
import os
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def login_envelope(key, username, password):
    if key['algorithm'] != 'RSA-OAEP-256+A256GCM':
        raise ValueError('Unsupported login encryption algorithm')
    public = serialization.load_der_public_key(base64.b64decode(key['public_key'], validate=True))
    aes_key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    ciphertext = AESGCM(aes_key).encrypt(iv, json.dumps({'username': username,
        'password': password}, ensure_ascii=False).encode(), key['challenge'].encode())
    wrapped = public.encrypt(aes_key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                                                 algorithm=hashes.SHA256(), label=None))
    encode = lambda data: base64.b64encode(data).decode('ascii')
    return dict(key_id=key['key_id'], challenge=key['challenge'], wrapped_key=encode(wrapped),
                iv=encode(iv), ciphertext=encode(ciphertext))


def seal_login(client, credentials):
    response = client.get('/api/auth/login-key')
    response.raise_for_status()
    return login_envelope(response.json(), credentials['username'], credentials['password'])
