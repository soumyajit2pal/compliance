"""Authorised notification families, source-cited deadlines and implementation decisions."""
import hashlib,json
from datetime import date,datetime,time,timedelta
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m,repository as repo
from .access import READ_ROLES,REGULATORY_ROLES,actor_for
from .events import new_id,now,audit,history,notify

KINDS={'link':m.notification_link,'deadline':m.regulatory_deadline,
       'assessment':m.notification_assessment,'clause':m.clause_relationship}
RESOLVED={'COMPLETED','NO_IMPACT'}

def approved_at(row,when):
    return row['approval_status']=='APPROVED' and row.get('approved_at') and row['approved_at'].date()<=when

def approved_source(versions,instrument_id,when,current_id=None):
    available=[row for row in versions if row['instrument_id']==instrument_id and approved_at(row,when) and
        row['effective_from']<=when and (not row['effective_to'] or row['effective_to']>when)]
    available.sort(key=lambda row:(row['effective_from'],row['id']==current_id,row['version_date'],row['created_at'],row['id']),reverse=True)
    return available[0] if available else None

def link_rows(db):
    return [dict(row) for row in db.execute(sa.select(m.notification_link)).mappings()]

def parent_map(rows,when=None):
    return {row['child_id']:row for row in rows if (approved_at(row,when) if when else row['approval_status']=='APPROVED')}

def chain(identifier,parents):
    result=[];seen=set()
    while identifier and identifier not in seen:
        seen.add(identifier);result.append(identifier)
        identifier=parents.get(identifier,{}).get('parent_id')
    return result

def family_key(identifier,parents): return chain(identifier,parents)[-1]

def scope_visible(actor,instrument,unit):
    return actor.covers(unit,READ_ROLES) or actor.covers(instrument['regulatory_owner_unit_id'],REGULATORY_ROLES)

def proposal_context(db,actor,kind,row):
    if kind=='link':
        parent=repo.read_instrument(db,actor,row['parent_id']);child=repo.read_instrument(db,actor,row['child_id'])
        return child,child['regulatory_owner_unit_id']
    if kind=='assessment':
        scope=repo.one(db,m.notification_scope,row['scope_id']);instrument=repo.read_instrument(db,actor,scope['instrument_id'])
        if not scope_visible(actor,instrument,scope['org_unit_id']):raise HTTPException(404,'Implementation scope is unavailable.')
        return instrument,instrument['regulatory_owner_unit_id']
    if kind=='clause':
        clause=repo.one(db,m.regulatory_clause,row['source_clause_id'])
        _,instrument=repo.read_version(db,actor,clause['instrument_version_id'])
        target=repo.one(db,m.regulatory_clause,row['target_clause_id']);repo.read_version(db,actor,target['instrument_version_id'])
        return instrument,instrument['regulatory_owner_unit_id']
    instrument=repo.read_instrument(db,actor,row['instrument_id'])
    repo.read_version(db,actor,row['source_version_id'])
    return instrument,instrument['regulatory_owner_unit_id']

def submit_proposal(db,actor,kind,values,payload,unit):
    recipients=[repo.eligible(db,payload.reviewer_id,'REVIEWER',unit,(actor.id,payload.approver_id)),
        repo.eligible(db,payload.approver_id,'APPROVER',unit,(actor.id,payload.reviewer_id))]
    for recipient in recipients:
        try:proposal_context(db,recipient,kind,values)
        except HTTPException:raise HTTPException(422,'Named recipients need access to every cited notification, source and business scope.')
    identifier=new_id();workflow=new_id();at=now()
    db.execute(KINDS[kind].insert().values(id=identifier,created_by=actor.id,approval_status='IN_REVIEW',**values))
    db.execute(m.workflow_instance.insert().values(id=workflow,workflow_type='NOTIFICATION_'+kind.upper(),
        entity_type='family_'+kind,entity_id=identifier,current_stage='COMPLIANCE_REVIEW',started_by=actor.id,started_at=at))
    for stage,recipient in [('COMPLIANCE_REVIEW',payload.reviewer_id),('FINAL_APPROVAL',payload.approver_id)]:
        db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow,stage=stage,assignee_user_id=recipient,due_at=at+timedelta(days=3)))
    audit(db,actor,'family_'+kind,identifier,'SUBMITTED',new=values)
    history(db,actor,'family_'+kind,identifier,None,'IN_REVIEW','Submitted for independent review and approval.')
    notify(db,'family_'+kind,identifier,payload.reviewer_id,'REVIEW_ASSIGNED',workflow+':REVIEW')
    return {'id':identifier,'workflow_id':workflow,'kind':kind}

