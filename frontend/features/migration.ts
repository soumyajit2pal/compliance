import { referenceSelect } from '../ui/reference-options.ts';
import { documentAccept, documentHint, fileLimitHint } from '../core/upload-policy.ts';
import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { has } from '../core/access.ts';
import { uploadSource } from '../core/documents.ts';
import {
  esc,
  title,
  badge,
  link,
  button,
  empty,
  field,
  input,
  select,
  message,
} from '../ui/components.ts';
import { modal, close } from '../ui/dialog.ts';
import { templateUploadModal } from '../ui/template-upload.ts';
import { heading } from '../ui/layout.ts';
import { icon } from '../ui/icons.ts';
import { panel, table, tablePanel, note, searchForm } from '../ui/widgets.ts';
import { combinedImportPreview, draftLoadingInstructions, hasReadyFamilyLinks, importedClausePath } from './import-preview.ts';
import { instrumentWorkspacePath } from '../core/source-navigation.ts';

const importGuidance = 'Fill Regulatory records and optionally Clauses. Start with Chapter through Item (columns B–F) on the Clauses sheet for automatic parent headings. Use Import reference to group clauses. Attach the matching source file or use an existing Source document ID.';
const excelTemplate = '/api/migration-template?format=xlsx';
const csvTemplate = '/api/migration-template?format=csv';

