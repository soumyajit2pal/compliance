"""Opt-in response paging after existing authorisation and filtering.

Omitting both parameters retains the legacy response for selectors and integrations.
This bounds HTTP responses; it does not bypass or move paging ahead of access checks.
"""
from fastapi import Query


def page_query(page: int | None = Query(None, ge=1), page_size: int | None = Query(None, ge=1, le=100)):
    return {'page': page, 'page_size': page_size}


def paginate(items, page=None, page_size=None):
    if page is None and page_size is None:
        return items
    size = page_size or 25
    total = len(items)
    pages = (total + size - 1) // size
    current = min(page or 1, max(1, pages))
    offset = (current - 1) * size
    return {'items': items[offset:offset + size], 'pagination': {
        'page': current, 'page_size': size, 'total': total, 'total_pages': pages,
        'start': offset + 1 if total else 0, 'end': min(offset + size, total)}}
