"""Retained Excel lineage, independent import review and Draft-only obligation loads."""
import hashlib,io,json,zipfile,re
from datetime import date,datetime
from pathlib import Path
from collections import defaultdict,Counter
import sqlalchemy as sa
from fastapi import HTTPException
from openpyxl import load_workbook
from pydantic import ValidationError
from . import models as m,obligations as service,repository as repo,business_ids
from .obligation_schemas import ObligationInput
from .migration_service import require_migration
from .events import new_id,now,audit
from . import obligation_import_template as excel
from .import_workbook import fill_reference_lists
from .import_choices import current_master
from .config import ROOT

SHEETS=excel.SHEETS
LOOKUPS={'primary_clause_id':m.regulatory_clause,'category_id':m.obligation_category,'frequency_id':m.frequency,
 'primary_domain_id':m.regulatory_domain,'regulatory_owner_unit_id':m.organisational_unit,'business_owner_unit_id':m.organisational_unit,
 'compliance_reviewer_user_id':m.user,'org_unit_id':m.organisational_unit,'user_id':m.user,'legal_entity_id':m.legal_entity,
 'product_id':m.product,'process_id':m.process,'channel_id':m.channel,'customer_segment_id':m.customer_segment,'geography_id':m.geography}


def require(actor,roles={'AUTHOR','REVIEWER'}):require_migration(actor,roles)


def template(db,actor):
    choices={key:[] for key in excel.CHOICE_KEYS};references=[]
    for key in choices:
        if key in excel.ENUMS:choices[key]=list(excel.ENUMS[key]);continue
        if key=='yes_no':choices[key]=['Yes','No'];continue
        table=LOOKUPS[key]
        if table is m.regulatory_clause:
            for row in repo.clause_listing(db,actor):
                if row['approval_status']!='APPROVED' or row['version_approval_status']!='APPROVED':continue
                display=f"{row.get('source_clause_reference') or 'Unnumbered'} · {(row.get('heading') or row.get('instrument_title') or 'Source clause')[:90]} · edition {row['version_number']} [{row['code']}]"
                choices[key].append(display);references.append(['Primary / supporting clause',display,row['code'],row['instrument_title']])
        else:
            rows=[dict(row) for row in db.execute(sa.select(table)).mappings() if current_master(row)]
            names=Counter(str(row.get('name') or '').casefold() for row in rows)
            for row in rows:
                code=row.get('username') or row.get('code');name=row.get('full_name') or row.get('name') or code
                display=f'{name} ({code})' if table is m.user or names[str(name).casefold()]>1 else name
                choices[key].append(display);references.append([excel.CHOICE_LABELS[key],display,code,name])
        choices[key].sort(key=str.casefold)
    validations={}
    for sheet,fields in SHEETS.items():
        columns={}
        for index,key in enumerate(fields):
            choice='org_unit_id' if key in {'regulatory_owner_unit_id','business_owner_unit_id'} else 'user_id' if key=='compliance_reviewer_user_id' else 'yes_no' if key.endswith('_flag') else key
            if choice in choices:columns[chr(65+index)]=choice
        validations[sheet]=columns
    return fill_reference_lists((ROOT/'backend/templates/obligation-import-template.xlsx').read_bytes(),choices,validations,references)


def parse(filename,data):
    if not filename.lower().endswith('.xlsx'):raise HTTPException(422,'Use the obligation Excel template (.xlsx).')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(item.file_size for item in archive.infolist())>50*1024*1024:raise ValueError('Expanded workbook too large')
            if any('vbaProject' in item.filename or item.filename.startswith('xl/externalLinks/') for item in archive.infolist()):raise ValueError('Active content is not supported')
        book=load_workbook(io.BytesIO(data),read_only=True,data_only=False,keep_links=False)
        result=[]
        try:
            if 'Obligations' not in book.sheetnames or set(book.sheetnames)-set(SHEETS)-excel.GUIDANCE_SHEETS:raise ValueError('Use the template sheet names')
            for name,allowed in SHEETS.items():
                if name not in book.sheetnames:continue
                iterator=book[name].iter_rows();header=next(iterator,())
                source_headers=[str(c.value or '').strip() for c in header]
                fields=[excel.canonical_header(name,value) for value in source_headers]
                if len(fields)>60 or len(fields)!=len(set(fields)) or any(f not in allowed for f in fields):raise ValueError(name+': unknown or repeated column. Keep the downloaded column labels.')
                for number,cells in enumerate(iterator,2):
                    if not any(c.value is not None for c in cells):continue
                    if any(c.data_type=='f' for c in cells):raise ValueError('Formula cells are not allowed')
                    raw={key:(c.value.date().isoformat() if isinstance(c.value,datetime) else c.value.isoformat() if isinstance(c.value,date) else c.value) for key,c in zip(fields,cells)}
                    result.append({'sheet':name,'number':number,'raw':raw,'source_values':dict(zip(source_headers,raw.values()))})
                    if len(result)>10000:raise ValueError('Too many rows')
        finally:book.close()
        if not result or sum(r['sheet']=='Obligations' for r in result)>1000:raise ValueError('Enter 1–1000 obligations and at most 10,000 total rows')
        return result
    except Exception as exc:raise HTTPException(422,'The workbook could not be read safely: '+str(exc)[:200]) from exc


