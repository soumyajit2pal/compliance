"""Oracle connection pool for application services; no startup DDL."""
import os
import time
import logging
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from .config import load_settings


def create_application_engine(database_url=None):
    settings = load_settings()
    from sqlalchemy.engine import make_url
    import re
    chosen_url = database_url or settings.database_url
    owner = make_url(settings.database_url).username
    runtime_user = make_url(chosen_url).username
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_$#]{0,127}', owner):
        raise RuntimeError('The Oracle owner must use a normal unquoted schema identifier.')
    engine = create_engine(chosen_url, hide_parameters=True,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
        pool_timeout=int(os.getenv("DB_POOL_TIMEOUT", "30")),
        pool_recycle=int(os.getenv("DB_POOL_RECYCLE", "1800")),
        pool_pre_ping=os.getenv("DB_POOL_PRE_PING", "true").lower() == "true")
    timeout = int(os.getenv("DB_QUERY_TIMEOUT_MS", "30000"))
    @event.listens_for(engine, "connect")
    def configure_timeout(connection, record):
        connection.call_timeout = timeout
        if runtime_user.upper() != owner.upper():
            cursor = connection.cursor()
            try:
                cursor.execute('ALTER SESSION SET CURRENT_SCHEMA = "' + owner.upper() + '"')
            finally:
                cursor.close()
    # Deep diagnostics measure database work without logging SQL, bind values,
    # result rows or connection credentials. The engine still hides parameters.
    logger = logging.getLogger('cbd.database')
    @event.listens_for(engine, 'before_cursor_execute')
    def query_started(conn, cursor, statement, parameters, context, executemany):
        context.cbd_started = time.perf_counter()
    @event.listens_for(engine, 'after_cursor_execute')
    def query_finished(conn, cursor, statement, parameters, context, executemany):
        logger.debug('Database query completed duration_ms=%.2f executemany=%s',
                     (time.perf_counter()-context.cbd_started)*1000, executemany)
    return engine


def create_session_factory():
    return sessionmaker(bind=create_application_engine(), autoflush=False, expire_on_commit=False)
