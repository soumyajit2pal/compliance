"""Week 3 regulatory master: scoped sources, versions, clauses and governed decisions."""
from datetime import date,timedelta
import hashlib,json,re
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m
from .access import READ_ROLES,REGULATORY_ROLES,actor_for,can_read_instrument
from .events import now,new_id,audit,history,notify

PENDING_VERSION_STATUSES=('DRAFT','IN_REVIEW','REVIEWED')

def require_no_pending_version(db,instrument_id,exclude_id=None):
    # Call only after locking the parent instrument. All edition lifecycle writes
    # use that same lock, so a waiting creator sees the committed pending edition.
    query=sa.select(m.instrument_version).where(m.instrument_version.c.instrument_id==instrument_id,
        m.instrument_version.c.approval_status.in_(PENDING_VERSION_STATUSES))
    if exclude_id: query=query.where(m.instrument_version.c.id!=exclude_id)
    pending=db.execute(query.order_by(m.instrument_version.c.created_at,m.instrument_version.c.id)).mappings().first()
    if pending:
        raise HTTPException(409,f"Version {source_version_label(pending['version_number'])} is pending ({pending['approval_status'].replace('_',' ').title()}). Open the pending edition and complete its approval or cancel the Draft before creating or submitting another edition. Withdrawing to Draft keeps it pending.")


def one(db,table,identifier,lock=False):
    query=sa.select(table).where(table.c.id==identifier)
    if lock: query=query.with_for_update()
    row=db.execute(query).mappings().first()
    if not row: raise HTTPException(404,'Record not found.')
    return dict(row)

def normalize_source_version_number(value):
    number=str(value).strip()
    if re.fullmatch(r'\d+',number): number=f'{int(number)}.0'
    match=re.fullmatch(r'(\d+)\.(\d+)',number)
    if not match: raise HTTPException(422,'Use major.minor version notation, such as 1.0 or 2.0.')
    normalized=f'{int(match.group(1))}.{int(match.group(2))}'
    if len(normalized)>30:raise HTTPException(422,'The normalized version number must fit within 30 characters.')
    return normalized

def source_version_label(value):
    try: return normalize_source_version_number(value)
    except HTTPException: return str(value)

def active(db,table,identifier):
    row=one(db,table,identifier)
    if 'active_flag' in row and not row['active_flag']: raise HTTPException(422,'Choose an active reference record.')
    if row.get('effective_from') and row['effective_from']>date.today() or row.get('effective_to') and row['effective_to']<=date.today():
        raise HTTPException(422,'Choose a reference record effective on the current date.')
    return row

def next_counter(db,entity):
    row=db.execute(sa.select(m.id_counter).where(m.id_counter.c.entity_type==entity).with_for_update()).mappings().one()
    db.execute(m.id_counter.update().where(m.id_counter.c.id==row['id']).values(next_value=row['next_value']+1))
    return row

def next_code(db,entity):
    row=next_counter(db,entity)
    return f"{row['prefix']}-{date.today().year}-{row['next_value']:06d}"

def next_instrument_code(db,regulator_code,domain_code,instrument_type_code):
    row=next_counter(db,'instrument')
    return f"{row['prefix']}-{regulator_code.upper()}-{domain_code.upper()}-{instrument_type_code.upper()}-{row['next_value']:03d}"

def read_instrument(db,actor,identifier,lock=False):
    row=one(db,m.regulatory_instrument,identifier,lock)
    rank=one(db,m.confidentiality_class,row['confidentiality_class_id'])['rank_number']
    if not can_read_instrument(actor,row,rank): raise HTTPException(404,'Record not found in your authorised area.')
    return row

def read_version(db,actor,identifier,lock=False):
    version=one(db,m.instrument_version,identifier)
    instrument=read_instrument(db,actor,version['instrument_id'],lock)
    if lock: version=one(db,m.instrument_version,identifier,lock=True)
    return version,instrument

def eligible(db,user_id,role,unit,exclude=()):
    actor=actor_for(db,user_id)
    actor.require({role},unit)
    if user_id in exclude: raise HTTPException(422,'Maker, reviewer and final approver must be different people.')
    if actor.user['needs_email_confirmation_flag'] or actor.user['needs_department_selection_flag']:
        raise HTTPException(422,'The assigned user must complete account onboarding.')
    return actor

def source_document(db,actor,identifier,unit,classification):
    row=one(db,m.document,identifier)
    actor.require({'AUTHOR'},unit)
    if row['owner_unit_id']!=unit or row['confidentiality_class_id']!=classification:
        raise HTTPException(422,'Source document department and confidentiality must match the instrument.')
    return row

def validate_instrument_domains(db,primary_domain_id,secondary_domain_ids):
    secondary=list(secondary_domain_ids or [])
    if len(secondary)!=len(set(secondary)):
        raise HTTPException(422,'Choose each additional regulatory domain only once.')
    if primary_domain_id in secondary:
        raise HTTPException(422,'The primary domain cannot also be an additional domain.')
    one(db,m.regulatory_domain,primary_domain_id)
    for domain_id in secondary: one(db,m.regulatory_domain,domain_id)
    return secondary

def save_instrument_domains(db,instrument_id,primary_domain_id,secondary_domain_ids,effective_from):
    # These mappings are editable only while the initial source is still a Draft.
    # Preserve closed mapping history; replace the open Draft assignments.
    open_ids=db.execute(sa.select(m.instrument_domain_map.c.id).where(
        m.instrument_domain_map.c.instrument_id==instrument_id,
        m.instrument_domain_map.c.effective_to.is_(None))).scalars().all()
    if open_ids:
        db.execute(m.instrument_domain_map.delete().where(m.instrument_domain_map.c.id.in_(open_ids)))
    for domain_id,role in [(primary_domain_id,'PRIMARY'),*((domain_id,'SECONDARY') for domain_id in secondary_domain_ids)]:
        db.execute(m.instrument_domain_map.insert().values(id=new_id(),instrument_id=instrument_id,
            domain_id=domain_id,domain_role=role,effective_from=effective_from))