function kpi(label, value, sub, ic = 'file', href = '') {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="kpi-card" ${href ? `href="#${href}"` : ''}><div class="kpi-label">${esc(label)}<span class="kpi-icon">${icon(ic)}</span></div><div class="kpi-number num">${value}</div><div class="kpi-footer">${esc(sub)}</div></${tag}>`;
}

function reviewGuide(data, filtered) {
  const { batch, permissions, populations } = data;
  const pending = populations.CONTENT_VALIDATION_PENDING || 0;
  const ready = populations.MIGRATION_READY || 0;
  const corrections = populations.CORRECTION_REQUIRED || 0;
  const rowsLabel = (count) => `${count} ${count === 1 ? 'row' : 'rows'}`;
  if (pending && permissions.can_validate) {
    return panel('Independent content review',
      `<ol class="import-review-steps" role="list">
        <li><strong>Open the authoritative source</strong><span>Download the attached source below or open the official document used for the workbook.</span></li>
        <li><strong>Compare the imported rows</strong><span>Check titles, references, dates and any proposed notification relationship. For clauses, check the original wording, source location and parent clause.</span></li>
        <li><strong>Confirm the review</strong><span>After reviewing all eligible rows, confirm the batch. The uploading Author will get a task and notification to load the validated rows as Drafts.</span></li>
      </ol>
      ${note(`If any eligible row disagrees with the source, ask ${esc(data.uploader_name || 'the uploader')} for a corrected workbook before confirming.`, 'warn')}
      ${filtered ? `<p class="small mt8">The preview is filtered. ${link('migration/' + batch.id, 'Show the full batch', 'text-link')} before confirming.</p>` : ''}
      <div class="actions mt16">${button('open-import-section', 'Open sources and rows', 'data-section="import-review-content"')}${button('validate-batch', 'Validate reviewed content', '', 'primary')}</div>`,
      { sub: `${rowsLabel(pending)} awaiting review in this shared Reviewer queue. The confirmation applies to the full batch.`, cls: 'import-review-guide' });
  }
  if (pending) {
    return panel('Awaiting independent content review',
      `<p>${rowsLabel(pending)} ${pending === 1 ? 'is' : 'are'} in the shared queue for global Compliance Reviewers. A Reviewer other than the uploader must confirm the content before loading.</p>`,
      { cls: 'import-review-guide' });
  }
  if (corrections && !ready) {
    return panel('Corrections required',
      `<p>Open the preview to see the findings for ${rowsLabel(corrections)}. If the workbook has incorrect values, the uploader needs to prepare a corrected file. If master data or a Draft target has changed, the uploader can refresh the preview.</p>
      <div class="actions mt16">${button('open-import-section', 'Open validation findings', 'data-section="import-review-content"')}</div>`,
      { cls: 'import-review-guide' });
  }
  return '';
}

function draftLoadGuide(data, status) {
  const { MIGRATION_READY: ready, LOADED: loaded } = data.populations;
  if (!ready) {
    if (!loaded) return '';
    return panel('Drafts loaded',
      `<p>The Regulatory Author can open the Draft editions in the Regulatory Library and submit them for review and approval.</p>
      <div class="actions mt16">${status === 'LOADED'
        ? button('open-import-section', 'View loaded records', 'data-section="import-review-content"')
        : link('migration/' + data.batch.id + '?status=LOADED', 'View loaded records', 'btn')}</div>`,
      { sub: `${loaded} ${loaded === 1 ? 'row' : 'rows'} linked to Draft records.`, cls: 'import-review-guide' });
  }
  const action = data.permissions.can_load
    ? data.combined
      ? button('open-import-section', 'Go to Draft loading', 'data-section="import-draft-loading"', 'primary')
      : button('load-batch', 'Load ready rows as Drafts', '', 'primary')
    : '';
  return panel(data.permissions.can_load ? 'Load validated rows as Drafts' : 'Waiting for Draft loading',
    `<p>${esc(draftLoadingInstructions(data))}</p>${action ? `<div class="actions mt16">${action}</div>` : ''}`,
    { sub: `${ready} ${ready === 1 ? 'row has' : 'rows have'} passed content validation.`, cls: 'import-review-guide' });
}
export async function migrationPage(id, query = new URLSearchParams()) {
  const request = state.routeNumber;
  if (id) {
    const data = await api('/migration/' + id);
    if (request !== state.routeNumber || !state.identity) return '';
    state.batch = data;
    return renderBatch(query);
  }
  const columnOptionsUrl = '/migration?' + apiPageQuery(query, 'batches');
  const result = await api(columnOptionsUrl);
  const batches = Array.isArray(result) ? result : result.items;
  if (request !== state.routeNumber || !state.identity) return '';
  const q = (query.get('q') || '').toLowerCase(),
    rows = result.pagination ? batches : batches.filter((b) => JSON.stringify(b).toLowerCase().includes(q));
  const sum = (key) => result.summary ? result.summary[key] : batches.reduce((n, b) => n + (b[key] || 0), 0);
  return (
    heading(
      'Import existing regulatory records',
      'Import regulatory records, clauses and source documents together. Preview and validate before loading Drafts.',
      has('AUTHOR')
        ? button('source', 'Upload source document') +
            button('stage', 'Import records & clauses', '', 'primary')
        : '',
    ) +
    `<div class="kpi-grid">${kpi('Source rows', sum('source_count'), 'Records and clauses', 'file')}${kpi('Loaded rows', sum('loaded_count'), 'Draft targets linked', 'check')}${kpi('Pending rows', sum('pending_count'), 'Review or correction needed', 'clock')}${kpi('Source batches', result.summary?.batches ?? batches.length, 'Preserved source snapshots', 'layers')}</div>` +
    searchForm('view-filter', 'Search source file or batch…', query.get('q') || '') +
    tablePanel(
      table(
        ['Source batch', 'Source file', 'Source rows', 'Loaded', 'Pending', ''],
        rows.map((r) => [
          `<span class="record-code">${esc(r.code)}</span>`,
          `<span class="record-title">${esc(r.source_file)}</span>`,
          r.source_count,
          r.loaded_count,
          r.pending_count,
          link('migration/' + r.id, 'Source profile', 'btn small'),
        ]),
        {pageKey: 'batches', pagination: result.pagination, columnOptionsUrl},
      ),
      'Source batches',
      `<div><div class="actions"><a class="btn small" href="${excelTemplate}" download>${icon('download')}Download Excel template</a><a class="btn small" href="${csvTemplate}" download>CSV template</a></div><p>Excel choices refresh on every download.</p></div>`,
    ) +
    `<div class="mt16">${note(esc(importGuidance) + ' Complete linked groups require independent content validation and normal source approval.')}</div>`
  );
}
function renderBatch(query) {
  const { batch: b, rows, populations, permissions } = state.batch,
    q = (query.get('q') || '').toLowerCase(),
    status = query.get('status'), entity = query.get('entity');
  const selected = rows.filter(
    (r) =>
      (!status || r.validation_status === status) && (!entity || r.profile.entity_type === entity) && JSON.stringify(r).toLowerCase().includes(q),
  );
  return (
    `<a class="back-link" href="#migration">${icon('back')}Back to Import existing regulatory records</a>` +
    heading(
      b.source_file,
      'Review the source and imported rows before loading validated records as Drafts.',
      `<a class="btn" href="/api/migration/${b.id}/report.csv" download>${icon('download')}Download profiling report</a>`,
    ) +
    reviewGuide(state.batch, Boolean(q || status || entity)) + draftLoadGuide(state.batch, status) +
    `<div class="kpi-grid">${[
      ...new Set([
        'LOADED',
        'CORRECTION_REQUIRED',
        'CONTENT_VALIDATION_PENDING',
        'MIGRATION_READY',
        ...Object.keys(populations),
      ]),
    ]
      .map((name) => [name, populations[name] || 0])
      .map(([name, count]) =>
        kpi(
          title(name),
          count,
          'Open this source population',
          'file',
          'migration/' + b.id + '?status=' + name,
        ),
      )
      .join('')}</div>` +
    panel(
      'Migration batch · ' + b.code,
      `<div class="row between"><div><strong>${esc(b.source_file)}</strong><p class="small muted mt8">Source rows: ${b.source_count} · Loaded: ${b.loaded_count} · Pending: ${b.pending_count}</p></div>${badge(state.batch.reconciled ? 'RECONCILED' : 'REVIEW_REQUIRED')}</div><progress class="migration-progress" max="${Math.max(b.source_count, 1)}" value="${b.loaded_count}" aria-label="Loaded source rows"></progress><details class="mt16"><summary>File integrity and lineage</summary><p class="small mt8">Batch: ${esc(b.code)}</p><p class="small wordbreak">${state.batch.combined ? 'Bundle' : 'Source file'} SHA-256: ${esc(b.file_hash)}</p>${state.batch.combined ? `<p class="small wordbreak">Workbook SHA-256: ${esc(state.batch.workbook_sha256)}</p>` : ''}</details>`,
      {
        action: permissions.can_refresh && b.pending_count
          ? button('reprofile-batch', 'Refresh validation preview', '', 'small') : '',
      },
    ) +
    '<div id="import-review-content" role="region" aria-label="Import sources and validation rows" tabindex="-1">' +
    `<div class="mt24">${searchForm('view-filter', 'Search source record, issue or target…', query.get('q') || '', (state.batch.combined ? select('entity', [{id:'instrument',name:'Regulatory records'},{id:'clause',name:'Clauses'}], entity || '', 'name', 'aria-label="Record type"', 'All record types') : '') + (status ? `<span class="tag neutral">${esc(title(status))}</span><input type="hidden" name="status" value="${esc(status)}"><a class="btn small" href="#migration/${b.id}">Clear status</a>` : ''))}</div>` +
    combinedImportPreview(state.batch, query) +
    tablePanel(
      table(
        ['Source lineage', 'Source content', 'Validation result', 'Issue / target'],
        selected.map((r) => {
          const normalized = r.profile.normalised || {};
          const domainName = (id) =>
            state.masters.regulatory_domain.find((domain) => domain.id === id)?.name || id;
          const secondaryNames = (normalized.secondary_domain_ids || []).map(domainName);
          const domainSummary = normalized.primary_domain_id
            ? `<small>Primary domain: ${esc(domainName(normalized.primary_domain_id))}</small>${secondaryNames.length ? `<small>Additional domains: ${esc(secondaryNames.join(', '))}</small>` : ''}`
            : '';
          return [
            `<span class="record-title">${esc(r.source_system)}</span><small>${r.profile.generated_heading ? 'Generated document heading' : `${esc(r.sheet_name)} · Row ${r.row_number}`}</small>`,
            esc(
              normalized.title ||
                normalized.heading ||
                r.profile.clause_reference ||
                r.source.title ||
                r.source.Title ||
                r.source.clause_reference ||
                r.profile.entity_type,
            ) +
              domainSummary +
              (r.profile.generated_heading ? '' : `<details class="mt8"><summary>Original row</summary><pre>${esc(JSON.stringify(r.source, null, 2))}</pre></details>`),
            badge(r.validation_status),
            (r.profile.errors?.map(esc).join('<br>') ||
              (r.validation_status === 'MIGRATION_READY' ? 'Validated and ready to load as a Draft.'
                : r.validation_status === 'CONTENT_VALIDATION_PENDING' ? 'Independent content validation pending.'
                : 'No field errors.')) +
              (r.target_entity_type === 'instrument'
                ? '<div class="mt8">' +
                  link(instrumentWorkspacePath(r.target_entity_id, r.profile.target_version_id), 'Open Draft →', 'text-link') +
                  '</div>'
                : r.target_entity_id
                  ? '<div class="mt8">' + link(importedClausePath(r), 'Open clause →', 'text-link') + '</div>'
                  : ''),
          ];
        }),
      ),
    ) +
    '</div>'
  );
}
export function migrationHandlers({ render, loadIdentity, loginView }) {
  return {
    actions: {
      source: () =>
        modal(
          'Upload a source document for import',
          /* HTML */ `<div class="grid">
            ${field(
              'Owning department',
              referenceSelect('regulatory_owner_unit_id','organisational_unit',state.identity.user.org_unit_id,'required',undefined,{authorScope:true}),
            )}${field(
              'Confidentiality',
              referenceSelect('confidentiality_class_id','confidentiality_class',state.masters.confidentiality_class.find(c=>c.code==='INTERNAL')?.id,'required'),
            )}${field(
              'Original source',
              input('source_file', '', 'file', `required ${documentAccept()}`),
              documentHint(),
              'full',
            )}
          </div>`,
          'source',
          'Upload source',
        ),
      stage: () =>
        templateUploadModal(
          'Import records and clauses',
          `${field('Source system / register name', input('source_system', '', 'text', 'required maxlength="100"'))}${field('Workbook or CSV register', input('file', '', 'file', 'required accept=".csv,.xlsx"'), fileLimitHint('workbook_mib') + ' Up to 10,000 rows.')}${field('Source documents (optional)', input('source_files', '', 'file', `multiple ${documentAccept()}`), documentHint() + ' Match Source file name exactly. Up to 50 sources and 100 MiB total.')}<p class="small">${esc(importGuidance)}</p>`,
          { formId: 'stage', submitLabel: 'Upload and profile', excelTemplate, csvTemplate },
        ),
      'open-import-section': ({ section }) => {
        const content = document.getElementById(section);
        content?.focus({ preventScroll: true });
        content?.scrollIntoView({ block: 'start' });
      },
      'validate-batch': () =>
        modal(
          'Confirm independent content validation',
          /* HTML */ `<p>
              This confirms the eligible content in the entire batch, including rows hidden by filters or pagination.
            </p>
            <label class="check-label"
              ><input type="checkbox" required /> I compared the eligible records and clauses with the
              authoritative source and verified the references, wording, clause hierarchy and any notification relationships.</label
            >
            <p>
              Rows with errors will still need correction. The uploading Author will be notified when rows are ready to load as Drafts.
            </p>`,
          'validate-batch',
          'Confirm content validation',
        ),
      'load-batch': async () => {
        const { batch, populations } = state.batch;
        const linked = hasReadyFamilyLinks(state.batch);
        let assignments = '';
        if (linked) {
          const { reviewers, approvers } = await api('/migration/' + batch.id + '/family-assignees');
          if (state.batch?.batch.id !== batch.id || location.hash.slice(1).split('?')[0] !== 'migration/' + batch.id) return;
          if (!reviewers.some(person => approvers.some(approver => person.id !== approver.id))) {
            modal('Notification proposal assignments unavailable', '<p>A separate Compliance Reviewer and Final Approver need access to the notifications in these proposals. Check their role and department assignments before loading.</p>');
            return;
          }
          const choices = people => people.map(person => ({...person, name: `${person.full_name} (${person.username})`}));
          assignments = `<p>These assignments apply to all notification proposals created by this load.</p>
            ${field('Compliance Reviewer', select('reviewer_id', choices(reviewers), '', 'name', 'required'))}
            ${field('Final Approver', select('approver_id', choices(approvers), '', 'name', 'required'))}`;
        }
        modal(
          'Load migration-ready rows',
          /* HTML */ `<p>
              Load all ${populations.MIGRATION_READY} ready rows in this batch as Drafts in the Regulatory Library.
              Rows awaiting review or correction stay in the batch.
            </p>
            <p>
              After loading, open the Draft source editions and submit them for review and approval.
              If an eligible group changes before loading, the entire load rolls back.
            </p>${assignments}`,
          'load-batch',
          linked ? 'Load Drafts and submit proposals' : 'Load Draft records',
        );
      },
      'reprofile-batch': () => modal('Refresh validation preview',
        '<p>Recheck pending groups against current master data, source files and Draft targets. Pending groups will need independent content validation again. Loaded rows are retained.</p>',
        'reprofile-batch', 'Refresh preview'),
    },
    forms: {
      source: async (form) => {
        const result = await uploadSource(form);
        modal(
          'Source document preserved',
          /* HTML */ `<p>${esc(result.file_name)} is stored with its integrity hash.</p>
            ${field('Source document ID', input('document_id', result.id, 'text', 'readonly'))}
            <p>
              Copy this value into the Source document ID column. Department and confidentiality
              must match the row you import.
            </p>
            ${button('close', 'Done')}`,
        );
      },
      stage: async (form) => {
        const workbook = form.elements.file.files[0];
        const sources = Array.from(form.elements.source_files.files) as File[];
        if (sources.length > 50 || workbook.size + sources.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024)
          throw new Error('Attach at most 50 source files; the complete upload must be at most 100 MiB.');
        const result = await api('/migration', 'POST', new FormData(form));
        close();
        location.hash = 'migration/' + result.id;
        message('Source register staged and profiled.');
        await render();
      },
      'validate-batch': async () => {
        const result = await api('/migration/' + state.batch.batch.id + '/validate', 'POST', {});
        close();
        message(result.validated
          ? `${result.validated} ${result.validated === 1 ? 'row is' : 'rows are'} ready to load. The uploading Author has been notified.`
          : 'No rows became ready to load. Check the current batch status and findings.', result.validated ? 'success' : 'info');
        await render();
      },
      'load-batch': async (form) => {
        const id = state.batch.batch.id;
        const values = Object.fromEntries(new FormData(form));
        if (values.reviewer_id && values.reviewer_id === values.approver_id) throw new Error('Choose a different person for final approval.');
        const result = await api('/migration/' + id + '/load', 'POST', values);
        close();
        history.replaceState(history.state, '', '#migration/' + id + '?status=LOADED');
        const sent = result.family_proposals ? ` ${result.family_proposals} notification ${result.family_proposals === 1 ? 'proposal sent' : 'proposals sent'} for review.` : '';
        message(`${result.loaded} ${result.loaded === 1 ? 'row loaded' : 'rows loaded'} as Drafts.${sent} Open the Draft source editions to submit them for review.`);
        await render();
      },
      'reprofile-batch': async () => {
        await api('/migration/' + state.batch.batch.id + '/reprofile', 'POST', {});
        close();
        message('Validation preview refreshed. Independent content validation is required for eligible pending groups.', 'info');
        await render();
      },
    },
  };
}
