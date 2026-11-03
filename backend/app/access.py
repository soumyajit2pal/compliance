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
    ownership_obligations: set = field(default_factory=set)
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
    roles={'REGULATORY':'AUTHOR','BUSINESS':'BUSINESS_OWNER','CONTROL':'CONTROL_OWNER','EVIDENCE':'EVIDENCE_OWNER','DATA':'BUSINESS_OWNER'}
    for proposal in db.execute(sa.select(m.obligation_owner_change,m.compliance_obligation.c.regulatory_owner_unit_id)
        .join(m.compliance_obligation,m.compliance_obligation.c.id==m.obligation_owner_change.c.obligation_id)
        .where(m.obligation_owner_change.c.approval_status.in_(['IN_REVIEW','REVIEWED']))).mappings():
        named=any(actor.id==proposal[key] and actor.covers(proposal['regulatory_owner_unit_id'],{role}) for key,role in [
            ('created_by','AUTHOR'),('compliance_reviewer_user_id','REVIEWER'),('approver_user_id','APPROVER')])
        if not named:
            named=any(actor.covers(item['org_unit_id'],{roles[item['owner_role']]}) for item in db.execute(sa.select(m.owner_change_assignment)
                .where(m.owner_change_assignment.c.change_id==proposal['id'],m.owner_change_assignment.c.user_id==actor.id)).mappings())
        if named:actor.ownership_obligations.add(proposal['obligation_id'])
    if actor.roles.intersection(READ_ROLES) and not actor.covers(None,READ_ROLES):
        scopes=db.execute(sa.select(m.notification_scope.c.instrument_id,m.notification_scope.c.org_unit_id)
            .where(m.notification_scope.c.effective_from<=today)).mappings()
        actor.notification_instruments={row['instrument_id'] for row in scopes if actor.covers(row['org_unit_id'],READ_ROLES)}
        # Participation is derived from obligations, without a second manual
        # notification/business-scope registration. Home organisation is unchanged.
        participation=db.execute(sa.select(m.compliance_obligation.c.id,m.compliance_obligation.c.business_owner_unit_id,
            m.compliance_obligation.c.regulatory_owner_unit_id,m.instrument_version.c.instrument_id)
            .join(m.regulatory_clause,m.regulatory_clause.c.id==m.compliance_obligation.c.primary_clause_id)
            .join(m.instrument_version,m.instrument_version.c.id==m.regulatory_clause.c.instrument_version_id)).mappings().all()
        participating_units={row['id']:{row['business_owner_unit_id'],row['regulatory_owner_unit_id']} for row in participation}
        for table in [m.obligation_owner,m.obligation_applicability]:
            query=sa.select(table.c.obligation_id,table.c.org_unit_id).where(table.c.approval_status!='WITHDRAWN')
            if table is m.obligation_owner:query=query.where(table.c.ended_by_change_id.is_(None))
            for value in db.execute(query).mappings():
                participating_units.setdefault(value['obligation_id'],set()).add(value['org_unit_id'])
        participating={row['id'] for row in participation if any(actor.covers(unit,READ_ROLES) for unit in participating_units.get(row['id'],set()))}
        participating.update(actor.ownership_obligations)
        actor.notification_instruments.update(row['instrument_id'] for row in participation if row['id'] in participating)
        if participating:
            actor.notification_instruments.update(db.execute(sa.select(m.instrument_version.c.instrument_id)
                .join(m.regulatory_clause,m.regulatory_clause.c.instrument_version_id==m.instrument_version.c.id)
                .join(m.obligation_clause_map,m.obligation_clause_map.c.clause_id==m.regulatory_clause.c.id)
                .where(m.obligation_clause_map.c.obligation_id.in_(participating))).scalars())
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
