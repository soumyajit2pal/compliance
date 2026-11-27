import { api } from '../core/api.ts';
import { esc, field, input, link, message } from '../ui/components.ts';
import { clauseOptionalFields, clausePayload, originalRegulatoryTextField } from './clause-dialog.ts';
import { sourceLocationField, updateSourceLocation } from './clause-source-location.ts';

const emptyNumberPreview = 'Enter an item label';

export function childClauseEditor(parent: Record<string, any>, parentPath: string, ancestors: { heading?: string; source_clause_reference?: string }[]) {
  const reference = parent.source_clause_reference || '';
  const label = parent.heading_only_flag ? parent.heading || 'Document heading'
    : [reference, parent.heading].filter(Boolean).join(' · ') || parent.code;
  const parentLocation = [...ancestors, parent].map(clause => ({
    heading: clause.heading?.trim() || '', number: clause.source_clause_reference?.trim() || '',
  }));
  return `<div class="clause-working-content">
    <section class="panel clause-working-detail clause-child-editor" role="region" aria-labelledby="child-clause-heading">
      <h2 id="child-clause-heading" tabindex="-1">Add child clause</h2>
      <p class="clause-child-parent">Adding under <strong>${esc(label)}</strong></p>
      <form id="add-child-clause" data-parent-path="${esc(parentPath)}"
        data-version-id="${esc(parent.instrument_version_id)}" data-parent-reference="${esc(reference)}"
        data-parent-location="${esc(JSON.stringify(parentLocation))}">
        ${input('parent_clause_id', parent.id, 'hidden')}
        <div class="grid clause-editor-fields">
          <div>
            ${field('Item label', input('item_label', '', 'text', 'required maxlength="100" autocomplete="off"'),
              reference ? 'Enter the part that follows the parent number, such as (i) or .1.' : 'Enter the label as it appears in the source.')}
            <p class="clause-child-number"><span id="child-clause-number-label">Source clause / para number</span>
              <output aria-labelledby="child-clause-number-label" aria-live="polite" data-child-citation>${emptyNumberPreview}</output>
            </p>
          </div>
          ${field('Clause heading', input('heading', '', 'text', 'required maxlength="500"'))}
          ${originalRegulatoryTextField()}
          ${sourceLocationField('', true, true)}
          <details class="full clause-child-options" open>
            <summary>Bank interpretation and clause requirements</summary>
            <div class="grid">${clauseOptionalFields()}</div>
          </details>
        </div>
        <p class="inline-error" data-dialog-feedback="error" role="alert"></p>
        <div class="actions clause-child-footer">${link(esc(parentPath), 'Cancel', 'btn')}<button type="submit" class="btn primary">Save as Draft</button></div>
      </form>
    </section>
  </div>`;
}

export function previewChildCitation(event: Event) {
  const control = event.target;
  if (!(control instanceof HTMLInputElement) || !control.matches('#add-child-clause [name=item_label]')) return;
  const label = control.value.trim();
  const parent = control.form.dataset.parentReference.trim();
  const valid = /^(?:\([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\)|\.?[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)$/u.test(label);
  const suffix = label.startsWith('(') || label.startsWith('.') ? label : '(' + label + ')';
  const citation = valid ? (parent ? parent + suffix : label) : '';
  const error = control.value && !valid ? 'Enter a single Item label, such as (i) or .1.'
    : [...citation].length > 100 ? 'Source clause / para number must fit within 100 characters.' : '';
  control.setCustomValidity(error);
  control.form.querySelector<HTMLOutputElement>('[data-child-citation]').value = error ? '—' : citation || emptyNumberPreview;
  const path: { heading: string; number: string }[] = JSON.parse(control.form.dataset.parentLocation);
  const distinct = path.filter(({ number }) =>
    !number || (number !== citation && !citation.startsWith(number + '(') && !citation.startsWith(number + '.')));
  updateSourceLocation(control.form, citation && !error ? [...distinct.map(row => row.number || row.heading), citation] : []);
}

export async function saveChildClause(form: HTMLFormElement) {
  const activeHash = location.hash;
  const result = await api('/versions/' + form.dataset.versionId + '/clauses', 'POST', clausePayload(form));
  if (location.hash !== activeHash) return;
  const [path, search] = form.dataset.parentPath.split('?');
  const query = new URLSearchParams(search);
  query.set('clause', result.id);
  message('Child clause saved in Draft.');
  location.hash = path + '?' + query.toString();
}
