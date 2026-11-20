from fastapi import Depends,Query,HTTPException
import sqlalchemy as sa
from . import delegations as d,delegation_schemas as c,models as m,repository as repo
from .access import READ_ROLES,actor_for
from .events import record_audit

def install(app,get_db,current):
    @app.get('/api/delegations/options')
    def options(role:str|None=None,unit:str|None=None,db=Depends(get_db),actor=Depends(current)):
        actor.require(READ_ROLES)
        roles=sorted(actor.roles & d.ROLES)
        result={'roles':roles,'units':[{'id':r['id'],'name':r['name']} for r in actor.units.values() if actor.covers(r['id'],{role} if role in roles else d.ROLES)],'delegates':[],'reviewers':[],'approvers':[]}
        if not role or not unit:return result
        d.fail(role in roles,'Choose one of your existing business roles.');actor.require({role},unit)
        for row in db.execute(sa.select(m.user.c.id,m.user.c.full_name).where(m.user.c.active_flag==1)).mappings():
            if row['id']==actor.id:continue
            person=actor_for(db,row['id'])
            if not d.ready(person):continue
            for key,required in [('delegates',role),('reviewers','REVIEWER'),('approvers','APPROVER')]:
                if person.covers(unit,{required}):result[key].append(dict(row))
        return result
    @app.get('/api/delegations')
    def listing(db=Depends(get_db),actor=Depends(current)):return d.listing(db,actor)
    @app.post('/api/delegations')
    def create(payload:c.DelegationInput,db=Depends(get_db),actor=Depends(current)):return d.create(db,actor,payload)
    @app.get('/api/delegations/{identifier}')
    def detail(identifier:str,db=Depends(get_db),actor=Depends(current)):
        record=next((r for r in d.listing(db,actor) if r['id']==identifier),None)
        if not record:raise HTTPException(404,'Delegation not found in your authorised area.')
        event = m.audit_log.c
        events=record_audit(db, (event.entity_type=='leave_delegation') & (event.entity_id==identifier), event.event_at,event.id)
        actions=[]
        if actor.id in {record['principal_user_id'],record['delegate_user_id']} or actor.covers(record['scope_unit_id'],{'CCO'}):
            actions=[r for r in record_audit(db, (event.delegation_id==identifier) & (event.entity_type!='portal_access'),
                                              event.event_at,event.id) if d.audit_visible(db,actor,r)]
        return {'record':record,'audit':events,'decisions_on_behalf':actions}
    @app.post('/api/delegations/{identifier}/decision')
    def decision(identifier:str,payload:c.Decision,db=Depends(get_db),actor=Depends(current)):return d.decision(db,actor,identifier,payload)
