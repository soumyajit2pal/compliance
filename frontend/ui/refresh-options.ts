import { options } from './components.ts';

export const unavailableChoiceMessage = 'This option is unavailable. Choose a replacement.';

/** Replace choices in place and retain the current value, even when it needs replacing. */
export function refreshSelectOptions(control: HTMLSelectElement, choices, label = 'name', blank?: string) {
  const placeholder = blank ?? [...control.options].find(option => !option.value)?.label;
  refreshSelectMarkup(control, options(choices, control.value, label, placeholder));
}

export function refreshSelectMarkup(control: HTMLSelectElement, markup: string) {
  const value = control.value;
  const previousLabel = control.selectedOptions[0]?.label.replace(/ · (Unavailable|inactive|retired)$/i, '') || value;
  control.innerHTML = markup;
  control.value = value;
  if (value && control.value !== value) {
    const retained = new Option(previousLabel + ' · Unavailable', value, true, true);
    retained.disabled = true;
    retained.dataset.unavailable = 'true';
    control.add(retained);
    control.value = value;
  } else if (!value && control.selectedIndex < 0) {
    control.selectedIndex = 0;
  }
  clearUnavailableChoiceError(control);
}

export function clearUnavailableChoiceError(control: HTMLSelectElement) {
  if (!control.selectedOptions[0]?.hasAttribute('data-unavailable') &&
      control.validationMessage === unavailableChoiceMessage) control.setCustomValidity('');
}
