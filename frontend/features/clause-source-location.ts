import { area, field } from '../ui/components.ts';

const maxLength = 1200;
const locationHint = (automatic: boolean) => automatic ? 'Filled from the source hierarchy. You can edit it or add a PDF page number.'
  : 'Enter a PDF page number or a reference to the relevant part of the source.';

export function sourceLocationField(value = '', required = true, automatic = false) {
  return `<div class="full clause-source-location">
    ${field('Source page reference', area('source_page_reference', value,
      `data-clause-location rows="2" maxlength="${maxLength}" ${required ? 'required' : ''}`),
      locationHint(automatic))}
    ${automatic ? '<button type="button" class="btn small" data-action="use-clause-hierarchy" hidden>Use hierarchy</button>' : ''}
  </div>`;
}

function validateLocation(control: HTMLTextAreaElement) {
  const value = control.value.trim();
  control.setCustomValidity(control.required && control.value && !value ? 'Enter a source page reference.'
    : [...value].length > maxLength ? 'Source page reference must fit within 1,200 characters.'
    : new TextEncoder().encode(value).length > 4000 ? 'Source page reference must fit within 4,000 UTF-8 bytes.'
    : '');
}

export function updateSourceLocation(form: HTMLFormElement, parts: string[], automatic = true) {
  const location = form.querySelector<HTMLTextAreaElement>('[data-clause-location]');
  const hint = form.querySelector('.clause-source-location .field-hint');
  const help = locationHint(automatic);
  if (hint.textContent !== help) hint.textContent = help;
  location.dataset.generatedLocation = automatic ? parts.map(part => part.trim()).filter(Boolean).join(' › ') : '';
  form.querySelector<HTMLButtonElement>('[data-action=use-clause-hierarchy]').hidden = !location.dataset.generatedLocation;
  if (automatic && !location.hasAttribute('data-location-edited')) location.value = location.dataset.generatedLocation;
  validateLocation(location);
}

export function rememberSourceLocationEdit(event: Event) {
  const control = event.target;
  if (!(control instanceof HTMLTextAreaElement) || !control.matches('[data-clause-location]')) return;
  control.dataset.locationEdited = '';
  validateLocation(control);
}

export function restoreSourceLocation(button: HTMLButtonElement) {
  const location = button.form.querySelector<HTMLTextAreaElement>('[data-clause-location]');
  delete location.dataset.locationEdited;
  location.value = location.dataset.generatedLocation;
  validateLocation(location);
  location.focus();
}

type SourceAncestor = { id: string; parent_clause_id?: string; heading?: string; source_clause_reference?: string };

export function clauseAncestors(clause: SourceAncestor, editionRows: SourceAncestor[]) {
  const byId = new Map(editionRows.map(row => [row.id, row]));
  const ancestors: SourceAncestor[] = [];
  const seen = new Set([clause.id]);
  for (let parent = byId.get(clause.parent_clause_id); parent && !seen.has(parent.id); parent = byId.get(parent.parent_clause_id)) {
    ancestors.unshift(parent);
    seen.add(parent.id);
  }
  return ancestors;
}
