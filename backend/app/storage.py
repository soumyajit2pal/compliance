"""Deployment-owned document storage; no client-controlled filesystem paths."""
import os
import re
import tempfile
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


def stored_path(root: Path, identifier: str, *, staging=False) -> Path:
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
