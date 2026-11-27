import { dialog } from '../core/dom.ts';
import { compareSourceClauses } from '../core/clause-order.ts';
import { area, esc, field, input, options, select, title } from '../ui/components.ts';
import { modal } from '../ui/dialog.ts';
import { sourceLocationField, updateSourceLocation } from './clause-source-location.ts';

export interface ClauseDraftTarget {
  id: string;
  instrument_id: string;
  name: string;
  clauses: Record<string, any>[];
}

const controlFlags = ['mandatory', 'conditional', 'reporting', 'disclosure', 'retention'];
const hierarchyFields = [
  ['source_chapter', 'Chapter', 'Chapter I - Preliminary', 500],
  ['source_section', 'Section', 'C. Definitions', 500],
  ['source_paragraph', 'Paragraph', '4', 100],
  ['source_subparagraph', 'Subparagraph', '(1)', 100],
  ['source_item', 'Item', '(i)', 100],
] as const;

function hierarchyFieldsMarkup() {
  const controls = hierarchyFields.map(([name, label, placeholder, max]) =>
    field(label, input(name, '', 'text', `maxlength="${max}" placeholder="${placeholder}" ${name === 'source_chapter' ? 'required' : ''}`)));
  return `<fieldset class="clause-source-hierarchy full" data-source-hierarchy>
    <legend>Source hierarchy</legend>
    <div class="clause-heading-parts">${controls.slice(0, 2).join('')}</div>
    <div class="clause-number-parts">${controls.slice(2).join('')}</div>
    <p class="field-hint" data-source-number-preview aria-live="polite"></p>
    <p class="field-hint">For a direct child such as 4(i), put (i) in Subparagraph. Save a subparagraph’s introductory wording with Item blank before adding its items.</p>
  </fieldset>`;
}

function syncLocationFields(form: HTMLFormElement, hierarchy: HTMLFieldSetElement) {
  const get = (name: string) => hierarchy.querySelector<HTMLInputElement>(`[name=${name}]`);
  const [chapter, section, paragraph, subparagraph, item] = hierarchyFields.map(([name]) => get(name).value.trim());
  get('source_paragraph').required = Boolean(subparagraph || item);
  get('source_subparagraph').required = Boolean(item);
  const reference = (value: string) => value ? `(${value.replace(/^\(|\)$/g, '')})` : '';
  const citation = paragraph + reference(subparagraph) + reference(item);
  const location = hierarchy.querySelector<HTMLElement>('[data-source-number-preview]');
  location.textContent = item && !subparagraph ? 'Enter Subparagraph to place this Item under the right parent.' : '';
  if (chapter && paragraph && (!item || subparagraph)) {
    const parent = paragraph + (item ? reference(subparagraph) : '');
    location.textContent = citation === paragraph
      ? `Source clause / para number ${citation}`
      : `Parent ${parent} · Source clause / para number ${citation}`;
  }
  const complete = chapter && (!(subparagraph || item) || paragraph) && (!item || subparagraph);
  updateSourceLocation(form, complete ? [chapter, section, citation] : []);
  location.hidden = !location.textContent;
}

function bindClausePlacement(form: HTMLFormElement, choice: HTMLFieldSetElement) {
  const hierarchy = form.querySelector<HTMLFieldSetElement>('[data-source-hierarchy]');
  const manual = form.querySelector<HTMLFieldSetElement>('[data-manual-clause-placement]');
  const location = form.querySelector<HTMLTextAreaElement>('[data-clause-location]');
  const drafts = { hierarchy: { value: '', edited: false }, manual: { value: '', edited: false } };
  let active: keyof typeof drafts = 'hierarchy';

  hierarchy.addEventListener('input', () => syncLocationFields(form, hierarchy));
  choice.addEventListener('change', () => {
    const next = choice.querySelector<HTMLInputElement>('input:checked').value as keyof typeof drafts;
    if (next === active) return;
    drafts[active] = { value: location.value, edited: location.hasAttribute('data-location-edited') };
    active = next;
    const fromHierarchy = next === 'hierarchy';
    hierarchy.disabled = hierarchy.hidden = !fromHierarchy;
    manual.disabled = manual.hidden = fromHierarchy;
    location.value = drafts[next].value;
    location.toggleAttribute('data-location-edited', drafts[next].edited);
    if (fromHierarchy) syncLocationFields(form, hierarchy);
    else updateSourceLocation(form, [], false);
  });
  syncLocationFields(form, hierarchy);
}

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
        name: clause.heading_only_flag ? clause.heading || 'Document heading'
          : [clause.code, clause.source_clause_reference, clause.heading].filter(Boolean).join(' · '),
      })),
    selected,
    'name',
    'Top-level clause',
  );
}

export function clauseOptionalFields(clause: Record<string, any> = {}) {
  return `${field('Bank’s internal interpretation', area('internal_interpretation', clause.internal_interpretation || '', 'maxlength="50000" rows="5"'), 'Record the bank’s explanation separately. You can complete it while the source edition is Draft.', 'full')}
    <fieldset class="clause-control-flags full"><legend>Clause requirements</legend><div>${controlFlags.map((flag) => `<label class="check-label"><input type="checkbox" name="${flag}_flag" ${(clause[flag + '_flag'] ?? flag === 'mandatory') ? 'checked' : ''}>${esc(title(flag))}</label>`).join('')}</div></fieldset>`;
}