def map_payload(db,group):
    parent=next(r for r in group if r['sheet']=='Obligations');raw=parent['raw'];result={}
    def convert(key,value,sheet='Obligations'):
        if value is None or value=='':return None
        value=excel.friendly_value(key,value)
        if key in LOOKUPS:
            table=LOOKUPS[key];value=str(value).strip()
            if table is m.regulatory_clause:
                display=re.fullmatch(r'.+\[([^\[\]]+)\]',value)
                if display:value=display.group(1)
                result=business_ids.resolve(db,'clause',value)
                if not result:raise ValueError(excel.label(sheet,key)+': choose an approved clause from Choices or enter its exact current or legacy reference.')
                return result
            alternatives=[table.c.id==value]
            for col in ['code','username','name']:
                if col in table.c:alternatives.append(sa.func.upper(table.c[col])==value.upper())
            if table is m.user:alternatives.append(sa.func.upper(table.c.full_name+sa.literal(' (')+table.c.username+sa.literal(')'))==value.upper())
            elif 'name' in table.c:alternatives.append(sa.func.upper(table.c.name+sa.literal(' (')+table.c.code+sa.literal(')'))==value.upper())
            matches=db.execute(sa.select(table.c.id).where(sa.or_(*alternatives))).scalars().all()
            if len(matches)!=1:raise ValueError(excel.label(sheet,key)+': choose one listed name or enter an exact reference or username.')
            return matches[0]
        if key.endswith('_flag'):
            if str(value).strip().upper() in {'TRUE','1','YES'}:return True
            if str(value).strip().upper() in {'FALSE','0','NO'}:return False
            raise ValueError(excel.label(sheet,key)+': choose Yes or No.')
        return str(value).strip()
    for key,value in raw.items():
        if key in {'import_reference','legacy_reference','supporting_clause_ids'}:continue
        mapped=convert(key,value)
        if mapped is not None:result[key]=mapped
    result['supporting_clause_ids']=[convert('primary_clause_id',v.strip()) for v in str(raw.get('supporting_clause_ids') or '').split(';') if v.strip()]
    for name,target in [('Owners','owners'),('Applicability','applicability'),('Processes','processes')]:
        result[target]=[{key:convert(key,value,name) for key,value in row['raw'].items() if key!='import_reference' and value is not None and value!=''} for row in group if row['sheet']==name]
    result['change_reason']='Imported legacy obligation; source reference '+str(raw.get('legacy_reference') or raw.get('import_reference'))[:150]
    return ObligationInput(**result)


