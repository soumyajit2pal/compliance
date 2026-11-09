"""Authorised reporting exports; existing register/child filters precede file generation."""
import csv
import io
from datetime import date,datetime
from itertools import groupby
from zoneinfo import ZoneInfo
import sqlalchemy as sa
from fastapi import HTTPException
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment,Border,Font,PatternFill,Side
from openpyxl.utils import get_column_letter
from . import models as m,obligations as service,regulation_registers as registers
from .access import REGULATORY_ROLES
from .obligation_workspace import workspace_rows

REGISTER_FILTERS={'q','domain','department','status','criticality','owner','exception','instrument','clause','tab'}
WORKSPACE_FILTERS={'q','department','assessment','legal_entity','assessment_approval','role','owner','assignment_approval','approval','response','mine','history','gap'}
ROLE_LABELS={'REGULATORY':'Regulatory owner','BUSINESS':'Business owner','CONTROL':'Control owner','EVIDENCE':'Evidence owner','DATA':'Data owner','COMPLIANCE_REVIEWER':'Compliance reviewer','APPROVER':'Approver'}
LABELS={'BUSINESS_VALIDATION':'Owner acceptance','COMPLIANCE_REVIEW':'Compliance review','FINAL_APPROVAL':'Final approval','REVIEWED':'Awaiting final approval','IN_REVIEW':'In review','NOT_APPLICABLE':'Does not apply','PARTIALLY_APPLICABLE':'Applies in part','APPLICABLE':'Applies','NOT_STARTED':'Not requested yet','PROPOSED_BY_MAKER':'Proposed by author','REVIEW_ACCEPTED':'Review complete','ACCEPT':'Accepted','OBJECT':'Changes requested','PENDING':'Awaiting response','PRIMARY':'Main clause'}
BASE=['Obligation reference','Revision','Obligation','Regulatory instrument','Source edition','Primary clause reference']
APP_HEADERS=BASE+['Department','Legal entity','Decision','Assessment approval','Record type','Reason','Included activities & limitations','Process','Product','Channel','Customer segment','Geography','Assessed by','Assessment date','Next review','Effective from','Effective to (exclusive)']
OWNER_HEADERS=BASE+['Department','Named owner','Owner role','Primary for role','Owner response','Assignment approval','Record type','Response comments','Effective from','Effective to (exclusive)']
REGISTER_HEADERS=BASE+['Instrument title','Accountable department','Primary Business owner','Regulatory department','Compliance reviewer','Regulatory domain','Category','Frequency','Obligation nature','Record status','Approval status','Workflow stage','Criticality','Findings','Content validation','Effective from','Effective to (exclusive)','Next review','Requirement','Bank interpretation','Evidence requirement','Breach consequence','Testing required','Certification required','Reporting required','Retention required','Earlier references']


def label(value):
    return LABELS.get(value,str(value or '').replace('_',' ').capitalize())


def owner_response(row):
    decision=row.get('validation_decision');task=row.get('validation_task') or {}
    if decision=='ACCEPT' and row.get('approval_status')=='DRAFT':return 'Accepted in an earlier review'
    if decision=='PENDING' and task and task.get('workflow_status')!='OPEN':return 'Not requested yet' if row.get('approval_status')=='DRAFT' else 'Closed without a response'
    return label(decision or 'NOT_STARTED')


def lookups(db):
    result={}
    for key in ['organisational_unit','regulatory_domain','obligation_category','frequency','legal_entity','process','product','channel','customer_segment','geography','user']:
        table=getattr(m,key);column=table.c.full_name if key=='user' else table.c.name
        result[key]={row['id']:row['name'] for row in db.execute(sa.select(table.c.id,column.label('name'))).mappings()}
    return result


def ref(names,key,value):
    return names.get(key,{}).get(value,'Unavailable reference' if value else '')


def base(row):
    o=row['obligation'];source=row.get('source') or {}
    return [o['code'],o['version_number'],o['title'],source.get('instrument_code',''),source.get('edition_number',''),source.get('source_clause_reference') or source.get('code','')]


def child_record(row):
    if row['kind']=='MISSING_ASSESSMENT':return 'Not assessed'
    if row['kind']=='MISSING_OWNER':return 'Not assigned'
    if row.get('ended_by_change_id'):return 'Previous assignment — replaced'
    return 'Retained record' if row.get('retained') else 'Current record'


class DepartmentExportRow(list):
    """Keep department identity for layout without adding IDs to exported cells."""
    def __init__(self,values,department_id):
        super().__init__(values)
        self.department_id=department_id


