"""QA Portal convention: DATABASE_URL, isolated prefix, explicit revisions."""
from logging.config import fileConfig
from alembic import context
from sqlalchemy import create_engine, pool
from backend.app.config import load_settings
from backend.app.db_base import metadata
from backend.app import models  # noqa: F401
from backend.alembic.oracle_compare import equivalent_case_indexes

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)
settings = load_settings()


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and reflected:
        return name.startswith("cbd_")
    if type_ == "index" and compare_to is not None and equivalent_case_indexes(obj, compare_to):
        return False
    return True


def configure(**kwargs):
    context.configure(target_metadata=metadata, version_table="cbd_alembic_version",
        include_object=include_object, include_schemas=False, compare_type=True,
        compare_server_default=False, seed_environment=settings.app_env,
        seed_user_password=settings.seed_user_password, **kwargs)


if context.is_offline_mode():
    configure(url=settings.database_url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(settings.database_url, poolclass=pool.NullPool, hide_parameters=True)
    try:
        with engine.connect() as connection:
            configure(connection=connection)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()
