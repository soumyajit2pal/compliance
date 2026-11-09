"""Scoped navigation registers over the existing governed records; no second workflow."""
from fastapi import Depends,Request,HTTPException
import sqlalchemy as sa
from . import models as m,repository as repo,obligations as obligations,notification_families as families,business_ids
from .access import READ_ROLES
from .pagination import page_query,paginate
from .obligation_workspace import workspace_rows,workspace_summary,workspace_groups,workspace_counts,current as current_owner,response as coverage_owner_response


def selected(db,table,column,identifiers):
    """Keep Oracle IN lists bounded for both large registers and history views."""
    identifiers=list(identifiers)
    for start in range(0,len(identifiers),900):
        for row in db.execute(sa.select(table).where(column.in_(identifiers[start:start+900])).order_by(table.c.created_at,table.c.id)).mappings():yield dict(row)


def retained(filters):return filters.get('history')=='1'
def matches(row,filters,keys):
    for parameter,field in keys.items():
        if filters.get(parameter) and str(row.get(field) or '')!=filters[parameter]:return False
    needle=filters.get('q','').strip().casefold()
    return not needle or needle in str(row).casefold()


def source_label(clause,edition,instrument):
    return {'id':clause['id'],'code':clause['code'],'heading':clause['heading'],'source_clause_reference':clause['source_clause_reference'],
        'edition_id':edition['id'],'edition_number':edition['version_number'],'edition_approval':edition['approval_status'],'clause_approval':clause['approval_status'],'instrument_id':instrument['id'],'instrument_code':instrument['code'],'instrument_title':instrument['title']}


def obligation_parents(db,actor,filters):
    aliases=business_ids.aliases(db,'obligation');parents={}
    query=sa.select(m.compliance_obligation).order_by(m.compliance_obligation.c.created_at.desc(),m.compliance_obligation.c.id)
    for value in db.execute(query).mappings():
        row=dict(value)
        if not retained(filters) and (row['record_status'] not in {'DRAFT','ACTIVE'} or row['approval_status'] in {'WITHDRAWN','REJECTED'}):continue
        if not obligations.visible(db,actor,row):continue
        try:clause,edition,instrument=obligations.source(db,actor,row['primary_clause_id'])
        except HTTPException:continue
        row['legacy_codes']=aliases.get(row['id'],[])
        parents[row['id']]={'obligation':{key:row.get(key) for key in ['id','code','legacy_codes','title','version_number','created_by','record_status','approval_status','effective_from','effective_to','business_owner_unit_id','regulatory_owner_unit_id']},'source':source_label(clause,edition,instrument)}
    return parents


def ownership(db,actor,filters,parents=None):
    actor.require(READ_ROLES);parents=obligation_parents(db,actor,filters) if parents is None else parents;rows=[]
    people={r['id']:r['full_name'] for r in db.execute(sa.select(m.user.c.id,m.user.c.full_name)).mappings()}
    units={r['id']:r['name'] for r in db.execute(sa.select(m.organisational_unit.c.id,m.organisational_unit.c.name)).mappings()}
    endings={r['id']:r['effective_from'] for r in db.execute(sa.select(m.obligation_owner_change.c.id,m.obligation_owner_change.c.effective_from).where(m.obligation_owner_change.c.applied_at.is_not(None))).mappings()}
    tasks={};identifiers=list(parents)
    for start in range(0,len(identifiers),900):
        query=sa.select(m.workflow_action,m.workflow_instance.c.record_status.label('workflow_status'),m.obligation_validation_task.c.owner_id).join(
            m.workflow_instance,m.workflow_instance.c.id==m.workflow_action.c.instance_id).join(
            m.obligation_validation_task,m.obligation_validation_task.c.task_id==m.workflow_action.c.id).join(
            m.obligation_owner,m.obligation_owner.c.id==m.obligation_validation_task.c.owner_id).where(
            m.obligation_owner.c.obligation_id.in_(identifiers[start:start+900])).order_by(m.workflow_action.c.created_at,m.workflow_action.c.id)
        for task in db.execute(query).mappings():tasks[task['owner_id']]=dict(task)
    for row in selected(db,m.obligation_owner,m.obligation_owner.c.obligation_id,parents):
        if (row['approval_status']=='WITHDRAWN' or row['ended_by_change_id']) and not retained(filters):continue
        parent=parents[row['obligation_id']];task=tasks.get(row['id'])
        if row['ended_by_change_id']:row['replacement_effective_from']=endings[row['ended_by_change_id']]
        obligations.ownership_period(row,parent['obligation']['effective_to'])
        row.update(validation_decision=obligations.owner_validation(row,[task] if task else [],parent['obligation']['created_by']),
            validation_task={key:task[key] for key in ['workflow_status','decision','comments','acted_at']} if task else None,
            owner_name=people.get(row['user_id']),department_name=units.get(row['org_unit_id']))
        row.update(parent)
        if matches(row,filters,{'role':'owner_role','owner':'user_id','department':'org_unit_id','approval':'approval_status'}):rows.append(row)
    return rows


