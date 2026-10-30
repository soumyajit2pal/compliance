"""Approved organisation hierarchy and ten STANDARD seed accounts.

Frozen installation snapshot. MERGE preserves existing credentials, profiles,
activation state and role scope. Reserved identities are checked before DML.
"""
from datetime import date
import json
from uuid import UUID, uuid5

from alembic import op
import bcrypt
import sqlalchemy as sa
from sqlalchemy.dialects import oracle

NAMESPACE = UUID("54db3707-2125-5f98-af13-cafbe8bfc9a4")
START = date(2026, 10, 17)

ORGANISATION_HIERARCHY = [('BANK', 'Bank of Maharashtra', 'BANK', None, 0),
 ('COMPLIANCE', 'Compliance Department', 'DEPARTMENT', 'BANK', 1),
 ('RETAIL', 'Retail Banking', 'DEPARTMENT', 'BANK', 1),
 ('OPERATIONS', 'Banking Operations', 'DEPARTMENT', 'BANK', 1),
 ('CREDIT', 'Credit and Risk', 'DEPARTMENT', 'BANK', 1),
 ('IT', 'Information Technology', 'DEPARTMENT', 'BANK', 1),
 ('PUNE-ZONE', 'Pune Zone', 'ZONE', 'OPERATIONS', 2),
 ('PUNE-BRANCH', 'Pune Main Branch', 'BRANCH', 'PUNE-ZONE', 3)]

APPLICATION_ROLES = [('ADMIN', 'Admin'),
 ('AUTHOR', 'Author'),
 ('REVIEWER', 'Reviewer'),
 ('APPROVER', 'Approver'),
 ('BUSINESS_OWNER', 'Business Owner'),
 ('CONTROL_OWNER', 'Control Owner'),
 ('EVIDENCE_OWNER', 'Evidence Owner'),
 ('CCO', 'CCO'),
 ('ZONE_VIEWER', 'Zone Viewer')]

SEED_USERS = [('admin', 'System Administrator', 'ADMIN', 'COMPLIANCE', True),
 ('author', 'Regulatory Author', 'AUTHOR', 'COMPLIANCE', True),
 ('reviewer', 'Compliance Reviewer', 'REVIEWER', 'COMPLIANCE', True),
 ('approver', 'Final Approver', 'APPROVER', 'COMPLIANCE', True),
 ('retail.owner', 'Retail Business Owner', 'BUSINESS_OWNER', 'RETAIL', False),
 ('operations.owner', 'Operations Business Owner', 'BUSINESS_OWNER', 'OPERATIONS', False),
 ('control.owner', 'Control Owner', 'CONTROL_OWNER', 'RETAIL', False),
 ('evidence.owner', 'Evidence Owner', 'EVIDENCE_OWNER', 'RETAIL', False),
 ('cco', 'Chief Compliance Office', 'CCO', 'COMPLIANCE', True),
 ('zone.viewer', 'Zone Viewer', 'ZONE_VIEWER', 'PUNE-ZONE', False)]

USER_IDS = {'admin': '0ebb3ca1-baee-5c0e-ae56-2cfc78e67158',
 'approver': 'ffc67859-bdb7-5644-a21f-986d5e5412e6',
 'author': 'b0520e9f-e1a3-53bf-8588-b84010d4c523',
 'cco': '58af0531-a548-5e99-b43f-7e0208850f98',
 'control.owner': '82140d17-fb35-582f-95e0-a4c5417a393e',
 'evidence.owner': '4edd6cf6-98e9-51ce-8f6b-28aa01dbe125',
 'operations.owner': 'a8176c2a-1ebd-5140-8d50-e5117b14e26f',
 'retail.owner': '746a4934-b4f9-5ba3-bf05-39578974bf36',
 'reviewer': '6375b170-bc28-563f-9ca1-3d1fc155c262',
 'zone.viewer': '009b1cb1-b699-52ea-a445-11873fceee0d'}

ASSIGNMENT_IDS = {'admin': '55325ce0-b960-5423-969f-920e26b80878',
 'approver': 'd20efa10-b8dd-55bd-a52c-fe9cce78c7b6',
 'author': '4e790ed1-5411-522a-a1a5-c426e4b6b494',
 'cco': '7ba905db-aac3-5533-97c4-b54e5b05a478',
 'control.owner': '8a3776d8-4e3d-5c15-bd7f-62a2dffc39c8',
 'evidence.owner': 'a2f84e06-b7f3-5866-802c-684778306f42',
 'operations.owner': 'f53ac844-d873-5449-9311-1f276eb10da1',
 'retail.owner': '56a4a763-c170-5f02-a572-1e6fe8437391',
 'reviewer': '50587520-8d33-5941-b296-e4665c61e705',
 'zone.viewer': '3038f3b6-3e96-5124-b77c-5d4bb80a1ad2'}


def _id(entity, value):
    if entity == "user" and value in USER_IDS:
        return USER_IDS[value]
    return str(uuid5(NAMESPACE, entity + ":" + value))


def _literal(value):
    return str(sa.literal(value).compile(dialect=oracle.dialect(), compile_kwargs={"literal_binds": True}))