def applicability_values(rows,names):
    result=[]
    for row in rows:
        gap=row['kind']=='MISSING_ASSESSMENT';decision=label(row.get('applicability_status')) if not gap else 'Not assessed'
        if row.get('applicability_status')=='NOT_APPLICABLE':decision='Exclusion '+({'APPROVED':'approved','REJECTED':'rejected','WITHDRAWN':'withdrawn'}.get(row.get('approval_status'),'proposed'))
        result.append(DepartmentExportRow(base(row)+[row.get('department_name') or ref(names,'organisational_unit',row.get('org_unit_id')) or 'Department not specified',ref(names,'legal_entity',row.get('legal_entity_id')),decision,label(row.get('approval_status')),child_record(row),row.get('basis'),row.get('conditions'),
            *[ref(names,key,row.get(key+'_id')) for key in ['process','product','channel','customer_segment','geography']],row.get('assessor_name') or ref(names,'user',row.get('assessed_by')),row.get('assessed_date'),row.get('next_review_date'),row.get('effective_from'),row.get('effective_to')],row.get('org_unit_id')))
    return result


def ownership_values(rows,names):
    return [DepartmentExportRow(base(row)+[row.get('department_name') or ref(names,'organisational_unit',row.get('org_unit_id')) or 'Department not specified',row.get('owner_name') or ref(names,'user',row.get('user_id')) or 'Not assigned',ROLE_LABELS.get(row.get('owner_role'),label(row.get('owner_role'))),'Yes' if row.get('primary_owner_flag') else 'No',owner_response(row) if row['kind']!='MISSING_OWNER' else 'Not requested yet',label(row.get('approval_status')),child_record(row),(row.get('validation_task') or {}).get('comments'),row.get('effective_from'),row.get('effective_to')],row.get('org_unit_id')) for row in rows]


def register_values(rows,parents,owners,names):
    result=[];primary_owners={owner['obligation']['id']:owner for owner in owners if owner['kind']=='ASSIGNMENT' and owner.get('owner_role')=='BUSINESS' and owner.get('primary_owner_flag') and not owner.get('retained')}
    for row in rows:
        primary=primary_owners.get(row['id'])
        result.append(base(parents[row['id']])+[row.get('instrument_title'),ref(names,'organisational_unit',row['business_owner_unit_id']),primary.get('owner_name') if primary else 'Not assigned',ref(names,'organisational_unit',row['regulatory_owner_unit_id']),ref(names,'user',row['compliance_reviewer_user_id']),ref(names,'regulatory_domain',row['primary_domain_id']),ref(names,'obligation_category',row['category_id']),ref(names,'frequency',row['frequency_id']),label(row['obligation_nature']),label(row['record_status']),label(row['approval_status']),label(row['stage']),label(row['criticality']),'; '.join(label(issue) for issue in row['issues']),label(row['content_validation_status']),row['effective_from'],row['effective_to'],row['next_review_date'],row['statement'],row['internal_interpretation'],row['evidence_standard'],row['breach_consequence'],*['Yes' if row[key] else 'No' for key in ['testing_required_flag','certification_required_flag','reporting_required_flag','retention_required_flag']],'; '.join(row.get('legacy_codes') or [])])
    return result


def related_sources(db,actor,parents):
    headers=['Obligation reference','Revision','Relationship','Visibility','Instrument reference','Instrument title','Source edition','Clause reference','Clause heading','Original regulatory wording','Bank interpretation']
    values=[]
    for row in registers.selected(db,m.obligation_clause_map,m.obligation_clause_map.c.obligation_id,parents):
        o=parents[row['obligation_id']]['obligation'];prefix=[o['code'],o['version_number'],label(row['link_type'])]
        try:
            clause,edition,instrument=service.source(db,actor,row['clause_id'])
            values.append(prefix+['Available',instrument['code'],instrument['title'],edition['version_number'],clause.get('source_clause_reference') or clause['code'],clause.get('heading'),clause['clause_text'],clause['internal_interpretation']])
        except HTTPException as error:
            if error.status_code not in {403,404}:raise
            values.append(prefix+['Restricted or unavailable']+['']*7)
    return 'Sources',headers,values


def related_processes(db,parents,names):
    values=[]
    for row in registers.selected(db,m.obligation_process_map,m.obligation_process_map.c.obligation_id,parents):
        o=parents[row['obligation_id']]['obligation']
        values.append([o['code'],o['version_number'],ref(names,'process',row['process_id']),'Primary' if row['relevance_type']=='PRIMARY' else label(row['relevance_type']),label(row['criticality']),row['effective_from'],row['effective_to']])
    return 'Processes',['Obligation reference','Revision','Process','Relationship','Criticality','Effective from','Effective to (exclusive)'],values