def stage(db,actor,filename,data,source_system,storage=None,replaces_batch_id=None):
    require(actor,{'AUTHOR'});system=source_system.strip()
    if not system or len(system)>90:raise HTTPException(422,'Enter a source system of 1–90 characters.')
    original=parse(filename,data);groups=defaultdict(list);identifier=new_id()
    batches={r['id']:dict(r) for r in db.execute(sa.select(m.migration_batch).where(m.migration_batch.c.record_status.like('OBL_%'))).mappings()}
    notes={key:json.loads(batch['reconciliation_notes']) for key,batch in batches.items()}
    ancestors=set()
    if replaces_batch_id:
        old=repo.one(db,m.migration_batch,replaces_batch_id,True)
        if old['uploaded_by']!=actor.id or notes.get(replaces_batch_id,{}).get('source_system')!=system:
            raise HTTPException(403,'A correction must retain the original uploader and source system.')
        if old['record_status']=='OBL_SUPERSEDED':raise HTTPException(409,'Open the latest correction batch.')
        previous=replaces_batch_id
        while previous and previous not in ancestors:
            ancestors.add(previous);previous=notes.get(previous,{}).get('replaces_batch_id')
    matching=[key for key,value in notes.items() if value.get('source_system')==system]
    prior=[dict(row) for row in db.execute(sa.select(m.migration_row).where(m.migration_row.c.batch_id.in_(matching),m.migration_row.c.sheet_name=='Obligations')).mappings()] if matching else []
    prior_refs=defaultdict(list)
    for row in prior:prior_refs[json.loads(row['validation_errors'])['reference']].append(row)
    if not replaces_batch_id and any(b['file_hash']==hashlib.sha256(data).hexdigest() for b in batches.values()):
        raise HTTPException(409,'This exact obligation workbook is already retained. Open its preview or upload a linked correction.')
    for row in original:groups[str(row['raw'].get('import_reference') or '').strip()].append(row)
    profiles={};fingerprints=set()
    for reference,group in groups.items():
        errors=[];payload=None
        if not reference or len(reference)>100:errors.append('Enter an Import reference of 1–100 characters.')
        if sum(r['sheet']=='Obligations' for r in group)!=1:errors.append('Each reference needs exactly one atomic Obligations row; child references must match it.')
        duplicates=prior_refs.get(reference,[])
        if duplicates and (any(row['target_entity_id'] for row in duplicates) or not replaces_batch_id or any(row['batch_id'] not in ancestors for row in duplicates)):
            raise HTTPException(409,'A reference is already staged or loaded in this source system. Open its preview; use a linked correction for unloaded rows and a governed revision for loaded obligations.')
        if not errors:
            try:
                payload=map_payload(db,group);service.validate(db,actor,payload)
                clean=lambda value:re.sub(r'\s+',' ',value).strip().casefold()
                fingerprint=(payload.primary_clause_id,clean(payload.title),clean(payload.statement))
                possible=db.execute(sa.select(m.compliance_obligation).where(m.compliance_obligation.c.primary_clause_id==payload.primary_clause_id)).mappings()
                if fingerprint in fingerprints or any((r['primary_clause_id'],clean(r['title']),clean(r['statement']))==fingerprint for r in possible):
                    errors.append('Duplicate requirement for the same primary clause. Use one obligation with multiple department scopes, or a governed revision of the existing record.')
                fingerprints.add(fingerprint)
            except (HTTPException,ValidationError,ValueError) as exc:errors.append(str(exc.detail) if isinstance(exc,HTTPException) else excel.validation_message(exc))
        parent=next((row for row in group if row['sheet']=='Obligations'),None)
        profiles[reference]={'errors':errors,'normalised':payload.model_dump(mode='json') if payload and not errors else None,
            'reference':reference,'legacy_reference':parent['raw'].get('legacy_reference') if parent else None}
    invalid=sum(bool(profiles[str(r['raw'].get('import_reference') or '').strip()]['errors']) for r in original)
    db.execute(m.migration_batch.insert().values(id=identifier,code='OBL-IMPORT-'+identifier,source_file=Path(filename).name[:500],
        file_hash=hashlib.sha256(data).hexdigest(),uploaded_by=actor.id,uploaded_at=now(),source_count=len(original),pending_count=len(original)-invalid,
        rejected_count=invalid,record_status='OBL_STAGED',reconciliation_notes=json.dumps({'kind':'obligation_import','source_system':system,'replaces_batch_id':replaces_batch_id})))
    parent_seen=set()
    for row in original:
        reference=str(row['raw'].get('import_reference') or '').strip();profile=profiles[reference]
        legacy=reference if row['sheet']=='Obligations' else f"{reference}:{row['sheet']}:{row['number']}"
        if row['sheet']=='Obligations' and reference in parent_seen:legacy=reference+':DUPLICATE:'+str(row['number'])
        if row['sheet']=='Obligations':parent_seen.add(reference)
        if row['sheet']!='Obligations':profile={key:value for key,value in profile.items() if key!='normalised'}
        db.execute(m.migration_row.insert().values(id=new_id(),batch_id=identifier,sheet_name=row['sheet'],row_number=row['number'],source_system='OBL-CORR:'+identifier if replaces_batch_id else 'OBL:'+system,
            legacy_id=legacy or 'INVALID:'+row['sheet']+':'+str(row['number']),source_payload=json.dumps(row.get('source_values',row['raw']),default=str),
            validation_status='CORRECTION_REQUIRED' if profile['errors'] else 'CONTENT_VALIDATION_PENDING',validation_errors=json.dumps(profile,default=str)))
    if storage:
        from .source_documents import preserve_bytes
        preserve_bytes(db,storage,identifier,data,staging=True)
    if replaces_batch_id:
        old_notes=notes[replaces_batch_id];old_notes['corrected_by_batch_id']=identifier
        db.execute(m.migration_batch.update().where(m.migration_batch.c.id==replaces_batch_id).values(
            record_status=old['record_status'] if old['loaded_count'] else 'OBL_SUPERSEDED',reconciliation_notes=json.dumps(old_notes)))
    audit(db,actor,'obligation_import',identifier,'STAGED',new={'rows':len(original),'correction_rows':invalid,'file_hash':hashlib.sha256(data).hexdigest()})
    return {'id':identifier}