def create_instrument(db,actor,payload):
    values=payload.model_dump();secondary_domains=validate_instrument_domains(
        db,values['primary_domain_id'],values.pop('secondary_domain_ids',[]))
    unit=values['regulatory_owner_unit_id'];actor.require({'AUTHOR'},unit)
    regulator=active(db,m.regulator,values['regulator_id'])
    # Serialize matching-reference registration under the regulator master lock.
    one(db,m.regulator,regulator['id'],lock=True)
    instrument_type=active(db,m.instrument_type,values['instrument_type_id']);domain=one(db,m.regulatory_domain,values['primary_domain_id'])
    active(db,m.organisational_unit,unit);active(db,m.confidentiality_class,values['confidentiality_class_id'])
    eligible(db,values['interpretation_owner_user_id'],'AUTHOR',unit)
    source_document(db,actor,values['source_document_id'],unit,values['confidentiality_class_id'])
    reference=(values.get('official_reference_number') or '').strip() or None;values['official_reference_number']=reference
    if reference and db.execute(sa.select(m.regulatory_instrument.c.id).where(m.regulatory_instrument.c.regulator_id==regulator['id'],
        sa.func.upper(sa.func.trim(m.regulatory_instrument.c.official_reference_number))==reference.upper())).first():
        raise HTTPException(409,'This regulator and official reference number are already registered. Open that record to add a version.')
    identifier=new_id();version=new_id();code=next_instrument_code(db,regulator['code'],domain['code'],instrument_type['code'])
    db.execute(m.regulatory_instrument.insert().values(id=identifier,code=code,created_by=actor.id,**values))
    db.execute(m.instrument_version.insert().values(id=version,instrument_id=identifier,version_number='1.0',
        version_date=values['issue_date'],effective_from=values['effective_date'],source_document_id=values['source_document_id'],
        change_summary='Initial registered source',created_by=actor.id))
    save_instrument_domains(db,identifier,values['primary_domain_id'],secondary_domains,values['effective_date'])
    audit(db,actor,'instrument',identifier,'REGISTERED',new={**values,'secondary_domain_ids':secondary_domains,'code':code,'initial_version_id':version})
    history(db,actor,'instrument',identifier,None,'DRAFT','Registered with initial version')
    return {'id':identifier,'version_id':version,'code':code}

def edit_instrument(db,actor,identifier,payload):
    old=read_instrument(db,actor,identifier,lock=True);actor.require({'AUTHOR'},old['regulatory_owner_unit_id'])
    if old['approval_status']!='DRAFT' or old['created_by']!=actor.id: raise HTTPException(409,'Only the maker can edit this Draft. Approved records are retained.')
    values=payload.model_dump()
    secondary_domains=validate_instrument_domains(db,values['primary_domain_id'],values.pop('secondary_domain_ids',[]))
    if any(values[k]!=old[k] for k in ['regulator_id','regulatory_owner_unit_id','confidentiality_class_id','primary_domain_id']):
        raise HTTPException(422,'Regulator, primary domain, department and classification are fixed after registration. Withdraw and register a corrected Draft.')
    source_document(db,actor,values['source_document_id'],old['regulatory_owner_unit_id'],old['confidentiality_class_id'])
    active(db,m.instrument_type,values['instrument_type_id'])
    eligible(db,values['interpretation_owner_user_id'],'AUTHOR',old['regulatory_owner_unit_id'])
    reference=(values.get('official_reference_number') or '').strip() or None;values['official_reference_number']=reference
    one(db,m.regulator,old['regulator_id'],lock=True)
    if reference and db.execute(sa.select(m.regulatory_instrument.c.id).where(m.regulatory_instrument.c.id!=identifier,
        m.regulatory_instrument.c.regulator_id==old['regulator_id'],sa.func.upper(sa.func.trim(m.regulatory_instrument.c.official_reference_number))==reference.upper())).first():
        raise HTTPException(409,'The official reference is already registered.')
    db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==identifier).values(**values))
    # Before first approval, keep the initial source edition and its clauses aligned.
    initial=db.execute(sa.select(m.instrument_version).where(m.instrument_version.c.instrument_id==identifier,m.instrument_version.c.supersedes_version_id.is_(None))).mappings().one()
    if initial['approval_status']!='DRAFT': raise HTTPException(409,'Return the initial version before editing the instrument.')
    db.execute(m.instrument_version.update().where(m.instrument_version.c.id==initial['id']).values(source_document_id=values['source_document_id'],version_date=values['issue_date'],effective_from=values['effective_date']))
    db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.instrument_version_id==initial['id']).values(effective_from=values['effective_date']))
    previous_domains=[dict(r) for r in db.execute(sa.select(m.instrument_domain_map.c.domain_id,m.instrument_domain_map.c.domain_role)
        .where(m.instrument_domain_map.c.instrument_id==identifier,m.instrument_domain_map.c.effective_to.is_(None))).mappings()]
    save_instrument_domains(db,identifier,values['primary_domain_id'],secondary_domains,values['effective_date'])
    audit(db,actor,'instrument',identifier,'DRAFT_UPDATED',old={**old,'domain_assignments':previous_domains},new={**values,'secondary_domain_ids':secondary_domains})
    return {'id':identifier}

def add_version(db,actor,instrument_id,payload):
    instrument=read_instrument(db,actor,instrument_id,lock=True);actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    require_no_pending_version(db,instrument_id)
    if instrument['approval_status']!='APPROVED': raise HTTPException(409,'Approve the initial instrument before adding a subsequent version.')
    values=payload.model_dump()
    values['version_number']=normalize_source_version_number(values['version_number'])
    source_document(db,actor,values['source_document_id'],instrument['regulatory_owner_unit_id'],instrument['confidentiality_class_id'])
    if values['supersedes_version_id']:
        old=one(db,m.instrument_version,values['supersedes_version_id'])
        if old['instrument_id']!=instrument_id or old['approval_status']!='APPROVED': raise HTTPException(422,'Choose an approved version of this instrument to supersede.')
        if values['effective_from']<=old['effective_from']: raise HTTPException(422,'The later version must take effect after the version it supersedes.')
    else: raise HTTPException(422,'A subsequent version must identify the approved version it supersedes.')
    existing_numbers=db.execute(sa.select(m.instrument_version.c.version_number).where(m.instrument_version.c.instrument_id==instrument_id)).scalars().all()
    for existing_number in existing_numbers:
        if source_version_label(existing_number)==values['version_number']:
            raise HTTPException(409,'This version number already exists.')
    identifier=new_id();db.execute(m.instrument_version.insert().values(id=identifier,instrument_id=instrument_id,created_by=actor.id,**values))
    audit(db,actor,'version',identifier,'VERSION_CREATED',new=values)
    return {'id':identifier}

def cancel_draft(db,actor,identifier,payload):
    version,instrument=read_version(db,actor,identifier,lock=True)
    actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    if version['created_by']!=actor.id: raise HTTPException(403,'Only the maker can cancel this Draft edition.')
    if version['approval_status']!='DRAFT':
        raise HTTPException(409,'Only a Draft edition can be cancelled. Withdraw an active submission to Draft first.')
    if db.execute(sa.select(m.workflow_instance.c.id).where(m.workflow_instance.c.entity_type=='version',
        m.workflow_instance.c.entity_id==identifier,m.workflow_instance.c.record_status=='OPEN')).first():
        raise HTTPException(409,'Withdraw the open review workflow to Draft before cancelling this edition.')
    if db.execute(sa.select(m.regulatory_clause.c.id).where(m.regulatory_clause.c.instrument_version_id==identifier,
        m.regulatory_clause.c.approval_status!='DRAFT')).first():
        raise HTTPException(409,'All clauses must be Draft before this edition can be cancelled.')
    # WITHDRAWN is the existing terminal storage status. The explicit audit event
    # distinguishes cancellation from legacy workflow withdrawals, without DDL.
    db.execute(m.instrument_version.update().where(m.instrument_version.c.id==identifier).values(approval_status='WITHDRAWN'))
    db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.instrument_version_id==identifier).values(approval_status='WITHDRAWN'))
    history(db,actor,'version',identifier,'DRAFT','WITHDRAWN',payload.reason)
    audit(db,actor,'version',identifier,'DRAFT_CANCELLED',old=version,
        new={'approval_status':'WITHDRAWN','cancelled_draft':True},reason=payload.reason)
    if not version['supersedes_version_id'] and instrument['approval_status']=='DRAFT':
        db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==instrument['id'])
            .values(approval_status='WITHDRAWN',regulatory_status='WITHDRAWN'))
        history(db,actor,'instrument',instrument['id'],'DRAFT','WITHDRAWN',payload.reason)
        audit(db,actor,'instrument',instrument['id'],'DRAFT_CANCELLED',
            old={'approval_status':'DRAFT'},new={'approval_status':'WITHDRAWN','version_id':identifier},reason=payload.reason)
    return {'id':identifier,'instrument_id':instrument['id'],'status':'WITHDRAWN','cancelled_draft':True,
        'message':'Draft edition cancelled. Its source, clauses, cancellation reason and earlier history are retained.'}

