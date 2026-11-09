"""Routes share the application's authentication, database transaction and paging."""
import csv,io
from typing import Literal
from fastapi import Depends,Query,Request,Response,HTTPException,UploadFile,File,Form
from fastapi.responses import FileResponse
from .storage import stored_path
import hashlib
import sqlalchemy as sa
from . import models as m,obligations as service,obligation_schemas as contracts
from .pagination import page_query,paginate
from .events import audit
from .access import actor_for,REGULATORY_ROLES


def safe_cell(value):
    text=str(value or '')
    return "'"+text if text.lstrip().startswith(('=','+','-','@','\t','\r')) else text


def install(app,get_db,current):
    @app.get('/api/obligations')
    def listing(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
        actor.require(service.READ_ROLES)
        rows=service.listing(db,actor,dict(request.query_params))
        return paginate(rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)

    @app.get('/api/obligations/report.csv')
    def report(request:Request,db=Depends(get_db),actor=Depends(current)):
        actor.require(REGULATORY_ROLES)
        rows=service.listing(db,actor,dict(request.query_params));output=io.StringIO();writer=csv.writer(output)
        fields=['code','version_number','title','instrument_code','clause_code','source_version','business_owner_unit_id','stage','record_status','criticality','content_validation_status','issues']
        departments={r['id']:r['name'] for r in db.execute(sa.select(m.organisational_unit.c.id,m.organisational_unit.c.name)).mappings()}
        writer.writerow([*fields,'business_owner_department'])
        for row in rows:writer.writerow([*[safe_cell('; '.join(row[k]) if k=='issues' else row[k]) for k in fields],safe_cell(departments.get(row['business_owner_unit_id']))])
        audit(db,actor,'obligation_report','register','EXPORTED',new={'count':len(rows),'filters':dict(request.query_params)})
        return Response('\ufeff'+output.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="obligation-exceptions.csv"'})

    @app.get('/api/obligations/export')
    def export(request:Request,format:Literal['xlsx','csv']='xlsx',view:Literal['register','applicability','accountability']='register',obligation_id:str|None=Query(None,max_length=36),db=Depends(get_db),actor=Depends(current)):
        from . import obligation_export
        result=obligation_export.build(db,actor,view,format,dict(request.query_params),obligation_id)
        audit(db,actor,'obligation_report',obligation_id or view,'EXPORTED',new={'view':view,'format':format,'count':result['count'],'rows':result['rows'],'filters':result['filters']})
        return Response(result['data'],media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if format=='xlsx' else 'text/csv',headers={'Content-Disposition':f'attachment; filename="{result["filename"]}"','Cache-Control':'private, no-store','X-Export-Obligations':str(result['count'])})

    @app.get('/api/obligations/assignees')
    def assignees(role:str,unit_id:str,db=Depends(get_db),actor=Depends(current)):
        actor.require({'AUTHOR','REVIEWER','APPROVER'})
        if role not in set(service.ROLE.values())|{'APPROVER'}:raise HTTPException(422,'Choose an obligation ownership or approval role.')
        result=[]
        for user in db.execute(sa.select(m.user).where(m.user.c.active_flag==1)).mappings():
            try:service.eligible(db,user['id'],role,unit_id)
            except HTTPException:continue
            result.append({'id':user['id'],'full_name':user['full_name'],'username':user['username']})
        return result

    @app.post('/api/obligations')
    def create(payload:contracts.ObligationInput,db=Depends(get_db),actor=Depends(current)):return service.create(db,actor,payload)

    @app.get('/api/obligations/{identifier}')
    def detail(identifier:str,db=Depends(get_db),actor=Depends(current)):return service.detail(db,actor,identifier)

    @app.put('/api/obligations/{identifier}')
    def edit(identifier:str,payload:contracts.ObligationInput,db=Depends(get_db),actor=Depends(current)):return service.edit(db,actor,identifier,payload)

    @app.put('/api/obligations/{identifier}/owners')
    def owners(identifier:str,payload:contracts.OwnershipChange,db=Depends(get_db),actor=Depends(current)):return service.assign_owners(db,actor,identifier,payload)

    @app.post('/api/obligations/{identifier}/owner-changes/{change_id}/decision')
    def owner_decision(identifier:str,change_id:str,payload:contracts.OwnershipDecision,db=Depends(get_db),actor=Depends(current)):
        from . import ownership_changes
        return ownership_changes.decide(db,actor,identifier,change_id,payload)

    @app.post('/api/obligations/{identifier}/submit')
    def submit(identifier:str,payload:contracts.Submission,db=Depends(get_db),actor=Depends(current)):return service.submit(db,actor,identifier,payload)

    @app.post('/api/obligations/{identifier}/decision')
    def decide(identifier:str,payload:contracts.ObligationDecision,db=Depends(get_db),actor=Depends(current)):return service.decide(db,actor,identifier,payload)

    @app.post('/api/obligations/{identifier}/revisions')
    def revision(identifier:str,payload:contracts.Revision,db=Depends(get_db),actor=Depends(current)):return service.revise(db,actor,identifier,payload)

    @app.post('/api/obligations/{identifier}/activate')
    def activate(identifier:str,db=Depends(get_db),actor=Depends(current)):return service.activate(db,actor,identifier)

    @app.post('/api/obligations/{identifier}/cancel')
    def cancel(identifier:str,payload:contracts.Revision,db=Depends(get_db),actor=Depends(current)):return service.cancel(db,actor,identifier,payload)

    from . import obligation_import as imports
    @app.get('/api/obligation-import-template')
    def template(db=Depends(get_db),actor=Depends(current)):
        imports.require(actor)
        return Response(imports.template(db,actor),media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={'Content-Disposition':'attachment; filename="obligation-import-template.xlsx"','Cache-Control':'private, no-store'})

    @app.get('/api/obligation-imports')
    def batches(paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
        imports.require(actor)
        rows=[dict(r) for r in db.execute(sa.select(m.migration_batch).where(m.migration_batch.c.record_status.like('OBL_%')).order_by(m.migration_batch.c.uploaded_at.desc())).mappings()]
        return paginate(rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)

    @app.post('/api/obligation-imports')
    async def stage(request:Request,file:UploadFile=File(...),source_system:str=Form(...),replaces_batch_id:str|None=Form(default=None),db=Depends(get_db),actor=Depends(current)):
        data=await file.read(20*1024*1024+1)
        if len(data)>20*1024*1024:raise HTTPException(422,'Limit the workbook to 20 MB.')
        return imports.stage(db,actor,file.filename or '',data,source_system,request.app.state.settings.storage,replaces_batch_id)

    @app.get('/api/obligation-imports/{identifier}/source')
    def original(identifier:str,request:Request,db=Depends(get_db),actor=Depends(current)):
        data=imports.preview(db,actor,identifier)
        path=stored_path(request.app.state.settings.storage,identifier,staging=True)
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=data['batch']['file_hash']:
            raise HTTPException(409,'The retained workbook is unavailable or failed its integrity check.')
        audit(db,actor,'obligation_import',identifier,'SOURCE_DOWNLOADED')
        return FileResponse(path,filename=data['batch']['source_file'],media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    @app.get('/api/obligation-imports/{identifier}')
    def preview(identifier:str,db=Depends(get_db),actor=Depends(current)):return imports.preview(db,actor,identifier)

    @app.post('/api/obligation-imports/{identifier}/validate')
    def validate(identifier:str,db=Depends(get_db),actor=Depends(current)):return imports.validate_batch(db,actor,identifier)

    @app.post('/api/obligation-imports/{identifier}/load')
    def load(identifier:str,db=Depends(get_db),actor=Depends(current)):return imports.load(db,actor,identifier)

    @app.get('/api/obligation-imports/{identifier}/report.csv')
    def reconciliation(identifier:str,db=Depends(get_db),actor=Depends(current)):
        data=imports.preview(db,actor,identifier);output=io.StringIO();writer=csv.writer(output)
        import json
        source_system=json.loads(data['batch']['reconciliation_notes'])['source_system']
        writer.writerow(['Source file','Source system','Sheet','Row','Import reference','Legacy reference','Status','Findings','Obligation code','Target obligation ID'])
        for row in data['rows']:writer.writerow([safe_cell(v) for v in [data['batch']['source_file'],source_system,row['sheet_name'],row['row_number'],row['profile']['reference'],row['profile'].get('legacy_reference'),row['validation_status'],'; '.join(row['profile'].get('errors',[])),row['profile'].get('target_code'),row['target_entity_id']]])
        audit(db,actor,'obligation_import',identifier,'RECONCILIATION_EXPORTED')
        return Response('\ufeff'+output.getvalue(),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="obligation-import-reconciliation.csv"'})
