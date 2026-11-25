"""Shared source validation and transaction-bound private file creation."""
import hashlib
from contextlib import contextmanager

from . import models as m, repository as repo
from .events import audit, new_id, now
from .storage import write_stored_file
from .upload_formats import inspect_document

FILE_LEDGER = 'cbd_created_storage_files'


@contextmanager
def file_transaction(db):
    """Remove only exclusively created files if the enclosing DB work fails."""
    previous = db.info.get(FILE_LEDGER)
    created = []
    db.info[FILE_LEDGER] = created
    try:
        yield
    except BaseException:
        for path in reversed(created):
            path.unlink(missing_ok=True)
            path.parent.rmdir()
        raise
    else:
        if previous is not None:
            previous.extend(created)
    finally:
        if previous is None:
            db.info.pop(FILE_LEDGER, None)
        else:
            db.info[FILE_LEDGER] = previous


def preserve_bytes(db, storage, identifier, filename, data, *, staging=False):
    path = write_stored_file(storage, identifier, filename, data, staging=staging)
    if FILE_LEDGER in db.info:
        db.info[FILE_LEDGER].append(path)
    return path


def inspect_source(filename, data):
    name, media = inspect_document(filename, data)
    return {'file_name': name, 'content_type': media,
        'file_size': len(data), 'file_hash': hashlib.sha256(data).hexdigest()}


def save_document(db, actor, storage, filename, data, owner_unit_id, confidentiality_class_id):
    actor.require({'AUTHOR'}, owner_unit_id)
    repo.active(db, m.organisational_unit, owner_unit_id)
    repo.active(db, m.confidentiality_class, confidentiality_class_id)
    details = inspect_source(filename, data)
    identifier = new_id()
    preserve_bytes(db, storage, identifier, details['file_name'], data)
    db.execute(m.document.insert().values(id=identifier, storage_uri='portal://' + identifier,
        owner_unit_id=owner_unit_id, confidentiality_class_id=confidentiality_class_id,
        uploaded_by=actor.id, uploaded_at=now(), **details))
    audit(db, actor, 'document', identifier, 'SOURCE_UPLOADED', new={
        'name': details['file_name'], 'sha256': details['file_hash'], 'bytes': details['file_size']})
    return {'id': identifier, 'file_name': details['file_name']}
