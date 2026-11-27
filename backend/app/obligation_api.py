"""Routes share the application's authentication, database transaction and paging."""
import json
from collections import Counter
from typing import Literal
from fastapi import Depends,Query,Request,Response,HTTPException,UploadFile,File,Form
from fastapi.responses import FileResponse
from .storage import stored_path
from . import upload_policy
from .upload_formats import validate_workbook
import hashlib
import sqlalchemy as sa
from . import models as m,obligations as service,obligation_schemas as contracts
from .delivery import today
from .pagination import page_query,paginate
from .table_filters import column_choices, column_query, fields, filter_rows, label
from .events import audit
from .access import actor_for,REGULATORY_ROLES
from .obligation_export import csv_bytes, label as export_label, reference_values


ISSUE_LABELS = {
    'SOURCE_PERIOD_MISMATCH': 'Source edition does not cover the obligation start',
    'PENDING_BUSINESS_VALIDATION': 'Owner confirmation pending',
    'MISSING_REGULATORY_OWNER': 'No primary regulatory owner',
    'MISSING_BUSINESS_OWNER': 'No primary business owner',
    'MISSING_CONTROL_OWNER': 'No check owner',
    'MISSING_COMPLIANCE_REVIEWER_OWNER': 'No Compliance reviewer',
    'INVALID_OWNER_ACCESS': 'Owner access requires review',
    'MISSING_APPLICABILITY': 'Applicability not assessed',
    'CONTENT_VALIDATION_PENDING': 'Content validation pending',
    'MISSING_EVIDENCE_STANDARD': 'No evidence requirement',
    'UNAPPROVED_SOURCE': 'Source approval required',
    'SOURCE_REASSESSMENT_REQUIRED': 'Source changed — reassessment required',
    'PROCESS_REASSESSMENT_REQUIRED': 'Process changed — reassessment required',
    'PRODUCT_REASSESSMENT_REQUIRED': 'Product changed — reassessment required',
    'MISSING_OR_UNAVAILABLE_CLAUSE': 'Source clause unavailable',
    'PARTIAL_APPLICABILITY': 'Partially applicable',
    'UNAPPROVED_NON_APPLICABILITY': 'Non-applicability awaiting approval',
    'REVIEW_OVERDUE': 'Review overdue',
    'HIGH_CRITICAL': 'High / critical',
    'ACTIVE_WITHOUT_MAPPED_CONTROLS': 'Active obligations without linked checks',
}


def obligation_columns(actor, today):
    def stage(row):
        status, approval = row['record_status'], row['approval_status']
        if approval == 'WITHDRAWN' and status in {'DRAFT', 'RETIRED'}:
            return 'Cancelled Draft'
        if status != 'DRAFT':
            return label(status)
        if approval == 'APPROVED':
            if row['effective_to'] and row['effective_to'] <= today:
                return 'Approved · period ended'
            if row['effective_from'] > today:
                return 'Approved · not yet effective'
            return 'Approved · awaiting activation'
        return {'BUSINESS_VALIDATION': 'Owner acceptance'}.get(row['stage'], label(row['stage']))

    return {
        'obligation': lambda row: (row['title'], row['code'], f"v{row['version_number']}", 'Quick view'),
        'regulatory_source': lambda row: (row['instrument_code'],
            'Clause ' + (row['source_clause_reference'] or row['clause_code']), f"Edition {row['source_version']}"),
        'accountable_department': lambda row: actor.units.get(row['business_owner_unit_id'], {}).get('name') or row['business_owner_unit_id'],
        'stage': stage,
        'criticality': fields('criticality'),
        'findings': lambda row: [ISSUE_LABELS.get(issue, label(issue)) for issue in row['issues']] or 'None reported',
    }


