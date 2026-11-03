"""One immutable, contextual business-code convention and legacy lookup boundary."""
import hashlib,re
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from . import models as m
from .events import new_id

TABLES={'instrument':m.regulatory_instrument,'clause':m.regulatory_clause,'obligation':m.compliance_obligation}
FIELDS={'instrument':'instrument_id','clause':'clause_id','obligation':'obligation_id'}


def instrument_prefix(regulator,domain,instrument_type,issue_date):
    parts=[str(value).strip().upper() for value in [regulator,domain,instrument_type]]
    if any(not re.fullmatch(r'[A-Z0-9][A-Z0-9._/-]*',part) for part in parts):
        raise ValueError('Business identifiers require valid regulator/domain/type master codes.')
    return 'INS-'+'-'.join(parts)+'-'+str(issue_date.year)


def counter_key(kind,prefix):
    return 'business-'+kind+':'+hashlib.sha256(prefix.encode()).hexdigest()[:40]


def allocate(db,kind,prefix):
    """A unique scoped counter serializes independent transactions, including first use."""
    table=TABLES[kind];key=counter_key(kind,prefix)
    query=sa.select(m.id_counter).where(m.id_counter.c.entity_type==key).with_for_update()
    row=db.execute(query).mappings().first()
    if not row:
        existing=db.execute(sa.select(table.c.code).where(table.c.code.startswith(prefix,autoescape=True))).scalars()
        numbers=[int(code[len(prefix):]) for code in existing if re.fullmatch(r'\d+',code[len(prefix):])]
        try:
            with db.begin_nested():
                db.execute(m.id_counter.insert().values(id=new_id(),entity_type=key,prefix=kind.upper(),next_value=max(numbers,default=0)+1))
        except IntegrityError as exc:
            if 'ORA-00001' not in str(exc):raise
        row=db.execute(query).mappings().one()
    number=row['next_value']
    db.execute(m.id_counter.update().where(m.id_counter.c.id==row['id']).values(next_value=number+1))
    code=prefix+f'{number:03d}'
    if len(code)>200:raise HTTPException(422,'The generated business reference exceeds 200 characters.')
    return code


def instrument(db,regulator,domain,instrument_type,issue_date):
    return allocate(db,'instrument',instrument_prefix(regulator,domain,instrument_type,issue_date)+'-')


def clause(db,instrument_code):return allocate(db,'clause',instrument_code+'-C')
def obligation(db,clause_code):return allocate(db,'obligation',clause_code+'-OBL-')


def aliases(db,kind,identifiers=None):
    field=m.business_code_alias.c[FIELDS[kind]]
    query=sa.select(field,m.business_code_alias.c.legacy_code).where(field.is_not(None))
    if identifiers is not None:
        if not identifiers:return {}
        values=list(identifiers)
        query=query.where(sa.or_(*[field.in_(values[start:start+900]) for start in range(0,len(values),900)]))
    result={}
    for identifier,code in db.execute(query):result.setdefault(identifier,[]).append(code)
    return {identifier:sorted(set(codes),key=str.casefold) for identifier,codes in result.items()}


def resolve(db,kind,value,*,version_id=None):
    """Resolve UUID/current/legacy code; never choose among ambiguous source editions."""
    table=TABLES[kind];field=m.business_code_alias.c[FIELDS[kind]];text=str(value).strip()
    old_ids=sa.select(field).where(sa.func.upper(m.business_code_alias.c.legacy_code)==text.upper(),field.is_not(None))
    query=sa.select(table.c.id).where(sa.or_(table.c.id==text,sa.func.upper(table.c.code)==text.upper(),table.c.id.in_(old_ids)))
    if kind=='clause' and version_id:query=query.where(table.c.instrument_version_id==version_id)
    matches=list(dict.fromkeys(db.execute(query).scalars()))
    if len(matches)>1:raise HTTPException(422,'This legacy reference identifies multiple editions. Use an exact record UUID or select its source edition.')
    return matches[0] if matches else None


def retain_alias(db,kind,identifier,legacy_code,canonical_code):
    if not legacy_code or legacy_code==canonical_code:return
    if kind=='clause':
        version=db.execute(sa.select(m.regulatory_clause.c.instrument_version_id).where(m.regulatory_clause.c.id==identifier)).scalar_one()
        existing=resolve(db,'clause',legacy_code,version_id=version)
        if existing and existing!=identifier:raise HTTPException(409,'This legacy clause reference already belongs to another clause in the same edition.')
    field=m.business_code_alias.c[FIELDS[kind]]
    if db.execute(sa.select(m.business_code_alias.c.id).where(field==identifier,m.business_code_alias.c.legacy_code==legacy_code)).first():return
    db.execute(m.business_code_alias.insert().values(id=new_id(),**{FIELDS[kind]:identifier},legacy_code=legacy_code,canonical_code=canonical_code))
