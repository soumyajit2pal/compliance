"""Control governance and exact action/mapping/execution lineage in caller transactions.

Lock order: continuing obligation (mappings/actions), control family, action.
Approved content is revised into new rows; no destructive edits or automatic compliance.
"""
import json
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m, repository as repo, obligations as obl
from .access import READ_ROLES, REGULATORY_ROLES, actor_for
from .events import audit, history, notify, new_id, now

KINDS={'controls':m.control,'control-mappings':m.obligation_control_map}
PENDING={'DRAFT','IN_REVIEW','REVIEWED'}
def fail(ok,text,status=422):
    if not ok: raise HTTPException(status,text)
def rows(db,t,where=None):
    q=sa.select(t)
    return [dict(r) for r in db.execute(q.where(where) if where is not None else q).mappings()]
def today():
    from .delivery import today as day
    return day()
def current(r,day=None):
    day=day or today()
    return r['approval_status']=='APPROVED' and not r['superseded_by_id'] and r['effective_from']<=day and (not r['effective_to'] or r['effective_to']>day)
def context(db,actor,kind,r):
    if kind=='controls':
        allowed=actor.covers(r['owner_unit_id'],READ_ROLES) or actor.covers(r['governance_unit_id'],REGULATORY_ROLES)
        if not allowed and r['approval_status']=='APPROVED':
            # An approved shared mapping exposes its exact control to the mapped
            # department, including retained history; it grants no write authority.
            for mapping in rows(db,m.obligation_control_map,sa.and_(m.obligation_control_map.c.control_id==r['id'],m.obligation_control_map.c.approval_status=='APPROVED')):
                if not actor.covers(mapping['scope_unit_id'],READ_ROLES):continue
                try:obl.read(db,actor,mapping['obligation_id'])
                except HTTPException:continue
                allowed=True;break
        fail(allowed,'Control not found in your authorised area.',404)
        return r['governance_unit_id']
    o=obl.read(db,actor,r['obligation_id']);control=read(db,actor,'controls',r['control_id'])
    fail(actor.covers(r['scope_unit_id'],READ_ROLES) or actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES),'Mapping not found in your authorised area.',404)
    return o['regulatory_owner_unit_id']
def read(db,actor,kind,identifier,lock=False):
    r=repo.one(db,KINDS[kind],identifier)
    context(db,actor,kind,r)
    if lock:
        if kind=='control-mappings':obl.read(db,actor,r['obligation_id'],True)
        if kind=='controls':
            root=db.execute(sa.select(m.control.c.id).where(m.control.c.code==r['code']).order_by(m.control.c.version_number).limit(1)).scalar_one()
            repo.one(db,m.control,root,True)
        else:read(db,actor,'controls',r['control_id'],True)
        r=repo.one(db,KINDS[kind],identifier,True)
    return r
def maker(actor,kind,r,unit):
    return actor.covers(unit,{'AUTHOR'}) or actor.covers(r['owner_unit_id'] if kind=='controls' else r['scope_unit_id'],{'CONTROL_OWNER'})
def expected(r,p):fail(r['edit_revision']==p.expected_revision,'This record changed. Refresh before continuing.',409)
def change(db,actor,kind,r,values,event,reason):
    values={**values,'edit_revision':r['edit_revision']+1}
    db.execute(KINDS[kind].update().where(KINDS[kind].c.id==r['id']).values(**values))
    audit(db,actor,kind,r['id'],event,old=r,new={**r,**values},reason=reason)
    if 'approval_status' in values:history(db,actor,kind,r['id'],r['approval_status'],values['approval_status'],reason)
    return {**r,**values}