def edit_version(db,actor,identifier,payload):
    version,instrument=read_version(db,actor,identifier,lock=True)
    actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    if version['approval_status']!='DRAFT' or version['created_by']!=actor.id:
        raise HTTPException(409,'Only the maker can edit a Draft source edition. Return or withdraw a submission to Draft before editing.')
    if db.execute(sa.select(m.workflow_instance.c.id).where(m.workflow_instance.c.entity_type=='version',
        m.workflow_instance.c.entity_id==identifier,m.workflow_instance.c.record_status=='OPEN')).first():
        raise HTTPException(409,'Close the current review workflow before editing this Draft.')
    if db.execute(sa.select(m.regulatory_clause.c.id).where(m.regulatory_clause.c.instrument_version_id==identifier,
        m.regulatory_clause.c.approval_status!='DRAFT')).first():
        raise HTTPException(409,'All clauses in the edition must be returned to Draft before editing.')
    values=payload.model_dump();values['version_number']=normalize_source_version_number(values['version_number'])
    source_document(db,actor,values['source_document_id'],instrument['regulatory_owner_unit_id'],instrument['confidentiality_class_id'])
    initial=version['supersedes_version_id'] is None
    if initial:
        if values['supersedes_version_id'] is not None or instrument['approval_status']!='DRAFT':
            raise HTTPException(422,'The initial Draft edition cannot supersede another edition or rewrite an approved instrument.')
    else:
        previous=one(db,m.instrument_version,values['supersedes_version_id']) if values['supersedes_version_id'] else None
        if not previous or previous['id']==identifier or previous['instrument_id']!=instrument['id'] or previous['approval_status']!='APPROVED':
            raise HTTPException(422,'Select an approved edition of this instrument to supersede.')
        if values['effective_from']<=previous['effective_from']:
            raise HTTPException(422,'The later edition must take effect after the edition it supersedes.')
    numbers=db.execute(sa.select(m.instrument_version.c.version_number).where(
        m.instrument_version.c.instrument_id==instrument['id'],m.instrument_version.c.id!=identifier)).scalars()
    if any(source_version_label(number)==values['version_number'] for number in numbers):
        raise HTTPException(409,'This version number already exists.')
    cleared={'reviewed_by':None,'reviewed_at':None,'approved_by':None,'approved_at':None}
    db.execute(m.instrument_version.update().where(m.instrument_version.c.id==identifier).values(**values,**cleared))
    db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.instrument_version_id==identifier)
        .values(effective_from=values['effective_from'],interpretation_status='PENDING',**cleared))
    if initial:
        db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==instrument['id']).values(
            source_document_id=values['source_document_id'],issue_date=values['version_date'],effective_date=values['effective_from'],**cleared))
        db.execute(m.instrument_domain_map.update().where(m.instrument_domain_map.c.instrument_id==instrument['id'],
            m.instrument_domain_map.c.effective_to.is_(None)).values(effective_from=values['effective_from']))
    audit(db,actor,'version',identifier,'DRAFT_VERSION_UPDATED',old=version,new={**values,**cleared},reason=values['change_summary'])
    return {'id':identifier,'instrument_id':instrument['id'],'status':'DRAFT',
        'message':'Draft source edition saved. Existing clauses are retained; recheck them against the source before submitting for independent review.'}

def add_clause(db,actor,version_id,payload,clause_id=None,*,imported=False):
    version,instrument=read_version(db,actor,version_id,lock=True);actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    if version['approval_status']!='DRAFT' or version['created_by']!=actor.id:
        raise HTTPException(409,'Clauses / Paras can only be edited by the maker while the version is Draft.')
    values=payload.model_dump();level=1
    if not imported and not clause_id and values.get('code'):
        raise HTTPException(422,'Clause references are generated automatically. Enter the regulator’s numbering in Source clause / para number.')
    if not imported and values.get('sequence_number') is not None:
        raise HTTPException(422,'Clause order is managed automatically within the parent hierarchy.')
    if values['parent_clause_id']:
        parent=one(db,m.regulatory_clause,values['parent_clause_id'])
        if parent['instrument_version_id']!=version_id or parent['id']==clause_id: raise HTTPException(422,'Choose another parent clause / para in the same version.')
        seen={clause_id};current=parent
        while current:
            if current['id'] in seen: raise HTTPException(422,'Clause / Para hierarchy cannot contain a cycle.')
            seen.add(current['id']);current=one(db,m.regulatory_clause,current['parent_clause_id']) if current['parent_clause_id'] else None
        level=parent['clause_level']+1
    if clause_id:
        old=one(db,m.regulatory_clause,clause_id)
        if old['instrument_version_id']!=version_id or old['approval_status']!='DRAFT': raise HTTPException(409,'Clause / Para is not editable in this Draft.')
        if values.get('code') not in (None,old['code']): raise HTTPException(422,'Clause / Para codes are permanent.')
        if values['parent_clause_id']!=old['parent_clause_id'] and db.execute(sa.select(m.regulatory_clause.c.id).where(m.regulatory_clause.c.parent_clause_id==clause_id)).first():
            raise HTTPException(409,'A clause / para with children cannot be moved. Correct the Draft hierarchy before adding children.')
        values.pop('code')
        if values['parent_clause_id']==old['parent_clause_id']:
            values['sequence_number']=old['sequence_number']
        else:
            siblings=sa.select(sa.func.max(m.regulatory_clause.c.sequence_number)).where(
                m.regulatory_clause.c.instrument_version_id==version_id,
                m.regulatory_clause.c.parent_clause_id==values['parent_clause_id'],m.regulatory_clause.c.id!=clause_id)
            values['sequence_number']=(db.execute(siblings).scalar_one() or 0)+1
        db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.id==clause_id).values(**values,clause_level=level))
        identifier=clause_id
    else:
        if values['sequence_number'] is None:
            siblings=sa.select(sa.func.max(m.regulatory_clause.c.sequence_number)).where(
                m.regulatory_clause.c.instrument_version_id==version_id,
                m.regulatory_clause.c.parent_clause_id==values['parent_clause_id'])
            values['sequence_number']=(db.execute(siblings).scalar_one() or 0)+1
        values['code']=values.get('code') or next_code(db,'clause');identifier=new_id()
        db.execute(m.regulatory_clause.insert().values(id=identifier,instrument_version_id=version_id,clause_level=level,
            effective_from=version['effective_from'],created_by=actor.id,**values))
    audit(db,actor,'version',version_id,'CLAUSE_SAVED',new={**values,'clause_id':identifier})
    return {'id':identifier}