def export_data(db,actor,view,filters,identifier=None,related=False):
    actor.require(REGULATORY_ROLES)
    names=lookups(db)
    if identifier:service.read(db,actor,identifier)
    if view=='register':
        rows=service.listing(db,actor,filters)
        if identifier:rows=[row for row in rows if row['id']==identifier]
        parents={row['id']:{'obligation':row,'source':{'instrument_code':row['instrument_code'],'edition_number':row['source_version'],'source_clause_reference':row.get('source_clause_reference') or row['clause_code']}} for row in rows}
        groups=registers.obligation_coverage(db,actor,{},'accountability',parents=parents)
        owners=workspace_rows(groups,'accountability',{},actor.id)
        datasets=[('Obligations',REGISTER_HEADERS,register_values(rows,parents,owners,names))]
        if related:
            assessments=workspace_rows(groups,'applicability',{},actor.id)
            datasets.extend([('Applicability',APP_HEADERS,applicability_values(assessments,names)),('Accountability',OWNER_HEADERS,ownership_values(owners,names)),related_sources(db,actor,parents),related_processes(db,parents,names)])
        return datasets,len(rows),names
    groups=registers.obligation_coverage(db,actor,{'history':filters.get('history','')},view)
    if identifier:groups=[group for group in groups if group['obligation']['id']==identifier]
    rows=workspace_rows(groups,view,filters,actor.id)
    if view=='applicability':dataset=('Applicability',APP_HEADERS,applicability_values(rows,names))
    else:dataset=('Accountability',OWNER_HEADERS,ownership_values(rows,names))
    return [dataset],len({row['obligation']['id'] for row in rows}),names


def csv_cell(value):
    if value is None:return ''
    if isinstance(value,(date,datetime)):return value.isoformat()
    if not isinstance(value,str):return value
    if value.startswith(('\t','\r','\n')) or value.lstrip(' \t\r\n\ufeff').startswith(('=','+','-','@')):return "'"+value
    return value


def csv_bytes(dataset):
    _,headers,rows=dataset
    stream=io.StringIO(newline='');writer=csv.writer(stream)
    writer.writerow(headers)
    writer.writerows([csv_cell(value) for value in row] for row in rows)
    return ('\ufeff'+stream.getvalue()).encode('utf-8')


def department_group(row):
    name=row[len(BASE)]
    identifier=getattr(row,'department_id',name)
    # Unknown departments stay separate; matching display names alone cannot
    # combine two distinct organisational units in assessment/owner exports.
    return (identifier,name) if identifier and name else object()


def grouped_reports(datasets):
    """Presentation copies; the underlying flat data stays complete and sortable."""
    reports=[]
    for name,headers,rows in datasets:
        if name not in {'Applicability','Accountability'}:continue
        title='Grouped report' if len(datasets)==1 else 'Grouped '+name.lower()
        groups={}
        for row in rows:
            # Include all shared facts in the key so a conflicting value can
            # never be discarded by a merge, even for the same reference/revision.
            groups.setdefault(tuple(row[:len(BASE)]),[]).append(row)
        grouped=[]
        for group in groups.values():
            departments={}
            for row in group:departments.setdefault(department_group(row),[]).append(row)
            grouped.extend(row for department in departments.values() for row in department)
        reports.append((title,headers,grouped))
    return reports


