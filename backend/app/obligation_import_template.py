"""Screen labels shared by obligation Excel capture, parsing and guidance."""
import re
from datetime import datetime

# key, screen label, required, guidance, illustrative value
FIELDS={
 'Obligations':[
  ('import_reference','Import reference',True,'Choose a workbook reference, such as OBL-001. Repeat it on related rows in the other three entry sheets. The permanent obligation ID is generated automatically.','OBL-001'),
  ('legacy_reference','Existing register reference',False,'Keep the reference from your earlier register, if any.','OLD-REGISTER-001'),
  ('primary_clause_id','Primary clause',True,'Choose an approved source clause from Choices. Its exact edition is retained.','Choose an approved clause from Choices'),
  ('title','Title',True,'Give this single requirement a short title.','Review customer identification evidence'),
  ('statement','Requirement',True,'Describe one actionable requirement. Split combined requirements into separate obligations.','Review customer identification evidence before opening the account.'),
  ('internal_interpretation','Internal interpretation',True,'Explain how the bank will apply the requirement. Keep original regulatory wording in its source clause.','The onboarding team records and checks the identification evidence.'),
  ('category_id','Category',True,'Choose the category name from Choices.','Choose from Choices'),
  ('obligation_nature','Nature',True,'Choose Ongoing, Periodic, Event driven or One time.','Ongoing'),
  ('frequency_id','Review / execution frequency',True,'Choose the frequency name from Choices.','Choose from Choices'),
  ('primary_domain_id','Regulatory domain',True,'Choose the regulatory domain name from Choices.','Choose from Choices'),
  ('criticality','Criticality',True,'Choose Critical, High, Medium or Low.','High'),
  ('breach_consequence','Breach consequence',True,'Explain the consequence of failing this requirement.','An account may be opened without complete identification evidence.'),
  ('evidence_standard','Evidence requirement',True,'Describe the records needed to demonstrate that the requirement was met.','Retain the checked identification record and reviewer confirmation.'),
  ('regulatory_owner_unit_id','Lead regulatory department',True,'Choose the department governing this requirement. This is separate from the business department.','Choose from Choices'),
  ('business_owner_unit_id','Accountable business department',True,'Choose the department accountable for execution. Add all named owners in Owners.','Choose from Choices'),
  ('compliance_reviewer_user_id','Compliance reviewer',True,'Choose a person with Reviewer access for the lead regulatory department, independent of the maker and final approver.','Choose from Choices'),
  ('effective_from','Effective from',True,'Use an Excel date, DD/MM/YYYY or YYYY-MM-DD.','01/11/2026'),
  ('effective_to','Effective to (exclusive)',False,'Optional. This date is excluded from the effective period and must be later than Effective from.',''),
  ('next_review_date','Next obligation review',True,'Use a date on or after Effective from.','01/02/2027'),
  ('testing_required_flag','Testing required',False,'Choose Yes or No. Blank means No.','No'),
  ('certification_required_flag','Certification required',False,'Choose Yes or No. Blank means No.','No'),
  ('reporting_required_flag','Reporting required',False,'Choose Yes or No. Blank means No.','No'),
  ('retention_required_flag','Record retention required',False,'Choose Yes or No. Blank means No.','Yes'),
  ('supporting_clause_ids','Supporting clauses',False,'Optional. Copy additional approved clauses from Choices, separated by semicolons. Do not repeat the primary clause.',''),
 ],
 'Owners':[
  ('import_reference','Import reference',True,'Match one Obligations row. Add one row per named assignment.','OBL-001'),
  ('owner_role','Owner role',True,'Choose Regulatory owner, Business owner, Control owner, Evidence owner or Data owner. Compliance reviewer is assigned on Obligations.','Business owner'),
  ('org_unit_id','Owner department',True,'Choose the department for this assignment. The person must hold the required role for this department.','Choose from Choices'),
  ('user_id','Named owner',True,'Choose a person from Choices. Business, Control and Evidence owners must be independent of the maker and reviewer.','Choose from Choices'),
  ('primary_owner_flag','Primary owner',False,'Choose Yes for exactly one Regulatory owner and one Business owner per obligation. Other assignments can be No.','Yes'),
 ],
 'Applicability':[
  ('import_reference','Import reference',True,'Match one Obligations row. Add one row per assessed business scope.','OBL-001'),
  ('legal_entity_id','Legal entity',True,'Choose the legal entity name from Choices.','Choose from Choices'),
  ('org_unit_id','Assessed department',True,'Choose the department covered by this assessment.','Choose from Choices'),
  ('product_id','Product',False,'Optional. Choose a product when the assessment is limited to that product.',''),
  ('process_id','Process',False,'Optional. Choose a process when it limits this assessment. Use Processes for the obligation process mappings.',''),
  ('channel_id','Channel',False,'Optional. Choose a channel when it limits this assessment.',''),
  ('customer_segment_id','Customer segment',False,'Optional. Choose a customer segment when it limits this assessment.',''),
  ('geography_id','Geography',False,'Optional. Choose a geography when it limits this assessment.',''),
  ('applicability_status','Applicability',True,'Choose Applicable, Partial or Not applicable.','Partial'),
  ('basis','Assessment basis / justification',True,'Explain the assessment. Not applicable needs a substantive justification of at least 20 characters.','This scope covers only the specified onboarding activity.'),
  ('conditions','Applicable component / limitations',False,'Required for Partial. Explain the included component and exclusions in at least 10 characters.','Applies to account onboarding. Ongoing account servicing is excluded.'),
  ('next_review_date','Next assessment review',True,'Use a date on or after the obligation Effective from.','01/02/2027'),
 ],
 'Processes':[
  ('import_reference','Import reference',True,'Match one Obligations row. Add one row per process and do not repeat a process.','OBL-001'),
  ('process_id','Process',True,'Choose the process name from Choices.','Choose from Choices'),
  ('relevance_type','Relevance',True,'Choose Primary, Direct, Indirect or Supporting.','Direct'),
  ('criticality','Criticality',True,'Choose Critical, High, Medium or Low.','High'),
 ],
}
SHEETS={sheet:[field[0] for field in fields] for sheet,fields in FIELDS.items()}
GUIDANCE_SHEETS={'How to fill','Example','Choices','References'}
ENUMS={
 'obligation_nature':{'Ongoing':'ONGOING','Periodic':'PERIODIC','Event driven':'EVENT_DRIVEN','One time':'ONE_TIME'},
 'criticality':{'Critical':'CRITICAL','High':'HIGH','Medium':'MEDIUM','Low':'LOW'},
 'owner_role':{'Regulatory owner':'REGULATORY','Business owner':'BUSINESS','Control owner':'CONTROL','Evidence owner':'EVIDENCE','Data owner':'DATA'},
 'applicability_status':{'Applicable':'APPLICABLE','Partial':'PARTIALLY_APPLICABLE','Not applicable':'NOT_APPLICABLE'},
 'relevance_type':{'Primary':'PRIMARY','Direct':'DIRECT','Indirect':'INDIRECT','Supporting':'SUPPORTING'},
}
CHOICE_KEYS=['primary_clause_id','category_id','frequency_id','primary_domain_id','org_unit_id','user_id',
 'legal_entity_id','product_id','process_id','channel_id','customer_segment_id','geography_id',*ENUMS,'yes_no']
