"""Allowed attachment formats, detected from file bytes, with passive preview types."""
import io
from pathlib import Path, PurePosixPath
import zipfile
import zlib
from xml.etree.ElementTree import ParseError

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException
from fastapi import HTTPException

from .upload_policy import MIB

TEXT = {'.txt': 'text/plain', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.md': 'text/markdown'}
IMAGES = {
    '.png': 'image/png', '.apng': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.jpe': 'image/jpeg', '.jfif': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.tif': 'image/tiff', '.tiff': 'image/tiff', '.dng': 'image/tiff', '.ico': 'image/vnd.microsoft.icon',
    '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif', '.jxl': 'image/jxl',
    '.jp2': 'image/jp2', '.psd': 'image/vnd.adobe.photoshop',
}
OOXML_ROOT = 'application/vnd.openxmlformats-officedocument.'
OOXML = {
    '.docx': ('word/document.xml', 'wordprocessingml.document'),
    '.dotx': ('word/document.xml', 'wordprocessingml.template'),
    '.xlsx': ('xl/workbook.xml', 'spreadsheetml.sheet'),
    '.xltx': ('xl/workbook.xml', 'spreadsheetml.template'),
    '.pptx': ('ppt/presentation.xml', 'presentationml.presentation'),
    '.potx': ('ppt/presentation.xml', 'presentationml.template'),
}
ODF = {f'.{extension}': 'application/vnd.oasis.opendocument.' + kind for extension, kind in (
    ('odt', 'text'), ('ott', 'text-template'), ('ods', 'spreadsheet'), ('ots', 'spreadsheet-template'),
    ('odp', 'presentation'), ('otp', 'presentation-template'),
)}
DOCUMENT_TYPES = {'.pdf': 'application/pdf', **TEXT, **IMAGES, **ODF,
    **{extension: OOXML_ROOT + kind for extension, (_, kind) in OOXML.items()}}
INLINE_TYPES = {'application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'}
MAX_EXPANDED_BYTES = 250 * MIB
BLOCKED_PARTS = {'activex', 'embeddings', 'externallinks', 'vbaproject.bin', 'vbadata.xml',
    'customui', 'webextensions', 'macrosheets', 'dialogsheets', 'basic', 'scripts'}
BLOCKED_MEMBER_EXTENSIONS = {'.exe', '.dll', '.com', '.msi', '.scr', '.bat', '.cmd', '.ps1',
    '.vbs', '.js', '.hta', '.jar', '.ocx', '.lnk', '.html', '.htm', '.svg', '.swf'}
OFFICE_ACTIVE = ('macroenabled', 'vbaproject', 'vbadata', 'activex', 'oleobject',
    'externallink', 'webextension', 'macrosheet', 'dialogsheets', 'attachedtemplate', 'customui', 'afchunk')


def _image_matches(media, data):
    signatures = {
        'image/png': (b'\x89PNG\r\n\x1a\n',), 'image/jpeg': (b'\xff\xd8\xff',),
        'image/gif': (b'GIF87a', b'GIF89a'), 'image/bmp': (b'BM',),
        'image/tiff': (b'II*\0', b'MM\0*', b'II+\0', b'MM\0+'),
        'image/vnd.microsoft.icon': (b'\0\0\x01\0',), 'image/jxl': (b'\xff\x0a', b'\0\0\0\x0cJXL \r\n\x87\n'),
        'image/jp2': (b'\0\0\0\x0cjP  \r\n\x87\n',), 'image/vnd.adobe.photoshop': (b'8BPS\0\x01',),
    }
    if media in signatures:
        return len(data) >= 12 and data.startswith(signatures[media])
    if media == 'image/webp':
        return len(data) >= 16 and data.startswith(b'RIFF') and data[8:12] == b'WEBP'
    brands = {'image/avif': {b'avif', b'avis'}, 'image/heic': {b'heic', b'heix', b'hevc', b'hevx'},
        'image/heif': {b'mif1', b'msf1', b'heic', b'heix'}}[media]
    box_size = int.from_bytes(data[:4], 'big')
    return (16 <= box_size <= min(len(data), 4096) and data[4:8] == b'ftyp'
        and any(data[index:index + 4] in brands for index in (8, *range(16, box_size, 4))))


def _xml(archive, name):
    return ElementTree.fromstring(archive.read(name), forbid_dtd=True)


def _tag(node):
    return node.tag.rsplit('}', 1)[-1]


def _safe_office(data, extension):
    if not data.startswith(b'PK\x03\x04'):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            if (len(members) > 10_000 or sum(part.file_size for part in members) > MAX_EXPANDED_BYTES
                    or len({part.filename.casefold() for part in members}) != len(members)):
                return False
            for member in members:
                name = member.filename.casefold()
                path = PurePosixPath(name)
                if (member.flag_bits & 1 or member.compress_type not in {zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED}
                        or path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name
                        or BLOCKED_PARTS.intersection(path.parts) or path.suffix in BLOCKED_MEMBER_EXTENSIONS):
                    return False
            names = set(archive.namelist())
            if extension in OOXML:
                return _safe_ooxml(archive, names, extension)
            return _safe_odf(archive, names, extension)
    except (zipfile.BadZipFile, zlib.error, EOFError, KeyError, OSError, RuntimeError,
            ParseError, DefusedXmlException, ValueError):
        return False


def _safe_ooxml(archive, names, extension):
    main_part, kind = OOXML[extension]
    manifest = '[Content_Types].xml'
    if main_part not in names or '_rels/.rels' not in names:
        return False
    relationships = [name for name in names if name.lower().endswith('.rels')]
    if sum(archive.getinfo(name).file_size for name in [manifest, *relationships]) > 4 * MIB:
        return False
    types = _xml(archive, manifest)
    overrides = [node.get('ContentType') for node in types if node.get('PartName') == '/' + main_part]
    defaults = [node.get('ContentType') for node in types if node.get('Extension', '').lower() == 'xml']
    if (overrides or defaults) != [OOXML_ROOT + kind + '.main+xml']:
        return False
    if any(any(active in node.get('ContentType', '').lower() for active in OFFICE_ACTIVE) for node in types):
        return False
    for name in relationships:
        links = _xml(archive, name)
        if name == '_rels/.rels':
            roots = [rel.get('Target', '').removeprefix('/') for rel in links
                     if rel.get('Type', '').endswith('/officeDocument')]
            if roots != [main_part]:
                return False
        for rel in links:
            kind = rel.get('Type', '').lower().rsplit('/', 1)[-1]
            if any(active in kind for active in OFFICE_ACTIVE) or kind in {'package', 'control'}:
                return False
            if rel.get('TargetMode', '').lower() == 'external':
                target = rel.get('Target', '').strip().lower()
                if kind != 'hyperlink' or not target.startswith(('http://', 'https://', 'mailto:')):
                    return False
    return True


def _safe_odf(archive, names, extension):
    if (archive.getinfo('mimetype').file_size > 128 or archive.read('mimetype') != ODF[extension].encode()
            or not {'content.xml', 'META-INF/manifest.xml'} <= names):
        return False
    for name in names & {'content.xml', 'styles.xml', 'META-INF/manifest.xml'}:
        if archive.getinfo(name).file_size > 20 * MIB:
            return False
        for node in _xml(archive, name).iter():
            if _tag(node) in {'event-listener', 'event-listeners', 'script', 'encryption-data', 'object', 'object-ole', 'applet', 'plugin'}:
                return False
    return True


def validate_workbook(data):
    if not _safe_office(data, '.xlsx'):
        raise HTTPException(422, 'Choose a valid .xlsx workbook without macros, embedded objects or active external content.')


def inspect_document(filename, data):
    name = str(filename or '').replace('\\', '/').rsplit('/', 1)[-1]
    if not name or len(name) > 255 or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise HTTPException(422, 'Use a filename of 1–255 characters without control characters.')
    extension = Path(name).suffix.lower()
    if extension not in DOCUMENT_TYPES:
        raise HTTPException(422, 'This file type is blocked or unsupported. Choose a supported image, PDF, text or macro-free Office document.')
    if not data:
        raise HTTPException(422, 'Choose a non-empty file.')
    media = DOCUMENT_TYPES[extension]
    if extension in TEXT:
        try:
            data.decode('utf-8')
            valid = b'\0' not in data
        except UnicodeDecodeError:
            valid = False
    elif extension in IMAGES:
        valid = _image_matches(media, data)
    elif extension == '.pdf':
        valid = data.startswith(b'%PDF-')
    else:
        valid = _safe_office(data, extension)
    if not valid:
        raise HTTPException(422, 'The file contents do not match its extension or contain unsupported active content.')
    return name, media
