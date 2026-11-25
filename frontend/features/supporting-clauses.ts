import { badge, button, esc, versionLabel } from '../ui/components.ts';
import { orderSourceEdition } from '../core/clause-order.ts';

export type SourceClause = {
  id: string;
  code: string;
  instrument_id: string;
  instrument_version_id: string;
  sequence_number?: number;
  source_clause_reference?: string;
  heading?: string;
  instrument_title: string;
  version_number: string;
  clause_text?: string;
  internal_interpretation?: string;
  interpretation_status: string;
};

export const clauseTitle = (clause: SourceClause) =>
  [clause.source_clause_reference || clause.code, clause.heading].filter(Boolean).join(' · ');
export const sourceLabel = (clause: SourceClause) => `${clause.instrument_title} · Edition ${versionLabel(clause.version_number)}`;

const editionOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function supportingClausesInSourceOrder(clauses: SourceClause[]) {
  const editions = new Map<string, SourceClause[]>();
  for (const clause of clauses) {
    const edition = editions.get(clause.instrument_version_id);
    if (edition) edition.push(clause);
    else editions.set(clause.instrument_version_id, [clause]);
  }
  return [...editions.values()].sort(([a], [b]) =>
    editionOrder.compare(a.instrument_title, b.instrument_title) ||
    editionOrder.compare(a.instrument_id, b.instrument_id) ||
    editionOrder.compare(b.version_number, a.version_number) ||
    editionOrder.compare(a.instrument_version_id, b.instrument_version_id)
  ).flatMap(orderSourceEdition);
}

export function supportingClauseIds(editor: HTMLFormElement): string[] {
  return [...editor.querySelectorAll<HTMLInputElement>('[data-obl-row=citations] [data-obl-field=clause_id]')]
    .map(control => control.value);
}

export function selectedSupportingClauses(identifiers: string[], clauses: SourceClause[]) {
  if (!identifiers.length) return '';
  const selected = new Set(identifiers);
  const ordered = supportingClausesInSourceOrder(clauses);
  const byId = new Map(ordered.map(clause => [clause.id, clause]));
  const orderedIds = [...byId.keys()].filter(id => selected.has(id));
  return [...orderedIds, ...[...selected].filter(id => !byId.has(id))].map(identifier => {
    const clause = byId.get(identifier);
    const title = clause ? clauseTitle(clause) : 'Unavailable supporting clause';
    return `<li class="supporting-clause-selection" data-obl-row="citations">
      <input type="hidden" name="citations.clause_id" data-obl-field="clause_id" value="${esc(identifier)}">
      <div><strong>${esc(title)}</strong>
        ${clause ? `<small>${esc(sourceLabel(clause))}</small>${clause.interpretation_status === 'APPROVED' ? '' : badge('INTERPRETATION_PENDING')}` : ''}
      </div>
      ${button('obl-remove-supporting-clause', 'Remove', `aria-label="${esc('Remove ' + title)}"`, 'small')}
    </li>`;
  }).join('');
}
