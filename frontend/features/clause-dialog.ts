import { dialog } from '../core/dom.ts';
import { compareSourceClauses } from '../core/clause-order.ts';
import { area, esc, field, input, options, select, title } from '../ui/components.ts';
import { modal } from '../ui/dialog.ts';

export interface ClauseDraftTarget {
  id: string;
  instrument_id: string;
  name: string;
  clauses: Record<string, any>[];
}

const controlFlags = ['mandatory', 'conditional', 'reporting', 'disclosure', 'retention'];

function parentOptions(target: ClauseDraftTarget, clauseId?: string, selected = '') {
  const clauses = target.clauses.filter((row) => row.instrument_version_id === target.id);
  const excluded = new Set<string>(clauseId ? [clauseId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const clause of clauses) {
      if (excluded.has(clause.parent_clause_id) && !excluded.has(clause.id)) {
        excluded.add(clause.id);
        changed = true;
      }
    }
  }
  return options(
    clauses
      .filter((clause) => !excluded.has(clause.id))
      .sort(compareSourceClauses)
      .map((clause) => ({
        id: clause.id,
        name: clause.code + (clause.source_clause_reference ? ' · ' + clause.source_clause_reference : '') + (clause.heading ? ' · ' + clause.heading : ''),
      })),
    selected,
    'name',
    'Top-level clause',
  );
}

export function openClauseDialog(targets: ClauseDraftTarget[], formId: string, clause: Record<string, any> = {}) {
  const target = targets[0];
  const targetControl = targets.length === 1
    ? input('source_edition_label', target.name, 'text', 'readonly') +
      input('instrument_version_id', target.id, 'hidden')
    : select('instrument_version_id', targets, target.id, 'name', 'required');
  modal(
    clause.id ? 'Edit Draft clause / para' : 'Add a source-linked clause',
    `<div class="grid clause-editor-fields">
      ${field('Instrument and source edition', targetControl, 'Only your Draft source editions are listed.')}
      ${field('Clause reference', input('code', clause.code || 'Generated on save', 'text', 'readonly'), 'Assigned automatically and kept permanently.')}
      ${field('Clause heading', input('heading', clause.heading || '', 'text', 'required maxlength="500"'), '', 'full')}
      ${field('Source clause / para number', input('source_clause_reference', clause.source_clause_reference || '', 'text', 'maxlength="100" placeholder="For example: 14.2 or para 5"'), 'Copy the source numbering exactly; leave blank if the provision is unnumbered.')}
      ${field('Source page reference', input('source_page_reference', clause.source_page_reference || '', 'text', 'required maxlength="50" placeholder="For example: pages 5–7"'))}
      ${field('Parent clause (optional)', `<select name="parent_clause_id">${parentOptions(target, clause.id, clause.parent_clause_id)}</select>`, 'Choose a parent from this source edition. Siblings follow source numbering, with creation order used when numbering is unavailable.', 'full')}
      ${field('Original regulatory text', area('clause_text', clause.clause_text || '', 'required maxlength="50000" rows="6"'), 'Preserve the regulator’s wording as it appears in the source.', 'full')}
      ${field('Bank’s internal interpretation', area('internal_interpretation', clause.internal_interpretation || '', 'maxlength="50000" rows="5"'), 'Record the bank’s explanation separately. You can complete it while the source edition is Draft.', 'full')}
      <fieldset class="clause-control-flags full"><legend>Control flags</legend><div>${controlFlags.map((flag) => `<label class="check-label"><input type="checkbox" name="${flag}_flag" ${(clause[flag + '_flag'] ?? flag === 'mandatory') ? 'checked' : ''}>${esc(title(flag))}</label>`).join('')}</div></fieldset>
      <p class="clause-save-guidance full">Saving keeps this clause in Draft. Submit the source edition from its Workflow tab when it is ready for independent review.</p>
    </div>`,
    formId,
    'Save clause to Draft',
    'Original regulatory wording and the bank’s interpretation are separate fields.',
  );
  dialog.classList.add('clause-editor-dialog');
  const form = dialog.querySelector<HTMLFormElement>('form');
  form.dataset.instrumentId = target.instrument_id;
  form.dataset.versionId = target.id;
  form.dataset.clauseId = clause.id||'';
  form.querySelector<HTMLSelectElement>('[name=instrument_version_id]')?.addEventListener('change', (event) => {
    const selected = targets.find((item) => item.id === (event.target as HTMLSelectElement).value);
    form.dataset.instrumentId = selected?.instrument_id || '';
    form.dataset.versionId = selected?.id || '';
    form.querySelector<HTMLSelectElement>('[name=parent_clause_id]').innerHTML = selected
      ? parentOptions(selected)
      : options([], '', 'name', 'Choose a source edition first');
  });
  form.querySelector<HTMLElement>('select[name=instrument_version_id], input[name=code]:not([readonly]), input[name=heading]')?.focus();
}

export function clausePayload(form: HTMLFormElement) {
  const values: Record<string, any> = Object.fromEntries(new FormData(form));
  delete values.instrument_version_id;
  delete values.source_edition_label;
  delete values.code;
  for (const key of ['heading', 'parent_clause_id', 'internal_interpretation', 'source_page_reference', 'source_clause_reference']) {
    if (!values[key]) values[key] = null;
  }
  for (const flag of controlFlags) {
    values[flag + '_flag'] = form.querySelector<HTMLInputElement>(`[name=${flag}_flag]`).checked;
  }
  return values;
}

