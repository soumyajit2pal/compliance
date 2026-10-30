"""Effective role scopes, independent of home department and technical Admin."""
from dataclasses import dataclass,field
from datetime import date
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m

REGULATORY_ROLES = {'AUTHOR','REVIEWER','APPROVER','CCO'}
READ_ROLES = REGULATORY_ROLES | {'BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','ZONE_VIEWER'}
DISCUSS_ROLES = READ_ROLES - {'ZONE_VIEWER'}

@dataclass
class Actor:
    user: dict
    grants: list
    units: dict
    notification_instruments: set = field(default_factory=set)
    @property
    def id(self): return self.user['id']
    @property
    def roles(self): return {g['role_code'] for g in self.grants}
    def covers(self, unit_id, roles):
        from .ldap_department import blocked
        if blocked(self.user):return False
        def effective(unit):
            today=date.today()
            return unit and unit['active_flag'] and (not unit.get('effective_from') or unit['effective_from']<=today) and (not unit.get('effective_to') or unit['effective_to']>today)
        for g in self.grants:
            if g['role_code'] not in roles: continue
            if g['global_scope_flag']: return True
            if not effective(self.units.get(g['scope_org_unit_id'])):continue
            current, seen = unit_id, set()
            while current and current not in seen:
                u = self.units.get(current)
                if not effective(u): break
                if current == g['scope_org_unit_id']: return True
                seen.add(current)
                current = u['parent_org_unit_id']
        return False
    def require(self, roles, unit=None):
        from .ldap_department import blocked
        if blocked(self.user):raise HTTPException(403,'Your LDAP department requires verification before workspace access.')
        if not (self.covers(unit, roles) if unit else self.roles.intersection(roles)):
            raise HTTPException(403,'Your role and department scope do not permit this action.')


def actor_for(db, user_id):
    user = db.execute(sa.select(m.user).where(m.user.c.id==user_id,m.user.c.active_flag==1)).mappings().first()
    if not user: raise HTTPException(401,'Please sign in again.')
    today=date.today()
    grants=db.execute(sa.select(m.user_role,m.role.c.code.label('role_code')).join(m.role,m.role.c.id==m.user_role.c.role_id)
        .where(m.user_role.c.user_id==user_id,m.role.c.active_flag==1,m.user_role.c.effective_from<=today,
          sa.or_(m.user_role.c.effective_to.is_(None),m.user_role.c.effective_to>today))).mappings().all()
    units={r['id']:dict(r) for r in db.execute(sa.select(m.organisational_unit)).mappings()}
    actor=Actor(dict(user),[dict(g) for g in grants],units)
    if actor.roles.intersection(READ_ROLES) and not actor.covers(None,READ_ROLES):
        scopes=db.execute(sa.select(m.notification_scope.c.instrument_id,m.notification_scope.c.org_unit_id)
            .where(m.notification_scope.c.effective_from<=today)).mappings()
        actor.notification_instruments={row['instrument_id'] for row in scopes if actor.covers(row['org_unit_id'],READ_ROLES)}
        links=db.execute(sa.select(m.notification_link.c.parent_id,m.notification_link.c.child_id)
            .where(m.notification_link.c.approval_status=='APPROVED')).mappings().all()
        changed=True
        while changed:
            descendants={row['child_id'] for row in links if row['parent_id'] in actor.notification_instruments}
            changed=bool(descendants-actor.notification_instruments)
            actor.notification_instruments.update(descendants)
    return actor


def can_read_instrument(actor, row, rank=1):
    if not actor.covers(row['regulatory_owner_unit_id'],READ_ROLES) and row.get('id') not in actor.notification_instruments:return False
    if rank>=2:
        return actor.covers(row['regulatory_owner_unit_id'],REGULATORY_ROLES) or row['interpretation_owner_user_id']==actor.id
    return True
