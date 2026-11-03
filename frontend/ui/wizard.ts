/** Shared, DOM-preserving wizard navigation for native portal forms. */
import { icon } from './icons.ts';

export function showWizardStep(form: HTMLFormElement, requested: number, focus = false) {
  const panels = [...form.querySelectorAll<HTMLElement>('[data-step]')];
  const index = Math.max(0, Math.min(requested, panels.length - 1));
  form.dataset.wizard = String(index);
  panels.forEach(panel => { panel.hidden = Number(panel.dataset.step) !== index; });
  const root = form.closest('.wizard') || form;
  root.querySelectorAll<HTMLElement>('[data-step-label]').forEach((label, i) => {
    label.classList.toggle('active', i === index);
    label.classList.toggle('done', i < index);
    if (i === index) label.setAttribute('aria-current', 'step');
    else label.removeAttribute('aria-current');
    const number = label.querySelector('span');
    if (number) number.innerHTML = i < index ? icon('check') : String(i + 1);
  });
  form.querySelectorAll<HTMLElement>('[data-wizard-back],[data-action=wizard-back]').forEach(el => { el.hidden = index === 0; });
  form.querySelectorAll<HTMLElement>('[data-wizard-next],[data-action=wizard-next]').forEach(el => { el.hidden = index === panels.length - 1; });
  form.querySelectorAll<HTMLElement>('[data-wizard-finish],#wizard-create').forEach(el => { el.hidden = index !== panels.length - 1; });
  if (focus) {
    const heading = panels[index]?.querySelector<HTMLElement>('h2,h3');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    panels[index]?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  return index;
}

export function validateWizardStep(form: HTMLFormElement, index: number) {
  const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[data-step="${index}"] input,[data-step="${index}"] select,[data-step="${index}"] textarea`,
  );
  const invalid = [...controls].find(control => control.willValidate && !control.validity.valid);
  if (!invalid) return true;
  showWizardStep(form, index);
  for (let parent = invalid.parentElement; parent && parent !== form; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  invalid.reportValidity();
  return false;
}

/** Run after React commits the HTML fragment, not while the async router is rendering it. */
export function initializeWizardSteps(scope:ParentNode=document) {
  scope.querySelectorAll<HTMLFormElement>('form[data-initial-step]').forEach(form=>{
    if(form.dataset.wizardInitialized)return;
    form.dataset.wizardInitialized='1';
    showWizardStep(form,Number(form.dataset.initialStep)||0,false);
  });
}
