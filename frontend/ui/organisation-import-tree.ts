import { childIndex } from '../core/hierarchy.ts';
import { badge, esc, title } from './components.ts';
import { icon } from './icons.ts';

export interface OrganisationImportRow {
  row: number;
  code: string;
  name: string;
  unit_type: string;
  parent_code: string;
  active_flag: boolean;
  effective_from: string;
  effective_to: string | null;
}

interface ExistingUnit {
  id: string;
  code: string;
  name: string;
  unit_type: string;
  parent_org_unit_id: string | null;
}

interface PreviewNode {
  code: string;
  name: string;
  type: string;
  parent: string | null;
  uploaded?: OrganisationImportRow;
}

const key = (code: string) => code.toUpperCase();
const indentLimit = 5;

export function organisationImportTree(rows: OrganisationImportRow[], existing: ExistingUnit[]) {
  const byId = new Map(existing.map(unit => [unit.id, unit]));
  const byCode = new Map(existing.map(unit => [key(unit.code), unit]));
  const nodes = new Map<string, PreviewNode>();
  for (const row of rows) nodes.set(key(row.code), {
    code: row.code, name: row.name, type: row.unit_type, parent: key(row.parent_code), uploaded: row,
  });

  // Show only the existing branches that lead to a proposed unit.
  for (const row of rows) {
    let parent: string | null = key(row.parent_code);
    while (parent && !nodes.has(parent)) {
      const unit = byCode.get(parent);
      const ancestor = unit?.parent_org_unit_id ? byId.get(unit.parent_org_unit_id) : undefined;
      const next = ancestor ? key(ancestor.code) : null;
      nodes.set(parent, {code: unit?.code ?? parent, name: unit?.name ?? parent, type: unit?.unit_type ?? '', parent: next});
      parent = next;
    }
  }

  const branches = childIndex([...nodes.values()], 'parent');
  const pending = (branches.get(null) ?? []).map(node => ({node, depth: 0})).reverse();
  const items: string[] = [];
  // Keep a flat DOM so a deep workbook stays readable and does not hit HTML nesting limits.
  while (pending.length) {
    const {node, depth} = pending.pop();
    const row = node.uploaded;
    const parent = node.parent ? nodes.get(node.parent) : undefined;
    const dateRange = row ? row.effective_from + ' → ' + (row.effective_to || 'Open-ended') : '';
    const metadata = [node.code, title(node.type), row && 'Excel row ' + row.row, dateRange].filter(Boolean).join(' · ');
    const parentLabel = parent
      ? `<span class="${depth > indentLimit ? 'organisation-import-parent' : 'sr-only'}">Child of ${esc(parent.name)}</span>` : '';
    items.push(`<li class="organisation-import-branch" data-code="${esc(node.code)}" data-depth="${Math.min(depth, indentLimit)}"${parent ? ` data-parent-code="${esc(parent.code)}"` : ''}>
      <div class="organisation-import-node${row ? '' : ' is-existing'}">
        <span class="organisation-import-icon">${icon(node.type === 'BRANCH' ? 'home' : 'org')}</span>
        <div class="organisation-import-label"><strong>${esc(node.name)}</strong><small>${esc(metadata)}</small>${parentLabel}</div>
        ${row ? badge(row.active_flag ? 'ACTIVE' : 'INACTIVE') : '<span class="tag neutral">Existing</span>'}
      </div>
    </li>`);
    const children = branches.get(key(node.code)) ?? [];
    for (let index = children.length - 1; index >= 0; index--) pending.push({node: children[index], depth: depth + 1});
  }
  return `<ul class="organisation-import-tree" role="list" aria-label="Proposed organisation hierarchy">${items.join('')}</ul>`;
}