def submit(db,actor,version_id,payload):
    version,instrument=read_version(db,actor,version_id,lock=True);unit=instrument['regulatory_owner_unit_id'];actor.require({'AUTHOR'},unit)
    if version['created_by']!=actor.id or version['approval_status']!='DRAFT': raise HTTPException(409,'Only the maker can submit this Draft.')
    require_no_pending_version(db,instrument['id'],exclude_id=version_id)
    eligible(db,payload.reviewer_id,'REVIEWER',unit,(actor.id,));eligible(db,payload.approver_id,'APPROVER',unit,(actor.id,payload.reviewer_id))
    domain_ids=db.execute(sa.select(m.instrument_domain_map.c.domain_id).where(
        m.instrument_domain_map.c.instrument_id==instrument['id'],m.instrument_domain_map.c.effective_to.is_(None))).scalars().all()
    if instrument['primary_domain_id'] not in domain_ids: domain_ids.append(instrument['primary_domain_id'])
    for domain_id in domain_ids:
        domain=one(db,m.regulatory_domain,domain_id)
        if not domain['active_flag'] or not domain['domain_owner_unit_id']:
            raise HTTPException(422,'Every affected domain must have its bank-approved owning department assigned and review submissions enabled before this instrument can be submitted. Ask an Admin to complete setup in Administration → Master data → Regulatory domains → Set owner.')
    if not db.execute(sa.select(m.regulatory_clause.c.id).where(m.regulatory_clause.c.instrument_version_id==version_id)).first():
        raise HTTPException(422,'Add at least one source clause / para before submitting.')
    if not version['source_document_id']: raise HTTPException(422,'A source document is required.')
    workflow=new_id();at=now()
    db.execute(m.workflow_instance.insert().values(id=workflow,workflow_type='INSTRUMENT_VERSION',entity_type='version',entity_id=version_id,
        current_stage='COMPLIANCE_REVIEW',started_by=actor.id,started_at=at))
    for stage,assignee in [('COMPLIANCE_REVIEW',payload.reviewer_id),('FINAL_APPROVAL',payload.approver_id)]:
        db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow,stage=stage,assignee_user_id=assignee,due_at=at+timedelta(days=3)))
    db.execute(m.instrument_version.update().where(m.instrument_version.c.id==version_id).values(approval_status='IN_REVIEW',reviewed_by=None,reviewed_at=None,approved_by=None,approved_at=None))
    db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.instrument_version_id==version_id).values(approval_status='IN_REVIEW',reviewed_by=None,reviewed_at=None,approved_by=None,approved_at=None))
    if instrument['approval_status']!='APPROVED':
        db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==instrument['id']).values(approval_status='IN_REVIEW',reviewed_by=None,reviewed_at=None,approved_by=None,approved_at=None))
    history(db,actor,'version',version_id,'DRAFT','IN_REVIEW',payload.comments);audit(db,actor,'version',version_id,'SUBMITTED',new={'workflow_id':workflow},reason=payload.comments)
    notify(db,'version',version_id,payload.reviewer_id,'REVIEW_ASSIGNED',workflow+':REVIEW')
    return {'id':workflow}

def activate(db,actor,version_id):
    version,instrument=read_version(db,actor,version_id);actor.require({'APPROVER'},instrument['regulatory_owner_unit_id'])
    # All promotions serialize on the continuing instrument, including simultaneous requests.
    instrument=one(db,m.regulatory_instrument,instrument['id'],lock=True)
    version=one(db,m.instrument_version,version_id,lock=True)
    if version['approval_status']!='APPROVED' or version['effective_from']>date.today(): raise HTTPException(409,'Only an approved, effective version can become current.')
    if version['current_version_flag']: return {'id':version_id,'current':True}
    if version['effective_to'] is not None and version['effective_to']<=date.today(): raise HTTPException(409,'This version has already been superseded.')
    old=None
    if instrument['current_version_id']:
        old=one(db,m.instrument_version,instrument['current_version_id'])
        if version['supersedes_version_id']!=old['id'] or version['effective_from']<=old['effective_from']:
            raise HTTPException(409,'The current source has changed. A new version must explicitly supersede it.')
        db.execute(m.instrument_version.update().where(m.instrument_version.c.id==old['id']).values(current_version_flag=0,effective_to=version['effective_from']))
    elif version['supersedes_version_id']:
        raise HTTPException(409,'The superseded source must first be made current.')
    db.execute(m.instrument_version.update().where(m.instrument_version.c.id==version_id).values(current_version_flag=1))
    db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==instrument['id']).values(current_version_id=version_id,regulatory_status='CURRENT'))
    history(db,actor,'version',version_id,'APPROVED','CURRENT','Approved effective source activated')
    if old: history(db,actor,'version',old['id'],'CURRENT','SUPERSEDED','Superseded by '+version_id)
    audit(db,actor,'instrument',instrument['id'],'CURRENT_VERSION_CHANGED',old={'version_id':old['id'] if old else None},new={'version_id':version_id})
    return {'id':version_id,'current':True}

