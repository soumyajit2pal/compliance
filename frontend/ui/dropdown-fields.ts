import {state} from '../core/state.ts';
import {esc, field, select} from './components.ts';
import {detailFields, panel} from './widgets.ts';

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
    if (!definition.active) return previous ? field(previous.field_label, '<span>'+esc(previous.label)+'</span>', 'Retired field') : '';
    const choices=configuration().lists[definition.source].options.filter(o=>o.active).map(o=>({id:o.code,name:o.label}));
    if(previous && !choices.some(o=>o.id===previous.code)) choices.push({id:previous.code,name:previous.label+' · retired'});
    return field(definition.label,select('custom.'+key, choices, previous?.code || '', 'name',
      'data-custom-field="'+esc(key)+'" '+(definition.required?'required':'')));
  }).join('');
}

export function captureCustom(form:HTMLFormElement, flat?:Record<string,any>) {
  const answers:Record<string,string|null>={};
  for(const control of form.querySelectorAll<HTMLSelectElement>('select[data-custom-field]')){
    answers[control.dataset.customField]=control.value || null;
    if(flat) delete flat[control.name];
  }
  return answers;
}

export function customDetails(answers:Answers={}) {
  const saved=Object.values(answers);
  return saved.length ? panel('Additional fields',detailFields(saved.map(a=>[a.field_label,esc(a.label)]))) : '';
}

export function classificationOptions(key:string,retained:string) {
  return (state.masters?.[key] || []).filter(r=>r.active_flag || r.code===retained)
    .sort((a,b)=>a.display_sequence-b.display_sequence || a.name.localeCompare(b.name))
    .map(r=>({...r,id:r.code}));
}
export function classificationName(key:string,code:string) {
  return state.masters?.[key]?.find(r=>r.code===code)?.name || code;
}
