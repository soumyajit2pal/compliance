"""Redis read-through cache for published dropdown definitions and reference options."""
import hashlib
import json
import logging

from fastapi.encoders import jsonable_encoder
from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry
from sqlalchemy.engine import make_url

from . import dropdowns, master_data

logger = logging.getLogger('cbd.portal')
CACHE_TTL_SECONDS = 300


class DropdownCache:
    def __init__(self, redis_url, database_url, environment):
        database = make_url(database_url)
        scope = (environment, database.host, database.port, database.query.get('service_name'), database.username)
        digest = hashlib.sha256(json.dumps(scope).encode()).hexdigest()
        self.prefix = f'cbd:dropdown:v1:{digest}:'
        self.reference_prefix = f'cbd:reference:v1:{digest}:'
        self.client = Redis.from_url(
            redis_url, socket_connect_timeout=0.15,
            socket_timeout=0.15, retry=Retry(NoBackoff(), 0),
        )

    def _read(self, key, required, value_type):
        try:
            stored = self.client.get(key)
        except RedisError:
            logger.debug('Redis reference cache unavailable. Reading from Oracle.')
            return None, False
        if stored is not None:
            try:
                data = json.loads(stored)
                if isinstance(data, dict) and all(isinstance(data.get(name), value_type) for name in required):
                    return data, True
            except ValueError:
                pass
        return None, True

    def _write(self, key, data):
        try:
            self.client.set(key, json.dumps(data), ex=CACHE_TTL_SECONDS)
        except RedisError:
            logger.debug('Redis reference cache fill failed. Using Oracle result.')

    def configuration(self, db):
        # Publication and business validation keep using the Oracle transaction.
        revision = dropdowns.configuration_revision(db)
        data, available = self._read(self.prefix + str(revision), ('fields', 'lists', 'presentation'), dict)
        if data is not None:
            return revision, data
        # A publish can commit between the revision check and this read. Cache
        # the revision returned with the definition, never the earlier revision.
        revision, data = dropdowns.configuration(db)
        if available:
            self._write(self.prefix + str(revision), data)
        return revision, data

    def reference_options(self, db, revision):
        names = master_data.CACHED_REFERENCE_MASTERS
        key = self.reference_prefix + str(revision)
        data, available = self._read(key, names, list)
        if data is not None:
            return {name: data[name] for name in names}
        data = master_data.reference_rows(db, names)
        # A publication during this group of reads can yield mixed revisions.
        # Serve the DB reads to this caller without warming that stale key.
        if available and dropdowns.configuration_revision(db) == revision:
            self._write(key, jsonable_encoder(data))
        return data

    def close(self):
        self.client.close()