def style_grouped_report(sheet,rows):
    """Merge shared labels; preserve each assessment/owner's individual facts."""
    sheet.auto_filter.ref=None
    sheet.sheet_view.showGridLines=False
    sheet.sheet_properties.tabColor='705389'
    divider=Side(style='medium',color='705389')
    subtle=Side(style='hair',color='E4DFE8')
    start=2;columns=sheet.max_column
    for number,(_,group) in enumerate(groupby(rows,key=lambda row:tuple(row[:len(BASE)]))):
        children=list(group);end=start+len(children)-1
        for row_number in range(start,end+1):
            sheet.row_dimensions[row_number].height=48
            for index in range(1,columns+1):
                cell=sheet.cell(row_number,index)
                cell.fill=PatternFill('solid',fgColor='F4EFF8' if index<=len(BASE) else 'FFFFFF' if number%2==0 else 'FAFBF8')
                cell.border=Border(top=divider if row_number==start else Side(),bottom=subtle)
        for index in range(1,len(BASE)+1):
            if end>start:sheet.merge_cells(start_row=start,end_row=end,start_column=index,end_column=index)
            cell=sheet.cell(start,index)
            cell.font=Font(bold=index in {1,3},color='42334F')
            cell.alignment=Alignment(vertical='top',wrap_text=True)
        department_start=start
        for _,department in groupby(children,key=department_group):
            department_end=department_start+len(list(department))-1
            if department_end>department_start:
                sheet.merge_cells(start_row=department_start,end_row=department_end,start_column=len(BASE)+1,end_column=len(BASE)+1)
            cell=sheet.cell(department_start,len(BASE)+1)
            cell.font=Font(bold=True,color='42334F')
            cell.alignment=Alignment(vertical='top',wrap_text=True)
            department_start=department_end+1
        # Excel cannot auto-fit merged cells. Reserve room for wrapped parent
        # text without changing or truncating the stored content.
        lines=1
        for index,value in enumerate(children[0][:len(BASE)],1):
            width=int(sheet.column_dimensions[get_column_letter(index)].width)
            wrapped=sum(max(1,(len(line)+width-1)//width) for line in str(value or '').split('\n'))
            lines=max(lines,wrapped)
        sheet.row_dimensions[start].height=min(120,max(48,16*lines+12-48*(len(children)-1)))
        start=end+1


def workbook_bytes(datasets,metadata,grouped=False):
    workbook=Workbook();workbook.remove(workbook.active)
    reports=grouped_reports(datasets) if grouped else []
    report_names={name for name,_,_ in reports}
    for name,headers,rows in [*reports,('Export info',['Field','Value'],metadata),*datasets]:
        if len(rows)>1048575:raise HTTPException(422,'This view exceeds the Excel sheet row limit. Narrow the filters or choose CSV.')
        sheet=workbook.create_sheet(name);sheet.append(headers);sheet.freeze_panes='A2'
        for row_number,row in enumerate(rows,2):
            for index,value in enumerate(row,1):
                cell=sheet.cell(row_number,index)
                if isinstance(value,str):
                    if len(value)>32767:raise HTTPException(422,'A value exceeds the Excel cell limit. Choose CSV to retain the full text.')
                    cell.value=ILLEGAL_CHARACTERS_RE.sub('\ufffd',value);cell.data_type='s'
                else:cell.value=value
                cell.alignment=Alignment(vertical='top',wrap_text=True)
                if isinstance(value,(date,datetime)):cell.number_format='yyyy-mm-dd'
        sheet.auto_filter.ref=sheet.dimensions
        for cell in sheet[1]:cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='705389');cell.alignment=Alignment(wrap_text=True,vertical='center')
        sheet.row_dimensions[1].height=32
        for index,header in enumerate(headers,1):
            sheet.column_dimensions[get_column_letter(index)].width=60 if header in {'Requirement','Bank interpretation','Original regulatory wording','Reason','Included activities & limitations','Evidence requirement','Breach consequence','Value'} else 44 if header in {'Obligation','Instrument title','Obligation reference','Regulatory instrument'} else max(16,min(28,len(header)+3))
        sheet.sheet_properties.pageSetUpPr.fitToPage=True
        if name in report_names:style_grouped_report(sheet,rows)
    output=io.BytesIO();workbook.save(output);return output.getvalue()


def build(db,actor,view,format,query,identifier=None):
    filters={key:value for key,value in query.items() if key in (REGISTER_FILTERS if view=='register' else WORKSPACE_FILTERS) and value}
    datasets,count,names=export_data(db,actor,view,filters,identifier,related=format=='xlsx' and view=='register')
    generated=datetime.now(ZoneInfo('Asia/Kolkata'))
    mode='exceptions' if view=='register' and filters.get('tab')=='reports' else view
    metadata=[['View',mode.capitalize()],['Generated at (IST)',generated.isoformat(timespec='seconds')],['Obligation revisions',count],['Scope','Selected obligation revision' if identifier else 'All authorised matching records across all pages'],['Use','Reporting export; not an import template'],['Related records','Register Excel includes current recorded assignments/assessments and gaps. Pending ownership requests are not applied assignments.'],['Approvals','Owner acceptance, assignment approval and applicability approval remain separate.'],['End dates','Effective-to dates are exclusive.'],['Excel text','Text is stored as text. Unsupported XML control characters are replaced with the replacement symbol.']]
    lookup_filters={'domain':'regulatory_domain','department':'organisational_unit','owner':'user','legal_entity':'legal_entity'}
    metadata.extend(['Filter — '+key.replace('_',' '),ref(names,lookup_filters[key],value) if key in lookup_filters else value] for key,value in sorted(filters.items()))
    metadata.extend(['Rows — '+name,len(rows)] for name,_,rows in datasets)
    metadata.append(['Excel layout','Grouped report sheets merge the six shared obligation fields and repeated departments within each revision. Every assessment/owner keeps a separate row with its own scope, decision, approval and dates. Use the unmerged data sheets for sorting and filtering.'])
    data=workbook_bytes(datasets,metadata,grouped=True) if format=='xlsx' else csv_bytes(datasets[0])
    return {'data':data,'filename':f'obligations-{mode}-{generated:%Y%m%d-%H%M%S}.{format}','count':count,'rows':{name:len(rows) for name,_,rows in datasets},'filters':filters}
