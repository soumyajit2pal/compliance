"""Week 4 contracts. Approval identity and status are never client-controlled."""
from datetime import date
from typing import Literal
from pydantic import Field,model_validator
from .schemas import Input

Criticality=Literal['CRITICAL','HIGH','MEDIUM','LOW']
OwnerRole=Literal['REGULATORY','BUSINESS','CONTROL','EVIDENCE','DATA','COMPLIANCE_REVIEWER']


class Owner(Input):
    org_unit_id:str
    user_id:str
    owner_role:OwnerRole
    primary_owner_flag:bool=False


class Applicability(Input):
    legal_entity_id:str
    org_unit_id:str
    product_id:str|None=None
    process_id:str|None=None
    channel_id:str|None=None
    customer_segment_id:str|None=None
    geography_id:str|None=None
    applicability_status:Literal['APPLICABLE','PARTIALLY_APPLICABLE','NOT_APPLICABLE']
    basis:str=Field(min_length=10,max_length=10000)
    conditions:str|None=Field(default=None,max_length=10000)
    next_review_date:date

    @model_validator(mode='after')
    def justification(self):
        if self.applicability_status=='PARTIALLY_APPLICABLE' and len((self.conditions or '').strip())<10:
            raise ValueError('Partial applicability requires conditions identifying the applicable component and limitations.')
        if self.applicability_status=='NOT_APPLICABLE' and len(self.basis)<20:
            raise ValueError('Not applicable requires a substantive justification (at least 20 characters).')
        return self


class ProcessMap(Input):
    process_id:str
    relevance_type:Literal['PRIMARY','DIRECT','INDIRECT','SUPPORTING']='DIRECT'
    criticality:Criticality='MEDIUM'


class ObligationInput(Input):
    primary_clause_id:str
    title:str=Field(min_length=3,max_length=500)
    statement:str=Field(min_length=10,max_length=20000)
    internal_interpretation:str=Field(min_length=10,max_length=20000)
    category_id:str
    obligation_nature:Literal['ONGOING','PERIODIC','EVENT_DRIVEN','ONE_TIME']='ONGOING'
    frequency_id:str
    primary_domain_id:str
    criticality:Criticality='MEDIUM'
    breach_consequence:str=Field(min_length=10,max_length=10000)
    evidence_standard:str=Field(min_length=10,max_length=10000)
    testing_required_flag:bool=False
    certification_required_flag:bool=False
    reporting_required_flag:bool=False
    retention_required_flag:bool=False
    regulatory_owner_unit_id:str
    business_owner_unit_id:str
    compliance_reviewer_user_id:str
    effective_from:date
    effective_to:date|None=None
    next_review_date:date
    supporting_clause_ids:list[str]=Field(default_factory=list,max_length=100)
    owners:list[Owner]=Field(default_factory=list,max_length=100)
    applicability:list[Applicability]=Field(default_factory=list,max_length=100)
    processes:list[ProcessMap]=Field(default_factory=list,max_length=100)
    expected_revision:int|None=Field(default=None,ge=1)
    change_reason:str=Field(default='Initial obligation capture',min_length=5,max_length=2000)

    @model_validator(mode='after')
    def periods(self):
        if self.effective_to and self.effective_to<=self.effective_from:
            raise ValueError('Effective to must be later than Effective from (exclusive end).')
        if self.next_review_date<self.effective_from or any(a.next_review_date<self.effective_from for a in self.applicability):
            raise ValueError('Review dates must be on or after the effective start.')
        if len(set(self.supporting_clause_ids))!=len(self.supporting_clause_ids) or self.primary_clause_id in self.supporting_clause_ids:
            raise ValueError('Each source clause may be linked once; keep the primary source separate.')
        if len({p.process_id for p in self.processes})!=len(self.processes):raise ValueError('Map each process once.')
        keys=[(o.owner_role,o.user_id,o.org_unit_id) for o in self.owners]
        if len(set(keys))!=len(keys):raise ValueError('Do not repeat the same owner assignment.')
        dims=[(a.legal_entity_id,a.org_unit_id,a.product_id,a.process_id,a.channel_id,a.customer_segment_id,a.geography_id) for a in self.applicability]
        if len(set(dims))!=len(dims):raise ValueError('Assess each applicability scope once.')
        return self


class Submission(Input):
    approver_id:str
    comments:str=Field(min_length=5,max_length=2000)
    expected_revision:int=Field(ge=1)


class ObligationDecision(Input):
    decision:Literal['REVIEW','ACCEPT','OBJECT','APPROVE','RETURN','REJECT','WITHDRAW','DELEGATE']
    comments:str=Field(min_length=5,max_length=10000)
    task_id:str|None=None
    delegate_user_id:str|None=None


class Revision(Input):
    reason:str=Field(min_length=10,max_length=2000)


class OwnershipChange(Revision):
    expected_revision:int=Field(ge=1)
    business_owner_unit_id:str
    compliance_reviewer_user_id:str
    owners:list[Owner]=Field(max_length=100)
    approver_id:str|None=None

    @model_validator(mode='after')
    def assignments(self):
        if any(o.owner_role=='COMPLIANCE_REVIEWER' for o in self.owners):
            raise ValueError('Select the Compliance reviewer in its dedicated field.')
        keys=[(o.owner_role,o.user_id,o.org_unit_id) for o in self.owners]
        if len(set(keys))!=len(keys):raise ValueError('Do not repeat the same owner assignment.')
        for role in ['REGULATORY','BUSINESS']:
            if sum(o.owner_role==role and o.primary_owner_flag for o in self.owners)>1:
                raise ValueError('Choose at most one primary '+role.lower()+' owner.')
        return self


class OwnershipDecision(Input):
    decision:Literal['REVIEW','ACCEPT','OBJECT','APPROVE','RETURN','REJECT','WITHDRAW']
    comments:str=Field(min_length=5,max_length=10000)
    task_id:str|None=None


class Retirement(Revision):
    pass
