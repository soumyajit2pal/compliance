"""Administrator account readiness, effective roles and access notifications."""
from datetime import date
import sqlalchemy as sa
from . import models as m
from .events import notify, new_id

ACTION_STATES = {'PENDING_APPROVAL', 'ROLE_ASSIGNMENT_REQUIRED', 'ROLE_REVIEW_REQUIRED',
    'LDAP_DEPARTMENT_REQUIRED','LDAP_DEPARTMENT_CHANGED','LDAP_DEPARTMENT_UNAVAILABLE'}


def access_state(user, assignments):
    """Enabled accounts, usable roles and first-login requirements are distinct."""
    count = sum(bool(a.get('effective_flag')) for a in assignments)
    if not user['active_flag']:
        status, label, message = 'INACTIVE', 'Inactive account', 'This account is disabled. Review the account before restoring access.'
    elif user['login_type']=='LDAP' and (user.get('needs_email_confirmation_flag') or user.get('needs_department_selection_flag')) and (
        user.get('ldap_department_status')=='VERIFIED' or (user.get('ldap_department_status')=='UNVERIFIED'
        and not user.get('department_code') and user.get('ldap_last_seen_department_code') and user.get('ldap_last_seen_department_name'))):
        status,label='PROFILE_PENDING','Profile confirmation pending'
        message=('Roles are assigned. The user must confirm their work email and Home organisation; LDAP department verification is separate.' if count else
                 'The user must confirm their work email and Home organisation before administrator department and access approval.')
    elif user['login_type']=='LDAP' and user.get('ldap_department_status')!='VERIFIED':
        states={
            'UNVERIFIED':('LDAP_DEPARTMENT_REQUIRED','LDAP department verification required','Review the LDAP department baseline separately from Home organisation and roles.'),
            'MISMATCH':('LDAP_DEPARTMENT_CHANGED','LDAP department changed','Access is blocked. Review the old/current LDAP department and pending update request.'),
            'UNAVAILABLE':('LDAP_DEPARTMENT_UNAVAILABLE','LDAP department unavailable','LDAP did not supply one valid code and name. Check directory attribute mappings and permissions.'),
            'RECHECK_REQUIRED':('LDAP_DEPARTMENT_RECHECK','Fresh LDAP sign-in required','The department update is approved. The user must sign in again before access opens.')}
        status,label,message=states.get(user.get('ldap_department_status'),states['UNVERIFIED'])
    elif not count:
        if assignments:
            status, label = 'ROLE_REVIEW_REQUIRED', 'Role review required'
            message = 'No assigned role is currently effective. Review role validity, availability and organisation scope.'
        elif user['login_type'] == 'LDAP':
            status, label = 'PENDING_APPROVAL', 'Pending access approval'
            message = 'Profile confirmed. Review the request and assign approved roles and organisation scope.'
        else:
            status, label = 'ROLE_ASSIGNMENT_REQUIRED', 'Role assignment required'
            message = 'This Standard account has no effective roles. Assign approved roles and organisation scope.'
    elif user.get('must_change_password_flag'):
        status, label = 'PASSWORD_CHANGE_REQUIRED', 'Password change required'
        message = 'Roles are assigned. The user must change their temporary password at sign-in.'
    else:
        status, label, message = 'ACCESS_READY', 'Access assigned', 'Effective roles are assigned. The user can sign in with the approved access.'
    return {'access_status': status, 'access_status_label': label, 'access_message': message,
            'effective_role_count': count, 'admin_action_required': status in ACTION_STATES}


def assignment_rows(db):
    today = date.today()
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
        user = {k: v for k, v in row.items() if k != 'password_hash'}
        users.append({**user, **access_state(user, by_user.get(user['id'], []))})
    summary = {'total': len(users), 'standard': 0, 'ldap': 0, 'active_accounts': 0,
               'action_required': 0, 'pending_approval': 0, 'role_assignment_required': 0,
               'role_review_required': 0, 'profile_pending': 0, 'access_ready': 0,
               'password_change_required': 0, 'inactive': 0,
               'ldap_department_required':0,'ldap_department_changed':0,'ldap_department_unavailable':0,'ldap_department_recheck':0,
               'department_pending':db.execute(sa.select(sa.func.count()).select_from(m.ldap_department_request).where(m.ldap_department_request.c.status=='PENDING')).scalar_one()}
    for user in users:
        summary[user['login_type'].lower()] += 1
        summary['active_accounts'] += bool(user['active_flag'])
        summary['action_required'] += user['admin_action_required']
        summary[user['access_status'].lower()] += 1
    return {'users': users, 'assignments': assignments, 'summary': summary}


def current_access(db, identifier):
    user = db.execute(sa.select(m.user).where(m.user.c.id == identifier)).mappings().one()
    return access_state(dict(user), [a for a in assignment_rows(db) if a['user_id'] == identifier])


def notify_administrators(db, identifier, kind, *, include_user=False):
    """Only current, active administrators receive other people's access events."""
    recipients = set(db.execute(sa.select(m.user.c.id).join(m.user_role, m.user_role.c.user_id == m.user.c.id)
        .join(m.role, m.role.c.id == m.user_role.c.role_id)
        .where(m.user.c.active_flag == 1, m.role.c.active_flag == 1, m.role.c.code == 'ADMIN',
               m.user_role.c.effective_from <= date.today(),
               sa.or_(m.user_role.c.effective_to.is_(None), m.user_role.c.effective_to > date.today()))).scalars())
    if include_user:
        recipients.add(identifier)
    event = new_id()
    for recipient in recipients:
        notify(db, 'user', identifier, recipient, kind, 'ACCESS:' + event)