export function originalRegulatoryTextField(wording = '') {
  return field('Original regulatory text', area('clause_text', wording, 'required maxlength="50000" rows="6"'),
    'Preserve the regulator’s wording as it appears in the source.', 'full');
}

export function openClauseDialog(targets: ClauseDraftTarget[], formId: string, clause: Record<string, any> = {}) {
  const target = targets[0];
  const headingOnly = Boolean(clause.heading_only_flag);
  const targetControl = targets.length === 1
    ? input('source_edition_label', target.name, 'text', 'readonly') +
      input('instrument_version_id', target.id, 'hidden')
    : select('instrument_version_id', targets, target.id, 'name', 'required');
  modal(
    headingOnly ? 'Edit document heading' : clause.id ? 'Edit Draft clause / para' : 'Add a source-linked clause',
    `<div class="grid clause-editor-fields">
      ${field('Instrument and source edition', targetControl, 'Only your Draft source editions are listed.', headingOnly ? 'full' : '')}
      ${headingOnly ? '' : field('Clause reference', input('code', clause.code || 'Generated on save', 'text', 'readonly'), 'Assigned automatically and kept permanently.')}
      ${clause.id ? '' : `<fieldset class="clause-placement full" data-clause-placement>
        <legend>Clause placement</legend>
        <div class="clause-placement-options">
          <label class="clause-placement-choice"><input type="radio" name="clause_placement" value="hierarchy" checked> <span>Use source hierarchy</span></label>
          <span class="clause-placement-or" aria-hidden="true">or</span>
          <label class="clause-placement-choice"><input type="radio" name="clause_placement" value="manual"> <span>Enter manually</span></label>
        </div>
      </fieldset>${hierarchyFieldsMarkup()}`}
      <fieldset class="full clause-manual-placement" data-manual-clause-placement aria-label="Manual placement"${clause.id ? '' : ' hidden disabled'}>
        ${field('Source clause / para number', input('source_clause_reference', clause.source_clause_reference || '', 'text', 'maxlength="100" placeholder="For example: 14.2 or para 5"'), 'Copy the source numbering exactly. Leave blank if the provision is unnumbered.')}
        ${field('Parent clause (optional)', `<select name="parent_clause_id">${parentOptions(target, clause.id, clause.parent_clause_id)}</select>`, 'Choose a parent from this source edition.')}
      </fieldset>
      ${field('Clause heading', input('heading', clause.heading || '', 'text', 'required maxlength="500"'), '', 'full')}
      ${sourceLocationField(clause.source_page_reference || '', !headingOnly, !clause.id)}
      ${headingOnly ? input('heading_only_flag', 'true', 'hidden') : `${originalRegulatoryTextField(clause.clause_text || '')}
      ${clauseOptionalFields(clause)}`}
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
  const placement = form.querySelector<HTMLFieldSetElement>('[data-clause-placement]');
  if (placement) bindClausePlacement(form, placement);
  form.querySelector<HTMLSelectElement>('[name=instrument_version_id]')?.addEventListener('change', (event) => {
    const selected = targets.find((item) => item.id === (event.target as HTMLSelectElement).value);
    form.dataset.instrumentId = selected?.instrument_id || '';
    form.dataset.versionId = selected?.id || '';
    form.querySelector<HTMLSelectElement>('[name=parent_clause_id]').innerHTML = selected
      ? parentOptions(selected)
      : options([], '', 'name', 'Choose a source edition first');
  });
  form.querySelector<HTMLElement>('select[name=instrument_version_id], input[name=clause_placement]:checked, input[name=heading]')?.focus();
}

export function clausePayload(form: HTMLFormElement) {
  const values: Record<string, any> = Object.fromEntries(new FormData(form));
  delete values.instrument_version_id;
  delete values.source_edition_label;
  delete values.code;
  const placement = values.clause_placement;
  delete values.clause_placement;
  const hierarchy = Object.fromEntries(hierarchyFields.map(([name]) => [name, (values[name] || '').trim()]));
  hierarchyFields.forEach(([name]) => { delete values[name]; });
  if (Object.values(hierarchy).some(Boolean)) values.source_hierarchy = hierarchy;
  for (const key of ['heading', 'parent_clause_id', 'internal_interpretation', 'source_page_reference', 'source_clause_reference']) {
    if (!values[key]) values[key] = null;
  }
  if (placement === 'hierarchy') {
    delete values.parent_clause_id;
    delete values.source_clause_reference;
  }
  for (const flag of controlFlags) {
    values[flag + '_flag'] = Boolean(form.querySelector<HTMLInputElement>(`[name=${flag}_flag]`)?.checked);
  }
  if (values.heading_only_flag) values.clause_text = values.source_clause_reference || values.heading;
  return values;
}

