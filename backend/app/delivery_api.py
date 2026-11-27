"""Week 5 routes reuse real sessions, LDAP readiness, CSRF and caller transactions."""
import hashlib,json
import sqlalchemy as sa
from fastapi import Depends,Request,Response,UploadFile,File,Form,HTTPException,Query
from fastapi.responses import FileResponse
from . import delivery as d,delivery_schemas as c,delivery_reporting as reporting,models as m,repository as repo
from .events import audit
from .pagination import page_query,paginate
from .storage import stored_path
from . import upload_policy
from .access import READ_ROLES
from . import mail_settings


def install(app,get_db,current):
 @app.get('/api/actions/assignees')
 def assignees(obligation_id:str,role:str,unit_id:str,db=Depends(get_db),actor=Depends(current)):
  return d.assignees(db,actor,obligation_id,role,unit_id)
 @app.get('/api/actions')
 def listing(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
  return paginate(d.listing(db,actor,dict(request.query_params)),**paging)
 @app.post('/api/actions')
 def create(payload:c.ActionInput,db=Depends(get_db),actor=Depends(current)):return d.create(db,actor,payload)
 @app.get('/api/actions/{identifier}')
 def detail(identifier:str,db=Depends(get_db),actor=Depends(current)):return d.detail(db,actor,identifier)
 @app.post('/api/actions/{identifier}/start')
 def start(identifier:str,payload:c.Mutation,db=Depends(get_db),actor=Depends(current)):return d.start(db,actor,identifier,payload)
 @app.put('/api/actions/{identifier}/result')
 def save(identifier:str,payload:c.Result,db=Depends(get_db),actor=Depends(current)):return d.save_result(db,actor,identifier,payload)
 @app.post('/api/actions/{identifier}/submit')
 def submit(identifier:str,payload:c.Result,db=Depends(get_db),actor=Depends(current)):return d.save_result(db,actor,identifier,payload,True)
 @app.post('/api/actions/{identifier}/decision')
 def decide(identifier:str,payload:c.Decision,request:Request,db=Depends(get_db),actor=Depends(current)):return d.decide_work(db,actor,identifier,payload,request.app.state.settings.storage)
 @app.post('/api/actions/{identifier}/evidence')
 async def evidence(identifier:str,request:Request,metadata:str=Form(...),file:UploadFile|None=File(default=None),db=Depends(get_db),actor=Depends(current)):
  try:payload=c.EvidenceInput.model_validate_json(metadata)
  except ValueError as exc:raise HTTPException(422,'Complete the required evidence metadata.') from None
  limits,_=upload_policy.configuration(db) if file else (None,None)
  data=await upload_policy.read_upload(file,limits.evidence_mib) if file else None
  return d.add_evidence(db,actor,identifier,payload,request.app.state.settings.storage,file.filename if file else None,data)
 @app.post('/api/actions/{identifier}/evidence-links')
 def reuse(identifier:str,payload:c.Link,db=Depends(get_db),actor=Depends(current)):return d.attach(db,actor,identifier,payload)
 @app.post('/api/actions/{identifier}/evidence-decision')
 def evidence_decide(identifier:str,payload:c.EvidenceDecision,request:Request,db=Depends(get_db),actor=Depends(current)):return d.decide_evidence(db,actor,identifier,payload,request.app.state.settings.storage)
 @app.post('/api/actions/{identifier}/extensions')
 def extension(identifier:str,payload:c.Extension,db=Depends(get_db),actor=Depends(current)):return d.extend(db,actor,identifier,payload)
 @app.post('/api/action-extensions/{identifier}/decision')
 def extension_decide(identifier:str,payload:c.ExtensionDecision,db=Depends(get_db),actor=Depends(current)):return d.decide_extension(db,actor,identifier,payload)
 @app.post('/api/actions/{identifier}/validations')
 def validation(identifier:str,payload:c.ValidationInput,db=Depends(get_db),actor=Depends(current)):return d.record_validation(db,actor,identifier,payload)
 @app.post('/api/action-validations/{identifier}/decision')
 def validation_decide(identifier:str,payload:c.ValidationDecision,request:Request,db=Depends(get_db),actor=Depends(current)):return d.decide_validation(db,actor,identifier,payload,request.app.state.settings.storage)
 @app.get('/api/evidence')
 def evidence_list(paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
  actor.require(READ_ROLES);result=[]
  for e in d.allrows(db,m.evidence_item):
   try:result.append(d.evidence_read(db,actor,e['id']))
   except HTTPException:continue
  return paginate(result,**paging)
 @app.get('/api/evidence/{identifier}')
 def evidence_detail(identifier:str,db=Depends(get_db),actor=Depends(current)):return d.evidence_read(db,actor,identifier)
 @app.get('/api/evidence/{identifier}/file')
 def evidence_file(identifier:str,request:Request,db=Depends(get_db),actor=Depends(current)):
  e=d.evidence_read(db,actor,identifier);d.fail(e['document_id'],'This evidence is held in the recorded external repository.',404);d.integrity(db,e,request.app.state.settings.storage)
  doc=repo.one(db,m.document,e['document_id']);audit(db,actor,'evidence',identifier,'DOWNLOADED')
  return FileResponse(stored_path(request.app.state.settings.storage,doc['id'],doc['file_name']),filename=doc['file_name'],media_type=doc['content_type'],content_disposition_type='attachment')
 @app.get('/api/team-overview')
 def overview(request:Request,db=Depends(get_db),actor=Depends(current)):
  result=reporting.build(db,actor,dict(request.query_params));cfg=request.app.state.settings
  mail=mail_settings.load(db,cfg)
  result['delivery']={'channel':'IN_APP','scheduler_enabled':cfg.reminders_enabled,'interval_seconds':cfg.reminder_interval_seconds,'email_configured':mail['enabled'] and not mail['problem']}
  return result
 @app.get('/api/team-overview/export')
 def export(request:Request,metric:str,population_hash:str,db=Depends(get_db),actor=Depends(current)):
  data=reporting.build(db,actor,dict(request.query_params));content,count=reporting.export(db,data,metric,population_hash)
  audit(db,actor,'delivery_report',metric,'EXPORTED',new={'filters':data['filters'],'population_hash':population_hash,'count':count})
  return Response(content,media_type='text/csv',headers={'Content-Disposition':'attachment; filename="compliance-'+metric+'.csv"','X-Source-Records':str(count)})


def document_visible(db,actor,identifier):
 for e in d.allrows(db,m.evidence_item,m.evidence_item.c.document_id==identifier):
  try:d.evidence_read(db,actor,e['id']);return True
  except HTTPException:continue
 for v in d.allrows(db,m.action_validation,m.action_validation.c.document_id==identifier):
  try:
   a,o=d.read(db,actor,v['action_id'])
   if actor.covers(o['regulatory_owner_unit_id'],{'AUTHOR','REVIEWER','APPROVER','CCO'}):return True
  except HTTPException:continue
 return False
