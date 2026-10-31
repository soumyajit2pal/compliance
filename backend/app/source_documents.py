"""Shared source validation and transaction-bound private file creation."""
import hashlib
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException

from . import models as m, repository as repo
from .events import audit, new_id, now
from .storage import stored_path, write_private

MAX_SOURCE_BYTES = 20 * 1024 * 1024
FILE_LEDGER = 'cbd_created_storage_files'
SOURCE_TYPES = {'.pdf': 'application/pdf', '.txt': 'text/plain',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}


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
        raise
    finally:
        if previous is None:
            db.info.pop(FILE_LEDGER, None)
        else:
            db.info[FILE_LEDGER] = previous
            previous.extend(created)


def preserve_bytes(db, storage, identifier, data, *, staging=False):
    path = stored_path(storage, identifier, staging=staging)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    write_private(path, data)
    if FILE_LEDGER in db.info:
        db.info[FILE_LEDGER].append(path)
    return path


def inspect_source(filename, data):
    name = str(filename or '').replace('\\', '/').split('/')[-1]
    if not name or len(name) > 255 or any(ord(c) < 32 for c in name):
        raise HTTPException(422, 'Use a source filename of 1–255 characters without control characters.')
    extension = Path(name).suffix.lower()
    if not data or len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(422, 'Choose a non-empty source file up to 20 MB.')
    if extension not in SOURCE_TYPES or (extension == '.pdf' and not data.startswith(b'%PDF-')) or (extension == '.docx' and not data.startswith(b'PK')):
        raise HTTPException(422, 'Upload a PDF, text or DOCX source file.')
    if extension == '.txt':
        try:
            data.decode('utf-8')
        except UnicodeError:
            raise HTTPException(422, 'Text sources must use UTF-8.') from None
    return {'file_name': name, 'content_type': SOURCE_TYPES[extension],
        'file_size': len(data), 'file_hash': hashlib.sha256(data).hexdigest()}


def save_document(db, actor, storage, filename, data, owner_unit_id, confidentiality_class_id):
    actor.require({'AUTHOR'}, owner_unit_id)
    repo.active(db, m.organisational_unit, owner_unit_id)
    repo.active(db, m.confidentiality_class, confidentiality_class_id)
    details = inspect_source(filename, data)
    identifier = new_id()
    preserve_bytes(db, storage, identifier, data)
    db.execute(m.document.insert().values(id=identifier, storage_uri='portal://' + identifier,
        owner_unit_id=owner_unit_id, confidentiality_class_id=confidentiality_class_id,
        uploaded_by=actor.id, uploaded_at=now(), **details))
    audit(db, actor, 'document', identifier, 'SOURCE_UPLOADED', new={
        'name': details['file_name'], 'sha256': details['file_hash'], 'bytes': details['file_size']})
    return {'id': identifier, 'file_name': details['file_name']}