def validate(db,actor,kind,values):
    if kind=='controls':
        fail(values['governance_unit_id'],'Legacy control needs a validated governance department.')
        for table,key in [(m.organisational_unit,'owner_unit_id'),(m.organisational_unit,'governance_unit_id'),(m.frequency,'frequency_id'),(m.evidence_type,'evidence_type_id')]:repo.active(db,table,values[key])
        if values['system_id']:repo.active(db,m.system,values['system_id'])
        owner=actor_for(db,values['owner_user_id']);owner.require({'CONTROL_OWNER'},values['owner_unit_id'])
        fail(not any(owner.user.get(k) for k in ['must_change_password_flag','needs_email_confirmation_flag','needs_department_selection_flag']),'The control owner must complete onboarding.')
        fail(values['review_date']>=values['effective_from'],'Review date must cover the effective start.')
        return values['governance_unit_id']
    from .delivery import current_obligation
    o=obl.read(db,actor,values['obligation_id'],True)
    c=read(db,actor,'controls',values['control_id'],True)
    current_obligation(db,actor,o,values['scope_unit_id'])
    fail(current(c) and c['control_status'] in {'DESIGNED','IMPLEMENTED'},'Use a current approved control; ineffective or retired controls cannot provide new coverage.',409)
    fail(c['effective_from']<=values['effective_from'] and (not c['effective_to'] or values['effective_to'] and values['effective_to']<=c['effective_to']),'Mapping dates must fit the approved control dates.')
    fail(o['effective_from']<=values['effective_from'] and (not o['effective_to'] or values['effective_to'] and values['effective_to']<=o['effective_to']),'Mapping dates must fit the obligation dates.')
    fail(actor.covers(values['scope_unit_id'],READ_ROLES) or actor.covers(o['regulatory_owner_unit_id'],REGULATORY_ROLES),'Mapping scope is outside your approved area.',403)
    return o['regulatory_owner_unit_id']
def input_values(p):return p.model_dump(exclude={'reason'}) | {'change_reason':p.reason}
def create(db,actor,kind,p,previous=None):
    values=input_values(p);unit=validate(db,actor,kind,values)
    fail(maker(actor,kind,values,unit),'Your role cannot prepare this record.',403)
    table=KINDS[kind];version=1
    if previous:
        old=read(db,actor,kind,previous,True)
        fail(old['approval_status']=='APPROVED' and not old['superseded_by_id'],'Revise the current approved record.',409)
        if kind=='control-mappings':
            fail(all(values[k]==old[k] for k in ['obligation_id','scope_unit_id']),'A revision must retain the obligation and department.')
        fail(not db.execute(sa.select(table.c.id).where(table.c.supersedes_id==previous,table.c.approval_status.in_(PENDING))).first(),'A revision is already in preparation or review.',409)
        values.update(supersedes_id=previous);version=old['version_number']+1
        if kind=='controls':fail(values['owner_unit_id']==old['owner_unit_id'] and values['governance_unit_id']==old['governance_unit_id'],'Department transfers require a separately governed new control and mapping.')
    elif kind=='control-mappings':
        existing=rows(db,table,sa.and_(table.c.obligation_id==values['obligation_id'],table.c.control_id==values['control_id'],table.c.scope_unit_id==values['scope_unit_id'],table.c.superseded_by_id.is_(None),table.c.approval_status.in_(list(PENDING|{'APPROVED'}))))
        fail(not existing,'This obligation/control/department already has a mapping. Open it and create a revision.',409)
    if kind=='controls':values['code']=old['code'] if previous else repo.next_code(db,'control')
    identifier=new_id();values.update(id=identifier,created_by=actor.id,version_number=version,edit_revision=1)
    db.execute(table.insert().values(**values));audit(db,actor,kind,identifier,'REVISION_CREATED' if previous else 'CREATED',new=values,reason=p.reason)
    return {'id':identifier}
def edit(db,actor,kind,identifier,p,revision):
    r=read(db,actor,kind,identifier,True);fail(r['created_by']==actor.id and r['approval_status']=='DRAFT','Only the Draft maker can edit. Revise approved content.',409)
    fail(r['edit_revision']==revision,'This record changed. Refresh before editing.',409)
    values=input_values(p)
    immutable=['owner_unit_id','governance_unit_id'] if kind=='controls' else ['obligation_id','control_id','scope_unit_id']
    fail(all(r[k]==values[k] for k in immutable),'Keep the original record scope. Create a separate record for a different scope.')
    unit=validate(db,actor,kind,values);fail(maker(actor,kind,r,unit),'Your role cannot edit this scope.',403)
    return change(db,actor,kind,r,values,'DRAFT_EDITED',p.reason)
