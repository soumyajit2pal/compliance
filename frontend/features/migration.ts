import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { has, covered } from '../core/access.ts';
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
import { heading } from '../ui/layout.ts';
import { icon } from '../ui/icons.ts';
import { panel, table, tablePanel, note, searchForm } from '../ui/widgets.ts';
import { combinedImportPreview, importedClausePath } from './import-preview.ts';
import { instrumentWorkspacePath } from '../core/source-navigation.ts';

const importGuidance = 'Fill Regulatory records and optionally Clauses. Link rows with Import reference; use Parent clause reference for hierarchy. Attach PDF, UTF-8 text or DOCX sources matching Source file name. Existing Source document IDs also work. Instructions, Example and Choices are excluded.';

function kpi(label, value, sub, ic = 'file', href = '') {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="kpi-card" ${href ? `href="#${href}"` : ''}><div class="kpi-label">${esc(label)}<span class="kpi-icon">${icon(ic)}</span></div><div class="kpi-number num">${value}</div><div class="kpi-footer">${esc(sub)}</div></${tag}>`;
}
export async function migrationPage(id, query = new URLSearchParams()) {
  const request = state.routeNumber;
  if (id) {
    const data = await api('/migration/' + id);
    if (request !== state.routeNumber || !state.identity) return '';
    state.batch = data;
    return renderBatch(query);
  }
  const batches = await api('/migration');
  if (request !== state.routeNumber || !state.identity) return '';
  const q = (query.get('q') || '').toLowerCase(),
    rows = batches.filter((b) => JSON.stringify(b).toLowerCase().includes(q));
  const sum = (key) => batches.reduce((n, b) => n + (b[key] || 0), 0);
  return (
    heading(
      'Import existing regulatory records',
      'Import regulatory records, clauses and source documents together. Preview and validate before loading Drafts.',
      has('AUTHOR')
        ? button('source', 'Upload source document') +
            button('stage', 'Import records & clauses', '', 'primary')
        : '',
    ) +
    `<div class="kpi-grid">${kpi('Source rows', sum('source_count'), 'Records and clauses', 'file')}${kpi('Loaded rows', sum('loaded_count'), 'Draft targets linked', 'check')}${kpi('Pending rows', sum('pending_count'), 'Review or correction needed', 'clock')}${kpi('Source batches', batches.length, 'Preserved source snapshots', 'layers')}</div>` +
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
      ),
      'Source batches',
      `<div><div class="actions"><a class="btn small" href="/api/migration-template?format=xlsx" download>${icon('download')}Download Excel template</a><a class="btn small" href="/api/migration-template?format=csv" download>CSV template</a></div><p>Choices refreshed from the database on every download.</p></div>`,
    ) +
    `<div class="mt16">${note(esc(importGuidance) + ' Complete linked groups require independent content validation and normal source approval.')}</div>`
  );
}
function renderBatch(query) {
  const { batch: b, rows, populations } = state.batch,
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
      'Source file → Sheet → Row → Profile → Content validation → Draft target',
      `<a class="btn" href="/api/migration/${b.id}/report.csv" download>${icon('download')}Download profiling report</a>`,
    ) +
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
        action:
          (has('REVIEWER') && populations.CONTENT_VALIDATION_PENDING
            ? button('validate-batch', 'Validate reviewed content', '', 'small')
            : '') +
          (has('AUTHOR') && (!state.batch.combined || b.uploaded_by === state.identity.user.id) && populations.MIGRATION_READY
            ? button('load-batch', 'Load ready rows as Drafts', '', 'small primary')
            : '') +
          (state.batch.combined && has('AUTHOR') && b.uploaded_by === state.identity.user.id && b.pending_count
            ? button('reprofile-batch', 'Refresh validation preview', '', 'small') : ''),
      },
    ) +
    `<div class="mt24">${searchForm('view-filter', 'Search source record, issue or target…', query.get('q') || '', (state.batch.combined ? select('entity', [{id:'instrument',name:'Regulatory records'},{id:'clause',name:'Clauses'}], entity || '', 'name', 'aria-label="Record type"', 'All record types') : '') + (status ? `<span class="tag neutral">${esc(status)}</span><input type="hidden" name="status" value="${esc(status)}"><a class="btn small" href="#migration/${b.id}">Clear status</a>` : ''))}</div>` +
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
            `<span class="record-title">${esc(r.source_system)}</span><small>${esc(r.sheet_name)} · Row ${r.row_number}</small>`,
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
              `<details class="mt8"><summary>Original row</summary><pre>${esc(JSON.stringify(r.source, null, 2))}</pre></details>`,
            badge(r.validation_status),
            (r.profile.errors?.map(esc).join('<br>') ||
              'No field errors. ' +
                (r.validation_status === 'CONTENT_VALIDATION_PENDING'
                  ? 'Independent content validation pending.'
                  : '')) +
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
    `<div class="mt16">${note('A migration-ready row has passed field checks and independent content validation. Loading creates a Draft; the target source version still needs normal review and approval.')}</div>`
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
              select(
                'regulatory_owner_unit_id',
                state.masters.organisational_unit.filter((u) => covered(u.id, ['AUTHOR'])),
                state.identity.user.org_unit_id,
                'name',
                'required',
              ),
            )}${field(
              'Confidentiality',
              select(
                'confidentiality_class_id',
                state.masters.confidentiality_class,
                state.masters.confidentiality_class.find((c) => c.code === 'INTERNAL')?.id,
                'name',
                'required',
              ),
            )}${field(
              'Original source',
              input('source_file', '', 'file', 'required accept=".pdf,.txt,.docx"'),
              'Maximum 20 MB.',
              'full',
            )}
          </div>`,
          'source',
          'Upload source',
        ),
      stage: () =>
        modal(
          'Import records and clauses',
          `${field('Source system / register name', input('source_system', '', 'text', 'required maxlength="100"'))}${field('Workbook or CSV register', input('file', '', 'file', 'required accept=".csv,.xlsx"'), 'Maximum 20 MB and 10,000 total data rows.')}${field('Source documents (optional)', input('source_files', '', 'file', 'multiple accept=".pdf,.txt,.docx"'), 'Match Source file name exactly. Up to 50 files, 20 MB each; complete upload up to 100 MB.')}<p class="small">${esc(importGuidance)}</p><p><a href="/api/migration-template?format=xlsx" download>Download combined Excel template</a> · <a href="/api/migration-template?format=csv" download>CSV template</a></p>`,
          'stage',
          'Upload and profile',
        ),
      'validate-batch': () =>
        modal(
          'Confirm independent content validation',
          /* HTML */ `<p>
              Review the original rows, source documents and clause hierarchy. Only complete groups
              without field or dependency errors can become migration-ready.
            </p>
            <label class="check-label"
              ><input type="checkbox" required /> I have checked these eligible rows against the
              authoritative source and confirm their content.</label
            >
            <p>
              Rows with errors will stay correction-required. Loaded targets still need the normal
              instrument review and approval.
            </p>`,
          'validate-batch',
          'Confirm content validation',
        ),
      'load-batch': () =>
        modal(
          'Load migration-ready rows',
          /* HTML */ `<p>
              Load ${state.batch.populations.MIGRATION_READY} ready rows into Draft records? Their
              original file, sheet, row and target identity remain traceable.
            </p>
            <p>
              Loading does not approve regulatory content. The operation is atomic: a changed row
              eligibility prevents the batch from being partly loaded.
            </p>`,
          'load-batch',
          'Load Draft records',
        ),
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
        if (workbook.size > 20 * 1024 * 1024 || sources.some((file) => !file.size || file.size > 20 * 1024 * 1024))
          throw new Error('Choose non-empty files up to 20 MB each.');
        if (sources.length > 50 || workbook.size + sources.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024)
          throw new Error('Attach at most 50 source files; the complete upload must be at most 100 MB.');
        const result = await api('/migration', 'POST', new FormData(form));
        close();
        location.hash = 'migration/' + result.id;
        message('Source register staged and profiled.');
        await render();
      },
      'validate-batch': async () => {
        await api('/migration/' + state.batch.batch.id + '/validate', 'POST', {});
        close();
        message('Eligible rows content-validated.');
        await render();
      },
      'load-batch': async () => {
        const result = await api('/migration/' + state.batch.batch.id + '/load', 'POST', {});
        close();
        message(result.loaded + ' source rows loaded as Draft targets.');
        await render();
      },
      'reprofile-batch': async () => {
        await api('/migration/' + state.batch.batch.id + '/reprofile', 'POST', {});
        close();
        message('Validation preview refreshed. Independent content validation is required for eligible pending groups.');
        await render();
      },
    },
  };
}
