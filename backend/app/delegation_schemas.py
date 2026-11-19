from datetime import date
from typing import Annotated,Literal
from pydantic import Field,model_validator
from .schemas import Input
Id=Annotated[str,Field(min_length=1,max_length=36)]
class DelegationInput(Input):
    delegate_user_id:Id
    role_code:Literal['AUTHOR','REVIEWER','APPROVER','BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','CCO','ZONE_VIEWER']
    scope_unit_id:Id
    starts_on:date
    ends_on:date
    reason:str=Field(min_length=10,max_length=10000)
    reviewer_user_id:Id
    approver_user_id:Id
    @model_validator(mode='after')
    def duration(self):
        if not 0<=(self.ends_on-self.starts_on).days<90:raise ValueError('Choose between 1 and 90 calendar days, including the first and last day.')
        if len({self.delegate_user_id,self.reviewer_user_id,self.approver_user_id})!=3:raise ValueError('Delegate, reviewer and final approver must be different people.')
        return self
class Decision(Input):
    expected_revision:int=Field(ge=1)
    decision:Literal['REVIEW','APPROVE','REJECT','WITHDRAW','REVOKE']
    reason:str=Field(min_length=10,max_length=10000)
