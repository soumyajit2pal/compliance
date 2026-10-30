"""Copy verified source clauses into a maker's Draft without crossing parent edges."""
import sqlalchemy as sa
from fastapi import HTTPException
from . import models as m, repository as repo
from .events import new_id,audit

def candidates(db,actor,version_id):
    version,instrument=repo.read_version(db,actor,version_id)
    actor.require({'AUTHOR'},instrument['regulatory_owner_unit_id'])
    if version['approval_status']!='DRAFT' or version['created_by']!=actor.id:
        raise HTTPException(409,'Only the maker can carry clauses into a Draft edition.')
    versions={row['id']:dict(row) for row in db.execute(sa.select(m.instrument_version).where(
        m.instrument_version.c.instrument_id==instrument['id'],m.instrument_version.c.approval_status=='APPROVED',
        m.instrument_version.c.effective_from<version['effective_from'])).mappings()}
    clauses=[dict(row) for row in db.execute(sa.select(m.regulatory_clause).where(
        m.regulatory_clause.c.instrument_version_id.in_(list(versions)),m.regulatory_clause.c.approval_status=='APPROVED',
        m.regulatory_clause.c.clause_status!='DELETED')).mappings()] if versions else []
    copied={row['source_clause_id']:row['target_clause_id'] for row in db.execute(sa.select(m.clause_carry_forward).where(
        m.clause_carry_forward.c.target_version_id==version_id)).mappings()}
    return {'versions':list(versions.values()),'clauses':clauses,'already_carried':copied}

def carry(db,actor,version_id,payload):
    version,instrument=repo.read_version(db,actor,version_id,lock=True)
    available=candidates(db,actor,version_id)
    if not payload.verified_in_target_source:
        raise HTTPException(422,'Confirm the wording and every citation against the target source document.')
    by_id={row['id']:row for row in available['clauses']}
    source=by_id.get(payload.source_clause_id)
    if not source: raise HTTPException(422,'Choose an approved earlier clause of this instrument.')
    chain=[];seen=set();current=source
    while current:
        if current['id'] in seen: raise HTTPException(422,'The earlier hierarchy contains a cycle.')
        seen.add(current['id']);chain.append(current)
        parent_id=current['parent_clause_id'];current=by_id.get(parent_id)
        if parent_id and (not current or current['instrument_version_id']!=source['instrument_version_id']):
            raise HTTPException(422,'The complete approved ancestor chain is required.')
    chain.reverse();copies=available['already_carried']
    entries={entry.source_clause_id:entry for entry in payload.entries}
    if len(entries)!=len(payload.entries) or set(entries)!={row['id'] for row in chain if row['id'] not in copies}:
        raise HTTPException(422,'Verify exactly the missing parent chain, from its root to the selected clause.')
    parent=None;created=[]
    for old in chain:
        if old['id'] in copies:
            existing=repo.one(db,m.regulatory_clause,copies[old['id']])
            if existing['instrument_version_id']!=version_id or existing['parent_clause_id']!=parent:
                raise HTTPException(409,'A carried parent has changed; review the Draft hierarchy before reusing it.')
            parent=existing['id'];continue
        entry=entries[old['id']]
        values=entry.model_dump(exclude={'source_clause_id'})
        values.update(parent_clause_id=parent,internal_interpretation=None,
            **{key:bool(old[key]) for key in ['mandatory_flag','conditional_flag','reporting_flag','disclosure_flag','retention_flag']})
        from .schemas import ClauseInput
        target=repo.add_clause(db,actor,version_id,ClauseInput(**values))['id']
        db.execute(m.clause_carry_forward.insert().values(id=new_id(),source_clause_id=old['id'],target_clause_id=target,
            target_version_id=version_id,created_by=actor.id,basis=payload.basis))
        copies[old['id']]=target;created.append(target);parent=target
    audit(db,actor,'version',version_id,'CLAUSE_CHAIN_CARRIED',new={'source_clause_id':source['id'],'target_clause_id':parent,'created_clause_ids':created},reason=payload.basis)
    return {'id':parent,'created_clause_ids':created,'instrument_id':instrument['id'],'version_id':version_id}
