"""Week 5 contracts; actors, hashes, stages and decisions are server-owned."""
from datetime import date
from typing import Literal
from pydantic import Field,model_validator
from .schemas import Input

class ActionInput(Input):
    obligation_id:str=Field(max_length=36)
    description:str=Field(min_length=10,max_length=10000)
    owner_unit_id:str=Field(max_length=36)
    owner_user_id:str=Field(max_length=36)
    reviewer_user_id:str=Field(max_length=36)
    escalation_user_id:str=Field(max_length=36)
    evidence_type_id:str=Field(max_length=36)
    evidence_requirement:str=Field(min_length=10,max_length=10000)
    action_type:Literal['IMPLEMENTATION','PERIODIC_REVIEW','CORRECTIVE','FOLLOW_UP']='IMPLEMENTATION'
    priority:Literal['CRITICAL','HIGH','MEDIUM','LOW']='MEDIUM'
    period_from:date
    period_to:date
    due_date:date
    retained_validation_required_flag:bool=False
    control_mapping_ids:list[str]=Field(default_factory=list,max_length=50)
    control_scope_reason:str|None=Field(default=None,max_length=10000)
    @model_validator(mode='after')
    def period(self):
        if self.period_to<self.period_from or self.due_date<self.period_to:raise ValueError('Choose an ordered period ending on or before the internal target.')
        if self.owner_user_id==self.reviewer_user_id:raise ValueError('The reviewer must be independent of the work owner.')
        return self

class Mutation(Input):
    expected_revision:int=Field(ge=1)
    reason:str=Field(default='',max_length=10000)
class Result(Mutation):
    notes:str=Field(min_length=10,max_length=10000)
class Decision(Mutation):
    decision:Literal['RETURN','COMPLETE','CANCEL']
    reason:str=Field(min_length=10,max_length=10000)
class EvidenceInput(Input):
    title:str=Field(min_length=3,max_length=500)
    evidence_type_id:str
    confidentiality_class_id:str
    retention_end_date:date
    source_system:str=Field(min_length=2,max_length=250)
    source_record:str=Field(min_length=2,max_length=250)
    repository_uri:str|None=Field(default=None,max_length=1000)
    file_hash:str|None=Field(default=None,pattern='^[a-fA-F0-9]{64}$')
    supersedes_evidence_id:str|None=None
    expected_revision:int=Field(ge=1)
class Link(Mutation):
    evidence_id:str
class EvidenceDecision(Input):
    submission_id:str
    evidence_link_id:str
    decision:Literal['ACCEPT','REJECT']
    reason:str=Field(min_length=10,max_length=10000)
    expected_revision:int=Field(ge=1)
class Extension(Mutation):
    due_date:date
    approver_id:str
    reason:str=Field(min_length=10,max_length=10000)
class ExtensionDecision(Input):
    decision:Literal['REVIEW','APPROVE','RETURN','REJECT']
    reason:str=Field(min_length=10,max_length=10000)
class ValidationInput(Mutation):
    reference:str=Field(min_length=5,max_length=250)
    procedure_text:str=Field(min_length=10,max_length=10000)
    result:Literal['PASS','FAIL']
    document_id:str
class ValidationDecision(Input):
    decision:Literal['ACCEPT','REJECT']
    reason:str=Field(min_length=10,max_length=10000)