def decide(db,actor,version_id,payload):
    version,instrument=read_version(db,actor,version_id,lock=True);unit=instrument['regulatory_owner_unit_id']
    workflow=db.execute(sa.select(m.workflow_instance).where(m.workflow_instance.c.entity_type=='version',m.workflow_instance.c.entity_id==version_id,
        m.workflow_instance.c.record_status=='OPEN').with_for_update()).mappings().first()
    if not workflow: raise HTTPException(409,'No open workflow for this version.')
    decision=payload.decision
    task=db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage==workflow['current_stage'],m.workflow_action.c.decision.is_(None)).with_for_update()).mappings().first()
    if not task: raise HTTPException(409,'The decision task has already changed.')
    if decision=='WITHDRAW':
        actor.require({'AUTHOR'},unit)
        if version['created_by']!=actor.id: raise HTTPException(403,'Only the maker can withdraw the submission.')
        target='DRAFT'
    else:
        role='REVIEWER' if workflow['current_stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
        eligible(db,actor.id,role,unit,(version['created_by'],version['reviewed_by']) if role=='APPROVER' else (version['created_by'],))
        if task['assignee_user_id']!=actor.id: raise HTTPException(403,'Only the named task recipient can decide or delegate.')
        if decision=='DELEGATE':
            if not payload.delegate_user_id: raise HTTPException(422,'Select an eligible delegate.')
            other_tasks=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.id!=task['id'])).scalars().all()
            eligible(db,payload.delegate_user_id,role,unit,(actor.id,version['created_by'],version['reviewed_by'],*other_tasks))
            # Retain the original assignment, decision and delegated task separately.
            db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision='DELEGATED',acted_by=actor.id,acted_at=now(),comments=payload.comments))
            db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow['id'],stage=task['stage'],assignee_user_id=payload.delegate_user_id,due_at=task['due_at']))
            audit(db,actor,'version',version_id,'TASK_DELEGATED',old={'recipient':actor.id},new={'recipient':payload.delegate_user_id},reason=payload.comments)
            notify(db,'version',version_id,payload.delegate_user_id,'TASK_DELEGATED',workflow['id']+':DELEGATE:'+new_id())
            return {'ok':True}
        if decision=='REVIEW' and role=='REVIEWER': target='REVIEWED'
        elif decision=='APPROVE' and role=='APPROVER': target='APPROVED'
        elif decision=='RETURN': target='DRAFT'
        elif decision=='REJECT': target='REJECTED'
        else: raise HTTPException(409,'This decision does not match the current workflow stage.')
    at=now();values={'approval_status':target}
    if target=='DRAFT':values.update(reviewed_by=None,reviewed_at=None,approved_by=None,approved_at=None)
    if target=='REVIEWED': values.update(reviewed_by=actor.id,reviewed_at=at)
    if target=='APPROVED':
        if version['approval_status']!='REVIEWED': raise HTTPException(409,'Independent Compliance review must finish first.')
        values.update(approved_by=actor.id,approved_at=at)
    db.execute(m.instrument_version.update().where(m.instrument_version.c.id==version_id).values(**values))
    clause_values=dict(values)
    if target in {'REVIEWED','APPROVED'}:
        # Empty interpretations remain pending for Week 4 activation controls.
        for clause in db.execute(sa.select(m.regulatory_clause).where(m.regulatory_clause.c.instrument_version_id==version_id)).mappings():
            interpretation=target if clause['internal_interpretation'] else 'PENDING'
            db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.id==clause['id']).values(**clause_values,interpretation_status=interpretation))
    else:
        if target=='DRAFT':clause_values['interpretation_status']='PENDING'
        db.execute(m.regulatory_clause.update().where(m.regulatory_clause.c.instrument_version_id==version_id).values(**clause_values))
    if instrument['approval_status']!='APPROVED': db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==instrument['id']).values(**values))
    db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(decision=decision,acted_by=actor.id,acted_at=at,comments=payload.comments))
    if target=='REVIEWED':
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(current_stage='FINAL_APPROVAL'))
        recipient=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.stage=='FINAL_APPROVAL',m.workflow_action.c.decision.is_(None))).scalar_one()
        notify(db,'version',version_id,recipient,'APPROVAL_ASSIGNED',workflow['id']+':APPROVAL')
    else:
        closed_status='WITHDRAWN' if decision=='WITHDRAW' else 'RETURNED' if target=='DRAFT' else target
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(record_status=closed_status,current_stage='CLOSED',completed_at=at))
        notify(db,'version',version_id,version['created_by'],decision,workflow['id']+':'+decision)
    history(db,actor,'version',version_id,version['approval_status'],target,payload.comments)
    audit(db,actor,'version',version_id,decision,old={'status':version['approval_status']},new={'status':target},reason=payload.comments)
    if target=='APPROVED' and version['effective_from']<=date.today():
        # Approval can be retained while activation waits for a competing source to be resolved.
        current=one(db,m.regulatory_instrument,instrument['id'])['current_version_id']
        if current==version['supersedes_version_id'] or (current is None and version['supersedes_version_id'] is None): activate(db,actor,version_id)
    return {'status':target}


_METADATA_CORRECTION_FIELDS={
    'official_reference_number','title','short_title','applicability_date','materiality',
    'regulatory_owner_unit_id','interpretation_owner_user_id','keywords','secondary_domain_ids'}

def _canonical_metadata_value(value):
    if isinstance(value,date): return value.isoformat()
    if isinstance(value,(list,tuple)): return sorted(str(item) for item in value)
    return value

def _current_secondary_domains(db,instrument_id):
    return sorted(db.execute(sa.select(m.instrument_domain_map.c.domain_id).where(
        m.instrument_domain_map.c.instrument_id==instrument_id,
        m.instrument_domain_map.c.domain_role=='SECONDARY',
        m.instrument_domain_map.c.effective_to.is_(None))).scalars().all())

def _instrument_metadata_values(db,instrument,keys):
    values={}
    for key in keys:
        values[key]=_current_secondary_domains(db,instrument['id']) if key=='secondary_domain_ids' else _canonical_metadata_value(instrument[key])
    return values

def _validate_metadata_proposal(db,instrument,changes):
    resulting_unit=changes.get('regulatory_owner_unit_id',instrument['regulatory_owner_unit_id'])
    if 'regulatory_owner_unit_id' in changes: active(db,m.organisational_unit,resulting_unit)
    if 'interpretation_owner_user_id' in changes or 'regulatory_owner_unit_id' in changes:
        eligible(db,changes.get('interpretation_owner_user_id',instrument['interpretation_owner_user_id']),
            'AUTHOR',resulting_unit)
    if 'official_reference_number' in changes:
        reference=changes['official_reference_number']
        if reference:
            one(db,m.regulator,instrument['regulator_id'],lock=True)
            duplicate=db.execute(sa.select(m.regulatory_instrument.c.id).where(
                m.regulatory_instrument.c.id!=instrument['id'],
                m.regulatory_instrument.c.regulator_id==instrument['regulator_id'],
                sa.func.upper(sa.func.trim(m.regulatory_instrument.c.official_reference_number))==reference.upper())).first()
            if duplicate: raise HTTPException(409,'The official reference is already registered for this regulator.')
    if 'secondary_domain_ids' in changes:
        selected=validate_instrument_domains(db,instrument['primary_domain_id'],changes['secondary_domain_ids'])
        all_domains=[instrument['primary_domain_id'],*selected]
        for domain_id in all_domains:
            domain=one(db,m.regulatory_domain,domain_id)
            if not domain['active_flag'] or not domain['domain_owner_unit_id']:
                raise HTTPException(422,'Every assigned domain needs an active bank-approved owner before the assignment can change.')
        changes['secondary_domain_ids']=sorted(selected)
    return resulting_unit

