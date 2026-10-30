"""QA-compatible bcrypt password hashes for local STANDARD accounts."""
import bcrypt

MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if not encoded or len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError("Password must contain 1 to 72 UTF-8 bytes.")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    encoded = plain.encode("utf-8")
    if not encoded or len(encoded) > MAX_PASSWORD_BYTES or not isinstance(hashed, str):
        return False
    try:
        return bcrypt.checkpw(encoded, hashed.encode("ascii"))
    except (ValueError, UnicodeError):
        return False
