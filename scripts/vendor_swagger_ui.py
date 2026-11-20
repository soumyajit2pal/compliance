"""Refresh pinned Swagger assets, verifying the npm archive before copying files.

Run with --archive after `npm pack swagger-ui-dist@5.34.1 --ignore-scripts`.
Without --archive, download the same pinned archive from the official registry.
No npm lifecycle scripts are run; only the four named files are copied.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

VERSION = '5.34.1'
URL = f'https://registry.npmjs.org/swagger-ui-dist/-/swagger-ui-dist-{VERSION}.tgz'
INTEGRITY = 'sha512-VSr8fXfI93obYaQicLJbLUKGRxDojj/SfRJDDLCioGTUBj4BK/Nj4eE9jCeCAnJxVLi7iS+08PbiZLyrQKBkJQ=='
FILES = ('swagger-ui-bundle.js', 'swagger-ui.css', 'LICENSE', 'NOTICE')
DESTINATION = Path(__file__).resolve().parents[1] / 'backend/static/swagger'


def vendor(archive: bytes):
    if hashlib.sha512(archive).digest() != base64.b64decode(INTEGRITY.split('-', 1)[1]):
        raise RuntimeError('Swagger archive integrity does not match the pinned distribution.')
    contents = {}
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
        for name in FILES:
            contents[name] = package.extractfile('package/' + name).read()
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, data in contents.items():
        (DESTINATION / name).write_bytes(data)
    manifest = {'package': 'swagger-ui-dist', 'version': VERSION, 'source': URL,
                'integrity': INTEGRITY, 'sha256': {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}}
    (DESTINATION / 'vendor.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    data = args.archive.read_bytes() if args.archive else urlopen(URL, timeout=30).read()
    print(json.dumps(vendor(data), indent=2))
