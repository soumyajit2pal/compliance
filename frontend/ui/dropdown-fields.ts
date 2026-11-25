import {state} from '../core/state.ts';
import {esc, field, select} from './components.ts';
import {detailFields, panel} from './widgets.ts';
import {refreshSelectOptions} from './refresh-options.ts';

interface SavedChoice { code:string; label:string; field_label:string }
type Answers = Record<string,SavedChoice>;
interface FieldDefinition {form:string; source:string; label:string; active:boolean; required:boolean}
const configuration = () => state.masters?.dropdown_configuration?.[0];
export function formFields(form:string) {
  return Object.entries<FieldDefinition>(configuration()?.fields || {}).filter(([,f])=>f.form===form);
}

export function customFields(form:string, answers:Answers={}) {
  return formFields(form).map(([key,definition])=>{
    const previous=answers[key];
    if (!definition.active) return previous ? `<div data-retained-custom="${esc(key)}" data-saved-code="${esc(previous.code)}" data-saved-label="${esc(previous.label)}">${field(previous.field_label, '<span>'+esc(previous.label)+'</span>', 'Retired field')}</div>` : '';
    const choices=configuration().lists[definition.source].options.filter(o=>o.active).map(o=>({id:o.code,name:o.label}));
    if(previous && !choices.some(o=>o.id===previous.code)) choices.push({id:previous.code,name:previous.label+' · retired'});
    return field(definition.label,select('custom.'+key, choices, previous?.code || '', 'name',
      'data-custom-field="'+esc(key)+'" '+(definition.required?'required':'')));
  }).join('');
}

export function customFieldGroup(form: string, answers: Answers = {}) {
  return `<div data-custom-fields="${esc(form)}">${customFields(form, answers)}</div>`;
}

export function refreshCustomFields(form: HTMLFormElement) {
  for (const group of form.querySelectorAll<HTMLElement>('[data-custom-fields]')) {
    const template = document.createElement('template');
    template.innerHTML = customFields(group.dataset.customFields);
    const existing = new Map([...group.querySelectorAll<HTMLSelectElement>('select[data-custom-field]')]
      .map(control => [control.dataset.customField, control]));
    const retained = new Map([...group.querySelectorAll<HTMLElement>('[data-retained-custom]')]
      .map(field => [field.dataset.retainedCustom, field]));
    for (const fresh of template.content.querySelectorAll<HTMLSelectElement>('select[data-custom-field]')) {
      const key = fresh.dataset.customField;
      const previous = retained.get(key);
      const control = existing.get(key) || fresh;
      const choices = [...fresh.options].filter(option => option.value).map(option => ({id: option.value, name: option.label}));
      if (previous) {
        fresh.add(new Option(previous.dataset.savedLabel, previous.dataset.savedCode, false, true));
        previous.replaceWith(fresh.closest('.field'));
      } else if (control === fresh) group.append(fresh.closest('.field'));
      existing.delete(key);
      control.disabled = false;
      delete control.dataset.refreshRetired;
      control.required = fresh.required;
      control.setAttribute('aria-label', fresh.getAttribute('aria-label'));
      control.closest('.field').querySelector('label').innerHTML = fresh.closest('.field').querySelector('label').innerHTML;
      refreshSelectOptions(control, choices);
    }
    for (const retired of existing.values()) {
      refreshSelectOptions(retired, []);
      retired.dataset.refreshRetired = 'true';
      retired.disabled = true;
    }
  }
}

export function captureCustom(form:HTMLFormElement, flat?:Record<string,any>) {
  const answers:Record<string,string|null>={};
  for(const control of form.querySelectorAll<HTMLSelectElement>('select[data-custom-field]:not([data-refresh-retired])')){
    answers[control.dataset.customField]=control.value || null;
    if(flat) delete flat[control.name];
  }
  return answers;
}

export function customDetails(answers:Answers={}) {
  const saved=Object.values(answers);
  return saved.length ? panel('Additional fields',detailFields(saved.map(a=>[a.field_label,esc(a.label)]))) : '';
}

export function classificationName(key:string,code:string) {
  return state.masters?.[key]?.find(r=>r.code===code)?.name || code;
}