def submit(db,actor,kind,identifier,p):
    r=read(db,actor,kind,identifier,True);expected(r,p);unit=context(db,actor,kind,r)
    fail(r['created_by']==actor.id and maker(actor,kind,r,unit) and r['approval_status']=='DRAFT','Only the Draft maker can submit.',403)
    validate(db,actor,kind,r)
    for uid,role in [(p.reviewer_user_id,'REVIEWER'),(p.approver_user_id,'APPROVER')]:
        candidate=obl.eligible(db,uid,role,unit,{r['created_by'],p.approver_user_id if role=='REVIEWER' else p.reviewer_user_id})
        context(db,candidate,kind,r)
    change(db,actor,kind,r,dict(approval_status='IN_REVIEW',reviewer_user_id=p.reviewer_user_id,approver_user_id=p.approver_user_id,reviewed_by=None,reviewed_at=None),'SUBMITTED',p.reason)
    notify(db,kind,identifier,p.reviewer_user_id,'CONTROL_REVIEW',identifier+':'+str(r['edit_revision'])+':review')
    return {'ok':True}
def open_linked_actions(db,kind,r):
    maps=[r['id']] if kind=='control-mappings' else [x['id'] for x in rows(db,m.obligation_control_map,m.obligation_control_map.c.control_id==r['id'])]
    return db.execute(sa.select(m.action.c.id).join(m.action_control_link,m.action_control_link.c.action_id==m.action.c.id).where(m.action_control_link.c.mapping_id.in_(maps),m.action.c.record_status.not_in(['COMPLETED','CANCELLED']))).first() if maps else None
def decide(db,actor,kind,identifier,p):
    r=read(db,actor,kind,identifier,True);expected(r,p);unit=context(db,actor,kind,r)
    if p.decision=='WITHDRAW':
        fail(r['created_by']==actor.id and maker(actor,kind,r,unit) and r['approval_status'] in PENDING,'Only the maker can withdraw a pending proposal.',403)
        values={'approval_status':'WITHDRAWN'}
    else:
        reviewing=r['approval_status']=='IN_REVIEW';role='REVIEWER' if reviewing else 'APPROVER'
        fail(r['approval_status'] in {'IN_REVIEW','REVIEWED'} and actor.id==r['reviewer_user_id' if reviewing else 'approver_user_id'] and actor.id!=r['created_by'] and (reviewing or actor.id!=r['reviewed_by']),'Only the named independent person can decide this stage.',403)
        actor.require({role},unit)
        if p.decision in {'RETURN','REJECT'}:values={'approval_status':'DRAFT' if p.decision=='RETURN' else 'REJECTED','reviewed_by':None,'reviewed_at':None}
        else:
            fail(p.decision==('REVIEW' if reviewing else 'APPROVE'),'Complete the current review stage first.',409)
            validate(db,actor,kind,r)
            if not reviewing and kind=='control-mappings' and r['mapping_status']=='ACTIVE':
                for other in rows(db,m.obligation_control_map,sa.and_(m.obligation_control_map.c.obligation_id==r['obligation_id'],m.obligation_control_map.c.scope_unit_id==r['scope_unit_id'],m.obligation_control_map.c.approval_status=='APPROVED',m.obligation_control_map.c.superseded_by_id.is_(None))):
                    if other['id'] in {r['id'],r['supersedes_id']} or other['mapping_status']!='ACTIVE':continue
                    overlap=(not other['effective_to'] or r['effective_from']<other['effective_to']) and (not r['effective_to'] or other['effective_from']<r['effective_to'])
                    fail(not overlap or other['control_id']!=r['control_id'],'An approved mapping already covers this control, obligation and department.',409)
                    fail(not overlap or not (r['primary_control_flag'] and other['primary_control_flag']),'Only one primary control mapping may cover a department at a time. Revise the existing primary mapping first.',409)
            values={'approval_status':'REVIEWED','reviewed_by':actor.id,'reviewed_at':now()} if reviewing else {'approval_status':'APPROVED','approved_by':actor.id,'approved_at':now()}
            if not reviewing and r['supersedes_id']:
                old=read(db,actor,kind,r['supersedes_id'],True)
                fail(not old['superseded_by_id'],'Another revision has replaced this record.',409)
                withdrawing=r['control_status'] in {'INEFFECTIVE','RETIRED'} if kind=='controls' else r['mapping_status']=='RETIRED'
                fail(withdrawing or not open_linked_actions(db,kind,old),'Finish or cancel open linked work before replacing this control or mapping. Original assignments remain retained.',409)
                fail(r['effective_from']<=today(),'A replacement must be effective now; future replacement scheduling is not supported.')
                change(db,actor,kind,old,{'superseded_by_id':identifier},'SUPERSEDED',p.reason)
    updated=change(db,actor,kind,r,values,p.decision,p.reason)
    recipient=r['approver_user_id'] if updated['approval_status']=='REVIEWED' else r['created_by']
    notify(db,kind,identifier,recipient,'CONTROL_'+p.decision,identifier+':'+str(r['edit_revision'])+':'+p.decision)
    return {'ok':True}
