import { state } from '../../core/state.ts';
import { api } from '../../core/api.ts';
import { covered, has } from '../../core/access.ts';
import { choosePeople } from '../../core/assignees.ts';
import {
  esc,
  ref,
  title,
  localDate,
  field,
  input,
  select,
  fixedSelect,
  area,
} from '../../ui/components.ts';
import { icon } from '../../ui/icons.ts';
import { heading } from '../../ui/layout.ts';
import { domainChoices, domainGuidance, secondaryDomainPicker } from '../../ui/domains.ts';
import { note, detailFields } from '../../ui/widgets.ts';
const steps = [
  'Basic information',
  'Classification',
  'Accountability',
  'Source & version',
  'Review & create',
];
export async function instrumentWizard(query=new URLSearchParams()) {
  if (!has('AUTHOR'))
    return note('Your role does not permit registration of regulatory sources.', 'warn');
  const units = state.masters.organisational_unit.filter(
    (u) => u.active_flag && covered(u.id, ['AUTHOR']),
  );
  const parent=query.get('family_parent')?(await api('/instruments/'+query.get('family_parent'))).instrument:null;
  if(parent&&!covered(parent.regulatory_owner_unit_id,['AUTHOR']))throw new Error('Author access to the original notification is required.');
  const unit = parent?.regulatory_owner_unit_id||units.find((u) => u.id === state.identity.user.org_unit_id)?.id || units[0]?.id;
  const people = unit ? await choosePeople('AUTHOR', unit) : [];
  const reviewers=parent?await choosePeople('REVIEWER',parent.regulatory_owner_unit_id,[state.identity.user.id]):[];
  const approvers=parent?await choosePeople('APPROVER',parent.regulatory_owner_unit_id,[state.identity.user.id]):[];
  state.view.editInstrument = false;
  const basic =
    field(
      'Instrument title',
      input(
        'title',
        '',
        'text',
        'required maxlength="500" placeholder="e.g. Master Direction — Know Your Customer"',
      ),
      'Use the title printed on the official source.',
      'full',
    ) +
    field('Short title', input('short_title', '', 'text', 'maxlength="250"')) +
    field(
      'Official reference number',
      input('official_reference_number', '', 'text', 'maxlength="150"'),
      'Record it exactly as issued, when available.',
    ) +
    field('Issue date', input('issue_date', localDate(), 'date', 'required')) +
    field('Effective date', input('effective_date', localDate(), 'date', 'required')) +
    field('Applicability date, if different', input('applicability_date', '', 'date'));
  const classification =
    field(
      'Regulator',
      select(
        'regulator_id',
        parent?state.masters.regulator.filter(row=>row.id===parent.regulator_id):state.masters.regulator,
        parent?.regulator_id||state.masters.regulator.find((r) => r.code === 'RBI')?.id,
        'name',
        'required',
      ),
    ) +
    field(
      'Primary regulatory domain',
      select(
        'primary_domain_id',
        domainChoices(state.masters.regulatory_domain),
        parent?.primary_domain_id||'',
        'name',
        'required',
      ) + `<div data-domain-guidance role="status" aria-live="polite">${domainGuidance(state.masters.regulatory_domain.find(row=>row.id===parent?.primary_domain_id))}</div>`,
      'Choose the required primary domain. The permanent instrument ID uses this domain; assign every other affected domain below.',
    ) +
    secondaryDomainPicker(state.masters.regulatory_domain) +
    field(
      'Instrument type',
      select('instrument_type_id', state.masters.instrument_type, parent?.instrument_type_id||'', 'name', 'required'),
    ) +
    field(
      'Materiality',
      fixedSelect('materiality', ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'], 'MEDIUM', 'required'),
    ) +
    field(
      'Confidentiality',
      select(
        'confidentiality_class_id',
        state.masters.confidentiality_class,
        parent?.confidentiality_class_id||state.masters.confidentiality_class.find((r) => r.code === 'INTERNAL')?.id,
        'name',
        'required',
      ),
    ) +
    field(
      'Search keywords',
      input('keywords', '', 'text', 'placeholder="Separate keywords with commas"'),
    );
  const account =
    field(
      'Regulatory owner department',
      select('regulatory_owner_unit_id', units, unit, 'name', 'required'),
      'Choose the department responsible for maintaining this source.',
    ) +
    field(
      'Interpretation owner',
      select(
        'interpretation_owner_user_id',
        people,
        state.identity.user.id,
        'full_name',
        'required',
      ),
    ) +
    `<div class="full">${note('The regulatory owner department is mandatory. Source interpretation, review and approval remain independently governed.')}</div>`;
  const source = `<div class="full">${detailFields([
    ['First source version', '1'],
    ['Version status', 'Draft'],
  ])}</div><div class="full upload-zone">${icon('upload')}<h3>Attach the authoritative source</h3><p>Choose the original PDF, text document or DOCX file. The portal preserves it with an integrity hash.</p>${input('source_file', '', 'file', 'required accept=".pdf,.txt,.docx" aria-label="Original source document"')}<small class="field-hint">Maximum 20 MB. The file is uploaded when you create the Draft.</small></div>`;
  const fields = [
    basic,
    classification,
    account,
    source+(parent?`<div class="full">${note('This separately issued amendment will receive its own library identity. Its family link requires independent review and approval; source approval remains separate.')}</div>${field('Relationship',select('family_relationship_type',['AMENDS','CLARIFIES','SUPERSEDES','REPEALS'].map(id=>({id,name:title(id)})),'AMENDS'))}${field('Relationship basis',area('family_basis','','required minlength="10"'))}${field('Family-link reviewer',select('family_reviewer_id',reviewers,'','full_name','required'))}${field('Family-link approver',select('family_approver_id',approvers,'','full_name','required'))}`:''),
    '<div class="full" id="wizard-review"></div>',
  ];
  return (
    `<a class="back-link" href="#repository">${icon('back')}Back to regulatory library</a>` +
    heading(
      parent?'Register an amendment':'Register a new instrument',
      parent?'Original notification: '+parent.code+' · '+parent.title:'Preserve an authoritative source and a governed first version.',
    ) +
    `<div class="wizard"><aside class="wizard-steps"><div class="eyebrow mb16">INSTRUMENT SETUP</div>${steps.map((name, i) => `<div class="wizard-step ${i === 0 ? 'active' : ''}" data-step-label="${i}"><span>${i + 1}</span>${name}</div>`).join('')}<p class="small muted mt24">Your entries stay in this form as you move between steps. Leaving this page discards unsaved entries.</p></aside><div class="wizard-body"><form id="instrument" data-wizard="0" data-family-parent="${esc(parent?.id||'')}" novalidate>${fields.map((content, i) => `<fieldset class="form-section wizard-step-panel" data-step="${i}" ${i ? 'hidden' : ''}><div class="eyebrow mb16">STEP ${i + 1} OF ${steps.length}</div><h3>${steps[i]}</h3><p>Fields marked * are required for this stage.</p><div class="form-grid">${content}</div></fieldset>`).join('')}<p class="inline-error" id="form-error" role="alert"></p><div class="wizard-footer"><div><a class="btn" href="#repository">Cancel</a><button type="button" class="btn" data-action="wizard-back" hidden>Previous step</button></div><div class="row"><button type="button" class="btn primary" data-action="wizard-next">Continue ${icon('arrow')}</button><button type="submit" class="btn primary" id="wizard-create" hidden>Create Draft instrument</button></div></div></form></div></div>`
  );
}
function validStep(form, step) {
  for (const c of form.querySelectorAll(
    `[data-step="${step}"] input,[data-step="${step}"] select,[data-step="${step}"] textarea`,
  )) {
    if (!c.checkValidity()) {
      setWizardStep(form, step);
      c.reportValidity();
      return false;
    }
  }
  return true;
}
function summary(form) {
  const data = new FormData(form);
  const values: Record<string, any> = Object.fromEntries(data);
  values.secondary_domain_ids = data.getAll('secondary_domain_ids');
  const selected = (name) =>
    form.elements[name].selectedOptions?.[0]?.textContent.trim() || values[name];
  const secondaryDomainNames = values.secondary_domain_ids
    .map((id) => state.masters.regulatory_domain.find((domain) => domain.id === id)?.name)
    .filter(Boolean);
  form.querySelector('#wizard-review').innerHTML =
    detailFields([
      ['Instrument title', esc(values.title), true],
      [
        'Official reference number',
        esc(values.official_reference_number || 'Not provided by regulator'),
      ],
      ['Issue / effective date', esc(values.issue_date) + ' / ' + esc(values.effective_date)],
      ['Regulator', esc(selected('regulator_id'))],
      ['Regulatory domain', esc(selected('primary_domain_id'))],
      ['Other affected domains', esc(secondaryDomainNames.join(', ') || 'None')],
      ['Instrument type', esc(selected('instrument_type_id'))],
      ['Materiality', esc(title(values.materiality))],
      ['Owner department', esc(selected('regulatory_owner_unit_id'))],
      ['Interpretation owner', esc(selected('interpretation_owner_user_id'))],
      ['Confidentiality', esc(selected('confidentiality_class_id'))],
      ['Source document', esc(form.elements.source_file.files[0]?.name || 'Not selected'), true],
      ...(form.dataset.familyParent?[
        ['Amendment relationship',esc(selected('family_relationship_type'))],
        ['Relationship basis',esc(values.family_basis),true],
        ['Family-link reviewer',esc(selected('family_reviewer_id'))],
        ['Family-link approver',esc(selected('family_approver_id'))],
      ]:[]),
    ]) +
    `<div class="mt24">${note('Create a Draft first, then capture its source clauses / paras and submit to a named independent Reviewer and Approver. Creating this record does not approve it or make it current.')}</div>`;
}
export function setWizardStep(form, index) {
  form.dataset.wizard = String(index);
  (form as HTMLFormElement)
    .querySelectorAll('[data-step]')
    .forEach((item: HTMLElement) => (item.hidden = Number(item.dataset.step) !== index));
  document.querySelectorAll<HTMLElement>('[data-step-label]').forEach((el, i) => {
    el.classList.toggle('active', i === index);
    el.classList.toggle('done', i < index);
    const number = el.querySelector('span');
    if (number) number.innerHTML = i < index ? icon('check') : String(i + 1);
  });
  (form.querySelector('[data-action=wizard-back]') as HTMLButtonElement).hidden = index === 0;
  (form.querySelector('[data-action=wizard-next]') as HTMLButtonElement).hidden = index === steps.length - 1;
  (form.querySelector('#wizard-create') as HTMLButtonElement).hidden = index !== steps.length - 1;
  if (index === steps.length - 1) summary(form);
}
export function validateWizard(form) {
  for (let i = 0; i < steps.length - 1; i++) if (!validStep(form, i)) return false;
  return true;
}
export function wizardActions() {
  return {
    'wizard-next': () => {
      const form = document.querySelector<HTMLFormElement>('#instrument');
      if (!form) return;
      const index = Number(form.dataset.wizard);
      if (validStep(form, index)) {
        setWizardStep(form, index + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    'wizard-back': () => {
      const form = document.querySelector<HTMLFormElement>('#instrument');
      if (!form) return;
      setWizardStep(form, Math.max(0, Number(form.dataset.wizard) - 1));
    },
  };
}
