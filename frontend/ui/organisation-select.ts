import { state } from '../core/state.ts';
import { esc, title } from './components.ts';

type OrganisationUnit = {
  id: string;
  name: string;
  code?: string;
  unit_type?: string;
  parent_org_unit_id?: string | null;
};

/** Use the same authorised unit IDs with readable hierarchy labels in the shared search picker. */
export function organisationUnitOptions(units: OrganisationUnit[], value = '') {
  const directory = new Map<string, OrganisationUnit>(state.masters.organisational_unit.map(unit => [unit.id, unit]));
  const groups = new Map<string, { order: string; markup: string }[]>([
    ['Departments', []],
    ['Sub-departments', []],
    ['Other organisation units', []],
  ]);

  for (const unit of units) {
    const parent = unit.parent_org_unit_id ? directory.get(unit.parent_org_unit_id) : undefined;
    const isDepartment = unit.unit_type === 'DEPARTMENT';
    const isSubDepartment = unit.unit_type === 'SUB_DEPARTMENT';
    const group = isDepartment ? 'Departments' : isSubDepartment ? 'Sub-departments' : 'Other organisation units';
    const type = title(unit.unit_type) || 'Organisation unit';
    const parentName = parent?.unit_type === 'BANK' ? '' : parent?.name;
    const label = parentName ? `${parentName} / ${unit.name}` : unit.name;
    const detail = parentName ? `${type} ${isSubDepartment ? 'of' : 'under'} ${parentName}` : type;
    const markup = `<option value="${esc(unit.id)}" data-option-title="${esc(unit.name)}"
      data-option-detail="${esc(detail)}" data-search="${esc([unit.code, parent?.code, parent?.name].join(' '))}"
      ${unit.id === value ? 'selected' : ''}>${esc(label)}</option>`;
    groups.get(group)!.push({ order: label, markup });
  }

  return `<option value="" hidden>Select organisation unit…</option>
    ${Array.from(groups, ([label, options]) => options.length ? `<optgroup label="${label}">${options
      .sort((a, b) => a.order.localeCompare(b.order, undefined, { numeric: true }))
      .map(option => option.markup).join('')}</optgroup>` : '').join('')}`;
}

export function organisationUnitSelect(name: string, units: OrganisationUnit[], value = '', extra = '') {
  return `<select class="organisation-unit-select" name="${esc(name)}" data-use-option-label
    data-search-placeholder="Search by unit name or code" ${extra}>${organisationUnitOptions(units, value)}</select>`;
}
