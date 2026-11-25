import { covered } from '../core/access.ts';
import { api } from '../core/api.ts';
import { choosePeople } from '../core/assignees.ts';
import { subtreeIds } from '../core/hierarchy.ts';
import { state } from '../core/state.ts';
import { button, esc, localDate, message, options, organisationScopeLabel, select } from './components.ts';
import { domainChoices, refreshSecondaryDomains } from './domains.ts';
import { refreshCustomFields } from './dropdown-fields.ts';
import { organisationUnitOptions, organisationUnitSelect } from './organisation-select.ts';
import { refreshSelectMarkup, refreshSelectOptions, unavailableChoiceMessage } from './refresh-options.ts';

type ReferenceRules = {
  label?: string;
  format?: 'hierarchy' | 'scope' | 'code' | 'domain' | 'classification';
  unitTypes?: string[];
  excludeSubDepartments?: boolean;
  retainSelectedType?: boolean;
  authorScope?: boolean;
  only?: string[];
  excludeTree?: {id: string; parentField: string};
  historical?: boolean;
  draftDomains?: boolean;
  endpoint?: '/auth/departments';
};

const referenceFields = 'select[data-reference-source],select[data-reference-assignee],[data-custom-fields],[data-secondary-domain-picker]';
const assigneeRequests = new WeakMap<HTMLSelectElement, symbol>();

function available(row, today: string, includeDraftDomains: boolean) {
  return (includeDraftDomains || (row.active_flag !== 0 && row.active_flag !== false)) &&
    (!row.effective_from || row.effective_from <= today) && (!row.effective_to || row.effective_to > today);
}

function referenceChoices(source: string, rules: ReferenceRules, selected = '', fresh = true, supplied?: any[]) {
  const rows = supplied ?? state.masters?.[source] ?? [];
  const excluded = rules.excludeTree ? subtreeIds(rows, rules.excludeTree.parentField, rules.excludeTree.id) : new Set();
  const today = localDate();
  // Instrument drafts can use domains whose review submissions are disabled.
  const includeDraftDomains = source === 'regulatory_domain' && (rules.format === 'domain' || rules.draftDomains);
  const eligible = row => available(row, today, includeDraftDomains);
  const choices = rows.filter(row => !excluded.has(row.id) && (!rules.only || rules.only.includes(row.id)) &&
    (!rules.authorScope || covered(row.id, ['AUTHOR'])) &&
    ((!rules.unitTypes || rules.unitTypes.includes(row.unit_type)) &&
    (!rules.excludeSubDepartments || row.unit_type !== 'SUB_DEPARTMENT') || rules.retainSelectedType && row.id === selected) &&
    (eligible(row) || rules.historical || (!fresh && (rules.format === 'classification' ? row.code : row.id) === selected)));
  if (rules.format === 'domain') return domainChoices(choices);
  if (rules.format === 'classification') return choices.map(row => ({...row, id: row.code, option_status: eligible(row) ? '' : 'Unavailable'}))
    .sort((a, b) => a.display_sequence - b.display_sequence || a.name.localeCompare(b.name));
  return choices.map(row => ({ ...row,
    name: rules.format === 'scope' ? organisationScopeLabel(row.id) : rules.format === 'code' ? `${row.code} · ${row.name}` : row.name,
    option_status: eligible(row) ? '' : 'Unavailable',
  }));
}

/** Declare the authoritative source alongside the native field so it can be refreshed in place. */
export function referenceSelect(name: string, source: string, value = '', extra = '', blank?: string, rules: ReferenceRules = {}, supplied?: any[]) {
  const rows = referenceChoices(source, rules, value, false, supplied);
  if (rules.historical && value && !rows.some(row => row.id === value)) rows.push({id: value, name: value, option_status: 'Unavailable'});
  const attributes = `data-reference-source="${esc(source)}" data-reference-rules="${esc(JSON.stringify(rules))}" ${extra}`;
  return rules.format === 'hierarchy' ? organisationUnitSelect(name, rows, value, attributes)
    : select(name, rows, value, rules.label || 'name', attributes, blank);
}

export function referenceAssignee(role: string, unitField: string, independent = false, fixedUnit = '', obligation = '') {
  return `data-reference-assignee="${esc(role)}" data-reference-unit-field="${esc(unitField)}" data-reference-unit="${esc(fixedUnit)}" data-reference-obligation="${esc(obligation)}" ${independent ? 'data-reference-independent' : ''}`;
}

export function referenceRefreshButton() {
  return button('refresh-reference-options', 'Refresh options', '', 'small');
}

/** Insert one action per eligible form or wizard step, including dynamically mounted dialogs. */
export function installReferenceRefresh() {
  const install = () => {
    for (const form of document.querySelectorAll<HTMLFormElement>('#app form, #dialog form')) {
      if (form.querySelector('[data-action=obl-refresh-options]') || form.hasAttribute('data-reference-toolbar')) continue;
      const scopes = new Set([...form.querySelectorAll(referenceFields)].map(field => field.closest('[data-step]') || form));
      for (const scope of scopes) {
        if (scope.querySelector(':scope > .reference-refresh-tools')) continue;
        const header = scope.querySelector(':scope > .eyebrow');
        if (header) {
          header.insertAdjacentHTML('beforebegin', `<div class="reference-refresh-tools reference-refresh-step">${referenceRefreshButton()}</div>`);
          header.parentElement.querySelector(':scope > .reference-refresh-step').prepend(header);
        } else {
          scope.insertAdjacentHTML('afterbegin', `<div class="reference-refresh-tools">${referenceRefreshButton()}</div>`);
        }
      }
    }
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node instanceof Element &&
      (node.matches(`form,${referenceFields}`) || node.querySelector(`form,${referenceFields}`))))) install();
  });
  observer.observe(document.body, { subtree: true, childList: true });
  install();
}

