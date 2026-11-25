"""Idempotent scheduled notices for actions, obligations and checks."""
from datetime import timedelta
import sqlalchemy as sa
from . import models as m,delivery as d,obligations as obl
from .access import actor_for
from .events import audit,notify,now

def review_overdue(submission):
 # Stored event timestamps are UTC; compare elapsed time without a date truncation.
 return submission['submitted_at']<=now()-timedelta(days=2)

def run(db):
 # Dedicated migration-seeded row serialises all API/CLI workers. No startup DDL.
 lock=db.execute(sa.select(m.id_counter.c.id).where(m.id_counter.c.entity_type=='delivery-reminders').with_for_update(skip_locked=True)).first()
 if not lock:return {'skipped':True,'created':0}
 day=d.today();created=0
 def send(actor,a,kind,recipients,token):
  nonlocal created
  for identifier in set(recipients):
   if not identifier:continue
   try:
    recipient=actor_for(db,identifier);d.read(db,recipient,a['id'])
   except d.HTTPException:continue
   key='delivery:'+a['id']+':'+kind+':'+token
   if db.execute(sa.select(m.notification.c.id).where(m.notification.c.recipient_user_id==identifier,m.notification.c.trigger_key==key)).first():continue
   notify(db,'action',a['id'],identifier,kind,key);created+=1
 def ccos(o):
  result=[]
  for u in d.allrows(db,m.user,m.user.c.active_flag==1):
   actor=actor_for(db,u['id'])
   if actor.covers(o['regulatory_owner_unit_id'],{'CCO'}):result.append(u['id'])
  return result
 for a in d.allrows(db,m.action):
  if not a['reviewer_user_id'] or a['record_status'] not in d.OPEN:continue
  try:owner=actor_for(db,a['owner_user_id']);o=obl.read(db,owner,a['obligation_id'])
  except d.HTTPException:continue
  if a['period_from'] and a['period_from']>day:continue
  send(owner,a,'ACTION_PERIOD_STARTED',[a['owner_user_id']],str(a['period_from']))
  delta=(a['current_due_date']-day).days
  if 0<=delta<=3:send(owner,a,'ACTION_UPCOMING',[a['owner_user_id']],str(day))
  if delta<0:send(owner,a,'ACTION_OVERDUE',[a['owner_user_id'],a['escalation_user_id']],str(day))
  if delta<=-7:send(owner,a,'ACTION_CCO_ESCALATION',ccos(o),str(day))
  sub=d.latest(db,a)
  if a['record_status']=='PENDING_VALIDATION' and sub and review_overdue(sub):send(owner,a,'EVIDENCE_REVIEW_OVERDUE',[a['reviewer_user_id'],a['escalation_user_id']],str(day))
  deadline=d.effective_deadline(db,owner,o)
  if deadline and deadline['due_date']<day:
   send(owner,a,'REGULATORY_DELAY',[a['owner_user_id'],a['escalation_user_id'],*ccos(o)],str(day))
   if not db.execute(sa.select(m.audit_log.c.id).where(m.audit_log.c.entity_type=='action',m.audit_log.c.entity_id==a['id'],m.audit_log.c.action=='REGULATORY_DELAY')).first():audit(db,None,'action',a['id'],'REGULATORY_DELAY',new={'deadline_id':deadline['id'],'due_date':deadline['due_date'],'observed_on':day})
 for o in d.allrows(db,m.compliance_obligation,sa.and_(m.compliance_obligation.c.record_status=='ACTIVE',m.compliance_obligation.c.next_review_date<=day+timedelta(days=7))):
  owners=obl.rows(db,m.obligation_owner,o['id']);recipients={x['user_id'] for x in owners if x['owner_role'] in {'BUSINESS','COMPLIANCE_REVIEWER'} and x['approval_status']=='APPROVED' and x['effective_from']<=day and (not x['effective_to'] or x['effective_to']>day)}
  for user in recipients:
   try:actor=actor_for(db,user);obl.read(db,actor,o['id'])
   except d.HTTPException:continue
   key='obligation-review:'+o['id']+':'+str(day)
   if not db.execute(sa.select(m.notification.c.id).where(m.notification.c.recipient_user_id==user,m.notification.c.trigger_key==key)).first():notify(db,'obligation',o['id'],user,'OBLIGATION_REVIEW_DUE',key);created+=1
 from . import controls
 for check in controls.rows(db, m.control, sa.and_(m.control.c.approval_status=='APPROVED',
         m.control.c.superseded_by_id.is_(None), m.control.c.review_date<=day+timedelta(days=7))):
  if not controls.current(check, day):continue
  user=check['owner_user_id']
  try:controls.read(db,actor_for(db,user),'controls',check['id'])
  except d.HTTPException:continue
  key='check-review:'+check['id']+':'+str(day)
  if not db.execute(sa.select(m.notification.c.id).where(m.notification.c.recipient_user_id==user,m.notification.c.trigger_key==key)).first():
   notify(db,'controls',check['id'],user,'CHECK_REVIEW_DUE',key);created+=1
 audit(db,None,'delivery_monitoring','scheduler','SWEEP_COMPLETED',new={'business_date':day,'created':created,'channel':'IN_APP'})
 return {'created':created,'business_date':day,'channel':'IN_APP'}