def listing(db,actor,kind,filters):
    actor.require(READ_ROLES);result=[]
    for r in rows(db,KINDS[kind]):
        try:
            unit=context(db,actor,kind,r)
            if kind=='control-mappings':
                c=read(db,actor,'controls',r['control_id']);o=obl.read(db,actor,r['obligation_id'])
                r.update(control_code=c['code'],control_title=c['title'],obligation_code=o['code'],obligation_title=o['title'],control_status=c['control_status'],control_version=c['version_number'],evidence_type_id=c['evidence_type_id'])
        except HTTPException:continue
        r['current']=current(r) and (r['control_status'] in {'DESIGNED','IMPLEMENTED'} if kind=='controls' else r['mapping_status']=='ACTIVE' and current(c) and c['control_status'] in {'DESIGNED','IMPLEMENTED'} and o['approval_status']=='APPROVED' and o['record_status']=='ACTIVE' and o['effective_from']<=today() and (not o['effective_to'] or o['effective_to']>today()))
        r['mapping_gap']=kind=='control-mappings' and r['coverage_type']!='FULL'
        if any(filters.get(k) and str(r.get(field) or '')!=filters[k] for k,field in [('department','owner_unit_id' if kind=='controls' else 'scope_unit_id'),('status','approval_status'),('obligation','obligation_id'),('control','control_id')]):continue
        if filters.get('current')=='true' and not r['current']:continue
        if filters.get('q') and filters['q'].casefold() not in json.dumps(r,default=str).casefold():continue
        result.append(r)
    return sorted(result,key=lambda r:(r['created_at'],r['id']),reverse=True)
def detail(db,actor,kind,identifier):
    r=read(db,actor,kind,identifier);unit=context(db,actor,kind,r)
    previous=repo.one(db,KINDS[kind],r['supersedes_id']) if r['supersedes_id'] else None
    links=rows(db,m.action_control_link,m.action_control_link.c.mapping_id==identifier) if kind=='control-mappings' else []
    actions=[]
    from . import delivery as d
    for link in links:
        try:a,_=d.read(db,actor,link['action_id']);actions.append(a)
        except HTTPException:continue
    return {'record':r,'previous':previous,'actions':actions,'permissions':{
        'can_edit':r['approval_status']=='DRAFT' and r['created_by']==actor.id and maker(actor,kind,r,unit),
        'can_revise':r['approval_status']=='APPROVED' and not r['superseded_by_id'] and maker(actor,kind,r,unit),
        'can_decide':r['approval_status'] in {'IN_REVIEW','REVIEWED'} and actor.id==r['reviewer_user_id' if r['approval_status']=='IN_REVIEW' else 'approver_user_id'] and actor.covers(unit,{'REVIEWER' if r['approval_status']=='IN_REVIEW' else 'APPROVER'}),
        'can_withdraw':r['created_by']==actor.id and r['approval_status'] in PENDING and maker(actor,kind,r,unit)},
        'audit':rows(db,m.audit_log,sa.and_(m.audit_log.c.entity_type==kind,m.audit_log.c.entity_id==identifier))}
