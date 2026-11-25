"""Deployment-owned document storage; no client-controlled filesystem paths."""
import os
import re
import tempfile
import unicodedata
from pathlib import Path


def writable_directory(path: Path, setting: str) -> Path:
    """Fail startup on an unusable mount, without retaining a probe file."""
    try:
        path = Path(path)
        if not path.is_absolute():
            raise ValueError('absolute path required')
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryFile(prefix='.cbd-storage-check-', dir=path) as probe:
            probe.write(b'cbd'); probe.flush(); os.fsync(probe.fileno())
        return path.resolve()
    except (OSError, ValueError):
        raise RuntimeError(f'{setting} must identify a writable server directory.') from None


def _storage_slot(root: Path, identifier: str, *, staging=False) -> Path:
    if not re.fullmatch(r'[a-f0-9-]{32,36}', identifier):
        raise ValueError('Invalid storage identifier.')
    root = Path(root).resolve()
    folder = root / 'staging' if staging else root
    # Reject redirected files and subdirectories, including links back inside
    # the root. An administrator must investigate these rather than overwrite.
    if folder.is_symlink():
        raise RuntimeError('The staging directory must not be a symbolic link.')
    candidate = folder / identifier
    if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
        raise RuntimeError('The stored file must remain inside UPLOAD_STORAGE_ROOT.')
    return candidate


def readable_filename(filename: str) -> str:
    """Keep a portable, single-component filename and preserve the extension."""
    name = unicodedata.normalize('NFC', filename.replace('\\', '/').rsplit('/', 1)[-1])
    name = ''.join('_' if char in '<>:"|?*' or unicodedata.category(char) in {'Cc', 'Cf', 'Cs'}
                   else char for char in name).strip().rstrip(' .')
    stem, dot, extension = name.rpartition('.')
    stem = (stem if dot else extension).strip(' .')
    if re.fullmatch(r'CON|PRN|AUX|NUL|(?:COM|LPT)[1-9¹²³]', stem.split('.', 1)[0], re.IGNORECASE):
        stem = '_' + stem
    suffix = (dot + extension).encode('utf-8')[:32].decode('utf-8', errors='ignore').rstrip(' .') if dot else ''
    budget = 240 - len(suffix.encode('utf-8'))
    prefix = stem.encode('utf-8')[:budget].decode('utf-8', errors='ignore').rstrip(' .')
    return (prefix or 'upload') + suffix


def stored_path(root: Path, identifier: str, filename: str, *, staging=False) -> Path:
    slot = _storage_slot(root, identifier, staging=staging)
    if not slot.is_dir():
        return slot  # Retained uploads store the bytes directly under their ID.
    path = slot / readable_filename(filename)
    if path.is_symlink():
        raise RuntimeError('The stored file must not be a symbolic link.')
    return path


def write_stored_file(root: Path, identifier: str, filename: str, data: bytes, *, staging=False) -> Path:
    slot = _storage_slot(root, identifier, staging=staging)
    path = slot / readable_filename(filename)
    slot.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    slot.mkdir(mode=0o700)
    try:
        write_private(path, data)
    except BaseException:
        slot.rmdir()
        raise
    return path


def prepare_storage(root: Path) -> None:
    root = writable_directory(root, 'UPLOAD_STORAGE_ROOT')
    staging = root / 'staging'
    if staging.is_symlink():
        raise RuntimeError('The staging directory must not be a symbolic link.')
    writable_directory(staging, 'UPLOAD_STORAGE_ROOT/staging')


def write_private(path: Path, data: bytes) -> None:
    """Create exclusively with owner-only access from the first byte."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as target:
            target.write(data)
    except BaseException:
        # O_EXCL succeeded: this file belongs to this operation, never a prior upload.
        path.unlink(missing_ok=True)
        raise
