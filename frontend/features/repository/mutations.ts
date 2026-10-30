import { detailFields } from '../../ui/widgets.ts';
import { wizardActions, validateWizard } from './wizard.ts';
import { state } from '../../core/state.ts';
import { api } from '../../core/api.ts';
import { isPendingEdition } from '../../core/source-editions.ts';

import { choosePeople } from '../../core/assignees.ts';
import { uploadSource } from '../../core/documents.ts';
import {
  esc,
  ref,
  title,
  localDate,
  field,
  input,
  select,
  area,
  versionLabel,
  message,
} from '../../ui/components.ts';
import { modal, close, sourceDocumentPreview } from '../../ui/dialog.ts';

import { instrumentForm } from './dialogs.ts';
import { secondaryDomainPicker } from '../../ui/domains.ts';
import { covered } from '../../core/access.ts';
import { clausePayload, openClauseDialog } from '../clause-dialog.ts';

function nextSourceVersion(versions) {
  const highestMajor = versions.reduce((highest, version) => {
    const major = Number.parseInt(String(version.version_number).split('.')[0], 10);
    return Number.isFinite(major) ? Math.max(highest, major) : highest;
  }, 0);
  return `${highestMajor + 1}.0`;
}

function correctionSummaryForDialog(correction) {
  let before = {}, proposed = {};
  try { before = JSON.parse(correction.before_values_json || '{}'); } catch {}
  try { proposed = JSON.parse(correction.proposed_values_json || '{}'); } catch {}
  const names = {
    official_reference_number: 'Official reference', title: 'Title', short_title: 'Short title',
    applicability_date: 'Applicability date', materiality: 'Materiality',
    regulatory_owner_unit_id: 'Regulatory owner unit', interpretation_owner_user_id: 'Interpretation owner',
    keywords: 'Keywords', secondary_domain_ids: 'Additional affected domains',
  };
  return `<div class="metadata-correction-values">${Object.keys(proposed).map((key) => {
    const display = (value) => key === 'secondary_domain_ids'
      ? (value || []).map((id) => state.masters.regulatory_domain.find((domain) => domain.id === id)?.name || id).join(', ') || 'None'
      : key === 'regulatory_owner_unit_id'
        ? ref('organisational_unit', value)
        : key === 'interpretation_owner_user_id'
          ? ref('user', value)
          : value || '—';
    return `<div><strong>${esc(names[key] || title(key))}</strong><span>${esc(display(before[key]))} → ${esc(display(proposed[key]))}</span></div>`;
  }).join('')}</div>`;
}

function openSourceVersionForm(edit = false) {
  const instrument = state.record.instrument;
  const version = edit ? state.view.version : null;
  if (!edit && state.record.versions.some(isPendingEdition))
    throw new Error('An edition is already pending. Open the pending edition and complete approval or cancel the Draft before creating another.');
  if (edit && (!version || version.approval_status !== 'DRAFT' || version.created_by !== state.identity.user.id ||
      !covered(instrument.regulatory_owner_unit_id, ['AUTHOR'])))
    throw new Error('Only the maker can edit this edition while it is Draft.');
  const initial = edit && !version.supersedes_version_id;
  const approvedVersions = state.record.versions.filter((v) => v.approval_status === 'APPROVED')
    .map((v) => ({...v, name: 'Version ' + versionLabel(v.version_number) + (v.current_version_flag ? ' · Current' : '')}));
  const sourceName = version && state.record.source_documents?.[version.source_document_id];
  modal(edit ? 'Edit draft source version' : 'Add a subsequent source version',
    `<div class="notice">${edit
      ? 'Only this Draft is updated. Existing clauses and uploaded sources are retained. Recheck the clauses against any replacement source before submitting for fresh independent review.'
      : 'The existing approved source and clauses remain available. This edition needs a source, change summary and independent approval.'}</div>
      <div class="grid">
        ${field('Version number', input('version_number', version ? versionLabel(version.version_number) : nextSourceVersion(state.record.versions), 'text', 'required maxlength="30" pattern="[0-9]+\\.[0-9]+"'), 'Use major.minor notation, such as 2.0.')}
        ${field('Version date', input('version_date', version?.version_date || localDate(), 'date', 'required'))}
        ${field('Effective from', input('effective_from', version?.effective_from || localDate(), 'date', 'required'))}
        ${initial ? '<input type="hidden" name="supersedes_version_id" value="">' : field('Supersedes version', select('supersedes_version_id', approvedVersions, version?.supersedes_version_id || instrument.current_version_id, 'name', 'required'))}
        ${sourceName ? `<div class="field full"><label>Current source document</label><p>${esc(sourceName)}</p></div>` : ''}
        ${field(edit ? 'Replacement source document (optional)' : 'New source document', input('source_file', '', 'file', `${edit ? '' : 'required'} accept=".pdf,.txt,.docx"`), edit ? 'Leave empty to retain the source document. PDF, text or DOCX; maximum 20 MB.' : 'PDF, text or DOCX; maximum 20 MB.', 'full')}
        ${field('Change summary', area('change_summary', version?.change_summary || '', 'required minlength="5" maxlength="10000"'), 'Explain the source edition and any corrections.', 'full')}
        <label class="check-label"><input type="checkbox" name="consolidated_flag" ${version?.consolidated_flag ? 'checked' : ''}> Consolidated edition</label>
      </div>
      ${initial ? '<p class="small muted">For the initial Draft, source and dates also update the draft instrument details. Permanent identifiers remain unchanged.</p>' : ''}`,
    'version', edit ? 'Save draft version' : 'Create Draft version');
  const form = document.querySelector<HTMLFormElement>('#version');
  form.dataset.editVersionId = edit ? version.id : '';
  form.dataset.instrumentId = instrument.id;
  form.dataset.sourceDocumentId = version?.source_document_id || '';
  form.dataset.returnTab = new URLSearchParams(location.hash.split('?')[1]).get('tab') || 'overview';
}