def install(app,get_db,current):
    @app.get('/api/obligations')
    def listing(request:Request,paging=Depends(page_query),columns=Depends(column_query),db=Depends(get_db),actor=Depends(current)):
        actor.require(service.READ_ROLES)
        filters=dict(request.query_params)
        pagination={'page':paging['page'] or 1,'page_size':paging['page_size'] or 25}
        projections=obligation_columns(actor,today())
        if columns.options_for:
            rows=filter_rows(service.listing(db,actor,filters),columns,projections)
            return column_choices(rows,columns.options_for,projections)
        if filters.get('tab')!='reports':
            return paginate(filter_rows(service.listing(db,actor,filters),columns,projections),**pagination)
        # Keep the summary useful while one finding is selected. Other filters
        # and authorisation apply to both the full population and the page.
        finding=filters.pop('exception',None)
        rows=filter_rows(service.listing(db,actor,filters),columns,projections)
        counts=Counter(issue for row in rows for issue in row['issues'])
        if finding:
            rows=[row for row in rows if finding in row['issues']]
        return {**paginate(rows,**pagination),'finding_counts':dict(counts)}

    @app.get('/api/obligations/report.csv')
    def report(request:Request,db=Depends(get_db),actor=Depends(current)):
        actor.require(REGULATORY_ROLES)
        rows=service.listing(db,actor,dict(request.query_params))
        departments=reference_values(db,m.organisational_unit.c.name,(row['business_owner_unit_id'] for row in rows))
        headers=('Obligation reference','Revision','Obligation','Regulatory instrument','Clause reference','Source edition',
                 'Accountable department','Workflow stage','Record status','Criticality','Content validation','Findings')
        values=[
            (row['code'],row['version_number'],row['title'],row['instrument_code'],row.get('source_clause_reference') or row['clause_code'],
             row['source_version'],departments.get(row['business_owner_unit_id']),export_label(row['stage']),export_label(row['record_status']),
             export_label(row['criticality']),export_label(row['content_validation_status']),
             '; '.join(ISSUE_LABELS.get(issue,export_label(issue)) for issue in row['issues']))
            for row in rows
        ]
        audit(db,actor,'obligation_report','register','EXPORTED',new={'count':len(rows),'filters':dict(request.query_params)})
        return Response(csv_bytes(('Obligation exceptions',headers,values)),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="obligation-exceptions.csv"'})

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
    def batches(paging=Depends(page_query),columns=Depends(column_query),db=Depends(get_db),actor=Depends(current)):
        imports.require(actor)
        rows=[dict(r) for r in db.execute(sa.select(m.migration_batch).where(m.migration_batch.c.record_status.like('OBL_%')).order_by(m.migration_batch.c.uploaded_at.desc())).mappings()]
        projections={
            'source_workbook':fields('source_file'),'date':fields('uploaded_at'),
            'status':lambda row:label(row['record_status'].removeprefix('OBL_')),
            'source_rows':fields('source_count'),'loaded':fields('loaded_count'),'not_loaded':fields('rejected_count'),
        }
        rows=filter_rows(rows,columns,projections)
        if columns.options_for:
            return column_choices(rows,columns.options_for,projections)
        return paginate(rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)

    @app.post('/api/obligation-imports')
    async def stage(request:Request,file:UploadFile=File(...),source_system:str=Form(...),replaces_batch_id:str|None=Form(default=None),db=Depends(get_db),actor=Depends(current)):
        imports.require(actor,{'AUTHOR'})
        limits,_=upload_policy.configuration(db)
        data=await upload_policy.read_upload(file,limits.workbook_mib)
        validate_workbook(data)
        return imports.stage(db,actor,file.filename or '',data,source_system,request.app.state.settings.storage,replaces_batch_id)

    @app.get('/api/obligation-imports/{identifier}/source')
    def original(identifier:str,request:Request,db=Depends(get_db),actor=Depends(current)):
        data=imports.preview(db,actor,identifier)
        path=stored_path(request.app.state.settings.storage,identifier,data['batch']['source_file'],staging=True)
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
        data=imports.preview(db,actor,identifier)
        source_system=json.loads(data['batch']['reconciliation_notes'])['source_system']
        headers=('Source file','Source system','Sheet','Row','Import reference','Legacy reference','Status','Findings','Obligation reference')
        values=[
            (data['batch']['source_file'],source_system,row['sheet_name'],row['row_number'],row['profile']['reference'],
             row['profile'].get('legacy_reference'),export_label(row['validation_status']),
             '; '.join(row['profile'].get('errors',[])),row['profile'].get('target_code'))
            for row in data['rows']
        ]
        audit(db,actor,'obligation_import',identifier,'RECONCILIATION_EXPORTED')
        return Response(csv_bytes(('Import reconciliation',headers,values)),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="obligation-import-reconciliation.csv"'})