def validate_link(db,parent,child,identifier=None):
    # A regulator row serializes all graph writers, including competing approvals.
    repo.one(db,m.regulator,parent['regulator_id'],lock=True)
    if child['id']==parent['id'] or parent['regulator_id']!=child['regulator_id']:
        raise HTTPException(422,'Choose different notifications issued by the same regulator.')
    rows=link_rows(db)
    if any(row['id']!=identifier and row['child_id']==child['id'] and row['approval_status'] in {'IN_REVIEW','REVIEWED','APPROVED'} for row in rows):
        raise HTTPException(409,'This notification already has a retained parent or a pending parent proposal.')
    parents=parent_map(rows)
    if child['id'] in chain(parent['id'],parents):raise HTTPException(422,'This notification link would create a cycle.')

def propose_link(db,actor,parent_id,payload):
    parent=repo.read_instrument(db,actor,parent_id);child=repo.read_instrument(db,actor,payload.child_id)
    actor.require({'AUTHOR'},parent['regulatory_owner_unit_id']);actor.require({'AUTHOR'},child['regulatory_owner_unit_id'])
    validate_link(db,parent,child)
    return submit_proposal(db,actor,'link',{'parent_id':parent_id,**payload.model_dump(exclude={'reviewer_id','approver_id'})},payload,child['regulatory_owner_unit_id'])

def validate_deadline(db,actor,instrument,row):
    version,source_instrument=repo.read_version(db,actor,row['source_version_id'])
    parents=parent_map(link_rows(db))
    if version['approval_status']!='APPROVED' or family_key(instrument['id'],parents)!=family_key(source_instrument['id'],parents):
        raise HTTPException(422,'Cite an approved source edition from this notification family.')
    if row['effective_from']<version['effective_from']:
        raise HTTPException(422,'A regulatory deadline cannot take effect before its cited source edition.')

