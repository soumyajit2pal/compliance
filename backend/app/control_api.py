"""Authenticated, CSRF-protected control governance and evidence library routes."""
import json,hashlib
import sqlalchemy as sa
from fastapi import Depends,Request,Response,HTTPException
from . import controls as service,control_schemas as c,models as m,delivery as d,repository as repo
from .access import READ_ROLES,actor_for
from .pagination import page_query,paginate
from .events import audit
from .obligation_export import csv_bytes, label

def evidence_library(db,actor,filters):
    actor.require(READ_ROLES);result=[]
    for e in d.allrows(db,m.evidence_item):
        try:e=d.evidence_read(db,actor,e['id'])
        except HTTPException:continue
        actions=[];executions=[]
        for link in d.allrows(db,m.evidence_link,m.evidence_link.c.evidence_id==e['id']):
            if link['action_id']:
                try:a,o=d.read(db,actor,link['action_id'])
                except HTTPException:continue
                actions.append({'id':a['id'],'code':a['code'],'description':a['description'],'department':a['owner_unit_id'],'obligation_id':o['id'],'obligation_code':o['code']})
            if link['control_execution_id']:
                execution=repo.one(db,m.control_execution,link['control_execution_id'])
                for r in d.allrows(db,m.action_control_result,m.action_control_result.c.execution_id==execution['id']):
                    target=repo.one(db,m.action_control_link,r['link_id'])
                    try:a,o=d.read(db,actor,target['action_id']);mapping=service.read(db,actor,'control-mappings',target['mapping_id']);control=service.read(db,actor,'controls',mapping['control_id'])
                    except HTTPException:continue
                    executions.append({'id':execution['id'],'control_id':control['id'],'control_code':control['code'],'mapping_id':mapping['id'],'action_id':a['id'],'result':execution['result'],'review_decision':r['decision'],
                                       'action_code':a['code'],'period_from':execution['period_from'],'period_to':execution['period_to']})
        if not actions:continue
        departments={a['department'] for a in actions}
        if filters.get('department') and filters['department'] not in departments:continue
        if filters.get('status') and filters['status']!=e['evidence_status']:continue
        doc=repo.one(db,m.document,e['document_id']) if e['document_id'] else None
        r={**e,'actions':actions,'executions':executions,'file_name':doc['file_name'] if doc else 'External repository reference','file_size_bytes':doc['file_size'] if doc else None}
        if filters.get('q') and filters['q'].casefold() not in json.dumps(r,default=str).casefold():continue
        result.append(r)
    return sorted(result,key=lambda r:(r['uploaded_at'],r['id']),reverse=True)

