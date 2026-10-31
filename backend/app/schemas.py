from datetime import date,datetime
from pydantic import BaseModel,Field,ConfigDict,field_validator,model_validator,StringConstraints
import re
from typing import Literal,Annotated
class Input(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
class Login(Input):
    username:str=Field(min_length=1,max_length=100)
    password:str=Field(min_length=1,max_length=300)
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=False)
class Password(Input):
    current_password:str
    new_password:str
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=False)
class Onboard(Input):
    email:str=Field(min_length=3,max_length=254)
    org_unit_id:str
class InstrumentInput(Input):
    regulator_id:str
    instrument_type_id:str
    primary_domain_id:str
    secondary_domain_ids:list[str]=Field(default_factory=list,max_length=14)
    official_reference_number:str|None=Field(default=None,max_length=150)
    title:str=Field(min_length=3,max_length=500)
    short_title:str|None=Field(default=None,max_length=250)
    issue_date:date
    effective_date:date
    applicability_date:date|None=None
    materiality:Literal['CRITICAL','HIGH','MEDIUM','LOW']='MEDIUM'
    regulatory_owner_unit_id:str
    interpretation_owner_user_id:str
    source_document_id:str
    confidentiality_class_id:str
    keywords:str|None=Field(default=None,max_length=4000)
class VersionInput(Input):
    version_number:str=Field(min_length=1,max_length=30)
    version_date:date
    effective_from:date
    source_document_id:str
    change_summary:str=Field(min_length=5,max_length=10000)
    supersedes_version_id:str|None=None
    consolidated_flag:bool=False
class CancelDraftInput(Input):
    reason:str=Field(min_length=10,max_length=10000)
class ClauseInput(Input):
    code:str|None=Field(default=None,max_length=100)
    heading:str|None=Field(default=None,max_length=500)
    clause_text:Annotated[str,StringConstraints(strip_whitespace=False)]=Field(min_length=1,max_length=50000)
    internal_interpretation:Annotated[str,StringConstraints(strip_whitespace=False)]|None=Field(default=None,max_length=50000)
    parent_clause_id:str|None=None
    sequence_number:float|None=Field(default=None,ge=0,le=1000000)
    source_page_reference:str|None=Field(default=None,max_length=50)
    source_clause_reference:str|None=Field(default=None,max_length=100)
    mandatory_flag:bool=True
    conditional_flag:bool=False
    reporting_flag:bool=False
    disclosure_flag:bool=False
    retention_flag:bool=False
    @field_validator('clause_text')
    @classmethod
    def original_wording_required(cls,value):
        if not value.strip():raise ValueError('Original regulatory text must contain source wording.')
        return value
    @field_validator('internal_interpretation')
    @classmethod
    def optional_interpretation(cls,value):
        return value if value and value.strip() else None
class Submit(Input):
    reviewer_id:str
    approver_id:str
    comments:str=Field(min_length=3,max_length=10000)
class Decision(Input):
    decision:Literal['REVIEW','APPROVE','RETURN','REJECT','WITHDRAW','DELEGATE']
    comments:str=Field(min_length=3,max_length=10000)
    delegate_user_id:str|None=None
class MetadataCorrectionInput(Input):
    official_reference_number:str|None=Field(default=None,max_length=150)
    title:str|None=Field(default=None,max_length=500)
    short_title:str|None=Field(default=None,max_length=250)
    applicability_date:date|None=None
    materiality:Literal['CRITICAL','HIGH','MEDIUM','LOW']|None=None
    regulatory_owner_unit_id:str|None=None
    interpretation_owner_user_id:str|None=None
    keywords:str|None=Field(default=None,max_length=4000)
    secondary_domain_ids:list[str]|None=Field(default=None,max_length=14)
    reason:str=Field(min_length=10,max_length=10000)
    reviewer_id:str
    approver_id:str
class CommentInput(Input):
    text:str=Field(min_length=1,max_length=10000)
class CarryEntry(Input):
    source_clause_id:str
    heading:str=Field(min_length=1,max_length=500)
    clause_text:str=Field(min_length=1,max_length=50000)
    source_clause_reference:str|None=Field(default=None,max_length=100)
    source_page_reference:str=Field(min_length=1,max_length=50)
class CarryClauseInput(Input):
    source_clause_id:str
    entries:list[CarryEntry]=Field(min_length=1,max_length=100)
    verified_in_target_source:bool
    basis:str=Field(min_length=10,max_length=10000)