def propose_deadline(db,actor,instrument_id,payload):
    instrument=repo.read_instrument(db,actor,instrument_id,lock=True);actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    values={'instrument_id':instrument_id,**payload.model_dump(exclude={'reviewer_id','approver_id'})}
    validate_deadline(db,actor,instrument,values)
    if db.execute(sa.select(m.regulatory_deadline.c.id).where(m.regulatory_deadline.c.instrument_id==instrument_id,
        m.regulatory_deadline.c.effective_from==payload.effective_from,m.regulatory_deadline.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']))).first():
        raise HTTPException(409,'A deadline decision or proposal already exists for this effective date.')
    return submit_proposal(db,actor,'deadline',values,payload,instrument['regulatory_owner_unit_id'])

def register_scope(db,actor,instrument_id,payload):
    instrument=repo.read_instrument(db,actor,instrument_id,lock=True);actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    repo.active(db,m.organisational_unit,payload.org_unit_id)
    owner=actor_for(db,payload.owner_user_id)
    if not owner.covers(payload.org_unit_id,{'BUSINESS_OWNER'}):raise HTTPException(422,'The implementation owner needs Business Owner authority for this organisation.')
    if db.execute(sa.select(m.notification_scope.c.id).where(m.notification_scope.c.instrument_id==instrument_id,m.notification_scope.c.org_unit_id==payload.org_unit_id)).first():
        raise HTTPException(409,'This business implementation scope is already registered.')
    identifier=new_id();db.execute(m.notification_scope.insert().values(id=identifier,instrument_id=instrument_id,created_by=actor.id,**payload.model_dump()))
    audit(db,actor,'instrument',instrument_id,'BUSINESS_SCOPE_REGISTERED',new={'scope_id':identifier,**payload.model_dump()})
    return {'id':identifier}

def delivery_snapshot(db,instrument_id,version_id,unit_id,when):
    cutoff=datetime.combine(when+timedelta(days=1),time())
    actions=[dict(row) for row in db.execute(sa.select(m.action).join(m.compliance_obligation,m.compliance_obligation.c.id==m.action.c.obligation_id)
        .join(m.regulatory_clause,m.regulatory_clause.c.id==m.compliance_obligation.c.primary_clause_id)
        .join(m.instrument_version,m.instrument_version.c.id==m.regulatory_clause.c.instrument_version_id)
        .where(m.instrument_version.c.instrument_id==instrument_id,m.instrument_version.c.id==version_id,
            m.action.c.owner_unit_id==unit_id,m.action.c.record_status!='CANCELLED',m.action.c.created_at<cutoff)).mappings()]
    evidence={};fingerprint=[]
    for action in actions:
        items=[dict(row) for row in db.execute(sa.select(m.evidence_item).join(m.evidence_link,m.evidence_link.c.evidence_id==m.evidence_item.c.id)
            .where(m.evidence_link.c.action_id==action['id'],m.evidence_link.c.linked_at<cutoff,
                m.evidence_item.c.evidence_status.in_(['ACCEPTED','EXPIRED','SUPERSEDED'] if when<date.today() else ['ACCEPTED']),
                m.evidence_item.c.verified_at<cutoff,m.evidence_item.c.retention_end_date>=when,
                m.evidence_item.c.verified_by!=m.evidence_item.c.uploaded_by)).mappings()]
        evidence[action['id']]=items
        if action['record_status']=='COMPLETED' and (not action['completed_at'] or action['completed_at']>=cutoff):action['record_status']='IN_PROGRESS'
        fingerprint.append([action['id'],action['record_status'],action['approval_status'],str(action['completed_at']),sorted(item['id'] for item in items)])
    snapshot=hashlib.sha256(json.dumps(sorted(fingerprint),sort_keys=True).encode()).hexdigest()
    return actions,evidence,snapshot

def validate_assessment(db,actor,scope,row,when):
    instrument=repo.read_instrument(db,actor,scope['instrument_id'])
    versions=[dict(v) for v in db.execute(sa.select(m.instrument_version).where(m.instrument_version.c.instrument_id==instrument['id'])).mappings()]
    source=approved_source(versions,instrument['id'],when,instrument['current_version_id'])
    if not source or source['id']!=row['source_version_id']:raise HTTPException(422,'Assess the exact approved source edition effective today.')
    actions,evidence,snapshot=delivery_snapshot(db,instrument['id'],source['id'],scope['org_unit_id'],when)
    if row['outcome']=='NO_IMPACT' and actions:raise HTTPException(422,'No impact is unavailable while delivery actions exist for this source and organisation.')
    if row['outcome']=='COMPLETED' and (not actions or any(action['record_status']!='COMPLETED' or action['approval_status']!='APPROVED' or not evidence[action['id']] for action in actions)):
        raise HTTPException(422,'Complete every source-specific delivery action with accepted independent evidence before proposing completion.')
    if row.get('action_snapshot') and row['action_snapshot']!=snapshot:raise HTTPException(409,'Delivery actions or evidence changed; submit a fresh implementation assessment.')
    return snapshot

def propose_assessment(db,actor,scope_id,payload):
    scope=repo.one(db,m.notification_scope,scope_id,lock=True);instrument=repo.read_instrument(db,actor,scope['instrument_id'])
    if not scope_visible(actor,instrument,scope['org_unit_id']):raise HTTPException(404,'Implementation scope is unavailable.')
    actor.require({'BUSINESS_OWNER'},scope['org_unit_id'])
    if scope['owner_user_id']!=actor.id:raise HTTPException(403,'Only the named implementation owner can propose this assessment.')
    if scope['effective_from']>date.today():raise HTTPException(422,'This business scope is not effective yet.')
    previous=[dict(row) for row in db.execute(sa.select(m.notification_assessment).where(m.notification_assessment.c.scope_id==scope_id)).mappings()]
    if any(row['approval_status'] in {'IN_REVIEW','REVIEWED'} for row in previous):raise HTTPException(409,'An implementation assessment is already pending.')
    values={'scope_id':scope_id,'revision':max([row['revision'] for row in previous],default=0)+1,**payload.model_dump(exclude={'reviewer_id','approver_id'})}
    values['action_snapshot']=validate_assessment(db,actor,scope,values,date.today())
    return submit_proposal(db,actor,'assessment',values,payload,instrument['regulatory_owner_unit_id'])

def validate_clause_relation(db,actor,row,identifier=None):
    source=repo.one(db,m.regulatory_clause,row['source_clause_id']);target=repo.one(db,m.regulatory_clause,row['target_clause_id'])
    source_version,instrument=repo.read_version(db,actor,source['instrument_version_id'])
    target_version,target_instrument=repo.read_version(db,actor,target['instrument_version_id'])
    if source_version['approval_status'] not in {'DRAFT','APPROVED'} or source['clause_status']=='DELETED':
        raise HTTPException(409,'Use an editable Draft or an approved source clause for a new relationship.')
    repo.one(db,m.regulator,instrument['regulator_id'],lock=True)
    parents=parent_map(link_rows(db))
    if source['id']==target['id'] or target['approval_status']!='APPROVED' or target_version['approval_status']!='APPROVED':
        raise HTTPException(422,'Choose a different approved earlier clause.')
    if family_key(instrument['id'],parents)!=family_key(target_instrument['id'],parents):raise HTTPException(422,'The related clause must belong to this notification family.')
    if target_version['effective_from']>source_version['effective_from']:raise HTTPException(422,'Choose an earlier source edition for this relationship.')
    rows=[dict(r) for r in db.execute(sa.select(m.clause_relationship).where(m.clause_relationship.c.approval_status.in_(['IN_REVIEW','REVIEWED','APPROVED']))).mappings()]
    if any(r['id']!=identifier and r['source_clause_id']==source['id'] and r['target_clause_id']==target['id'] and r['relationship_type']==row['relationship_type'] for r in rows):
        raise HTTPException(409,'This clause relationship is already recorded or pending.')
    if row['relationship_type'] in {'AMENDS','SUPERSEDES','DEPENDS_ON','REPEALS'}:
        edges={}
        for r in rows:
            if r['id']!=identifier and r['relationship_type'] in {'AMENDS','SUPERSEDES','DEPENDS_ON','REPEALS'}:edges.setdefault(r['source_clause_id'],[]).append(r['target_clause_id'])
        stack=[target['id']];seen=set()
        while stack:
            node=stack.pop()
            if node==source['id']:raise HTTPException(422,'This clause relationship would introduce a cycle.')
            if node not in seen:seen.add(node);stack.extend(edges.get(node,[]))

def propose_clause_relation(db,actor,clause_id,payload):
    clause=repo.one(db,m.regulatory_clause,clause_id)
    version,instrument=repo.read_version(db,actor,clause['instrument_version_id'])
    actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    if version['approval_status']=='DRAFT' and version['created_by']!=actor.id:raise HTTPException(403,'Only the Draft maker can propose its clause relationships.')
    values={'source_clause_id':clause_id,**payload.model_dump(exclude={'reviewer_id','approver_id'}),'effective_to':None}
    validate_clause_relation(db,actor,values)
    return submit_proposal(db,actor,'clause',values,payload,instrument['regulatory_owner_unit_id'])

def decide(db,actor,kind,identifier,payload):
    if kind not in KINDS:raise HTTPException(404,'Proposal type is unavailable.')
    table=KINDS[kind];row=repo.one(db,table,identifier,lock=True)
    instrument,unit=proposal_context(db,actor,kind,row)
    if row['approval_status'] not in {'IN_REVIEW','REVIEWED'}:raise HTTPException(409,'This proposal no longer has an open decision.')
    workflow=db.execute(sa.select(m.workflow_instance).where(m.workflow_instance.c.entity_type=='family_'+kind,
        m.workflow_instance.c.entity_id==identifier,m.workflow_instance.c.record_status=='OPEN').with_for_update()).mappings().one()
    task=db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage==workflow['current_stage'],m.workflow_action.c.decision.is_(None)).with_for_update()).mappings().one()
    role='REVIEWER' if workflow['current_stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
    if payload.decision=='WITHDRAW':
        if row['created_by']!=actor.id:raise HTTPException(403,'Only the proposal maker can withdraw it.')
        target='WITHDRAWN'
    else:
        repo.eligible(db,actor.id,role,unit,(row['created_by'],row['reviewed_by']) if role=='APPROVER' else (row['created_by'],))
        if task['assignee_user_id']!=actor.id:raise HTTPException(403,'Only the named independent recipient can decide.')
        target='REVIEWED' if payload.decision=='REVIEW' and role=='REVIEWER' else 'APPROVED' if payload.decision=='APPROVE' and role=='APPROVER' else 'REJECTED' if payload.decision=='REJECT' else 'WITHDRAWN' if payload.decision=='RETURN' else None
        if not target:raise HTTPException(422,'Choose Review, Approve, Return or Reject for the current stage.')
    if target in {'REVIEWED','APPROVED'}:
        if kind=='link':validate_link(db,repo.read_instrument(db,actor,row['parent_id']),instrument,identifier)
        elif kind=='deadline':validate_deadline(db,actor,instrument,row)
        elif kind=='assessment':
            scope=repo.one(db,m.notification_scope,row['scope_id'],lock=True)
            owner=actor_for(db,scope['owner_user_id'])
            if not owner.covers(scope['org_unit_id'],{'BUSINESS_OWNER'}):raise HTTPException(422,'The named implementation owner no longer has effective authority.')
            validate_assessment(db,actor,scope,row,date.today())
        else:validate_clause_relation(db,actor,row,identifier)
    at=now();values={'approval_status':target}
    if target=='REVIEWED':values.update(reviewed_by=actor.id,reviewed_at=at)
    if target=='APPROVED':values.update(approved_by=actor.id,approved_at=at)
    db.execute(table.update().where(table.c.id==identifier).values(**values))
    db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision=payload.decision,acted_by=actor.id,acted_at=at,comments=payload.comments))
    if target=='REVIEWED':
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(current_stage='FINAL_APPROVAL'))
        recipient=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage=='FINAL_APPROVAL')).scalar_one()
        notify(db,'family_'+kind,identifier,recipient,'APPROVAL_ASSIGNED',workflow['id']+':APPROVAL')
    else:db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(record_status='RETURNED' if payload.decision=='RETURN' else target,current_stage='CLOSED',completed_at=at))
    history(db,actor,'family_'+kind,identifier,row['approval_status'],target,payload.comments)
    audit(db,actor,'family_'+kind,identifier,payload.decision,reason=payload.comments)
    return {'id':identifier,'approval_status':target}

