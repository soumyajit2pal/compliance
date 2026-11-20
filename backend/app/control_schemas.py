"""Governed control definitions, mappings and period results; no client-owned approvals."""
from datetime import date
from typing import Literal, Annotated
from pydantic import Field, model_validator
from .schemas import Input

Id = Annotated[str, Field(min_length=1,max_length=36)]

class Dates(Input):
    custom_fields: dict[str,str | None] = Field(default_factory=dict,max_length=120)
    effective_from: date
    effective_to: date | None = None
    @model_validator(mode='after')
    def dates(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValueError('The end date must be after the start date (exclusive end).')
        return self

class ControlInput(Dates):
    title: str = Field(min_length=3,max_length=500)
    description: str = Field(min_length=10,max_length=10000)
    objective: str = Field(min_length=10,max_length=10000)
    control_type: str = Field(min_length=1,max_length=40)
    execution_mode: str = Field(min_length=1,max_length=40)
    frequency_id: Id
    owner_unit_id: Id
    owner_user_id: Id
    governance_unit_id: Id
    evidence_type_id: Id
    system_id: Id | None = None
    key_control_flag: bool = False
    control_status: Literal['DESIGNED','IMPLEMENTED','INEFFECTIVE','RETIRED'] = 'DESIGNED'
    review_date: date
    reason: str = Field(min_length=10,max_length=10000)
    @model_validator(mode='after')
    def review(self):
        if self.review_date < self.effective_from: raise ValueError('Review date cannot precede the effective start.')
        return self

class MappingInput(Dates):
    obligation_id: Id
    control_id: Id
    scope_unit_id: Id
    coverage_type: Literal['FULL','PARTIAL','COMPENSATING']
    coverage_percentage: float | None = Field(default=None,ge=0,le=100)
    primary_control_flag: bool = False
    mapping_rationale: str = Field(min_length=10,max_length=10000)
    gap_description: str | None = Field(default=None,max_length=10000)
    mapping_status: Literal['ACTIVE','RETIRED'] = 'ACTIVE'
    reason: str = Field(min_length=10,max_length=10000)
    @model_validator(mode='after')
    def coverage(self):
        if self.coverage_type != 'FULL' and len(self.gap_description or '') < 10:
            raise ValueError('Explain the uncovered scope or compensating limitations.')
        if self.coverage_type == 'FULL' and self.coverage_percentage not in {None,100}:
            raise ValueError('Full coverage cannot have a percentage below 100.')
        if self.coverage_type != 'FULL' and self.coverage_percentage == 100:
            raise ValueError('Partial or compensating coverage cannot claim 100 percent.')
        return self

class Expected(Input):
    expected_revision: int = Field(ge=1)
    reason: str = Field(min_length=10,max_length=10000)
class Submit(Expected):
    reviewer_user_id: Id
    approver_user_id: Id
class Decision(Expected):
    decision: Literal['REVIEW','APPROVE','RETURN','REJECT','WITHDRAW']
class Result(Input):
    expected_revision: int = Field(ge=1)
    mapping_id: Id
    performed_date: date
    result: Literal['EFFECTIVE','EXCEPTION','FAILED']
    exception_count: int = Field(ge=0)
    comments: str = Field(min_length=10,max_length=10000)
    @model_validator(mode='after')
    def exceptions(self):
        if self.result == 'EFFECTIVE' and self.exception_count:
            raise ValueError('An effective result cannot hide recorded exceptions.')
        return self
class ResultDecision(Input):
    expected_revision: int = Field(ge=1)
    decision: Literal['ACCEPT','REJECT']
    reason: str = Field(min_length=10,max_length=10000)
