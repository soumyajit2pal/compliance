"""Run notification delivery and the compliance reminder job after Oracle migration."""
import argparse
from hashlib import sha256
import logging
import os
from pathlib import Path
import signal
from stat import S_ISREG
from tempfile import NamedTemporaryFile, gettempdir
from threading import Event, Thread
from time import monotonic, time

from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry
from sqlalchemy.engine import make_url

from . import delivery_reminders, mail_queue, mail_settings
from .database import create_application_engine
from .events import now
from .logging_config import configure_logging
from .runtime import runtime_settings

LOG = logging.getLogger('cbd.notifications')
POLL_SECONDS = 30
HEARTBEAT = Path(gettempdir()) / 'cbd-notification-worker-heartbeat'


class WakeSignal:
    """Redis is a wake hint. Oracle polling resumes every job after restart or cache loss."""
    def __init__(self, cfg):
        self.redis = None
        if cfg.redis_url:
            url = make_url(cfg.database_url)
            scope = (cfg.environment, url.host, url.port, url.username, url.query.get('service_name'))
            self.key = 'cbd:notifications:pending:' + sha256(repr(scope).encode()).hexdigest()
            self.redis = Redis.from_url(cfg.redis_url, socket_connect_timeout=.15, socket_timeout=.15,
                                        retry=Retry(NoBackoff(), 0))

    def send(self):
        if self.redis:
            try:
                self.redis.set(self.key, '1', ex=60)
            except RedisError:
                LOG.debug('Redis notification wake unavailable. Oracle polling remains active.')

    def consume(self):
        if self.redis:
            try:
                return bool(self.redis.getdel(self.key))
            except RedisError:
                return False
        return False

    def close(self):
        if self.redis:
            self.redis.close()


class NotificationWorker:
    def __init__(self, engine, cfg, wake):
        self.engine = engine
        self.cfg = cfg
        self.wake = wake
        self.stop = Event()

    def schedule(self):
        next_reminder = 0
        while not self.stop.is_set():
            if self.cfg.reminders_enabled and monotonic() >= next_reminder:
                try:
                    with self.engine.begin() as db:
                        created = delivery_reminders.run(db)['created']
                    if created:
                        self.wake.send()
                except Exception:
                    LOG.exception('Compliance reminder job failed. It will retry.')
                next_reminder = monotonic() + self.cfg.reminder_interval_seconds
            try:
                with self.engine.begin() as db:
                    config = mail_settings.load(db, self.cfg)
                    created = mail_queue.queue_daily_digest(db, config, now())
                if created:
                    self.wake.send()
            except Exception:
                LOG.exception('Daily approval reminder job failed. It will retry.')
            self.stop.wait(POLL_SECONDS)

    def send(self):
        next_poll = 0
        while not self.stop.is_set():
            if self.wake.consume() or monotonic() >= next_poll:
                try:
                    mail_queue.deliver_pending(self.engine, self.cfg, stopping=self.stop.is_set)
                except Exception:
                    LOG.exception('Email delivery job failed. Oracle polling will resume.')
                next_poll = monotonic() + POLL_SECONDS
            self.stop.wait(1 if self.wake.redis else max(1, next_poll - monotonic()))

    def run(self, *, heartbeat=False):
        threads = [Thread(target=self.schedule, name='notification-scheduler'),
                   Thread(target=self.send, name='notification-delivery')]
        for thread in threads:
            thread.start()
        try:
            while not self.stop.is_set() and all(thread.is_alive() for thread in threads):
                if heartbeat:
                    try:
                        write_heartbeat()
                    except OSError:
                        LOG.warning('Notification worker heartbeat could not be updated.')
                self.stop.wait(5)
        finally:
            self.stop.set()
            for thread in threads:
                thread.join()


def write_heartbeat():
    with NamedTemporaryFile(mode='w', encoding='utf-8', dir=HEARTBEAT.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(str(time()))
            stream.close()
            temporary.replace(HEARTBEAT)
        finally:
            temporary.unlink(missing_ok=True)


def healthy():
    try:
        with os.fdopen(os.open(HEARTBEAT, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), encoding='utf-8') as stream:
            info = os.fstat(stream.fileno())
            return (S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o077
                    and 0 <= time() - float(stream.read(64)) <= 30)
    except (ValueError, OSError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--healthcheck', action='store_true')
    if parser.parse_args().healthcheck:
        raise SystemExit(0 if healthy() else 1)
    cfg = runtime_settings()
    if cfg.notification_worker_mode != 'dedicated':
        raise RuntimeError('Use NOTIFICATION_WORKER_MODE=dedicated to run the standalone notification worker.')
    configure_logging(cfg)
    engine = create_application_engine(cfg.database_url)
    wake = WakeSignal(cfg)
    worker = NotificationWorker(engine, cfg, wake)
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: worker.stop.set())
    try:
        worker.run(heartbeat=True)
    finally:
        wake.close()
        engine.dispose()


if __name__ == '__main__':
    main()
