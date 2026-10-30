"""Transient, JSON-safe LDAP user details for a successful sign-in response."""
import base64
import math
import re
from datetime import date, datetime, time


def credential_attribute(name):
    base = str(name).split(';')[0].strip().casefold()
    # Standard password attribute OIDs, in case the directory uses numeric names.
    if base in {'2.5.4.35', '1.3.6.1.4.1.4203.1.3.4'}:
        return True
    compact = re.sub(r'[^a-z0-9]', '', base)
    if compact in {'pwd', 'passwd', 'userpw', 'ntpwd', 'lmpwd'}:
        return True
    # These describe password/account status rather than containing credentials.
    if compact in {'pwdlastset', 'pwdchangedtime', 'passwordlastset',
                   'passwordlastchanged', 'passwordexpirationtime',
                   'msdsuserpasswordexpirytimecomputed'}:
        return False
    return any(part in compact for part in (
        'password', 'unicodepwd', 'pwdhistory', 'supplementalcredentials',
        'credential', 'secret', 'privatekey', 'krbprincipalkey', 'krbmkey',
        'userpkcs12', 'nthash', 'lmhash', 'authkey', 'bindpw',
    ))


def json_value(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {'encoding': 'base64', 'data': base64.b64encode(value).decode('ascii')}
    if isinstance(value, dict):
        return public_attributes(value)
    if isinstance(value, (list, tuple, set)):
        return [json_value(item) for item in value]
    return str(value)


def public_attributes(attributes):
    return {str(name): json_value(value) for name, value in attributes.items()
            if not credential_attribute(name)}


def login_user_details(profile, username):
    """No bind configuration, credentials or portal authority enter this object."""
    return {
        'username': username,
        'source': 'uat_mock' if profile.get('source') == 'uat_mock' else 'ldap',
        'distinguished_name': profile.get('distinguished_name'),
        'full_name': profile.get('full_name') or username,
        'email': profile.get('email'),
        'department_code':profile.get('department_code'),
        'attributes_available': bool(profile.get('attributes_available', profile.get('attributes'))),
        'attributes': public_attributes(profile.get('attributes') or {}),
    }
