"""Run the shipped Alembic chain once for the portal's configured Oracle schema."""
from sqlalchemy.engine import make_url

from .config import load_settings
from .seed import run


def migration_target(settings):
    url = make_url(settings.database_url)
    return (
        settings.app_env,
        url.host.lower(),
        url.port or 1521,
        url.query['service_name'].lower(),
        url.username.upper(),
    )


def main():
    migration_profile = load_settings()
    portal_profile = load_settings({'APP_ENV_FILE': '/run/portal/profile.env'})
    if migration_target(migration_profile) != migration_target(portal_profile):
        raise SystemExit('The Docker migration and portal profiles must select the same environment and Oracle owner service.')
    run()


if __name__ == '__main__':
    main()