def proposal_tasks(db,actor,identifiers=None):
    tasks=[]
    for row in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.entity_type,m.workflow_instance.c.entity_id,m.workflow_instance.c.current_stage)
        .join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id)
        .where(m.workflow_instance.c.entity_type.in_(['family_'+kind for kind in KINDS]),m.workflow_instance.c.record_status=='OPEN',
            m.workflow_action.c.decision.is_(None),m.workflow_action.c.stage==m.workflow_instance.c.current_stage)).mappings():
        if identifiers is not None and row['entity_id'] not in identifiers:continue
        kind=row['entity_type'][7:];proposal=repo.one(db,KINDS[kind],row['entity_id'])
        try:instrument,unit=proposal_context(db,actor,kind,proposal)
        except HTTPException:continue
        role='REVIEWER' if row['stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
        if row['assignee_user_id']==actor.id and actor.id!=proposal['created_by'] and actor.covers(unit,{role}) and (role!='APPROVER' or actor.id!=proposal['reviewed_by']):
            tasks.append({**dict(row),'kind':'DECISION','workflow_kind':'FAMILY','proposal_kind':kind,'proposal_id':row['entity_id'],
                'instrument_id':instrument['id'],'title':'Notification '+kind+' · '+row['stage'].replace('_',' ').title()})
    return tasks

def linked_obligations(db,actor,instrument,visible_ids,when):
    clauses={r['id']:dict(r) for r in db.execute(sa.select(m.regulatory_clause,m.instrument_version.c.instrument_id)
        .join(m.instrument_version,m.instrument_version.c.id==m.regulatory_clause.c.instrument_version_id)
        .where(m.instrument_version.c.instrument_id.in_(list(visible_ids)))).mappings()} if visible_ids else {}
    maps=[dict(r) for r in db.execute(sa.select(m.obligation_clause_map).where(m.obligation_clause_map.c.clause_id.in_(list(clauses)),
        m.obligation_clause_map.c.effective_from<=when,sa.or_(m.obligation_clause_map.c.effective_to.is_(None),m.obligation_clause_map.c.effective_to>when))).mappings()] if clauses else []
    approved_maps=set(db.execute(sa.select(m.workflow_instance.c.entity_id).where(m.workflow_instance.c.entity_type=='obligation_clause_map',m.workflow_instance.c.record_status=='APPROVED',m.workflow_instance.c.completed_at<datetime.combine(when+timedelta(days=1),time()))).scalars())
    result=[]
    for row in db.execute(sa.select(m.compliance_obligation).where(m.compliance_obligation.c.approval_status=='APPROVED',
        m.compliance_obligation.c.effective_from<=when,sa.or_(m.compliance_obligation.c.effective_to.is_(None),m.compliance_obligation.c.effective_to>when))).mappings():
        row=dict(row);primary=clauses.get(row['primary_clause_id'])
        if not primary or not (actor.covers(row['business_owner_unit_id'],READ_ROLES) or actor.covers(row['regulatory_owner_unit_id'],REGULATORY_ROLES)):continue
        citations=[primary] if primary['instrument_id']==instrument['id'] else []
        citations += [clauses[r['clause_id']] for r in maps if r['obligation_id']==row['id'] and r['link_type']=='SUPPORTING' and r['id'] in approved_maps and clauses[r['clause_id']]['instrument_id']==instrument['id'] and clauses[r['clause_id']]['approval_status']=='APPROVED']
        if not citations:continue
        actions=[dict(r) for r in db.execute(sa.select(m.action).where(m.action.c.obligation_id==row['id'])).mappings() if scope_visible(actor,instrument,r['owner_unit_id'])]
        mappings=[dict(r) for r in db.execute(sa.select(m.obligation_control_map,m.control.c.title.label('control_name'),m.control.c.owner_unit_id.label('control_unit_id'))
            .join(m.control,m.control.c.id==m.obligation_control_map.c.control_id)
            .where(m.obligation_control_map.c.obligation_id==row['id'],m.obligation_control_map.c.approval_status=='APPROVED',m.obligation_control_map.c.effective_from<=when,
                sa.or_(m.obligation_control_map.c.effective_to.is_(None),m.obligation_control_map.c.effective_to>when))).mappings() if scope_visible(actor,instrument,r['control_unit_id'])]
        applicability=[dict(r) for r in db.execute(sa.select(m.obligation_applicability).where(m.obligation_applicability.c.obligation_id==row['id'],
            m.obligation_applicability.c.approval_status=='APPROVED',m.obligation_applicability.c.effective_from<=when,
            sa.or_(m.obligation_applicability.c.effective_to.is_(None),m.obligation_applicability.c.effective_to>when))).mappings() if not r['org_unit_id'] or scope_visible(actor,instrument,r['org_unit_id'])]
        result.append({**row,'citations':[{'clause_id':c['id'],'clause_code':c['code'],'version_id':c['instrument_version_id'],'role':'PRIMARY' if c['id']==row['primary_clause_id'] else 'SUPPORTING'} for c in {c['id']:c for c in citations}.values()],
            'actions':actions,'control_mappings':mappings,'applicability':applicability})
    return result

def view(db,actor,identifier=None,when=None,search=''):
    when=when or date.today()
    visible={row['id']:row for row in repo.listing(db,actor,{})}
    if identifier and identifier not in visible:raise HTTPException(404,'Notification family is outside your authorised scope.')
    links=link_rows(db);parents=parent_map(links,when)
    def visible_chain(item):
        result=[item];seen={item}
        while item in parents and parents[item]['parent_id'] in visible and parents[item]['parent_id'] not in seen:
            item=parents[item]['parent_id'];seen.add(item);result.append(item)
        return result
    roots={key:visible_chain(key)[-1] for key in visible}
    all_versions=[dict(r) for r in db.execute(sa.select(m.instrument_version).where(m.instrument_version.c.instrument_id.in_(list(visible)))).mappings()] if visible else []
    version_by_id={r['id']:r for r in all_versions}
    scopes=[dict(r) for r in db.execute(sa.select(m.notification_scope).where(m.notification_scope.c.instrument_id.in_(list(visible)),m.notification_scope.c.effective_from<=when,
        m.notification_scope.c.created_at<datetime.combine(when+timedelta(days=1),time()))).mappings()] if visible else []
    scopes=[r for r in scopes if scope_visible(actor,visible[r['instrument_id']],r['org_unit_id'])]
    assessments=[dict(r) for r in db.execute(sa.select(m.notification_assessment).where(m.notification_assessment.c.scope_id.in_([s['id'] for s in scopes]))).mappings()] if scopes else []
    deadline_rows=[dict(r) for r in db.execute(sa.select(m.regulatory_deadline).where(m.regulatory_deadline.c.instrument_id.in_(list(visible)))).mappings()] if visible else []
    deadline_rows=[r for r in deadline_rows if version_by_id.get(r['source_version_id'],{}).get('instrument_id') in visible and r['created_at'].date()<=when]
    def deadline(item):
        levels=[sorted([r for r in deadline_rows if r['instrument_id']==candidate and approved_at(r,when)],key=lambda r:(r['effective_from'],r['created_at'],r['id'])) for candidate in visible_chain(item)]
        def resolve(position):
            for depth,events in enumerate(levels):
                effective=[row for row in events if row['effective_from']<=position]
                if effective:return effective[-1],depth
            return None,None
        current,depth=resolve(when);next_row=None
        for position in sorted({row['effective_from'] for events in levels for row in events if row['effective_from']>when}):
            candidate,_=resolve(position)
            if candidate and (not current or candidate['id']!=current['id']):next_row=candidate;break
        original=levels[0][0] if levels[0] else levels[depth][0] if depth is not None else next((events[0] for events in levels if events),None)
        return {'current':current,'original':original,'next':next_row,'inherited':depth is not None and depth>0}
    def scope_status(scope,source):
        proposals=[r for r in assessments if r['scope_id']==scope['id'] and r['created_at'].date()<=when] if scope.get('id') else []
        accepted=sorted([r for r in proposals if approved_at(r,when)],key=lambda r:r['revision'],reverse=True)
        actions,evidence,snapshot=delivery_snapshot(db,scope['instrument_id'],source['id'] if source else '',scope['org_unit_id'],when)
        status='PENDING'
        if accepted:
            last=accepted[0]
            valid=source and last['source_version_id']==source['id'] and last['action_snapshot']==snapshot
            if valid and last['outcome']=='COMPLETED':valid=bool(actions) and all(r['record_status']=='COMPLETED' and r['approval_status']=='APPROVED' and evidence[r['id']] for r in actions)
            if valid and last['outcome']=='NO_IMPACT':valid=not actions
            status=last['outcome'] if valid else 'REASSESSMENT_REQUIRED'
        if any(r['approval_status'] in {'IN_REVIEW','REVIEWED'} for r in proposals):status='UNDER_REVIEW'
        elif status=='PENDING' and any(r['record_status'] in {'IN_PROGRESS','COMPLETED','PENDING_VALIDATION'} for r in actions):status='IN_PROGRESS'
        return {**scope,'status':status,'source_version_id':source['id'] if source else None,'actions':actions,'assessments':proposals,'last_approved':accepted[0] if accepted else None}
    def member(item):
        instrument=visible[item];source=approved_source(all_versions,item,when,instrument['current_version_id'])
        own={r['org_unit_id']:r for r in scopes if r['instrument_id']==item}
        for ancestor in visible_chain(item)[1:]:
            for row in scopes:
                if row['instrument_id']==ancestor and row['org_unit_id'] not in own and scope_visible(actor,instrument,row['org_unit_id']):
                    own[row['org_unit_id']]={**row,'id':None,'instrument_id':item,'inherited_pending':True}
        values=[scope_status(row,source) for row in own.values()]
        resolved=sum(row['status'] in RESOLVED for row in values)
        status='NOT_ASSESSED' if not values else ('NO_IMPACT' if all(r['status']=='NO_IMPACT' for r in values) else 'COMPLETED') if resolved==len(values) else next((state for state in ['REASSESSMENT_REQUIRED','UNDER_REVIEW','IN_PROGRESS'] if any(r['status']==state for r in values)),'PENDING')
        due=deadline(item)
        future=any(r['instrument_id']==item and approved_at(r,when) and r['effective_from']>when for r in all_versions)
        timing='UPCOMING' if not source and future or parents.get(item,{}).get('effective_from',when)>when else 'NO_APPROVED_SOURCE' if not source else 'RESOLVED' if status in RESOLVED else 'OVERDUE' if due['current'] and due['current']['due_date']<when else 'WITHIN_TIMELINE' if due['current'] else 'NO_APPROVED_DEADLINE'
        return {**instrument,'relationship':parents.get(item,{}).get('relationship_type','ORIGINAL'),'parent_id':parents.get(item,{}).get('parent_id') if parents.get(item,{}).get('parent_id') in visible else None,
            'restricted_parent':item in parents and parents[item]['parent_id'] not in visible,'depth':len(visible_chain(item))-1,
            'implementation_status':status,'resolved_scopes':resolved,'scopes':values,'source_version_id':source['id'] if source else None,
            'deadline':due,'timing':timing,'versions':[r for r in all_versions if r['instrument_id']==item]}
    if not identifier:
        families=[]
        for root in sorted(set(roots.values()),key=lambda key:visible[key]['title']):
            keys=[key for key in visible if roots[key]==root]
            if search and not any(search.casefold() in (' '.join(str(visible[key].get(field) or '') for field in ['code','title','official_reference_number'])).casefold() for key in keys):continue
            members=[member(key) for key in keys]
            families.append({'root':next(row for row in members if row['id']==root),'members':members,
                'amendments':len(members)-1,'overdue':sum(r['timing']=='OVERDUE' for r in members),
                'upcoming':sum(r['timing']=='UPCOMING' for r in members),'resolved':sum(r['implementation_status'] in RESOLVED for r in members)})
        return {'as_of':when,'families':families,'authorised_instruments':len(visible)}
    root=roots[identifier];keys=[key for key in visible if roots[key]==root]
    members=sorted([member(key) for key in keys],key=lambda r:(r['depth'],r['issue_date'],r['code']))
    proposals=[]
    for kind,table in KINDS.items():
        for row in db.execute(sa.select(table)).mappings():
            row=dict(row)
            if row['created_at'].date()>when:continue
            try:target,_=proposal_context(db,actor,kind,row)
            except HTTPException:continue
            if target['id'] in keys or kind=='link' and row['parent_id'] in keys:
                labels={}
                if kind=='link':labels['parent_code']=visible.get(row['parent_id'],{}).get('code')
                if kind=='assessment':labels['scope_org_unit_id']=repo.one(db,m.notification_scope,row['scope_id'])['org_unit_id']
                if row.get('source_version_id'):
                    source=version_by_id[row['source_version_id']]
                    labels.update(source_instrument_id=source['instrument_id'],source_version_number=source['version_number'])
                if kind=='clause':
                    for side in ['source','target']:
                        clause=repo.one(db,m.regulatory_clause,row[side+'_clause_id']);source=version_by_id[clause['instrument_version_id']]
                        labels.update({side+'_clause_code':clause['code'],side+'_instrument_id':source['instrument_id'],side+'_version_id':source['id']})
                proposals.append({**row,**labels,'kind':kind,'instrument_id':target['id'],'instrument_code':target['code']})
    proposal_ids={r['id'] for r in proposals}
    tasks=proposal_tasks(db,actor,proposal_ids)
    return {'as_of':when,'root_id':root,'selected_id':identifier,'members':members,
        'proposals':proposals,'decision_tasks':tasks,'deadlines':[r for r in deadline_rows if r['instrument_id'] in keys],
        'obligations':{key:linked_obligations(db,actor,visible[key],visible,when) for key in keys},
        'assurance':'NOT_ASSESSED'}