def tasks(db,actor):
    result=[]
    for kind in KINDS:
        for r in listing(db,actor,kind,{}):
            status=r['approval_status'];unit=context(db,actor,kind,r)
            draft=status=='DRAFT' and r['created_by']==actor.id and maker(actor,kind,r,unit)
            decision=status in {'IN_REVIEW','REVIEWED'} and actor.id==r['reviewer_user_id' if status=='IN_REVIEW' else 'approver_user_id'] and actor.covers(unit,{'REVIEWER' if status=='IN_REVIEW' else 'APPROVER'})
            if draft or decision:result.append({'id':r['id'],'kind':'DRAFT' if draft else 'DECISION','workflow_kind':'CONTROL','action_path':kind+'/'+r['id'],'code':r.get('code') or r['control_code']+' → '+r['obligation_code'],'title':r.get('title') or r['control_title'],'department_id':unit,'stage':status,'due_at':r.get('review_date')})
    return result

def action_mappings(db,actor,obligation,unit):
    result=[]
    for r in listing(db,actor,'control-mappings',{'obligation':obligation,'department':unit,'current':'true'}):
        c=read(db,actor,'controls',r['control_id'])
        if current(c) and c['control_status'] in {'DESIGNED','IMPLEMENTED'}:result.append(r)
    return result
def prepare_links(db,actor,o,p):
    identifiers=p.control_mapping_ids
    fail(len(identifiers)==len(set(identifiers)),'Choose each control mapping once.')
    fail(identifiers or len(p.control_scope_reason or '')>=10,'Select approved controls or explain why this action has no control execution scope.')
    result=[]
    for identifier in identifiers:
        r=read(db,actor,'control-mappings',identifier,True);c=read(db,actor,'controls',r['control_id'],True)
        fail(r['obligation_id']==o['id'] and r['scope_unit_id']==p.owner_unit_id,'The mapping must match the exact obligation revision and department.')
        fail(current(r) and r['mapping_status']=='ACTIVE' and current(c) and c['control_status'] in {'DESIGNED','IMPLEMENTED'},'The selected control or mapping is no longer current.',409)
        fail(c['control_status']=='IMPLEMENTED','Execution work needs an implemented control. Use a reasoned implementation action to establish a designed control.',409)
        for v in [r,c]:fail(v['effective_from']<=p.period_from and (not v['effective_to'] or p.period_to<v['effective_to']),'The control and mapping must cover the entire reporting period.')
        fail(c['evidence_type_id']==p.evidence_type_id,'The action evidence type must match every selected control; use separate assignments for different proof types.')
        result.append(r)
    return result
def link_action(db,actor,a,mappings):
    for r in mappings:db.execute(m.action_control_link.insert().values(id=new_id(),action_id=a['id'],mapping_id=r['id'],linked_by=actor.id,linked_at=now()))
def action_context(db,actor,a):
    result=[]
    for link in rows(db,m.action_control_link,m.action_control_link.c.action_id==a['id']):
        r=read(db,actor,'control-mappings',link['mapping_id']);c=read(db,actor,'controls',r['control_id'])
        attempts=rows(db,m.action_control_result,m.action_control_result.c.link_id==link['id']);attempts.sort(key=lambda x:x['attempt_number'])
        for attempt in attempts:attempt['execution']=repo.one(db,m.control_execution,attempt['execution_id'])
        result.append({'link':link,'mapping':r,'control':c,'results':attempts})
    return result
def record_result(db,actor,identifier,p):
    from . import delivery as d
    a,o=d.read(db,actor,identifier,True);d.revision(a,p);d.require_owner(actor,a)
    fail(a['record_status'] in {'OPEN','IN_PROGRESS'},'Results cannot change during review.',409)
    fail(a['period_to']<=today() and a['period_from']<=p.performed_date<=today(),'Record the result after the period ends, with a valid performance date.')
    scope=next((x for x in action_context(db,actor,a) if x['mapping']['id']==p.mapping_id),None);fail(scope,'Select a control mapped to this action.')
    c=scope['control'];fail(current(c) and current(scope['mapping']),'Control coverage needs reassessment before recording this result.',409)
    fail(p.performed_date>=a['period_to'],'Performance date cannot precede the end of the reporting period.')
    execution=new_id();db.execute(m.control_execution.insert().values(id=execution,control_id=c['id'],period_from=a['period_from'],period_to=a['period_to'],due_date=a['current_due_date'],performed_date=p.performed_date,performed_by=actor.id,result='PENDING',exception_count=p.exception_count,comments=p.comments,certification_status='RETAINED_ACTION_GATE' if a['retained_validation_required_flag'] else 'NOT_REQUIRED'))
    result=new_id();db.execute(m.action_control_result.insert().values(id=result,link_id=scope['link']['id'],execution_id=execution,attempt_number=len(scope['results'])+1,proposed_result=p.result))
    audit(db,actor,'control_execution',execution,'RESULT_RECORDED',new=p.model_dump());d.update(db,actor,a,{},'CONTROL_RESULT_RECORDED',p.comments)
    return {'id':result}