def install(app,get_db,current):
    @app.get('/api/control-assignees')
    def owners(unit_id:str,role:str,db=Depends(get_db),actor=Depends(current)):
        actor.require(READ_ROLES,unit_id)
        if role not in {'CONTROL_OWNER','REVIEWER','APPROVER'}:raise HTTPException(422,'Choose a check owner, reviewer or approver.')
        result=[]
        for user in d.allrows(db,m.user,m.user.c.active_flag==1):
            try:repo.eligible(db,user['id'],role,unit_id)
            except HTTPException:continue
            result.append({'id':user['id'],'full_name':user['full_name']})
        return result

    def register(kind):
        base='/api/'+kind
        @app.get(base,name=kind+' listing')
        def listing(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
            return paginate(service.listing(db,actor,kind,dict(request.query_params)),**paging)
        @app.post(base,name=kind+' create')
        def create(payload:c.ControlInput if kind=='controls' else c.MappingInput,db=Depends(get_db),actor=Depends(current)):
            return service.create(db,actor,kind,payload)
        @app.get(base+'/{identifier}',name=kind+' detail')
        def detail(identifier:str,db=Depends(get_db),actor=Depends(current)):return service.detail(db,actor,kind,identifier)
        @app.put(base+'/{identifier}',name=kind+' edit')
        def edit(identifier:str,payload:c.ControlInput if kind=='controls' else c.MappingInput,expected_revision:int,db=Depends(get_db),actor=Depends(current)):
            return service.edit(db,actor,kind,identifier,payload,expected_revision)
        @app.post(base+'/{identifier}/revisions',name=kind+' revise')
        def revise(identifier:str,payload:c.ControlInput if kind=='controls' else c.MappingInput,db=Depends(get_db),actor=Depends(current)):
            return service.create(db,actor,kind,payload,identifier)
        @app.post(base+'/{identifier}/submit',name=kind+' submit')
        def submit(identifier:str,payload:c.Submit,db=Depends(get_db),actor=Depends(current)):
            return service.submit(db,actor,kind,identifier,payload)
        @app.post(base+'/{identifier}/decision',name=kind+' decide')
        def decide(identifier:str,payload:c.Decision,db=Depends(get_db),actor=Depends(current)):
            return service.decide(db,actor,kind,identifier,payload)
        @app.get(base+'/{identifier}/assignees',name=kind+' eligible reviewers')
        def candidates(identifier:str,role:str,db=Depends(get_db),actor=Depends(current)):
            r=service.read(db,actor,kind,identifier);unit=service.context(db,actor,kind,r)
            if role not in {'REVIEWER','APPROVER'}:raise HTTPException(422,'Choose a reviewer or approver.')
            result=[]
            for user in d.allrows(db,m.user,m.user.c.active_flag==1):
                try:
                    person=repo.eligible(db,user['id'],role,unit,{r['created_by']});service.context(db,person,kind,r)
                except HTTPException:continue
                result.append({'id':user['id'],'full_name':user['full_name']})
            return result
    for kind in service.KINDS:register(kind)

    @app.get('/api/action-control-options')
    def options(obligation_id:str,department:str,db=Depends(get_db),actor=Depends(current)):
        o=d.obl.read(db,actor,obligation_id);d.current_obligation(db,actor,o,department)
        return service.action_mappings(db,actor,obligation_id,department)
    @app.post('/api/actions/{identifier}/control-results')
    def result(identifier:str,payload:c.Result,db=Depends(get_db),actor=Depends(current)):return service.record_result(db,actor,identifier,payload)
    @app.post('/api/control-results/{identifier}/decision')
    def decide_result(identifier:str,payload:c.ResultDecision,request:Request,db=Depends(get_db),actor=Depends(current)):
        return service.decide_result(db,actor,identifier,payload,request.app.state.settings.storage)
    @app.get('/api/evidence-library')
    def library(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
        return paginate(evidence_library(db,actor,dict(request.query_params)),**paging)
    @app.get('/api/evidence-library/export')
    def export(request:Request,population_hash:str,db=Depends(get_db),actor=Depends(current)):
        items=evidence_library(db,actor,dict(request.query_params));fingerprint=hashlib.sha256(json.dumps([(r['id'],r['evidence_status'],r['file_hash']) for r in items],separators=(',',':')).encode()).hexdigest()
        service.fail(fingerprint==population_hash,'Evidence changed. Refresh before exporting.',409)
        headers=('Evidence reference','Title','Status','File name','Period from','Period to','Source system',
                 'Source record reference','File hash','Retention end date','Linked action references','Linked check results')
        values=[
            (row['code'],row['title'],label(row['evidence_status']),row['file_name'],row['period_from'],row['period_to'],
             row['source_system'],row['source_record'],row['file_hash'],row['retention_end_date'],
             '; '.join(action['code'] for action in row['actions']),
             '; '.join(f"{check['control_code']} · {check['action_code']} · {check['period_from']} to {check['period_to']} · {label(check['result'])}"
                       for check in row['executions']))
            for row in items
        ]
        audit(db,actor,'evidence_library','export','EXPORTED',new={'count':len(items),'filters':dict(request.query_params),'population_hash':fingerprint})
        return Response(csv_bytes(('Evidence library',headers,values)),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="evidence-library.csv"','X-Source-Records':str(len(items))})