def request_metadata_correction(db,actor,instrument_id,payload):
    instrument=read_instrument(db,actor,instrument_id,lock=True)
    unit=instrument['regulatory_owner_unit_id'];actor.require({'AUTHOR'},unit)
    if instrument['approval_status']!='APPROVED':
        raise HTTPException(409,'Metadata corrections are available only after the instrument is approved.')
    open_request=db.execute(sa.select(m.metadata_correction.c.id).where(
        m.metadata_correction.c.instrument_id==instrument_id,
        m.metadata_correction.c.correction_status.in_(['IN_REVIEW','REVIEWED']))).first()
    if open_request:
        raise HTTPException(409,'Resolve the existing metadata correction request before submitting another one.')
    supplied=payload.model_dump(exclude_unset=True)
    reviewer_id=supplied.pop('reviewer_id');approver_id=supplied.pop('approver_id');reason=supplied.pop('reason').strip()
    unknown=set(supplied)-_METADATA_CORRECTION_FIELDS
    if unknown: raise HTTPException(422,'This field must be changed through a new source version or an administrator-controlled process.')
    changes={}
    for key,value in supplied.items():
        if key=='secondary_domain_ids':
            value=value or []
            if len(value)!=len(set(value)):
                raise HTTPException(422,'Choose each additional regulatory domain only once.')
            value=sorted(value)
        elif key in {'official_reference_number','short_title','keywords'}: value=(value or '').strip() or None
        elif key=='title':
            value=(value or '').strip()
            if not value: raise HTTPException(422,'Title cannot be empty.')
        changes[key]=_canonical_metadata_value(value)
    if not changes: raise HTTPException(422,'Change at least one supported metadata field.')
    before=_instrument_metadata_values(db,instrument,changes.keys())
    changes={key:value for key,value in changes.items() if _canonical_metadata_value(value)!=before[key]}
    if not changes: raise HTTPException(422,'The proposed values are identical to the approved record.')
    new_unit=_validate_metadata_proposal(db,instrument,changes)
    if new_unit!=unit: actor.require({'AUTHOR'},new_unit)
    eligible(db,reviewer_id,'REVIEWER',unit,(actor.id,))
    eligible(db,approver_id,'APPROVER',unit,(actor.id,reviewer_id))
    correction_id=new_id();workflow_id=new_id();at=now()
    db.execute(m.metadata_correction.insert().values(id=correction_id,instrument_id=instrument_id,
        before_values_json=json.dumps(before,default=str),proposed_values_json=json.dumps(changes,default=str),
        reason=reason,created_by=actor.id,reviewer_id=reviewer_id,approver_id=approver_id,
        correction_status='IN_REVIEW'))
    db.execute(m.workflow_instance.insert().values(id=workflow_id,workflow_type='METADATA_CORRECTION',
        entity_type='metadata_correction',entity_id=correction_id,current_stage='COMPLIANCE_REVIEW',
        started_by=actor.id,started_at=at))
    for stage,assignee in [('COMPLIANCE_REVIEW',reviewer_id),('FINAL_APPROVAL',approver_id)]:
        db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow_id,stage=stage,
            assignee_user_id=assignee,due_at=at+timedelta(days=3)))
    history(db,actor,'metadata_correction',correction_id,None,'IN_REVIEW',reason)
    audit(db,actor,'metadata_correction',correction_id,'CORRECTION_SUBMITTED',
        old=before,new={'proposed':changes,'instrument_id':instrument_id,'target_owner_unit_id':new_unit},reason=reason)
    notify(db,'metadata_correction',correction_id,reviewer_id,'REVIEW_ASSIGNED',workflow_id+':REVIEW')
    return {'id':correction_id,'workflow_id':workflow_id}

def _apply_metadata_correction(db,actor,instrument,correction,at):
    changes=json.loads(correction['proposed_values_json']);before=json.loads(correction['before_values_json'])
    current=_instrument_metadata_values(db,instrument,before.keys())
    if current!=before:
        raise HTTPException(409,'This request is based on older metadata. Return it and submit a fresh correction against the current record.')
    new_unit=_validate_metadata_proposal(db,instrument,changes)
    if 'secondary_domain_ids' in changes:
        desired=set(changes['secondary_domain_ids']);today=at.date()
        mappings=db.execute(sa.select(m.instrument_domain_map).where(
            m.instrument_domain_map.c.instrument_id==instrument['id'],
            m.instrument_domain_map.c.domain_role=='SECONDARY',
            m.instrument_domain_map.c.effective_to.is_(None)).with_for_update()).mappings().all()
        open_ids={r['domain_id'] for r in mappings}
        for mapping in mappings:
            if mapping['domain_id'] not in desired:
                db.execute(m.instrument_domain_map.update().where(m.instrument_domain_map.c.id==mapping['id']).values(
                    effective_to=max(today,mapping['effective_from'])))
        for domain_id in sorted(desired-open_ids):
            duplicate=db.execute(sa.select(m.instrument_domain_map.c.id).where(
                m.instrument_domain_map.c.instrument_id==instrument['id'],
                m.instrument_domain_map.c.domain_id==domain_id,
                m.instrument_domain_map.c.effective_from==today)).first()
            if duplicate:
                raise HTTPException(409,'This domain was already changed today. Retry the correction on the next business day to preserve effective-dated history.')
            db.execute(m.instrument_domain_map.insert().values(id=new_id(),instrument_id=instrument['id'],
                domain_id=domain_id,domain_role='SECONDARY',effective_from=today))
    instrument_changes={key:date.fromisoformat(value) if key=='applicability_date' and value else value
        for key,value in changes.items() if key!='secondary_domain_ids'}
    if instrument_changes:
        db.execute(m.regulatory_instrument.update().where(m.regulatory_instrument.c.id==instrument['id']).values(**instrument_changes))
    audit(db,actor,'instrument',instrument['id'],'METADATA_CORRECTION_APPLIED',old=before,new=changes,reason=correction['reason'])
    return new_unit

