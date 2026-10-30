"""Read-only schema, revision, integrity and seed reconciliation."""
import json
from pathlib import Path
import sys
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.config import load_settings
from backend.app.models import metadata
from backend.app.reference_data import (
    REGULATORY_DOMAINS, ROLE_SEED_USERS, ORGANISATION_HIERARCHY, APPLICATION_ROLES,
)


def main():
    settings = load_settings()
    engine = create_engine(settings.database_url, hide_parameters=True)
    try:
        with engine.connect() as conn:
            inspector = inspect(conn)
            expected = set(metadata.tables)
            present = set(inspector.get_table_names())
            heads = set(ScriptDirectory.from_config(Config(str(ROOT / "backend/alembic.ini"))).get_heads())
            current = set(conn.execute(text("SELECT version_num FROM cbd_alembic_version")).scalars())
            invalid = conn.execute(text("SELECT object_name, object_type FROM user_objects WHERE status <> 'VALID' AND object_name LIKE 'CBD_%'")).fetchall()
            disabled = conn.execute(text("SELECT trigger_name FROM user_triggers WHERE table_name LIKE 'CBD_%' AND status <> 'ENABLED'")).scalars().all()
            missing_columns, missing_fks = {}, {}
            for name, table in metadata.tables.items():
                if name not in present:
                    continue
                columns = {c["name"] for c in inspector.get_columns(name)}
                missing = set(table.c.keys()) - columns
                if missing:
                    missing_columns[name] = sorted(missing)
                names = {fk["name"] for fk in inspector.get_foreign_keys(name)}
                missing = {fk.name for fk in table.foreign_key_constraints} - names
                if missing:
                    missing_fks[name] = sorted(missing)
            seeds = {name: conn.execute(text("SELECT COUNT(*) FROM cbd_" + name)).scalar_one()
                     for name in ["regulator", "regulatory_domain", "instrument_type", "obligation_category", "role", "status"]}
            access_counts = {name: conn.execute(text("SELECT COUNT(*) FROM cbd_" + name)).scalar_one()
                             for name in ["user", "role", "organisational_unit", "user_role"]}
            cleanup_event = conn.execute(text("SELECT new_value FROM cbd_audit_log "
                "WHERE entity_type = 'system' AND entity_id = '20261017_0007' AND action = 'CLEANUP_ACCESS_SEEDS'")).scalar_one_or_none()
            domains = dict(conn.execute(text("SELECT code, name FROM cbd_regulatory_domain")).all())
            domain_schemes = conn.execute(text("SELECT DISTINCT s.code FROM cbd_taxonomy_scheme s "
                "JOIN cbd_regulatory_domain d ON d.scheme_id = s.id ORDER BY s.code")).scalars().all()
            domain_match = domains == dict(REGULATORY_DOMAINS) and domain_schemes == ["REGULATORY"]
            organisation_rows = conn.execute(text(
                "SELECT u.code, u.name, u.unit_type, parent.code parent_code, u.level_number, u.active_flag "
                "FROM cbd_organisational_unit u LEFT JOIN cbd_organisational_unit parent ON parent.id = u.parent_org_unit_id "
                "ORDER BY u.level_number, u.code")).mappings().all()
            expected_hierarchy = {row[0]: row[1:] for row in ORGANISATION_HIERARCHY}
            hierarchy_match = all(
                (row["name"], row["unit_type"], row["parent_code"], row["level_number"]) == expected_hierarchy[row["code"]]
                and row["active_flag"] == 1
                for row in organisation_rows if row["code"] in expected_hierarchy
            ) and set(expected_hierarchy) == {row["code"] for row in organisation_rows}
            active_roles = dict(conn.execute(text("SELECT code, name FROM cbd_role WHERE active_flag = 1")).all())
            roles_match = active_roles == dict(APPLICATION_ROLES) and access_counts["role"] == len(APPLICATION_ROLES)
            usernames = {f"seed_{index}": user[0] for index, user in enumerate(ROLE_SEED_USERS)}
            user_rows = conn.execute(text(
                "SELECT u.username, r.code role_code, u.login_type, u.active_flag, "
                "u.must_change_password_flag, home.code home_department, scope_unit.code scope_department, "
                "ur.global_scope_flag, CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END has_password "
                "FROM cbd_user u JOIN cbd_user_role ur ON ur.user_id = u.id "
                "JOIN cbd_role r ON r.id = ur.role_id "
                "LEFT JOIN cbd_organisational_unit home ON home.id = u.org_unit_id "
                "LEFT JOIN cbd_organisational_unit scope_unit ON scope_unit.id = ur.scope_org_unit_id "
                "WHERE u.username IN (" + ", ".join(":" + name for name in usernames) + ") "
                "AND r.active_flag = 1 AND ur.effective_from <= TRUNC(SYSDATE) "
                "AND (ur.effective_to IS NULL OR ur.effective_to > TRUNC(SYSDATE)) "
                "ORDER BY r.code, u.username"), usernames).mappings().all()
            expected_user_roles = {(user[0], user[2]) for user in ROLE_SEED_USERS}
            present_user_roles = {(row["username"], row["role_code"]) for row in user_rows}
            user_coverage = expected_user_roles.issubset(present_user_roles)
            expected_scopes = {(u[0], u[2]): (u[3], u[4], None if u[4] else u[3]) for u in ROLE_SEED_USERS}
            scope_match = len(user_rows) == len(expected_scopes) and all(
                expected_scopes.get((row["username"], row["role_code"])) ==
                (row["home_department"], bool(row["global_scope_flag"]), row["scope_department"])
                for row in user_rows)
            account_states = {row["username"]: row for row in user_rows}
            user_summary = {"expected_count": len(ROLE_SEED_USERS), "present_users": len(account_states),
                "role_assignments": len(user_rows), "covers_all_roles": user_coverage,
                "matches_scope_policy": scope_match,
                "standard_users": sum(row["login_type"] == "STANDARD" for row in account_states.values()),
                "active_users": sum(bool(row["active_flag"]) for row in account_states.values()),
                "users_with_password_hash": sum(bool(row["has_password"]) for row in account_states.values()),
                "password_change_required": sum(bool(row["must_change_password_flag"]) for row in account_states.values()),
                "accounts": [{"username": row["username"], "role": row["role_code"],
                    "department": row["home_department"], "global_scope": bool(row["global_scope_flag"]),
                    "scope": row["scope_department"]} for row in user_rows]}
            transactions = {name: conn.execute(text("SELECT COUNT(*) FROM cbd_" + name)).scalar_one()
                     for name in ["regulatory_instrument", "compliance_obligation", "observation", "regulatory_return"]}
            enabled_constraints = conn.execute(text("SELECT constraint_name FROM user_constraints WHERE table_name LIKE 'CBD_%' AND (status <> 'ENABLED' OR validated <> 'VALIDATED')")).scalars().all()
            errors = conn.execute(text("SELECT name, line, text FROM user_errors WHERE name LIKE 'CBD_%' ORDER BY name, sequence")).fetchall()
            result = {"environment": settings.app_env, "schema": conn.execute(text("SELECT USER FROM dual")).scalar_one(),
                "current_revision": sorted(current), "expected_revision": sorted(heads),
                "model_tables": len(expected), "present_model_tables": len(expected & present),
                "model_columns": sum(len(t.c) for t in metadata.tables.values()),
                "model_foreign_keys": sum(len(t.foreign_key_constraints) for t in metadata.tables.values()),
                "missing_tables": sorted(expected - present), "missing_columns": missing_columns,
                "missing_foreign_keys": missing_fks, "invalid_objects": [list(r) for r in invalid],
                "disabled_triggers": disabled, "unvalidated_constraints": enabled_constraints,
                "compile_errors": [list(r) for r in errors], "reference_counts": seeds, "business_counts": transactions,
                "regulatory_domains": {"expected_count": len(REGULATORY_DOMAINS),
                    "matches_reference": domain_match, "schemes": domain_schemes, "codes": sorted(domains)},
                "role_user_seeds": user_summary,
                "organisation_hierarchy": {"expected_count": len(ORGANISATION_HIERARCHY),
                    "matches_reference": hierarchy_match,
                    "units": [dict(row) for row in organisation_rows]},
                "application_roles": {"expected_active_count": len(APPLICATION_ROLES),
                    "matches_reference": roles_match, "active_roles": active_roles},
                "access_counts": access_counts,
                "seed_cleanup": json.loads(cleanup_event) if cleanup_event else None,
                "enabled_triggers": conn.execute(text("SELECT COUNT(*) FROM user_triggers WHERE table_name LIKE 'CBD_%' AND status = 'ENABLED'")).scalar_one()}
            result["ok"] = (current == heads and domain_match and user_coverage and scope_match
                and hierarchy_match and roles_match and not any([result["missing_tables"], missing_columns,
                missing_fks, invalid, disabled, enabled_constraints, errors]))
            print(json.dumps(result, indent=2))
            return 0 if result["ok"] else 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
