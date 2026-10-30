import { state } from './state.ts';

export const roles = () => new Set(state.identity?.roles || []);
export const has = (...items) => items.some((r) => roles().has(r));
export function covered(unit, allowed) {
  for (const grant of state.identity.grants) {
    if (!allowed.includes(grant.role_code)) continue;
    if (grant.global_scope_flag) return true;
    let current = unit;
    const seen = new Set();
    while (current && !seen.has(current)) {
      if (current === grant.scope_org_unit_id) return true;
      seen.add(current);
      current = state.masters.organisational_unit.find((u) => u.id === current)?.parent_org_unit_id;
    }
  }
  return false;
}