export function acceptReferenceSnapshot(fresh: Record<string, any[]>) {
  if ((fresh.dropdown_configuration?.[0]?.revision || 0) >= (state.masters?.dropdown_configuration?.[0]?.revision || 0)) state.masters = fresh;
}

export function refreshReferenceControls(form: HTMLFormElement, departments?: any[]) {
  for (const control of form.querySelectorAll<HTMLSelectElement>('select[data-reference-source]')) {
    const rules: ReferenceRules = JSON.parse(control.dataset.referenceRules);
    const rows = referenceChoices(control.dataset.referenceSource, rules, control.value, true, rules.endpoint ? departments : undefined);
    if (rules.format === 'hierarchy') refreshSelectMarkup(control, organisationUnitOptions(rows, control.value));
    else refreshSelectOptions(control, rows, rules.label);
  }
  refreshSecondaryDomains(form, referenceChoices('regulatory_domain', {draftDomains: true}));
  refreshCustomFields(form);
}

async function prepareAssigneeRefresh(form: HTMLFormElement, control: HTMLSelectElement) {
  const readUnit = () => control.dataset.referenceUnit ||
    (form.elements.namedItem(control.dataset.referenceUnitField) as HTMLSelectElement)?.value || '';
  const request = Symbol();
  assigneeRequests.set(control, request);
  const unit = readUnit();
  const role = control.dataset.referenceAssignee;
  const obligation = control.dataset.referenceObligation;
  const excluded = control.hasAttribute('data-reference-independent') ? [state.identity.user.id] : [];
  const people = !unit ? [] : obligation ? await api('/actions/assignees?' + new URLSearchParams({obligation_id: obligation, unit_id: unit, role}))
    : await choosePeople(role, unit, excluded);
  const rows = people.filter(person => !excluded.includes(person.id));
  return (scopeChanged = false) => {
    if (!form.isConnected || !control.isConnected || unit !== readUnit() || assigneeRequests.get(control) !== request) return;
    if (scopeChanged) {
      const selected = role === 'AUTHOR' && form.id === 'instrument' ? state.identity.user.id : '';
      control.innerHTML = options(rows, selected, 'full_name');
      control.setCustomValidity('');
    } else refreshSelectOptions(control, rows, 'full_name');
  };
}

export async function refreshScopedAssignees(changed: HTMLSelectElement) {
  const form = changed.form;
  const controls = [...form.querySelectorAll<HTMLSelectElement>('select[data-reference-assignee]')]
    .filter(control => control.dataset.referenceUnitField === changed.name);
  const updates = await Promise.all(controls.map(control => prepareAssigneeRefresh(form, control)));
  for (const apply of updates) apply(true);
}

/** Refresh the data used by the mounted form. Apply the result to today's field values. */
export async function refreshReferenceForm(form: HTMLFormElement) {
  if (!form || form.dataset.refreshingOptions) return;
  form.dataset.refreshingOptions = 'true';
  const route = state.routeNumber, actor = state.identity?.user.id;
  const current = () => form.isConnected && state.routeNumber === route && state.identity?.user.id === actor;
  try {
    const onlyDepartments = form.id === 'onboard';
    const assignees = [...form.querySelectorAll<HTMLSelectElement>('select[data-reference-assignee]:not([disabled])')]
      .map(control => prepareAssigneeRefresh(form, control));
    const [fresh, people] = await Promise.all([onlyDepartments ? api('/auth/departments') : api('/masters'), Promise.all(assignees)]);
    if (!current()) return;
    if (!onlyDepartments) acceptReferenceSnapshot(fresh);
    refreshReferenceControls(form, onlyDepartments ? fresh : undefined);
    for (const apply of people) apply();
    message('Options refreshed.', 'info');
  } catch {
    if (current()) message('Options could not be refreshed. Your entries are still here. Try Refresh options again.', 'exception');
  } finally {
    delete form.dataset.refreshingOptions;
  }
}

export function unavailableSelection(control: Element) {
  return control instanceof HTMLSelectElement ? control.selectedOptions[0]?.hasAttribute('data-unavailable')
    : control instanceof HTMLInputElement && control.checked && control.hasAttribute('data-unavailable');
}

/** Validate optional unavailable picks too, including checked additional domains. */
export function validateReferenceSelections(form: HTMLFormElement) {
  const unavailable = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input[data-unavailable]')]
    .find(control => control.willValidate && unavailableSelection(control));
  if (!unavailable) return true;
  for (let parent = unavailable.parentElement; parent && parent !== form; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  unavailable.setCustomValidity(unavailableChoiceMessage);
  unavailable.reportValidity();
  return false;
}