def decide_metadata_correction(db,actor,correction_id,payload):
    correction=one(db,m.metadata_correction,correction_id,lock=True)
    instrument=read_instrument(db,actor,correction['instrument_id'],lock=True)
    unit=instrument['regulatory_owner_unit_id']
    workflow=db.execute(sa.select(m.workflow_instance).where(
        m.workflow_instance.c.entity_type=='metadata_correction',m.workflow_instance.c.entity_id==correction_id,
        m.workflow_instance.c.record_status=='OPEN').with_for_update()).mappings().first()
    if not workflow: raise HTTPException(409,'No open workflow exists for this metadata correction.')
    task=db.execute(sa.select(m.workflow_action).where(m.workflow_action.c.instance_id==workflow['id'],
        m.workflow_action.c.stage==workflow['current_stage'],m.workflow_action.c.decision.is_(None)).with_for_update()).mappings().first()
    if not task: raise HTTPException(409,'The decision task has already changed.')
    decision=payload.decision
    if decision=='WITHDRAW':
        actor.require({'AUTHOR'},unit)
        if correction['created_by']!=actor.id: raise HTTPException(403,'Only the maker can withdraw this correction request.')
        target='WITHDRAWN'
    else:
        role='REVIEWER' if workflow['current_stage']=='COMPLIANCE_REVIEW' else 'APPROVER'
        excluded=(correction['created_by'],) if role=='REVIEWER' else (correction['created_by'],correction['reviewed_by'])
        eligible(db,actor.id,role,unit,excluded)
        if task['assignee_user_id']!=actor.id: raise HTTPException(403,'Only the named task recipient can decide or delegate.')
        if decision=='DELEGATE':
            if not payload.delegate_user_id: raise HTTPException(422,'Select an eligible delegate.')
            other_tasks=db.execute(sa.select(m.workflow_action.c.assignee_user_id).where(
                m.workflow_action.c.instance_id==workflow['id'],m.workflow_action.c.id!=task['id'])).scalars().all()
            eligible(db,payload.delegate_user_id,role,unit,(actor.id,correction['created_by'],
                correction['reviewed_by'],*other_tasks))
            db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(
                decision='DELEGATED',acted_by=actor.id,acted_at=now(),comments=payload.comments))
            db.execute(m.workflow_action.insert().values(id=new_id(),instance_id=workflow['id'],stage=task['stage'],
                assignee_user_id=payload.delegate_user_id,due_at=task['due_at']))
            audit(db,actor,'metadata_correction',correction_id,'TASK_DELEGATED',
                old={'recipient':actor.id},new={'recipient':payload.delegate_user_id},reason=payload.comments)
            notify(db,'metadata_correction',correction_id,payload.delegate_user_id,'TASK_DELEGATED',workflow['id']+':DELEGATE:'+new_id())
            return {'ok':True}
        if decision=='REVIEW' and role=='REVIEWER': target='REVIEWED'
        elif decision=='APPROVE' and role=='APPROVER': target='APPROVED'
        elif decision=='RETURN': target='RETURNED'
        elif decision=='REJECT': target='REJECTED'
        else: raise HTTPException(409,'This decision does not match the current workflow stage.')
    at=now()
    if target=='REVIEWED':
        db.execute(m.metadata_correction.update().where(m.metadata_correction.c.id==correction_id).values(
            correction_status=target,reviewed_by=actor.id,reviewed_at=at))
        db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(
            decision=decision,acted_by=actor.id,acted_at=at,comments=payload.comments))
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(current_stage='FINAL_APPROVAL'))
        notify(db,'metadata_correction',correction_id,correction['approver_id'],'APPROVAL_ASSIGNED',workflow['id']+':APPROVAL')
    else:
        if target=='APPROVED':
            if correction['correction_status']!='REVIEWED': raise HTTPException(409,'Independent Compliance review must finish first.')
            _apply_metadata_correction(db,actor,instrument,correction,at)
            db.execute(m.metadata_correction.update().where(m.metadata_correction.c.id==correction_id).values(
                correction_status=target,approved_by=actor.id,approved_at=at))
        else:
            db.execute(m.metadata_correction.update().where(m.metadata_correction.c.id==correction_id).values(correction_status=target))
        db.execute(m.workflow_action.update().where(m.workflow_action.c.id==task['id']).values(
            decision=decision,acted_by=actor.id,acted_at=at,comments=payload.comments))
        workflow_status='RETURNED' if target=='RETURNED' else target
        db.execute(m.workflow_instance.update().where(m.workflow_instance.c.id==workflow['id']).values(
            record_status=workflow_status,current_stage='CLOSED',completed_at=at))
        notify(db,'metadata_correction',correction_id,correction['created_by'],decision,workflow['id']+':'+decision)
    history(db,actor,'metadata_correction',correction_id,correction['correction_status'],target,payload.comments)
    audit(db,actor,'metadata_correction',correction_id,decision,
        old={'status':correction['correction_status']},new={'status':target},reason=payload.comments)
    return {'status':target}


def listing(db,actor,filters):
    try:
        for key in ['from_date','to_date']:
            if filters.get(key): date.fromisoformat(filters[key])
    except ValueError as exc:raise HTTPException(422,'Search dates must use YYYY-MM-DD.') from exc
    current_version=m.instrument_version.alias('current_version')
    rows=db.execute(sa.select(m.regulatory_instrument,m.regulator.c.name.label('regulator_name'),
        m.regulatory_domain.c.name.label('domain_name'),m.instrument_type.c.name.label('type_name'),
        m.confidentiality_class.c.rank_number.label('confidentiality_rank'),
        current_version.c.version_number.label('current_version_number'))
        .join(m.regulator,m.regulator.c.id==m.regulatory_instrument.c.regulator_id)
        .join(m.regulatory_domain,m.regulatory_domain.c.id==m.regulatory_instrument.c.primary_domain_id)
        .join(m.instrument_type,m.instrument_type.c.id==m.regulatory_instrument.c.instrument_type_id)
        .join(m.confidentiality_class,m.confidentiality_class.c.id==m.regulatory_instrument.c.confidentiality_class_id)
        .outerjoin(current_version,current_version.c.id==m.regulatory_instrument.c.current_version_id)
        .order_by(m.regulatory_instrument.c.created_at.desc())).mappings().all()
    result=[]
    mapping_rows=db.execute(sa.select(m.instrument_domain_map.c.instrument_id,
        m.instrument_domain_map.c.domain_id,m.instrument_domain_map.c.domain_role,m.regulatory_domain.c.name.label('mapped_domain_name'))
        .join(m.regulatory_domain,m.regulatory_domain.c.id==m.instrument_domain_map.c.domain_id)
        .where(m.instrument_domain_map.c.effective_to.is_(None))).mappings().all()
    mappings_by_instrument={}
    for mapping in mapping_rows:
        mappings_by_instrument.setdefault(mapping['instrument_id'],[]).append(dict(mapping))
    for raw in rows:
        row=dict(raw)
        if not can_read_instrument(actor,row,row['confidentiality_rank']): continue
        mappings=mappings_by_instrument.get(row['id'],[])
        domain_ids={mapping['domain_id'] for mapping in mappings}
        domain_ids.add(row['primary_domain_id'])
        domain_filter=filters.get('domain_id') or filters.get('primary_domain_id')
        if domain_filter and domain_filter not in domain_ids: continue
        if any(filters.get(k) and row.get(k)!=filters[k] for k in ['regulator_id','instrument_type_id','approval_status','regulatory_status','regulatory_owner_unit_id','interpretation_owner_user_id','materiality']): continue
        if filters.get('from_date') and row['issue_date']<date.fromisoformat(filters['from_date']):continue
        if filters.get('to_date') and row['issue_date']>date.fromisoformat(filters['to_date']):continue
        haystack=' '.join(str(row.get(k) or '') for k in ['code','official_reference_number','title','short_title','keywords']).casefold()
        if filters.get('q','').casefold() not in haystack: continue
        secondary_names=sorted({mapping['mapped_domain_name'] for mapping in mappings
            if mapping['domain_role']=='SECONDARY' and mapping['domain_id']!=row['primary_domain_id']})
        row['secondary_domain_names']=secondary_names
        row['domain_ids']=sorted(domain_ids)
        result.append(row)
    return result


