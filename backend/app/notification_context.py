"""Authorised record links for in-app notifications and outbound mail."""
from fastapi import HTTPException

from . import clause_interpretations, migration_work, models as m, notification_families as families, repository as repo
from .user_access import current_access


def resolve_notification(db, actor, item, *, strict=False):
    item = dict(item)
    if item['entity_type']=='version':
        try:version,instrument=repo.read_version(db,actor,item['entity_id'])
        except HTTPException:
            if strict:return None
        else:item.update(instrument_id=instrument['id'],source_title=instrument['title'],version_number=version['version_number'])
    elif item['entity_type']==clause_interpretations.ENTITY:
        try:
            proposal=repo.one(db,m.clause_interpretation_request,item['entity_id'])
            clause,_,instrument=clause_interpretations.context(db,actor,proposal['clause_id'])
            actor.require({'AUTHOR', 'REVIEWER', 'APPROVER', 'CCO'}, instrument['regulatory_owner_unit_id'])
        except HTTPException:return None
        item.update(source_title='Bank interpretation · '+clause['code'],
            action_path=clause_interpretations.path(instrument['id'],clause,proposal['id']),action_label='Open interpretation')
    elif item['entity_type']=='metadata_correction':
        try:
            correction=repo.one(db,m.metadata_correction,item['entity_id'])
            instrument=repo.read_instrument(db,actor,correction['instrument_id'])
        except HTTPException:
            if strict:return None
        else:item.update(instrument_id=instrument['id'],source_title=instrument['title'])
    elif item['entity_type'].startswith('family_'):
        kind=item['entity_type'][7:]
        if kind not in families.KINDS:return None
        try:
            proposal=repo.one(db,families.KINDS[kind],item['entity_id'])
            instrument,_=families.proposal_context(db,actor,kind,proposal)
        except HTTPException:return None
        item.update(source_title=instrument['title'],action_path='notification-families/'+instrument['id']+'?proposal='+item['entity_id'],action_label='Open notification decision')
    elif item['entity_type']=='obligation':
        from . import obligations
        try:record=obligations.read(db,actor,item['entity_id'])
        except HTTPException:return None
        item.update(source_title=record['code']+' · '+record['title'],action_path='obligations/'+record['id'],action_label='Open obligation')
    elif item['entity_type']=='leave_delegation':
        from . import delegations
        try:record=delegations.read(db,actor,item['entity_id'])
        except HTTPException:return None
        item.update(source_title='Leave cover · '+str(record['starts_on'])+' – '+str(record['ends_on']),action_path='delegations/'+record['id'],action_label='Open delegation')
    elif item['entity_type'] in {'controls','control-mappings'}:
        from . import controls
        try:record=controls.read(db,actor,item['entity_type'],item['entity_id'])
        except HTTPException:return None
        item.update(source_title=record.get('title') or 'Obligation link review',action_path=item['entity_type']+'/'+record['id'],action_label='Open decision')
    elif item['entity_type'] in {'action','action_extension'}:
        from . import delivery
        try:item.update(delivery.notification_context(db,actor,item))
        except HTTPException:return None
    elif item['entity_type']=='migration':
        return migration_work.notification_context(db,actor,item)
    elif item['entity_type']=='user':
        if 'ADMIN' not in actor.roles and item['entity_id']!=actor.id:return None
        target=repo.one(db,m.user,item['entity_id']);access=current_access(db,target['id'])
        item.update(source_title=target['full_name']+' · '+target['username'],
            message=access['access_message'],access_status_label=access['access_status_label'],
            action_path=('users?tab='+target['login_type']+'&user='+target['id']) if 'ADMIN' in actor.roles else 'home',
            action_label='Review user access' if 'ADMIN' in actor.roles else 'Open workspace')
    return item