def preview(db,actor,identifier,lock=False):
    require(actor);batch=repo.one(db,m.migration_batch,identifier,lock)
    if not batch['record_status'].startswith('OBL_'):raise HTTPException(404,'Not an obligation import.')
    rows=[dict(r) for r in db.execute(sa.select(m.migration_row).where(m.migration_row.c.batch_id==identifier).order_by(m.migration_row.c.sheet_name,m.migration_row.c.row_number)).mappings()]
    for row in rows:row['profile']=json.loads(row['validation_errors'] or '{}')
    groups={row['profile'].get('reference') for row in rows if row['sheet_name']=='Obligations'}
    return {'batch':batch,'rows':rows,'obligation_count':len(groups),'ready_obligations':sum(row['sheet_name']=='Obligations' and row['validation_status']=='MIGRATION_READY' for row in rows)}


def validate_batch(db,actor,identifier):
    require(actor,{'REVIEWER'});data=preview(db,actor,identifier,True);batch=data['batch']
    if batch['uploaded_by']==actor.id:raise HTTPException(403,'An independent Reviewer must validate the import.')
    if batch['record_status'] not in {'OBL_STAGED','OBL_VALIDATED'}:raise HTTPException(409,'This import was already loaded.')
    for row in data['rows']:
        if row['profile'].get('errors'):continue
        db.execute(m.migration_row.update().where(m.migration_row.c.id==row['id']).values(validation_status='MIGRATION_READY'))
    notes=json.loads(batch['reconciliation_notes']);notes.update(validated_by=actor.id,validated_at=now().isoformat())
    db.execute(m.migration_batch.update().where(m.migration_batch.c.id==identifier).values(record_status='OBL_VALIDATED',reconciliation_notes=json.dumps(notes)))
    audit(db,actor,'obligation_import',identifier,'IMPORT_VALIDATED',new={'scope':'structural/source mapping; no obligation activation'})
    return {'ok':True}


def load(db,actor,identifier):
    require(actor,{'AUTHOR'});data=preview(db,actor,identifier,True);batch=data['batch']
    if batch['uploaded_by']!=actor.id:raise HTTPException(403,'Only the uploader may load this reviewed import.')
    if batch['record_status']!='OBL_VALIDATED':raise HTTPException(409,'An independent import review is required before Draft loading; an import can be loaded once.')
    groups=defaultdict(list)
    for row in data['rows']:groups[row['profile']['reference']].append(row)
    loaded=0;obligations=0
    for group in groups.values():
        parent=next((row for row in group if row['sheet_name']=='Obligations'),None)
        if not parent or any(row['validation_status']!='MIGRATION_READY' for row in group):continue
        # A failed/revoked mapping rejects this complete group and retains its source.
        try:
            with db.begin_nested():
                payload=ObligationInput(**parent['profile']['normalised'])
                target=service.create(db,actor,payload,imported=True)
        except (HTTPException,ValidationError) as exc:
            for row in group:
                profile={**row['profile'],'errors':[str(exc.detail) if isinstance(exc,HTTPException) else str(exc)]}
                db.execute(m.migration_row.update().where(m.migration_row.c.id==row['id']).values(validation_status='CORRECTION_REQUIRED',validation_errors=json.dumps(profile)))
            continue
        for row in group:db.execute(m.migration_row.update().where(m.migration_row.c.id==row['id']).values(validation_status='LOADED',target_entity_type='compliance_obligation',target_entity_id=target['id'],loaded_at=now(),
            validation_errors=json.dumps({**row['profile'],'target_code':target['code']})))
        loaded+=len(group);obligations+=1
    rejected=batch['source_count']-loaded
    notes=json.loads(batch['reconciliation_notes']);notes.update(loaded_obligations=obligations,draft_only=True)
    db.execute(m.migration_batch.update().where(m.migration_batch.c.id==identifier).values(record_status='OBL_LOADED' if obligations else 'OBL_CORRECTION_REQUIRED',loaded_count=loaded,
        rejected_count=rejected,pending_count=0,reconciliation_notes=json.dumps(notes)))
    audit(db,actor,'obligation_import',identifier,'DRAFTS_LOADED',new={'obligations':obligations,'source_rows_loaded':loaded,'source_rows_not_loaded':rejected})
    return {'loaded_obligations':obligations,'loaded_rows':loaded,'not_loaded_rows':rejected,
        'message':'Draft loading complete.' if obligations else 'No Drafts loaded. Review the updated eligibility findings and upload a linked correction.'}