CHOICE_LABELS={key:next((label for fields in FIELDS.values() for name,label,*_ in fields if name==key),key) for key in CHOICE_KEYS}
CHOICE_LABELS.update(org_unit_id='Department',user_id='Person',yes_no='Yes / No')


def label(sheet,key):return next((field[1] for field in FIELDS[sheet] if field[0]==key),key)


def canonical_header(sheet,value):
    value=str(value or '').strip().rstrip('*').strip().casefold()
    return next((key for key,name,*_ in FIELDS[sheet] if value in {key.casefold(),name.casefold()}),value)


def friendly_value(key,value):
    if isinstance(value,str):
        text=value.strip();token=re.sub(r'[\s-]+','_',text).upper()
        choices=ENUMS.get(key,{})
        for name,code in choices.items():
            if text.casefold()==name.casefold() or token==code:return code
        if key=='applicability_status' and token=='PARTIALLY_APPLICABLE':return token
        if key in {'effective_from','effective_to','next_review_date'} and text:
            for pattern in ['%d/%m/%Y','%Y-%m-%d']:
                try:return datetime.strptime(text,pattern).date().isoformat()
                except ValueError:pass
    return value


def validation_message(exc):
    """Show the same column labels in preview findings as in Excel."""
    if not hasattr(exc,'errors'):return str(exc)
    messages=[]
    for error in exc.errors():
        location=error.get('loc',());sheet={'owners':'Owners','applicability':'Applicability','processes':'Processes'}.get(location[0] if location else '', 'Obligations')
        key=location[-1] if location and isinstance(location[-1],str) else None
        name=label(sheet,key) if key else sheet
        message='Choose '+', '.join(ENUMS[key])+'.' if key in ENUMS and error['type']=='literal_error' else error['msg'].removeprefix('Value error, ')
        messages.append(name+': '+message)
    return '; '.join(messages)
