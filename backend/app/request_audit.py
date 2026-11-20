"""Record request facts without retaining credentials, query strings or request bodies."""
from contextvars import ContextVar
import logging

from starlette.concurrency import run_in_threadpool
from starlette.routing import Match

from . import models as m
from .logging_config import client_ip, database_error_code, request_id

request_context = ContextVar('cbd_audit_request', default=None)
SIGN_IN = '/api/auth/login'
SIGN_OUT = '/api/auth/logout'
IGNORED = {'/api/health', '/api/auth/login-key', '/api/auth/demo-users'}
logger = logging.getLogger('cbd.portal')


class RequestAuditWriter:
    """Persist after FastAPI has completed the request and released its DB transaction."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        try:
            await self.app(scope, receive, send)
        finally:
            event = scope.get('state', {}).get('access_audit_event')
            if event:
                token = request_id.set(event['request_id'])
                peer = client_ip.set(event['client_ip'] or '-')
                try:
                    await run_in_threadpool(scope['app'].state.write_request_audit, event)
                except Exception as error:
                    logger.error('Request audit insert failed type=%s code=%s',
                                 type(error).__name__, database_error_code(error))
                finally:
                    client_ip.reset(peer)
                    request_id.reset(token)


def route_template(request):
    route = getattr(request.scope.get('route'), 'path', None)
    if route and route.startswith('/api/'):
        return route[:250]
    if request.url.path == SIGN_IN:
        return SIGN_IN
    if request.url.path.startswith('/api/'):
        for candidate in request.app.router.routes:
            if getattr(candidate, 'path', '').startswith('/api/') and candidate.matches(request.scope)[0] == Match.FULL:
                return candidate.path[:250]
    return None


def snapshot(actor):
    actual = getattr(actor, 'actual_actor', None) or actor
    return {
        'actor_user_id': actual.id if actual else None,
        'actor_name': getattr(actual, 'user', {}).get('full_name'),
        'actor_username': getattr(actual, 'user', {}).get('username'),
        'actor_roles': ','.join(sorted(getattr(actor, 'roles', ()))) or None,
        'on_behalf_of_user_id': actor.id if getattr(actor, 'actual_actor', None) else None,
        'on_behalf_of_name': actor.user.get('full_name') if getattr(actor, 'actual_actor', None) else None,
        'delegation_id': actor.delegation['id'] if getattr(actor, 'delegation', None) else None,
    }


def request_fields(request):
    # The ASGI peer has already been validated by operational logging. The
    # application's own code does not trust client-supplied forwarding headers.
    agent = ''.join(char if char.isprintable() else ' ' for char in request.headers.get('User-Agent', '')[:512])
    return {
        'client_ip': client_ip.get() if client_ip.get() != '-' else None,
        'request_id': request_id.get(), 'request_method': request.method[:12],
        'request_route': route_template(request), 'user_agent': agent.strip() or None,
    }


def business_fields(actor):
    fields = snapshot(actor)
    request = request_context.get()
    if request is not None:
        fields.update(request_fields(request))
    return fields


def access_event(request, status, elapsed, when):
    route = route_template(request)
    actor = getattr(request.state, 'audit_actor', None)
    if not route or route in IGNORED or request.method == 'OPTIONS':
        return None
    if not actor and route != SIGN_IN and status not in {401, 403}:
        return None
    action = ('SIGN_IN' if route == SIGN_IN else 'SIGN_OUT' if route == SIGN_OUT else
              'API_READ' if request.method in {'GET', 'HEAD'} else 'API_WRITE')
    fields = snapshot(actor)
    return {
        **fields, **request_fields(request), 'id': request_id.get(), 'entity_type': 'portal_access',
        'entity_id': fields['actor_user_id'] or request_id.get(), 'action': action,
        'event_at': when, 'channel': 'PORTAL', 'http_status': status, 'duration_ms': round(elapsed, 2),
    }


def insert_request(db, event):
    db.execute(m.audit_log.insert().values(**event))
