"""Business audit and status history are written in the same transaction."""
import json
from datetime import datetime, timezone
from uuid import uuid4
from . import models as m

def now(): return datetime.now(timezone.utc).replace(tzinfo=None)
def new_id(): return str(uuid4())
def audit(db, actor, entity, identifier, action, old=None, new=None, reason=None):
    from .delegations import event_independence
    event_independence(db,actor,entity,identifier,action,old,new)
    delegation=getattr(actor,'delegation',None)
    actual=getattr(actor,'actual_actor',None) or actor
    db.execute(m.audit_log.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,action=action,
        old_value=json.dumps(old,default=str) if old is not None else None,
        new_value=json.dumps(new,default=str) if new is not None else None,
        actor_name=getattr(actual,'user',{}).get('full_name'),on_behalf_of_name=getattr(actor,'user',{}).get('full_name') if delegation else None,
        actor_user_id=getattr(actor,'actual_id',actor.id) if actor else None,on_behalf_of_user_id=actor.id if delegation else None,
        delegation_id=delegation['id'] if delegation else None,event_at=now(),channel='PORTAL',reason=reason))
def history(db,actor,entity,identifier,old,new,reason):
    db.execute(m.status_history.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,
        previous_status=old,new_status=new,reason=reason,changed_by=getattr(actor,'actual_id',actor.id),changed_at=now()))
def notify(db,entity,identifier,recipient,kind,key):
    db.execute(m.notification.insert().values(id=new_id(),entity_type=entity,entity_id=identifier,
        notification_type=kind,recipient_user_id=recipient,channel='IN_APP',trigger_key=key,
        triggered_at=now(),delivered_at=now(),delivery_status='DELIVERED'))
