"""Administrator account readiness, effective roles and access notifications."""
import sqlalchemy as sa
from .bank_time import today as bank_today
from . import models as m
from .events import notify, new_id

ACTION_STATES={'PENDING_APPROVAL','ROLE_ASSIGNMENT_REQUIRED','ROLE_REVIEW_REQUIRED','DEPARTMENT_REQUIRED','DEPARTMENT_CHANGED','DEPARTMENT_UNAVAILABLE'}


def access_state(user,assignments):
    count=sum(bool(a.get('effective_flag')) for a in assignments)
    if not user['active_flag']:
        status,label,message='INACTIVE','Inactive account','This account is disabled. Review it before restoring access.'
    elif user['login_type']=='LDAP' and (user.get('needs_email_confirmation_flag') or user.get('needs_department_selection_flag')):
        status,label,message='PROFILE_PENDING','Profile confirmation pending','The employee must confirm work email and Home organisation. Employee profile approval and role assignment remain separate.'
    elif user.get('employee_profile_required',user['login_type']=='LDAP') and user.get('employee_profile_status')!='VERIFIED':
        state=user.get('employee_profile_status')
        if state=='RECHECK_REQUIRED':status,label,message='DEPARTMENT_RECHECK','Fresh sign-in required','Employee profile approved. Fresh authentication is required before access opens.'
        elif state=='UNAVAILABLE':status,label,message='DEPARTMENT_UNAVAILABLE','LDAP department unavailable','Review the LDAP department mapping and current employee observation. Approved data is retained.'
        elif user.get('employee_approved_version_id'):status,label,message='DEPARTMENT_CHANGED','Employee profile change requires review','Review all changed employee fields against the approved snapshot; existing access remains restricted.'
        else:status,label,message='DEPARTMENT_REQUIRED','Employee profile approval required','Complete LDAP/API employee details require independent administrator approval.'
    elif not count:
        if assignments:status,label,message='ROLE_REVIEW_REQUIRED','Role review required','No assigned role is currently effective. Review role validity and organisation scope.'
        elif user['login_type']=='LDAP':status,label,message='PENDING_APPROVAL','Pending access approval','Assign approved roles and organisation scope separately from employee profile approval.'
        else:status,label,message='ROLE_ASSIGNMENT_REQUIRED','Role assignment required','This Standard account has no effective roles.'
    elif user.get('must_change_password_flag'):status,label,message='PASSWORD_CHANGE_REQUIRED','Password change required','Change the temporary password at sign-in.'
    else:status,label,message='ACCESS_READY','Access assigned','All employee, profile and effective role checks are complete.'
    return {'access_status':status,'access_status_label':label,'access_message':message,'effective_role_count':count,'admin_action_required':status in ACTION_STATES}


def assignment_rows(db):
    today = bank_today()
    rows = db.execute(sa.select(m.user_role, m.role.c.active_flag.label('role_active_flag'),
        m.role.c.code.label('role_code'), m.organisational_unit.c.active_flag.label('scope_active_flag'),
        m.organisational_unit.c.effective_from.label('scope_effective_from'),
        m.organisational_unit.c.effective_to.label('scope_effective_to'))
        .join(m.role, m.role.c.id == m.user_role.c.role_id)
        .outerjoin(m.organisational_unit, m.organisational_unit.c.id == m.user_role.c.scope_org_unit_id)
        .where(sa.or_(m.user_role.c.effective_to.is_(None), m.user_role.c.effective_to > today))).mappings()
    result = []
    for row in rows:
        item = dict(row)
        scope_valid = item['global_scope_flag'] or (item['scope_active_flag'] and
            (not item['scope_effective_from'] or item['scope_effective_from'] <= today) and
            (not item['scope_effective_to'] or item['scope_effective_to'] > today))
        item['effective_flag'] = bool(item['role_active_flag'] and item['effective_from'] <= today and scope_valid)
        result.append(item)
    return result


def account_catalogue(db):
    assignments = assignment_rows(db)
    by_user = {}
    for assignment in assignments:
        by_user.setdefault(assignment['user_id'], []).append(assignment)
    users = []
    for row in db.execute(sa.select(m.user).order_by(m.user.c.username)).mappings():
        from .employee_identity import decorate
        user = decorate(db,{k: v for k, v in row.items() if k != 'password_hash'})
        users.append({**user, **access_state(user, by_user.get(user['id'], []))})
    summary = {'total': len(users), 'standard': 0, 'ldap': 0, 'active_accounts': 0,
               'action_required': 0, 'pending_approval': 0, 'role_assignment_required': 0,
               'role_review_required': 0, 'profile_pending': 0, 'access_ready': 0,
               'password_change_required': 0, 'inactive': 0,
               'department_required':0,'department_changed':0,'department_unavailable':0,'department_recheck':0,
               'department_pending':db.execute(sa.select(sa.func.count()).select_from(m.employee_profile_review).where(m.employee_profile_review.c.status=='PENDING')).scalar_one()}
    for user in users:
        summary[user['login_type'].lower()] += 1
        summary['active_accounts'] += bool(user['active_flag'])
        summary['action_required'] += user['admin_action_required']
        summary[user['access_status'].lower()] += 1
    return {'users': users, 'assignments': assignments, 'summary': summary}


def current_access(db, identifier):
    user = db.execute(sa.select(m.user).where(m.user.c.id == identifier)).mappings().one()
    from .employee_identity import decorate
    return access_state(decorate(db,user), [a for a in assignment_rows(db) if a['user_id'] == identifier])


def notify_administrators(db, identifier, kind, *, include_user=False):
    """Only current, active administrators receive other people's access events."""
    recipients = set(db.execute(sa.select(m.user.c.id).join(m.user_role, m.user_role.c.user_id == m.user.c.id)
        .join(m.role, m.role.c.id == m.user_role.c.role_id)
        .where(m.user.c.active_flag == 1, m.role.c.active_flag == 1, m.role.c.code == 'ADMIN',
               m.user_role.c.effective_from <= bank_today(),
               sa.or_(m.user_role.c.effective_to.is_(None), m.user_role.c.effective_to > bank_today()))).scalars())
    if include_user:
        recipients.add(identifier)
    event = new_id()
    for recipient in recipients:
        notify(db, 'user', identifier, recipient, kind, 'ACCESS:' + event)