export function repositoryHandlers({ render, loadIdentity, loginView }) {
  return {
    actions: {
      ...wizardActions(),
      'clear-repository-filters': async () => {
        if (location.hash === '#repository') await render();
        else location.hash = 'repository';
      },
      instrument: () => {
        location.hash = 'repository/new';
      },
      'source-document-preview': ({ id, name }) => sourceDocumentPreview(id, name),
      'edit-instrument': () => instrumentForm(true),
      'request-metadata-correction': async () => {
        const i = state.record.instrument;
        const authorCandidates = await choosePeople('AUTHOR', i.regulatory_owner_unit_id);
        const reviewers = await choosePeople('REVIEWER', i.regulatory_owner_unit_id, [state.identity.user.id]);
        const approvers = await choosePeople('APPROVER', i.regulatory_owner_unit_id, [state.identity.user.id]);
        const units = state.masters.organisational_unit.filter((unit) => unit.active_flag &&
          (!unit.effective_from || unit.effective_from <= localDate()) &&
          (!unit.effective_to || unit.effective_to > localDate()) && covered(unit.id, ['AUTHOR']));
        modal(
          'Request metadata correction',
          `<div class="notice">Approved source content stays unchanged. Regulator, instrument type and primary domain are part of the permanent ID; issue/effective dates or source changes need a new source version. Confidentiality changes require administrator handling.</div>
            <div class="grid">
              ${field('Official reference number', input('official_reference_number', i.official_reference_number || '', 'text', 'maxlength="150"'))}
              ${field('Title', input('title', i.title || '', 'text', 'required maxlength="500"'))}
              ${field('Short title', input('short_title', i.short_title || '', 'text', 'maxlength="250"'))}
              ${field('Materiality', select('materiality', ['CRITICAL','HIGH','MEDIUM','LOW'].map((id) => ({id,name:title(id)})), i.materiality, 'name', 'required'))}
              ${field('Applicability date', input('applicability_date', i.applicability_date || '', 'date'))}
              ${field('Regulatory owner unit', select('regulatory_owner_unit_id', units, i.regulatory_owner_unit_id, 'name', 'required'))}
              ${field('Interpretation owner', select('interpretation_owner_user_id', authorCandidates, i.interpretation_owner_user_id, 'full_name', 'required'))}
              ${field('Keywords', area('keywords', i.keywords || ''), 'Search terms used to find this instrument.', 'full')}
              ${secondaryDomainPicker(state.masters.regulatory_domain, (state.record.secondary_domains || []).map((domain) => domain.id), i.primary_domain_id)}
              ${field('Reason for correction', area('reason', '', 'required minlength="10" maxlength="10000"'), 'Explain why the approved register metadata is incorrect.', 'full')}
              ${field('Compliance reviewer', select('reviewer_id', reviewers, '', 'full_name', 'required'))}
              ${field('Final approver', select('approver_id', approvers, '', 'full_name', 'required'))}
            </div>
            <p class="small muted">The requester, reviewer and final approver must be different people. Changes take effect on final approval. The owner unit and interpretation owner must be valid together, and a proposed new owner unit must be within your Author scope.</p>`,
          'metadata-correction',
          'Submit correction for review',
        );
      },
      version: () => openSourceVersionForm(),
      'edit-version': () => openSourceVersionForm(true),
      'cancel-draft': () => {
        const v = state.view.version, i = state.record.instrument;
        if (v.approval_status !== 'DRAFT' || v.created_by !== state.identity.user.id ||
            !covered(i.regulatory_owner_unit_id, ['AUTHOR']))
          throw new Error('Only the maker with Author access can cancel this Draft.');
        modal('Cancel draft edition',
          `<div class="notice">Cancel version ${esc(versionLabel(v.version_number))} permanently. Its source, clauses, reason and earlier review history remain available. This edition cannot be reopened.${!v.supersedes_version_id ? ' Cancelling the initial Draft also closes this unapproved instrument.' : ' The approved source remains unchanged; another edition can then be created.'}</div>` +
          field('Reason for cancellation', area('reason', '', 'required minlength="10" maxlength="10000"'), 'Explain why this Draft is being abandoned (at least 10 characters).'),
          'cancel-draft', 'Cancel draft');
        document.querySelector<HTMLFormElement>('#cancel-draft').dataset.versionId = v.id;
      },
      clause: ({ id }) => {
        const v = state.view.version,
          c = state.record.clauses.find((c) => c.id === id) || {};
        state.view.editClause = id;
        openClauseDialog([{
          id: v.id,
          instrument_id: state.record.instrument.id,
          name: `${state.record.instrument.code} · Version ${versionLabel(v.version_number)}`,
          clauses: state.record.clauses.filter((row) => row.instrument_version_id === v.id),
        }], 'clause', c);
      },
      'submit-version': async () => {
        const i = state.record.instrument,
          v = state.view.version;
        const reviewers = await choosePeople('REVIEWER', i.regulatory_owner_unit_id, [
          v.created_by,
        ]);
        const approvers = await choosePeople('APPROVER', i.regulatory_owner_unit_id, [
          v.created_by,
        ]);
        modal(
          'Submit for independent review',
          `${field('Compliance reviewer', select('reviewer_id', reviewers, '', 'full_name', 'required'))}${field('Final approver', select('approver_id', approvers, '', 'full_name', 'required'))}${field('Submission notes', area('comments', '', 'required minlength="3"'))}<div class="notice">The maker, reviewer and final approver must be different people. Approval cannot start before the named review is completed.</div>`,
          'submit-version',
          'Submit for review',
        );
      },
      decision: async ({ decision }) => {
        state.view.decision = decision;
        let extra = '';
        if (decision === 'DELEGATE') {
          const v = state.view.version,
            task = state.record.tasks.find(
              (t) =>
                t.entity_id === v.id &&
                t.workflow_status === 'OPEN' &&
                t.stage === t.current_stage &&
                !t.decision,
            );
          const role = task.stage === 'COMPLIANCE_REVIEW' ? 'REVIEWER' : 'APPROVER';
          const exclude = [
            state.identity.user.id,
            v.created_by,
            v.reviewed_by,
            ...state.record.tasks
              .filter((t) => t.instance_id === task.instance_id && t.id !== task.id)
              .map((t) => t.assignee_user_id),
          ];
          extra = field(
            'Eligible delegate',
            select(
              'delegate_user_id',
              await choosePeople(role, state.record.instrument.regulatory_owner_unit_id, exclude),
              '',
              'full_name',
              'required',
            ),
          );
        }
        modal(
          title(decision) + ' version',
          detailFields([
            ['Source', esc(state.record.instrument.title), true],
            ['Version', esc(versionLabel(state.view.version.version_number))],
            ['Maker', esc(ref('user', state.view.version.created_by))],
            ['Decision maker', esc(state.identity.user.full_name)],
            ['Decision', esc(title(decision))],
          ]) +
            `<div class="divider"></div>${decision === 'WITHDRAW' ? '<div class="notice">Withdraw this submission to Draft for editing. Current review is closed; submitting again starts a fresh independent review.</div>' : ''}${extra}${field(
              'Decision and rationale',
              area('comments', '', 'required minlength="3"'),
            )}${['REVIEW', 'APPROVE'].includes(decision) ? '<label class="check-label mt24"><input type="checkbox" required>I confirm I am independent of the maker and have reviewed the source and clauses / paras.</label>' : ''}`,
          'decision',
          'Record ' + title(decision),
        );
      },
      'correction-decision': async ({ decision, id }) => {
        const correction = state.record.metadata_corrections.find((row) => row.id === id);
        if (!correction) throw new Error('This metadata correction is no longer available. Refresh the record.');
        state.view.correctionDecision = decision;
        let extra = '';
        if (decision === 'DELEGATE') {
          const task = state.record.tasks.find((row) => row.entity_id === id && row.workflow_status === 'OPEN' && row.stage === row.current_stage && !row.decision);
          if (!task) throw new Error('The assigned decision task is no longer open.');
          const role = task.stage === 'COMPLIANCE_REVIEW' ? 'REVIEWER' : 'APPROVER';
          const exclude = [state.identity.user.id, correction.created_by, correction.reviewed_by,
            ...state.record.tasks.filter((row) => row.instance_id === task.instance_id && row.id !== task.id).map((row) => row.assignee_user_id)];
          extra = field('Eligible delegate', select('delegate_user_id', await choosePeople(role, state.record.instrument.regulatory_owner_unit_id, exclude), '', 'full_name', 'required'));
        }
        modal(
          title(decision) + ' metadata correction',
          `<p><strong>Requester</strong> ${esc(ref('user', correction.created_by))}</p>${correctionSummaryForDialog(correction)}<p><strong>Reason for correction</strong><br>${esc(correction.reason)}</p>${extra}${field('Decision and rationale', area('comments', '', 'required minlength="3" maxlength="10000"'), '', 'full')}${['REVIEW', 'APPROVE'].includes(decision) ? '<label class="check-label mt24"><input type="checkbox" required>I confirm that I am independent of the requester and reviewed the proposed register changes.</label>' : ''}`,
          'correction-decision',
          'Record ' + title(decision),
        );
        const form = document.querySelector<HTMLFormElement>('#correction-decision');
        if (form) form.dataset.correctionId = id;
      },
      activate: async () => {
        await api('/versions/' + state.view.version.id + '/activate', 'POST', {});
        message('Approved effective source is now current. Previous history is retained.');
        await render();
      },
    },
    forms: {
      'cancel-draft': async (form) => {
        const result = await api('/versions/' + form.dataset.versionId + '/cancel', 'POST', Object.fromEntries(new FormData(form)));
        close();
        message(result.message);
        await render();
      },
      filters: async (form: HTMLFormElement) => {
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(form)) {
          if (typeof value === 'string' && value) query.set(key, value);
        }
        const more = form.querySelector<HTMLDetailsElement>('.filter-more');
        if (more?.open) {
          more.open = false;
          more.querySelector('summary')?.focus();
        }
        location.hash = 'repository?' + query;
      },
      instrument: async (form) => {
        if (form.dataset.wizard !== undefined && !validateWizard(form)) return;
        const formData = new FormData(form);
        const values: Record<string, any> = Object.fromEntries(formData);
        values.secondary_domain_ids = formData.getAll('secondary_domain_ids');
        delete values.source_file;
        for (const key of [
          'official_reference_number',
          'short_title',
          'applicability_date',
          'keywords',
        ])
          if (!values[key]) values[key] = null;
        if (state.view.editInstrument) {
          for (const key of [
            'regulator_id',
            'regulatory_owner_unit_id',
            'confidentiality_class_id',
          ])
            values[key] = state.record.instrument[key];
          values.primary_domain_id = state.record.instrument.primary_domain_id;
          values.source_document_id = state.record.instrument.source_document_id;
        }
        if (form.elements.source_file.files.length) {
          values.source_document_id = (await uploadSource(form)).id;
        }
        const family=Object.fromEntries(Object.keys(values).filter(key=>key.startsWith('family_')).map(key=>[key,values[key]]));
        for(const key of Object.keys(family))delete values[key];
        const result = await api(
          form.dataset.familyParent?'/notification-families/'+form.dataset.familyParent+'/amendments':state.view.editInstrument ? '/instruments/' + state.record.instrument.id : '/instruments',
          state.view.editInstrument ? 'PUT' : 'POST',
          form.dataset.familyParent?{instrument:values,reviewer_id:family.family_reviewer_id,approver_id:family.family_approver_id,relationship_type:family.family_relationship_type,basis:family.family_basis,effective_from:values.effective_date}:values,
        );
        close();
        message('Draft instrument saved. Add clauses / paras to its source version next.');
        location.hash = 'repository/' + result.id;
        await render();
      },
      version: async (form) => {
        const values: Record<string, any> = Object.fromEntries(new FormData(form));
        delete values.source_file;
        values.consolidated_flag = form.elements.consolidated_flag.checked;
        values.supersedes_version_id = values.supersedes_version_id || null;
        values.source_document_id = form.dataset.sourceDocumentId;
        if (form.elements.source_file.files.length) values.source_document_id = (await uploadSource(form)).id;
        if (!values.source_document_id) throw new Error('Choose a source document for this edition.');
        const editId = form.dataset.editVersionId;
        const result = await api(editId ? '/versions/' + editId : '/instruments/' + form.dataset.instrumentId + '/versions',
          editId ? 'PUT' : 'POST', values);
        const path = 'repository/' + form.dataset.instrumentId + '?' + new URLSearchParams({
          version: result.id, tab: form.dataset.returnTab,
        });
        close();
        location.hash = path;
        message(result.message || 'New Draft source version created.');
        await render();
      },
      clause: async (form) => {
        const values = clausePayload(form);
        const result = await api(
          '/versions/' +
            state.view.version.id +
            '/clauses' +
            (state.view.editClause ? '/' + state.view.editClause : ''),
          state.view.editClause ? 'PUT' : 'POST',
          values,
        );
        close();
        message('Source wording and bank interpretation saved separately.');
        const query = new URLSearchParams({ version: state.view.version.id, tab: 'clauses', clause: result.id });
        location.hash = 'repository/' + state.record.instrument.id + '?' + query;
        await render();
      },
      'submit-version': async (form) => {
        await api(
          '/versions/' + state.view.version.id + '/submit',
          'POST',
          Object.fromEntries(new FormData(form)),
        );
        close();
        message('Submitted to the named Compliance reviewer.');
        await render();
      },
      'metadata-correction': async (form) => {
        const formData = new FormData(form);
        const values: Record<string, any> = Object.fromEntries(formData);
        values.secondary_domain_ids = formData.getAll('secondary_domain_ids');
        for (const key of ['official_reference_number','short_title','applicability_date','keywords'])
          if (!values[key]) values[key] = null;
        const result = await api('/instruments/' + state.record.instrument.id + '/metadata-corrections', 'POST', values);
        close();
        location.hash = 'repository/' + state.record.instrument.id + '?tab=workflow&correction=' + result.id;
        message('Metadata correction submitted for independent Compliance review.');
        await render();
      },
      'correction-decision': async (form) => {
        const correctionId = form.dataset.correctionId;
        await api('/metadata-corrections/' + correctionId + '/decision', 'POST', {
          ...Object.fromEntries(new FormData(form)), decision: state.view.correctionDecision,
        });
        close();
        message('Metadata correction decision recorded in the audit history.');
        await render();
      },
      decision: async (form) => {
        await api('/versions/' + state.view.version.id + '/decision', 'POST', {
          ...Object.fromEntries(new FormData(form)),
          decision: state.view.decision,
        });
        close();
        message(state.view.decision === 'WITHDRAW' ? 'Submission withdrawn to Draft. Edit the edition and submit for fresh review; the earlier workflow history is retained.' : state.view.decision === 'RETURN' ? 'Edition returned to Draft for correction and fresh review.' : 'Decision recorded with audit history.');
        await render();
      },
      comment: async (form) => {
        await api(
          '/instruments/' + state.record.instrument.id + '/comments',
          'POST',
          Object.fromEntries(new FormData(form)),
        );
        message('Comment added.');
        await render();
      },
    },
  };
}