def bind_submission(db,actor,a,submission,proof):
    for x in action_context(db,actor,a):
        fail(current(x['mapping']) and current(x['control']),'A control or mapping requires reassessment before submission.',409)
        last=x['results'][-1] if x['results'] else None
        fail(last and not last['submission_id'],'Record a fresh result for every mapped control before submitting this period.',409)
        db.execute(m.action_control_result.update().where(m.action_control_result.c.id==last['id']).values(submission_id=submission))
        for e in proof:db.execute(m.evidence_link.insert().values(id=new_id(),evidence_id=e['evidence_id'],control_execution_id=last['execution_id'],link_purpose='EXECUTION',primary_evidence_flag=0,linked_by=actor.id,linked_at=now()))
def decide_result(db,actor,identifier,p,storage):
    from . import delivery as d
    r=repo.one(db,m.action_control_result,identifier);link=repo.one(db,m.action_control_link,r['link_id']);a,o=d.read(db,actor,link['action_id'],True);d.revision(a,p);d.require_reviewer(actor,a,o)
    r=repo.one(db,m.action_control_result,identifier,True);sub=d.latest(db,a)
    fail(a['record_status']=='PENDING_VALIDATION' and sub and r['submission_id']==sub['id'] and r['decision']=='PENDING','Review the current submitted control result once.',409)
    proof=json.loads(sub['evidence_snapshot']);decisions=rows(db,m.action_evidence_decision,m.action_evidence_decision.c.submission_id==sub['id'])
    if p.decision=='ACCEPT':
        fail(proof and all(any(x['evidence_link_id']==e['link_id'] and x['decision']=='ACCEPT' and x['reviewed_by']==actor.id for x in decisions) for e in proof),'Review and accept every submitted proof item before accepting a control result.',409)
        for e in proof:
            item=d.evidence_read(db,actor,e['evidence_id']);d.evidence_valid(a,item);d.integrity(db,item,storage)
    execution=repo.one(db,m.control_execution,r['execution_id'],True)
    fail(execution['performed_by']!=actor.id,'A performer cannot review their own execution.',403)
    db.execute(m.control_execution.update().where(m.control_execution.c.id==execution['id']).values(reviewed_by=actor.id,result=r['proposed_result'] if p.decision=='ACCEPT' else 'FAILED'))
    db.execute(m.action_control_result.update().where(m.action_control_result.c.id==identifier).values(decision=p.decision,decision_reason=p.reason))
    audit(db,actor,'control_execution',execution['id'],p.decision,old=execution,new={'result':r['proposed_result'] if p.decision=='ACCEPT' else 'FAILED','decision':p.decision},reason=p.reason);d.update(db,actor,a,{},'CONTROL_RESULT_'+p.decision,p.reason)
    return {'ok':True}
def closure(db,actor,a,submission):
    for x in action_context(db,actor,a):
        fail(current(x['mapping']) and current(x['control']) and x['mapping']['mapping_status']=='ACTIVE' and x['control']['control_status']=='IMPLEMENTED','Current approved control coverage is required before closing mapped work.',409)
        matched=[r for r in x['results'] if r['submission_id']==submission['id']]
        fail(len(matched)==1 and matched[0]['decision']=='ACCEPT' and matched[0]['execution']['result']=='EFFECTIVE','Each mapped control needs an independently accepted effective result for this submission. Exceptions and failures require correction.',409)