def applicability(db,actor,filters,parents=None):
    actor.require(READ_ROLES);parents=obligation_parents(db,actor,filters) if parents is None else parents;rows=[]
    names={key:{r['id']:r['name'] for r in db.execute(sa.select(getattr(m,key).c.id,getattr(m,key).c.name)).mappings()} for key in ['legal_entity','organisational_unit','product','process','channel','customer_segment','geography']}
    people={r['id']:r['full_name'] for r in db.execute(sa.select(m.user.c.id,m.user.c.full_name)).mappings()}
    for row in selected(db,m.obligation_applicability,m.obligation_applicability.c.obligation_id,parents):
        if row['approval_status']=='WITHDRAWN' and not retained(filters):continue
        row.update(parents[row['obligation_id']]);row['assessor_name']=people.get(row['assessed_by'])
        row['scope']={key:names[key].get(row[field]) for key,field in [('legal_entity','legal_entity_id'),('organisational_unit','org_unit_id'),('product','product_id'),('process','process_id'),('channel','channel_id'),('customer_segment','customer_segment_id'),('geography','geography_id')] if row[field]}
        if matches(row,filters,{'assessment':'applicability_status','department':'org_unit_id','legal_entity':'legal_entity_id','approval':'approval_status'}):rows.append(row)
    return rows


def coverage_totals(groups):
    """Count authorised, filtered whole revisions before response pagination."""
    counts={'awaiting':0,'accepted':0,'objected':0,'without_accepted_business':0}
    seen=set()
    for group in groups:
        owners=[row for unit in group['departments'] for row in unit['owners'] if current_owner(row)]
        if not any(row.get('owner_role')=='BUSINESS' and row.get('primary_owner_flag') and coverage_owner_response(row)=='ACCEPT' for row in owners):counts['without_accepted_business']+=1
        for row in owners:
            if row['id'] in seen:continue
            seen.add(row['id']);key={'PENDING':'awaiting','ACCEPT':'accepted','OBJECT':'objected'}.get(coverage_owner_response(row))
            if key:counts[key]+=1
    return counts


def obligation_coverage(db,actor,filters,perspective,parents=None):
    """Page whole authorised revisions, never a partial collection of their departments.

    Filters select obligations by a matching department; all recorded departments
    remain in the response. Owner assignments do not establish applicability.
    """
    actor.require(READ_ROLES)
    if filters.get('response') and filters['response'] not in {'PENDING','ACCEPT','OBJECT'}:raise HTTPException(422,'Choose a listed owner response.')
    parents=obligation_parents(db,actor,filters) if parents is None else parents
    groups={key:{**parent,'departments':{},'unallocated_assessments':[]} for key,parent in parents.items()}
    selection={'history':filters.get('history','')}
    for collection,rows in [('owners',ownership(db,actor,selection,parents)),('assessments',applicability(db,actor,selection,parents))]:
        for value in rows:
            group=groups[value['obligation_id']]
            row={key:item for key,item in value.items() if key not in {'obligation','source'}}
            unit=row.get('org_unit_id')
            if unit is None:
                group['unallocated_assessments'].append(row)
                continue
            department=group['departments'].setdefault(unit,{'id':unit,'name':None,'owners':[],'assessments':[]})
            department['name']=department['name'] or row.get('department_name') or row.get('scope',{}).get('organisational_unit')
            department[collection].append(row)
    assessment_filters={key:filters.get(parameter) for parameter,key in [('assessment','applicability_status'),('legal_entity','legal_entity_id'),('assessment_approval','approval_status')] if filters.get(parameter)}
    owner_filters={key:filters.get(parameter) for parameter,key in [('role','owner_role'),('owner','user_id'),('assignment_approval','approval_status')] if filters.get(parameter)}
    if filters.get('approval'):
        (assessment_filters if perspective=='applicability' else owner_filters).setdefault('approval_status',filters['approval'])
    def row_matches(row,values):return all(str(row.get(key) or '')==value for key,value in values.items())
    def department_matches(department):
        if filters.get('department') and department['id']!=filters['department']:return False
        if assessment_filters and not any(row_matches(row,assessment_filters) for row in department['assessments']):return False
        if (owner_filters or filters.get('response') or filters.get('mine')=='1') and not any(
            row_matches(row,owner_filters) and (not filters.get('response') or coverage_owner_response(row)==filters['response']) and
            (filters.get('mine')!='1' or current_owner(row) and row['user_id']==actor.id) for row in department['owners']):return False
        return True
    has_filters=bool(assessment_filters or owner_filters or filters.get('department') or filters.get('response') or filters.get('mine')=='1')
    result=[]
    for group in groups.values():
        group['departments']=sorted(group['departments'].values(),key=lambda unit:((unit['name'] or unit['id']).casefold(),unit['id']))
        candidates=[*group['departments'],{'id':None,'assessments':group['unallocated_assessments'],'owners':[]}]
        matching=[unit['id'] for unit in candidates if department_matches(unit) and (unit['assessments'] or unit['owners'])] if has_filters else []
        if has_filters and not matching:continue
        needle=filters.get('q','').strip().casefold()
        if needle and needle not in str(group).casefold():continue
        group['matching_department_ids']=matching
        result.append(group)
    return result


