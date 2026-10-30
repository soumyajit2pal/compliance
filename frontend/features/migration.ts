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
      'Bring existing Excel or CSV regulatory registers into the portal. Keep one primary domain for the permanent instrument ID, and list any other affected domains separately.',
      has('AUTHOR')
        ? button('source', 'Upload source document') +
            button('stage', 'Import source', '', 'primary')
        : '',
    ) +
    `<div class="kpi-grid">${kpi('Source records', sum('source_count'), 'Original source rows', 'file')}${kpi('Loaded records', sum('loaded_count'), 'Draft targets created', 'check')}${kpi('Pending rows', sum('pending_count'), 'Review or correction needed', 'clock')}${kpi('Source batches', batches.length, 'Preserved source snapshots', 'layers')}</div>` +
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
    `<div class="mt16">${note('The Excel template uses screen field names, current database choices, instructions and a separate example. For each instrument, choose one Primary regulatory domain; enter additional domain names or codes in Additional affected domains, separated by semicolons. The additional domains are mapped independently and do not change the permanent ID. Saved files are snapshots; download a fresh template for updated choices. Fill only Regulatory records; the example and guidance sheets are not imported. Upload each authoritative source first and copy its Source document ID into the matching record. Imported records still need independent review before approval.')}</div>`
  );
}
function renderBatch(query) {
  const { batch: b, rows, populations } = state.batch,
    q = (query.get('q') || '').toLowerCase(),
    status = query.get('status');
  const selected = rows.filter(
    (r) =>
      (!status || r.validation_status === status) && JSON.stringify(r).toLowerCase().includes(q),
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
      `<div class="row between"><div><strong>${esc(b.source_file)}</strong><p class="small muted mt8">Source rows: ${b.source_count} · Loaded: ${b.loaded_count} · Pending: ${b.pending_count}</p></div>${badge(state.batch.reconciled ? 'RECONCILED' : 'REVIEW_REQUIRED')}</div><progress class="migration-progress" max="${Math.max(b.source_count, 1)}" value="${b.loaded_count}" aria-label="Loaded source rows"></progress><details class="mt16"><summary>File integrity and lineage</summary><p class="small mt8">Batch: ${esc(b.code)}</p><p class="small wordbreak">SHA-256: ${esc(b.file_hash)}</p></details>`,
      {
        action:
          (has('REVIEWER') && populations.CONTENT_VALIDATION_PENDING
            ? button('validate-batch', 'Validate reviewed content', '', 'small')
            : '') +
          (has('AUTHOR') && populations.MIGRATION_READY
            ? button('load-batch', 'Load ready rows as Drafts', '', 'small primary')
            : ''),
      },
    ) +
    `<div class="mt24">${searchForm('view-filter', 'Search source record, issue or target…', query.get('q') || '', status ? `<span class="tag neutral">${esc(status)}</span><a class="btn small" href="#migration/${b.id}">Clear status</a>` : '')}</div>` +
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
                  link('repository/' + r.target_entity_id, 'Open Draft →', 'text-link') +
                  '</div>'
                : r.target_entity_id
                  ? '<small>Target clause / para: ' + esc(r.target_entity_id) + '</small>'
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
          'Import a regulatory register',
          `${field('Source system / register name', input('source_system', '', 'text', 'required maxlength="100"'), 'For example: Compliance approved register.')}${field('CSV or XLSX file', input('file', '', 'file', 'required accept=".csv,.xlsx"'), 'Download a fresh template for current database choices. Use one Primary regulatory domain and put other affected domains in the optional semicolon-separated Additional affected domains field. Fill Regulatory records; example and guidance sheets are excluded. UTF-8 CSV or XLSX, up to 20 MB and 10,000 rows. Every original row is preserved.')}<p><a href="/api/migration-template?format=xlsx" download>Download Excel template with example</a> · <a href="/api/migration-template?format=csv" download>CSV template</a></p>`,
          'stage',
          'Upload and profile',
        ),
      'validate-batch': () =>
        modal(
          'Confirm independent content validation',
          /* HTML */ `<p>
              You are validating ${state.batch.populations.CONTENT_VALIDATION_PENDING} rows that
              passed field checks. Review each original row and its source document first.
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
        message(result.loaded + ' Draft records loaded with source lineage.');
        await render();
      },
    },
  };
}