def _password():
    options = op.get_context().opts
    environment = options.get("seed_environment")
    configured = options.get("seed_user_password") or ""
    if environment not in {"uat", "prod"}:
        raise RuntimeError("Organisation-user seeding requires an explicit uat or prod environment.")
    if environment == "prod" and (not configured or configured == "Password@123"):
        raise RuntimeError("Prod organisation-user seeding requires a separate SEED_USER_PASSWORD.")
    password = configured or "Password@123"
    if len(password) < 12 or len(password.encode("utf-8")) > 72:
        raise RuntimeError("SEED_USER_PASSWORD must have at least 12 characters and at most 72 UTF-8 bytes.")
    return password


def _preflight():
    roles = sorted({user[2] for user in SEED_USERS})
    checks = [f"""
      SELECT COUNT(*) INTO found_count FROM cbd_role
        WHERE code IN ({', '.join(_literal(code) for code in roles)}) AND active_flag = 1;
      IF found_count <> {len(roles)} THEN
        RAISE_APPLICATION_ERROR(-20050, 'All required application roles must be active before user seeding.');
      END IF;
    """]
    for username, _, _, _, _ in SEED_USERS:
        checks.append(f"""
          SELECT COUNT(*) INTO found_count FROM cbd_user
            WHERE (username = {_literal(username)} AND id <> {_literal(_id('user', username))})
              OR (id = {_literal(_id('user', username))} AND username <> {_literal(username)});
          IF found_count <> 0 THEN
            RAISE_APPLICATION_ERROR(-20051, 'Reserved seed account belongs to another identity: {username}');
          END IF;
        """)
    for code, _, _, _, _ in ORGANISATION_HIERARCHY:
        checks.append(f"""
          SELECT COUNT(*) INTO found_count FROM cbd_organisational_unit
            WHERE code = {_literal(code)} AND id <> {_literal(_id('organisation', code))};
          IF found_count <> 0 THEN
            RAISE_APPLICATION_ERROR(-20052, 'Reserved organisation code belongs to another identity: {code}');
          END IF;
        """)
    op.execute(sa.DDL("DECLARE found_count INTEGER; BEGIN\n" + "\n".join(checks) + "\nEND;"))


def _audit(entity, identifier, action, details):
    op.execute(f"""
      MERGE INTO cbd_audit_log target
      USING (SELECT {_literal(_id('audit', entity + ':' + identifier))} id FROM dual) source ON (target.id = source.id)
      WHEN NOT MATCHED THEN INSERT (id, entity_type, entity_id, action, new_value, event_at, channel, reason)
        VALUES (source.id, {_literal(entity)}, {_literal(identifier)}, {_literal(action)},
          {_literal(json.dumps(details, sort_keys=True))}, SYSTIMESTAMP, 'ALEMBIC',
          'Install the approved organisation hierarchy, seed users and role scopes.')
    """)


def install():
    password = _password()
    _preflight()
    for code, name, unit_type, parent, level in ORGANISATION_HIERARCHY:
        parent_id = "NULL" if parent is None else f"(SELECT id FROM cbd_organisational_unit WHERE code = {_literal(parent)})"
        op.execute(f"""
          MERGE INTO cbd_organisational_unit target
          USING (SELECT {_literal(_id('organisation', code))} id, {_literal(code)} code FROM dual) source
          ON (target.code = source.code)
          WHEN NOT MATCHED THEN INSERT (id, code, name, unit_type, parent_org_unit_id, level_number, active_flag, effective_from)
            VALUES (source.id, source.code, {_literal(name)}, {_literal(unit_type)}, {parent_id}, {level}, 1, {_literal(START)})
        """)
    for username, full_name, role, department, global_scope in SEED_USERS:
        user_id = _id("user", username)
        encoded_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")
        op.execute(f"""
          MERGE INTO cbd_user target USING (SELECT {_literal(user_id)} id FROM dual) source ON (target.id = source.id)
          WHEN NOT MATCHED THEN INSERT
            (id, username, full_name, email, login_type, password_hash, org_unit_id, active_flag, must_change_password_flag)
            VALUES (source.id, {_literal(username)}, {_literal(full_name)}, {_literal(username + '@example.invalid')},
              'STANDARD', {_literal(encoded_hash)}, (SELECT id FROM cbd_organisational_unit WHERE code = {_literal(department)}), 1, 1)
        """)
        scope = "NULL" if global_scope else f"(SELECT id FROM cbd_organisational_unit WHERE code = {_literal(department)})"
        assignment_id = ASSIGNMENT_IDS.get(username, _id("user_role", username + ":" + role))
        op.execute(f"""
          MERGE INTO cbd_user_role target
          USING (SELECT {_literal(assignment_id)} id, {_literal(user_id)} user_id, r.id role_id
            FROM cbd_role r WHERE r.code = {_literal(role)}) source
          ON (target.user_id = source.user_id AND target.role_id = source.role_id)
          WHEN NOT MATCHED THEN INSERT (id, user_id, role_id, scope_org_unit_id, global_scope_flag, effective_from)
            VALUES (source.id, source.user_id, source.role_id, {scope}, {int(global_scope)}, {_literal(START)})
        """)
        _audit("user", user_id, "RECONCILE_SEED_ACCESS", {
            "username": username, "role": role, "home_organisation": department,
            "global_scope": global_scope, "scope": None if global_scope else department})
    _audit("system", "20261017_0006", "RECONCILE_ORGANISATION_ACCESS", {
        "organisation_units": len(ORGANISATION_HIERARCHY), "application_roles": len(APPLICATION_ROLES),
        "account_definitions": len(SEED_USERS)})
