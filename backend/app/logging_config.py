"""QualityOps-style persistent operational logs, without request/profile data.

POSIX workers coordinate rollover through a stable flock file. The filesystem
must support flock; use a log collector for hosts without shared lock semantics.
"""
import contextvars
import fcntl
import logging
from logging.handlers import RotatingFileHandler
import os
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo
from .storage import writable_directory

request_id = contextvars.ContextVar('cbd_request_id', default='-')
_configured = None
_handlers = []


class ProcessSafeRotatingFileHandler(RotatingFileHandler):
    def _open(self):
        fd = os.open(self.baseFilename, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.fchmod(fd, 0o600)
        return os.fdopen(fd, 'a', encoding='utf-8')

    def emit(self, record):
        try:
            fd = os.open(self.baseFilename + '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'ab') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                try:
                    if self.stream is not None:
                        self.stream.close(); self.stream = None
                    super().emit(record)
                finally:
                    fcntl.flock(lock, fcntl.LOCK_UN)
        except Exception:
            self.handleError(record)


class ContextFilter(logging.Filter):
    def filter(self, record):
        record.request_id = request_id.get()
        return True


class SafeFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        return datetime.fromtimestamp(record.created, ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d %H:%M:%S IST')

    def formatException(self, info):
        # Raw driver/validation exception messages can contain SQL, bind data,
        # usernames or credentials. Retain the complete stack locations and
        # exception type, without message text, source lines or local variables.
        kind, _, tb = info
        lines = ['Traceback (exception message and source values omitted):']
        lines.extend(f'  File "{frame.filename}", line {frame.lineno}, in {frame.name}'
                     for frame in traceback.extract_tb(tb))
        lines.append(kind.__name__)
        return '\n'.join(lines)


def configure_logging(cfg):
    global _configured, _handlers
    signature = (cfg.log_dir, cfg.log_file_name, cfg.log_max_bytes, cfg.log_backup_count, cfg.deep_logging)
    if _configured == signature: return
    folder = writable_directory(cfg.log_dir, 'LOG_DIR')
    file = folder / cfg.log_file_name
    if file.is_symlink() or file.with_name(file.name + '.lock').is_symlink():
        raise RuntimeError('LOG_FILE_NAME and its lock must not be symbolic links.')
    try:
        handler = ProcessSafeRotatingFileHandler(file, maxBytes=cfg.log_max_bytes,
            backupCount=cfg.log_backup_count, encoding='utf-8', delay=False)
        # Validate lock access before serving traffic, not on the first emit.
        descriptor = os.open(str(file) + '.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
    except OSError:
        raise RuntimeError('LOG_DIR must allow application log and lock creation.') from None
    level = logging.DEBUG if cfg.deep_logging else logging.INFO
    formatter = SafeFormatter('%(asctime)s %(levelname)-8s [%(name)s] [pid=%(process)d request_id=%(request_id)s] %(message)s')
    handlers = [handler, logging.StreamHandler()]
    for target in handlers:
        target.setLevel(level); target.setFormatter(formatter); target.addFilter(ContextFilter())
    # Only known operational loggers use this sink. Dependency debug messages
    # and raw Uvicorn access URLs/query strings must not expose directory data.
    for name in ('cbd', 'uvicorn', 'uvicorn.error'):
        logger = logging.getLogger(name)
        logger.handlers = handlers.copy(); logger.setLevel(level); logger.propagate = False
    access = logging.getLogger('uvicorn.access')
    access.handlers = [logging.NullHandler()]; access.propagate = False
    for old in _handlers: old.close()
    _handlers = handlers; _configured = signature
    logging.getLogger('cbd.operations').info('Logging configured mode=%s', 'DEEP' if cfg.deep_logging else 'BASIC')