def clause_relationships(db,actor,filters):
    actor.require(READ_ROLES);rows=[]
    clauses={r['id']:r for r in repo.clause_listing(db,actor)}
    for value in db.execute(sa.select(m.clause_relationship).order_by(m.clause_relationship.c.created_at.desc(),m.clause_relationship.c.id)).mappings():
        row=dict(value)
        if not retained(filters) and row['approval_status'] not in {'IN_REVIEW','REVIEWED','APPROVED'}:continue
        if not all(row[side+'_clause_id'] in clauses for side in ['source','target']):continue
        try:instrument,unit=families.proposal_context(db,actor,'clause',row)
        except HTTPException:continue
        row['regulatory_owner_unit_id']=unit
        for side in ['source','target']:
            clause,edition,source=obligations.source(db,actor,row[side+'_clause_id']);row[side]=source_label(clause,edition,source)
            row[side]['legacy_codes']=clauses[clause['id']].get('legacy_codes',[])
        if filters.get('instrument') and filters['instrument'] not in {row['source']['instrument_id'],row['target']['instrument_id']}:continue
        if matches(row,filters,{'type':'relationship_type','approval':'approval_status'}):rows.append(row)
    return rows


def relationship_sources(db,actor):
    actor.require({'AUTHOR'});result=[];versions={r['id']:r for r in repo.source_edition_listing(db,actor)}
    instruments={r['id']:r for r in repo.listing(db,actor,{})}
    for row in repo.clause_listing(db,actor):
        version=versions.get(row['instrument_version_id']);instrument=instruments.get(row['instrument_id'])
        if not version or not instrument or not actor.covers(instrument['regulatory_owner_unit_id'],{'AUTHOR'}):continue
        if row['clause_status']=='DELETED' or version.get('cancelled_draft') or version['approval_status'] not in {'DRAFT','APPROVED'}:continue
        if version['approval_status']=='DRAFT' and version['created_by']!=actor.id:continue
        repo.read_version(db,actor,version['id'])
        result.append({key:row.get(key) for key in ['id','instrument_id','instrument_title','source_clause_reference','code','heading','version_number']})
    return result


def install(app,get_db,current):
    def workspace(db,actor,filters,perspective,paging):
        groups=obligation_coverage(db,actor,{'history':filters.get('history','')},perspective)
        rows=workspace_rows(groups,perspective,filters,actor.id)
        if filters.get('group_by') not in {None,'','obligation'}:raise HTTPException(422,'Choose obligation grouping.')
        grouped=workspace_groups(rows) if filters.get('group_by')=='obligation' else None
        result=paginate(grouped if grouped is not None else rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)
        if grouped is not None:result['counts']=workspace_counts(rows,grouped,perspective)
        result['summary']=workspace_summary(rows,perspective)
        return result

    @app.get('/api/accountability')
    def owners(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
        filters=dict(request.query_params)
        if filters.get('view')=='workspace':return workspace(db,actor,filters,'accountability',paging)
        rows=obligation_coverage(db,actor,filters,'accountability') if filters.get('view')=='obligations' else ownership(db,actor,filters)
        result=paginate(rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)
        if filters.get('view')=='obligations':result['summary']=coverage_totals(rows)
        return result
    @app.get('/api/applicability')
    def assessments(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
        filters=dict(request.query_params)
        if filters.get('view')=='workspace':return workspace(db,actor,filters,'applicability',paging)
        rows=obligation_coverage(db,actor,filters,'applicability') if filters.get('view')=='obligations' else applicability(db,actor,filters)
        result=paginate(rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)
        if filters.get('view')=='obligations':result['summary']=coverage_totals(rows)
        return result
    @app.get('/api/clause-relationships/sources')
    def sources(db=Depends(get_db),actor=Depends(current)):return relationship_sources(db,actor)
    @app.get('/api/clause-relationships')
    def relationships(request:Request,paging=Depends(page_query),db=Depends(get_db),actor=Depends(current)):
        rows=clause_relationships(db,actor,dict(request.query_params));result=paginate(rows,page=paging['page'] or 1,page_size=paging['page_size'] or 25)
        result['decision_tasks']=families.proposal_tasks(db,actor,{r['id'] for r in result['items']})
        return result
