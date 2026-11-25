"""Revisioned per-file upload limits and the multipart transport ceiling."""
import json

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from . import models as m
from .events import audit, new_id

MIB = 1024 * 1024
MAX_FILE_MIB = 100
MAX_REQUEST_BYTES = 101 * MIB  # Keep aligned with the Nginx limit, including multipart overhead.
MAX_BUNDLE_MIB = 100
MAX_ATTACHMENTS = 50
CODE = 'UPLOAD_POLICY'
ADMIN_PATH = '/api/admin/upload-settings'


class Limits(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_mib: int = Field(20, ge=1, le=MAX_FILE_MIB, strict=True)
    evidence_mib: int = Field(20, ge=1, le=MAX_FILE_MIB, strict=True)
    workbook_mib: int = Field(20, ge=1, le=MAX_FILE_MIB, strict=True)
    organisation_mib: int = Field(2, ge=1, le=MAX_FILE_MIB, strict=True)


class LimitsUpdate(Limits):
    revision: str = Field(min_length=1, max_length=36)


def configuration(db, *, lock=False):
    table = m.directory_configuration
    query = sa.select(table).where(table.c.code == CODE)
    row = db.execute(query.with_for_update() if lock else query).mappings().first()
    if not row:
        return LimitsUpdate(**Limits().model_dump(), revision='default'), None
    try:
        return LimitsUpdate.model_validate_json(row['configuration']), row['id']
    except ValidationError:
        raise HTTPException(503, 'Upload limits are unavailable. Contact a portal administrator.') from None


def _checked(data, limit_mib):
    if len(data) > limit_mib * MIB:
        raise HTTPException(413, f'Each file must be {limit_mib} MiB or smaller.')
    if not data:
        raise HTTPException(422, 'Choose a non-empty file.')
    return data


def read_file(file, limit_mib):
    return _checked(file.file.read(limit_mib * MIB + 1), limit_mib)


async def read_upload(file, limit_mib):
    return _checked(await file.read(limit_mib * MIB + 1), limit_mib)


def public(limits):
    from .upload_formats import DOCUMENT_TYPES, INLINE_TYPES
    return limits.model_dump(exclude={'revision'}) | {
        'document_extensions': sorted(DOCUMENT_TYPES),
        'preview_extensions': sorted(extension for extension, media in DOCUMENT_TYPES.items() if media in INLINE_TYPES),
        'max_bundle_mib': MAX_BUNDLE_MIB, 'max_attachments': MAX_ATTACHMENTS,
    }


def install(app, get_db, current):
    @app.get(ADMIN_PATH)
    def get_limits(db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        previous, _ = configuration(db)
        return previous.model_dump() | {'max_file_mib': MAX_FILE_MIB}

    @app.put(ADMIN_PATH)
    def save_limits(payload: LimitsUpdate, db=Depends(get_db), actor=Depends(current)):
        actor.require({'ADMIN'})
        previous, identifier = configuration(db, lock=True)
        if payload.revision != previous.revision:
            raise HTTPException(409, 'Upload settings changed. Reload the page before saving.')
        result = payload.model_copy(update={'revision': new_id()})
        table = m.directory_configuration
        values = {'configuration': result.model_dump_json()}
        try:
            if identifier:
                db.execute(table.update().where(table.c.id == identifier).values(**values))
            else:
                db.execute(table.insert().values(id=new_id(), code=CODE, **values))
        except IntegrityError:
            raise HTTPException(409, 'Upload settings changed. Reload the page before saving.') from None
        audit(db, actor, 'system', CODE, 'UPLOAD_SETTINGS_SAVED',
            old=previous.model_dump(exclude={'revision'}), new=result.model_dump(exclude={'revision'}))
        return result.model_dump() | {'max_file_mib': MAX_FILE_MIB}