class FamilyReviewInput(Input):
    reviewer_id:str
    approver_id:str
class FamilyLinkInput(FamilyReviewInput):
    child_id:str
    relationship_type:Literal['AMENDS','CLARIFIES','SUPERSEDES','REPEALS']='AMENDS'
    effective_from:date
    basis:str=Field(min_length=10,max_length=10000)
class FamilyDeadlineInput(FamilyReviewInput):
    source_version_id:str
    due_date:date
    effective_from:date
    basis:str=Field(min_length=10,max_length=10000)
class FamilyAmendmentInput(FamilyReviewInput):
    instrument:InstrumentInput
    relationship_type:Literal['AMENDS','CLARIFIES','SUPERSEDES','REPEALS']='AMENDS'
    effective_from:date
    basis:str=Field(min_length=10,max_length=10000)
class FamilyScopeInput(Input):
    org_unit_id:str
    owner_user_id:str
    effective_from:date
class FamilyAssessmentInput(FamilyReviewInput):
    source_version_id:str
    outcome:Literal['COMPLETED','NO_IMPACT']
    rationale:str=Field(min_length=10,max_length=10000)
class ClauseRelationInput(FamilyReviewInput):
    target_clause_id:str
    relationship_type:Literal['AMENDS','SUPERSEDES','REFERS_TO','DEPENDS_ON','REPEALS']='AMENDS'
    effective_from:date
    description:str=Field(min_length=10,max_length=10000)
class RoleAssignment(Input):
    role_id:str
    scope_org_unit_id:str|None=None
    global_scope_flag:bool=False
class UserInput(Input):
    username:str=Field(min_length=1,max_length=100)
    full_name:str=Field(min_length=2,max_length=250)
    email:str|None=Field(default=None,max_length=254)
    org_unit_id:str|None=None
    login_type:Literal['STANDARD','LDAP']='STANDARD'
    password:str|None=Field(default=None,max_length=72)
    active_flag:bool=True
    roles:list[RoleAssignment]=Field(default_factory=list,max_length=20)

    @model_validator(mode='after')
    def validate_account_username(self):
        if self.login_type=='STANDARD' and not re.fullmatch(r'[a-zA-Z0-9._-]{2,100}',self.username):
            raise ValueError('Standard usernames require 2–100 letters, numbers, dots, underscores or hyphens.')
        if any(ord(c)<32 or ord(c)==127 for c in self.username):
            raise ValueError('Usernames must not contain control characters.')
        return self
class DomainInput(Input):
    domain_owner_unit_id:str
    active_flag:bool
class LinkInput(Input):
    url:str
    active_flag:bool
class DirectoryInput(Input):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=False)
    enabled:bool=True
    server_uri:str=Field(default='',max_length=500)
    use_ssl:bool=True
    start_tls:bool=False
    base_dn:str=Field(default='',max_length=500)
    bind_dn:str=Field(default='',max_length=500)
    bind_password:str=Field(default='',max_length=1000,repr=False)
    user_dn_template:str=Field(default='',max_length=500)
    user_search_filter:str=Field(default='(sAMAccountName={username})',max_length=500)
    ca_cert_file:str=Field(default='',max_length=1000)
    ca_certificate_action:Literal['keep','replace','remove']='keep'
    ca_certificate_data:str|None=Field(default=None,max_length=1398104,repr=False)
    ca_certificate_name:str|None=Field(default=None,max_length=255)
    attr_full_name:str=Field(default='displayName',max_length=100)
    attr_email:str=Field(default='mail',max_length=100)
    attr_department_code:str=Field(default='department',min_length=1,max_length=100)

    @field_validator('server_uri','base_dn','bind_dn','user_dn_template','user_search_filter',
                     'ca_cert_file','attr_full_name','attr_email','attr_department_code')
    @classmethod
    def strip_directory_values(cls,value):return value.strip()

class DirectoryTest(DirectoryInput):
    test_username:str=Field(min_length=1,max_length=100)
    test_password:str=Field(min_length=1,max_length=1000,repr=False)

class DepartmentRequest(Input):
    reason:str=Field(default='',max_length=1000)

class DepartmentDecision(Input):
    decision:Literal['APPROVE','REJECT']
    reason:str=Field(min_length=3,max_length=1000)
