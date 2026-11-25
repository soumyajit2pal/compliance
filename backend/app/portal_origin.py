"""Verify the browser source of portal writes, including same-origin HTTPS behind the edge."""
from urllib.parse import urlsplit

from starlette.requests import Request


def web_origin(value: str, *, referrer: bool = False) -> tuple[str, str, int] | None:
    """Compare scheme, host and effective port. Only a Referer may include a page path."""
    if not value or '\\' in value or any(ord(char) <= 32 or ord(char) == 127 for char in value):
        return None
    try:
        url = urlsplit(value)
        if url.scheme not in {'http', 'https'} or not url.hostname or url.username is not None:
            return None
        if not referrer and (url.path not in {'', '/'} or '?' in value or '#' in value):
            return None
        port = url.port
        return url.scheme, url.hostname, port if port is not None else (443 if url.scheme == 'https' else 80)
    except ValueError:
        return None


def portal_write_allowed(request: Request, configured_origins: frozenset) -> bool:
    headers = request.headers
    site = headers.get('sec-fetch-site')
    if site == 'cross-site' or any(len(headers.getlist(name)) > 1 for name in
                                   ('host', 'origin', 'referer', 'sec-fetch-site')):
        return False

    # Both the TLS edge and the development proxy preserve the browser's Host.
    # The ASGI server supplies the scheme after applying its proxy trust settings.
    target = web_origin(f"https://{headers['host']}") if request.scope['scheme'] == 'https' and 'host' in headers else None
    if 'origin' in headers:
        source = web_origin(headers['origin'])
    elif 'referer' in headers:
        source = web_origin(headers['referer'], referrer=True)
    else:
        return site == 'same-origin' and target is not None
    return source is not None and (source == target or source in configured_origins)
