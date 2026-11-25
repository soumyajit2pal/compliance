import { documentAccept, documentHint } from '../../core/upload-policy.ts';
import {customFieldGroup} from '../../ui/dropdown-fields.ts';
import { state } from '../../core/state.ts';

import { covered } from '../../core/access.ts';
import { choosePeople } from '../../core/assignees.ts';

import { localDate, field, input, select, fixedSelect, area } from '../../ui/components.ts';
import { modal } from '../../ui/dialog.ts';
import { domainGuidance, secondaryDomainPicker } from '../../ui/domains.ts';
import { referenceSelect, referenceAssignee } from '../../ui/reference-options.ts';

export async function instrumentForm(edit = false) {
  const i = edit ? state.record.instrument : {};
  const units = state.masters.organisational_unit.filter(
    (u) => u.active_flag && covered(u.id, ['AUTHOR']),
  );
  const unit = i.regulatory_owner_unit_id || state.identity.user.org_unit_id || units[0]?.id;
  const people = await choosePeople('AUTHOR', unit);
  state.view.editInstrument = edit;
  modal(
    edit ? 'Edit Draft instrument' : 'Register a regulatory instrument',
    /* HTML */ `<div class="notice">
        The official reference number is issued by RBI or another regulator. The portal generates
        its own permanent ID separately.
      </div>
      <div class="form-step">1 · Preserve the original source</div>
      <div class="grid">
        ${field(
          'Owning department',
          referenceSelect('regulatory_owner_unit_id', 'organisational_unit', unit, edit ? 'disabled' : 'required', undefined, {format: 'hierarchy', authorScope: true}),
        )}${field(
          'Confidentiality',
          referenceSelect(
            'confidentiality_class_id',
            'confidentiality_class',
            i.confidentiality_class_id ||
              state.masters.confidentiality_class.find((x) => x.code === 'INTERNAL')?.id,
            edit ? 'disabled' : 'required',
          ),
        )}${field(
          'Original source document',
          input('source_file', '', 'file', `${edit ? '' : 'required'} ${documentAccept()}`),
          edit ? 'Leave empty to retain the existing source.' : documentHint(),
          'full',
        )}
      </div>
      <div class="form-step">2 · Describe the regulatory instrument</div>
      <div class="grid">
        ${field(
          'Title',
          input('title', i.title || '', 'text', 'required maxlength="500"'),
          'Use the source’s official title.',
          'full',
        )}${field(
          'Official reference number',
          input(
            'official_reference_number',
            i.official_reference_number || '',
            'text',
            'maxlength="150"',
          ),
          'Record it exactly as issued, when available.',
        )}${field('Short title', input('short_title', i.short_title || ''))}${field(
          'Regulator',
          referenceSelect(
            'regulator_id',
            'regulator',
            i.regulator_id || state.masters.regulator.find((x) => x.code === 'RBI')?.id,
            edit ? 'disabled' : 'required',
          ),
        )}${field(
          'Instrument type',
          referenceSelect(
            'instrument_type_id',
            'instrument_type',
            i.instrument_type_id,
            'required',
          ),
        )}${field(
          'Regulatory domain',
          referenceSelect(
            'primary_domain_id',
            'regulatory_domain',
            i.primary_domain_id,
            edit ? 'required disabled' : 'required',
            undefined, {format: 'domain'},
          ) +
            `<div data-domain-guidance role="status" aria-live="polite">${domainGuidance(state.masters.regulatory_domain.find((d) => d.id === i.primary_domain_id))}</div>`,
          'The primary domain is part of the permanent instrument ID and stays fixed after registration. Add other affected domains below.',
        )}${secondaryDomainPicker(
          state.masters.regulatory_domain,
          (state.record.secondary_domains || []).map((domain) => domain.id),
          i.primary_domain_id,
        )}${field(
          'Interpretation owner',
          select(
            'interpretation_owner_user_id',
            people,
            i.interpretation_owner_user_id || state.identity.user.id,
            'full_name',
            'required ' + referenceAssignee('AUTHOR', 'regulatory_owner_unit_id'),
          ),
        )}${field(
          'Issue date',
          input('issue_date', i.issue_date || localDate(), 'date', 'required'),
        )}${field(
          'Effective date',
          input('effective_date', i.effective_date || localDate(), 'date', 'required'),
        )}${field(
          'Applicability date, if different',
          input('applicability_date', i.applicability_date || '', 'date'),
        )}${field(
          'Materiality',
          fixedSelect(
            'materiality',
            ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
            i.materiality || 'MEDIUM',
            'required',
          ),
        )}${field(
          'Keywords',
          area('keywords', i.keywords || ''),
          'Use searchable business terms.',
          'full',
        )}${customFieldGroup('instrument',i.custom_answers)}
      </div>
      <p class="print-note">
        ${edit ? 'Saving updates the initial Draft instrument and its source details.' : 'Saving creates Draft version 1.0.'} Add or review source Clauses / Para next; review and approval remain separate steps.
      </p>`,
    'instrument',
    edit ? 'Save Draft' : 'Create instrument and version 1.0',
  );
}
