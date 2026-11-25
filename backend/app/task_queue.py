"""Current actionable tasks shared by the portal and notification scheduler."""
import sqlalchemy as sa

from . import clause_interpretations, migration_work, models as m, notification_families as families, repository as repo
from .access import READ_ROLES


def list_tasks(db, actor):
    visible={r['id']:r for r in repo.listing(db,actor,{})};result=[]
    for v in db.execute(sa.select(m.instrument_version).where(m.instrument_version.c.created_by==actor.id,m.instrument_version.c.approval_status=='DRAFT')).mappings():
        instrument=visible.get(v['instrument_id'])
        if instrument and actor.covers(instrument['regulatory_owner_unit_id'],{'AUTHOR'}):
            result.append({'kind':'DRAFT','instrument_id':v['instrument_id'],'version_id':v['id'],'title':'Complete version '+repo.source_version_label(v['version_number']),'due_at':None})
    for task in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.entity_id,m.workflow_instance.c.current_stage).join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id).where(m.workflow_instance.c.entity_type=='version',m.workflow_action.c.assignee_user_id==actor.id,m.workflow_action.c.decision.is_(None),m.workflow_instance.c.record_status=='OPEN',m.workflow_action.c.stage==m.workflow_instance.c.current_stage)).mappings():
        v=repo.one(db,m.instrument_version,task['entity_id']);instrument=visible.get(v['instrument_id'])
        role='REVIEWER' if task['stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
        valid_stage=v['approval_status']==('IN_REVIEW' if role=='REVIEWER' else 'REVIEWED')
        independent=actor.id!=v['created_by'] and (role!='APPROVER' or v['reviewed_by'] and actor.id!=v['reviewed_by'])
        if instrument and valid_stage and independent and actor.covers(instrument['regulatory_owner_unit_id'],{role}):
            result.append({**dict(task),'kind':'DECISION','instrument_id':v['instrument_id'],'version_id':v['id'],'title':task['stage'].replace('_',' ').title()})
    for task in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.entity_id,m.workflow_instance.c.current_stage)
        .join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id)
        .where(m.workflow_instance.c.entity_type=='metadata_correction',m.workflow_action.c.assignee_user_id==actor.id,
            m.workflow_action.c.decision.is_(None),m.workflow_instance.c.record_status=='OPEN',
            m.workflow_action.c.stage==m.workflow_instance.c.current_stage)).mappings():
        correction=repo.one(db,m.metadata_correction,task['entity_id'])
        instrument=visible.get(correction['instrument_id'])
        role='REVIEWER' if task['stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
        valid_stage=correction['correction_status']==('IN_REVIEW' if role=='REVIEWER' else 'REVIEWED')
        independent=actor.id!=correction['created_by'] and (role!='APPROVER' or correction['reviewed_by'] and actor.id!=correction['reviewed_by'])
        if instrument and valid_stage and independent and actor.covers(instrument['regulatory_owner_unit_id'],{role}):
            result.append({**dict(task),'kind':'DECISION','workflow_kind':'METADATA_CORRECTION',
                'correction_id':correction['id'],'instrument_id':correction['instrument_id'],
                'title':'Metadata correction · '+task['stage'].replace('_',' ').title()})
    result.extend(clause_interpretations.tasks(db, actor, visible))
    result.extend(families.proposal_tasks(db,actor))
    result.extend(migration_work.tasks(db,actor))
    from . import obligations
    result.extend(obligations.tasks(db,actor))
    from . import delivery
    if actor.roles & READ_ROLES:
        result.extend(delivery.tasks(db,actor))
        from . import controls
        result.extend(controls.tasks(db,actor))
        if not actor.delegation:
            from . import delegations
            result.extend(delegations.tasks(db,actor))
    return result