def source_edition_listing(db,actor):
    """Authorised edition metadata, including sources with no captured clauses."""
    visible_ids=[row['id'] for row in listing(db,actor,{})]
    if not visible_ids: return []
    rows=[dict(row) for row in db.execute(sa.select(m.instrument_version)
        .where(m.instrument_version.c.instrument_id.in_(visible_ids))
        .order_by(m.instrument_version.c.instrument_id,m.instrument_version.c.effective_from.desc(),
            m.instrument_version.c.id)).mappings()]
    # Use a subquery rather than a potentially unbounded list of edition IDs.
    cancelled=set(db.execute(sa.select(m.audit_log.c.entity_id).where(
        m.audit_log.c.entity_type=='version',m.audit_log.c.action=='DRAFT_CANCELLED',
        m.audit_log.c.entity_id.in_(sa.select(m.instrument_version.c.id)
            .where(m.instrument_version.c.instrument_id.in_(visible_ids))))).scalars())
    return [{**row,'cancelled_draft':row['id'] in cancelled} for row in rows]


def clause_listing(db,actor):
    # Reuse the repository's instrument visibility rules before loading any clause data.
    visible_ids=[row['id'] for row in listing(db,actor,{})]
    if not visible_ids: return []
    parent=m.regulatory_clause.alias('parent_clause')
    rows=db.execute(sa.select(m.regulatory_clause,
        m.instrument_version.c.instrument_id,
        m.instrument_version.c.version_number,
        m.instrument_version.c.approval_status.label('version_approval_status'),
        m.instrument_version.c.current_version_flag.label('version_current_flag'),
        m.regulatory_instrument.c.code.label('instrument_code'),
        m.regulatory_instrument.c.title.label('instrument_title'),
        m.regulatory_instrument.c.short_title.label('instrument_short_title'),
        m.regulatory_instrument.c.official_reference_number,
        m.regulator.c.code.label('regulator_code'),
        m.regulator.c.name.label('regulator_name'),
        m.regulatory_domain.c.name.label('domain_name'),
        parent.c.code.label('parent_code'))
        .join(m.instrument_version,m.instrument_version.c.id==m.regulatory_clause.c.instrument_version_id)
        .join(m.regulatory_instrument,m.regulatory_instrument.c.id==m.instrument_version.c.instrument_id)
        .join(m.regulator,m.regulator.c.id==m.regulatory_instrument.c.regulator_id)
        .join(m.regulatory_domain,m.regulatory_domain.c.id==m.regulatory_instrument.c.primary_domain_id)
        .outerjoin(parent,parent.c.id==m.regulatory_clause.c.parent_clause_id)
        .where(m.instrument_version.c.instrument_id.in_(visible_ids))
        .order_by(m.regulatory_instrument.c.title,m.instrument_version.c.version_date.desc(),
            m.regulatory_clause.c.sequence_number,m.regulatory_clause.c.code)).mappings().all()
    return [dict(row) for row in rows]


def detail(db,actor,identifier):
    row=read_instrument(db,actor,identifier)
    versions=[dict(v) for v in db.execute(sa.select(m.instrument_version).where(m.instrument_version.c.instrument_id==identifier).order_by(m.instrument_version.c.effective_from.desc())).mappings()]
    version_ids=[v['id'] for v in versions]
    source_document_ids={v['source_document_id'] for v in versions if v['source_document_id']}
    source_documents={r['id']:r['file_name'] for r in db.execute(sa.select(m.document.c.id,m.document.c.file_name).where(m.document.c.id.in_(source_document_ids))).mappings()} if source_document_ids else {}
    secondary_domains=[dict(r) for r in db.execute(sa.select(m.regulatory_domain.c.id,m.regulatory_domain.c.code,m.regulatory_domain.c.name)
        .join(m.instrument_domain_map,m.instrument_domain_map.c.domain_id==m.regulatory_domain.c.id)
        .where(m.instrument_domain_map.c.instrument_id==identifier,m.instrument_domain_map.c.domain_role=='SECONDARY',
            m.instrument_domain_map.c.effective_to.is_(None))
        .order_by(m.regulatory_domain.c.name)).mappings()]
    clauses=[dict(c) for c in db.execute(sa.select(m.regulatory_clause).where(m.regulatory_clause.c.instrument_version_id.in_(version_ids)).order_by(m.regulatory_clause.c.sequence_number)).mappings()]
    clause_ids=[c['id'] for c in clauses]
    clause_relationships=[dict(r) for r in db.execute(sa.select(m.clause_relationship).where(
        m.clause_relationship.c.source_clause_id.in_(clause_ids),
        m.clause_relationship.c.target_clause_id.in_(clause_ids)).order_by(
            m.clause_relationship.c.effective_from.desc())).mappings()] if clause_ids else []
    tasks=[dict(t) for t in db.execute(sa.select(m.workflow_action,m.workflow_instance.c.current_stage,m.workflow_instance.c.record_status.label('workflow_status'),m.workflow_instance.c.entity_id)
        .join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id).where(m.workflow_instance.c.entity_type=='version',m.workflow_instance.c.entity_id.in_(version_ids))).mappings()]
    metadata_corrections=[dict(r) for r in db.execute(sa.select(m.metadata_correction).where(
        m.metadata_correction.c.instrument_id==identifier).order_by(m.metadata_correction.c.created_at.desc())).mappings()]
    correction_ids=[r['id'] for r in metadata_corrections]
    if correction_ids:
        correction_tasks=[dict(t) for t in db.execute(sa.select(m.workflow_action,
            m.workflow_instance.c.current_stage,m.workflow_instance.c.record_status.label('workflow_status'),
            m.workflow_instance.c.entity_id,m.workflow_instance.c.workflow_type)
            .join(m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id)
            .where(m.workflow_instance.c.entity_type=='metadata_correction',
                m.workflow_instance.c.entity_id.in_(correction_ids))).mappings()]
        tasks.extend(correction_tasks)
    entities=[identifier,*version_ids,*correction_ids]
    audit_rows=[dict(r) for r in db.execute(sa.select(m.audit_log).where(m.audit_log.c.entity_id.in_(entities)).order_by(m.audit_log.c.event_at.desc())).mappings()]
    cancellations={r['entity_id']:r for r in audit_rows if r['entity_type']=='version' and r['action']=='DRAFT_CANCELLED'}
    for version in versions:
        cancellation=cancellations.get(version['id'])
        version.update(cancelled_draft=bool(cancellation),cancellation_reason=cancellation['reason'] if cancellation else None,
            cancelled_by=cancellation['actor_user_id'] if cancellation else None,cancelled_at=cancellation['event_at'] if cancellation else None)
    statuses=[dict(r) for r in db.execute(sa.select(m.status_history).where(m.status_history.c.entity_id.in_(entities)).order_by(m.status_history.c.changed_at.desc())).mappings()]
    comments=[dict(r) for r in db.execute(sa.select(m.comment).where(m.comment.c.entity_id==identifier).order_by(m.comment.c.created_at)).mappings()]
    carried=[dict(r) for r in db.execute(sa.select(m.clause_carry_forward).where(m.clause_carry_forward.c.target_version_id.in_(version_ids))).mappings()] if version_ids else []
    return {'instrument':row,'versions':versions,'secondary_domains':secondary_domains,'source_documents':source_documents,'clause_carry_forward':carried,
        'clauses':clauses,'clause_relationships':clause_relationships,'tasks':tasks,
        'metadata_corrections':metadata_corrections,'audit':audit_rows,'history':statuses,'comments':comments}
