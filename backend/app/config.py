"""One explicit Oracle profile, shared by the application and Alembic."""
from dataclasses import dataclass, field
import os
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[2]
PROFILES = frozenset({"uat", "prod"})


@dataclass(frozen=True)
class Settings:
    app_env: str
    database_url: str = field(repr=False)
    env_file: Path | None = None
    seed_user_password: str = field(default="", repr=False)


def load_settings(environ=None, root=ROOT):
    env = dict(os.environ if environ is None else environ)
    selector = dotenv_values(root / ".env") if (root / ".env").is_file() else {}
    explicit = env.get("APP_ENV_FILE")
    profile = env.get("APP_ENV") or (None if explicit else selector.get("APP_ENV"))
    path = None
    if explicit:
        path = Path(explicit).expanduser()
        if not path.is_absolute():
            path = root / path
        if not path.is_file():
            raise RuntimeError("APP_ENV_FILE must identify an existing profile file.")
        values = dotenv_values(path)
        if profile and values.get("APP_ENV") and profile != values["APP_ENV"]:
            raise RuntimeError("APP_ENV and the selected profile file disagree.")
        profile = profile or values.get("APP_ENV")
    else:
        if profile not in PROFILES:
            raise RuntimeError("Set APP_ENV to uat or prod; these are the only environments.")
        path = root / f".env.{profile}"
        values = dotenv_values(path) if path.is_file() else {}
        if values.get("APP_ENV") and values["APP_ENV"] != profile:
            raise RuntimeError("APP_ENV and the selected profile file disagree.")
    if profile not in PROFILES:
        raise RuntimeError("APP_ENV must be exactly uat or prod.")
    url = env.get("DATABASE_URL", values.get("DATABASE_URL", ""))
    try:
        parsed = make_url(url)
        valid = (parsed.drivername == "oracle+oracledb" and parsed.username
                 and parsed.host and parsed.query.get("service_name"))
    except Exception:
        valid = False
    if not valid:
        raise RuntimeError("DATABASE_URL requires an oracle+oracledb URL with user, host and service_name.")
    seed_password = env.get("SEED_USER_PASSWORD", values.get("SEED_USER_PASSWORD", "")) or ""
    return Settings(profile, url, path if path.is_file() else None, seed_password)
