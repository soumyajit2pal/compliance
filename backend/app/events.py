"""Business audit and status history are written in the same transaction."""
import json
from datetime import datetime, timezone
from uuid import uuid4
from . import models as m

def now(): return datetime.now(timezone.utc).replace(tzinfo=None)
def new_id(): return str(uuid4())
def audit(db, actor, entity, identifier, action, old=None, new=None, reason=None):
    db.execute(m.audit_log.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,action=action,
        old_value=json.dumps(old,default=str) if old is not None else None,
        new_value=json.dumps(new,default=str) if new is not None else None,
        actor_user_id=actor.id if actor else None,event_at=now(),channel='PORTAL',reason=reason))
def history(db,actor,entity,identifier,old,new,reason):
    db.execute(m.status_history.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,
        previous_status=old,new_status=new,reason=reason,changed_by=actor.id,changed_at=now()))
def notify(db,entity,identifier,recipient,kind,key):
    db.execute(m.notification.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,
        notification_type=kind,recipient_user_id=recipient,channel='IN_APP',trigger_key=key,
        triggered_at=now(),delivered_at=now(),delivery_status='DELIVERED'))
