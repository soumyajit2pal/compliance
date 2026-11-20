"""Business audit and status history are written in the same transaction."""
import json
from datetime import datetime, timezone
from uuid import uuid4
import sqlalchemy as sa
from . import models as m
from .request_audit import business_fields

def now(): return datetime.now(timezone.utc).replace(tzinfo=None)
def new_id(): return str(uuid4())

def record_audit(db, condition, *order):
    """Record history shown in workspaces never carries request telemetry."""
    event = m.audit_log.c
    fields = ('id', 'created_at', 'entity_type', 'entity_id', 'action', 'field_name',
              'old_value', 'new_value', 'actor_user_id', 'event_at', 'reason',
              'actor_name', 'on_behalf_of_user_id', 'on_behalf_of_name', 'delegation_id')
    query = sa.select(*(event[key] for key in fields)).where(condition).order_by(*order)
    return [dict(row) for row in db.execute(query).mappings()]
def audit(db, actor, entity, identifier, action, old=None, new=None, reason=None):
    from .delegations import event_independence
    event_independence(db,actor,entity,identifier,action,old,new)
    db.execute(m.audit_log.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,action=action,
        old_value=json.dumps(old,default=str) if old is not None else None,
        new_value=json.dumps(new,default=str) if new is not None else None,
        event_at=now(),channel='PORTAL',reason=reason, **business_fields(actor)))
def history(db,actor,entity,identifier,old,new,reason):
    db.execute(m.status_history.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,
        previous_status=old,new_status=new,reason=reason,changed_by=getattr(actor,'actual_id',actor.id),changed_at=now()))
def notify(db,entity,identifier,recipient,kind,key):
    db.execute(m.notification.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,
        notification_type=kind,recipient_user_id=recipient,channel='IN_APP',trigger_key=key,
        triggered_at=now(),delivered_at=now(),delivery_status='DELIVERED'))
