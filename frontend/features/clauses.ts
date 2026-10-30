import { api } from '../core/api.ts';
import { covered, has } from '../core/access.ts';
import { state } from '../core/state.ts';
import {
  badge,
  esc,
  input,
  date,
  localDate,
  link,
  message,
  title,
  versionLabel,
} from '../ui/components.ts';
import { heading, pageHelp } from '../ui/layout.ts';
import { close, modal } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { note, recordCell, table, tablePanel } from '../ui/widgets.ts';
import { clausePayload, openClauseDialog, type ClauseDraftTarget } from './clause-dialog.ts';
import { clauseEditionBadges, renderClauseWorkingView } from './clause-workspace.ts';
import { sourceEditionStatus } from '../core/source-editions.ts';
import { selectClauseScope } from '../core/clause-scope.ts';

function workingPath(row, query = new URLSearchParams(), matchingIds?: Set<string>) {
  const next = new URLSearchParams(query);
  next.delete('view');
  if (matchingIds && !matchingIds.has(row.id)) {
    next.delete('q');
    next.delete('status');
    const edition=next.get('edition');
    if(edition&&edition!=='all'&&(edition==='current'?!row.version_is_effective_current:edition!==row.instrument_version_id)){
      next.set('edition',row.instrument_version_id);next.set('instrument',row.instrument_id);
    }
    if(next.get('instrument')&&next.get('instrument')!=='all'&&next.get('instrument')!==row.instrument_id)next.set('instrument',row.instrument_id);
  }
  next.set('clause', row.id);
  if (!next.has('instrument')) next.set('instrument', 'all');
  if (!next.has('edition')) next.set('edition', 'all');
  next.delete('version');
  return 'clauses?' + next;
}

function clauseRegister(rows, query) {
  return tablePanel(table(
    ['Clause', 'Instrument', 'Source edition', 'Parent / page reference', 'Interpretation', 'Status', ''],
    rows.map((row) => {
      const path = workingPath(row, query);
      return [
        recordCell(row.code, row.heading || 'Source clause / para', path, row.source_clause_reference ? 'Source clause / para ' + row.source_clause_reference : ''),
        `<a class="text-link" href="#repository/${esc(row.instrument_id)}">${esc(row.instrument_code)}</a><small>${esc(row.instrument_short_title || row.instrument_title)}</small><small>${esc(row.regulator_code)} · ${esc(row.domain_name)}</small>`,
        clauseEditionBadges(row),
        esc(row.parent_code || 'Top level') + `<small>${esc(row.source_page_reference || 'Page not recorded')}</small>`,
        esc(row.internal_interpretation || 'Interpretation pending'),
        badge(row.approval_status || 'DRAFT'),
        `<a class="btn small clause-open-button" href="#${esc(path)}">Open <span class="sr-only">${esc(row.code)}</span></a>`,
      ];
    }),
    { caption: 'Authorised source clauses and paras', empty: 'No clauses or paras match this search.' },
  ), 'Clause and para register', '', 'clause-register-panel');
}

export async function clausesPage(_id, query = new URLSearchParams()) {
  const registerView = query.get('view') === 'register';
  const [sourceRows, instruments, editions] = await Promise.all([
    api('/clauses'), api('/instruments'), api('/source-editions'),
  ]);
  instruments.sort((a, b) => a.title.localeCompare(b.title));
  const scope = selectClauseScope(instruments, editions, query, localDate());
  const editionById = new Map<string, any>(editions.map((row) => [row.id, row]));
  const visibleIds = new Set(scope.visibleEditions.map((row) => row.id));
  const allRows = sourceRows.map((row) => {
    const version = editionById.get(row.instrument_version_id);
    return { ...row, version_is_effective_current: scope.currentIds.has(row.instrument_version_id),
      version_cancelled_draft: version?.cancelled_draft, version_effective_from: version?.effective_from,
      version_effective_to: version?.effective_to };
  });
  const population = allRows.filter((row) => (scope.instrumentId === 'all' || row.instrument_id === scope.instrumentId) &&
    visibleIds.has(row.instrument_version_id));
  const search = (query.get('q') || '').trim().toLocaleLowerCase();
  const status = query.get('status') || '';
  const rows = population.filter((row) => {
    const haystack = [row.code, row.source_clause_reference, row.source_page_reference, row.heading,
      row.clause_text, row.internal_interpretation, row.instrument_code, row.instrument_title,
      row.instrument_short_title, row.official_reference_number, row.regulator_code, row.regulator_name, row.domain_name]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return (!search || haystack.includes(search)) && (!status || row.approval_status === status);
  });
  const selected = rows.find((row) => row.id === query.get('clause')) || rows[0];
  // Only the opened clause needs full document/workflow detail, even in the All view.
  const record = selected && !registerView ? await api('/instruments/' + selected.instrument_id) : null;
  const selectedVersion = record?.versions.find((row) => row.id === selected?.instrument_version_id);
  const editable = selected && record && covered(record.instrument.regulatory_owner_unit_id, ['AUTHOR']) &&
    selectedVersion?.approval_status === 'DRAFT' && selectedVersion.created_by === state.identity.user.id && selected.approval_status === 'DRAFT';
  const matchingIds = new Set<string>(rows.map((row) => row.id));
  const contextQuery = new URLSearchParams(query);
  contextQuery.set('instrument', scope.instrumentId);
  contextQuery.set('edition', scope.editionFilter);
  contextQuery.delete('version');
  const clearQuery = new URLSearchParams(contextQuery);
  for (const key of ['q', 'status', 'clause']) clearQuery.delete(key);
  const clearPath = 'clauses?' + clearQuery;
  const viewQuery = new URLSearchParams(contextQuery);
  if (selected) viewQuery.set('clause', selected.id);
  viewQuery.delete('view');
  const workspacePath = 'clauses?' + viewQuery;
  viewQuery.set('view', 'register');
  const registerPath = 'clauses?' + viewQuery;
  const sourceDocument = selectedVersion?.source_document_id ? {
    id: selectedVersion.source_document_id,
    name: record.source_documents[selectedVersion.source_document_id] || 'Source document',
  } : undefined;
  const editionOptions = scope.instrument ? scope.scopedEditions.map((version) => {
    const status = scope.currentIds.has(version.id) ? 'Current approved' : title(sourceEditionStatus(version));
    const position = version.effective_from > localDate() ? ' · Future effective' :
      version.approval_status === 'APPROVED' && version.effective_to && version.effective_to <= localDate() ? ' · Historical' : '';
    return `<option value="${esc(version.id)}" ${version.id === scope.editionFilter ? 'selected' : ''}>Version ${esc(versionLabel(version.version_number))} · ${esc(status)}${position}</option>`;
  }).join('') : '';
  const navigationControls = `<div class="clause-source-controls">
    <label for="clause-instrument">Instrument</label>
    <select id="clause-instrument" name="clause_workspace_instrument">
      <option value="all" ${scope.instrumentId === 'all' ? 'selected' : ''}>All instruments</option>
      ${instruments.map((row) => `<option value="${esc(row.id)}" ${row.id === scope.instrumentId ? 'selected' : ''}>${esc(row.short_title || row.title)} · ${esc(row.code)}</option>`).join('')}
    </select>
    <label for="clause-source-edition">Source edition</label>
    <select id="clause-source-edition" name="clause_workspace_edition" data-instrument-id="${esc(scope.instrumentId)}">
      <option value="all" ${scope.editionFilter === 'all' ? 'selected' : ''}>All editions</option>
      <option value="current" ${scope.editionFilter === 'current' ? 'selected' : ''}>Current approved</option>
      ${editionOptions}
    </select>
    <p>${scope.instrument ? 'Specific editions are listed for this instrument.' : 'Choose an instrument to select a specific edition.'}</p>
    ${scope.specific ? `<p>Effective from ${date(scope.specific.effective_from)}${scope.specific.effective_to ? ' until ' + date(scope.specific.effective_to) + ' (exclusive)' : ''}</p>` : ''}
  </div>`;
  let editionNotice = '';
  if (scope.invalidInstrument || scope.invalidEdition)
    editionNotice += note('A requested instrument or edition is unavailable. The filters shown above identify the available selection.', 'warn');
  if (scope.editionFilter === 'all')
    editionNotice += note('All editions are shown, including Draft and historical sources. Edition/status badges identify each clause’s source.');
  else if (scope.editionFilter === 'current' && !scope.visibleEditions.length)
    editionNotice += note('No approved source edition is effective today for this selection. All editions remains available for reference.', 'warn');
  else if (scope.specific && !scope.currentIds.has(scope.specific.id)) {
    const currentQuery = new URLSearchParams({ instrument: scope.instrumentId, edition: 'current' });
    editionNotice += note('Viewing a specific ' + esc(title(sourceEditionStatus(scope.specific)).toLowerCase()) +
      ' edition for reference. ' + link('clauses?' + currentQuery, 'View current approved', 'text-link'), 'warn');
  }
  return pageHelp('Read the specific provision',
    'The workspace starts with All instruments and All editions. Filter to Current approved, or choose an instrument and a specific edition. Each branch retains parents from its own edition. Search applies to the selected scope. Authors can edit clauses only in their own Draft editions.') +
    heading(registerView ? 'Clause register' : 'Clause workspace',
      'Keep original regulatory wording separate from the bank’s internal interpretation.',
      `${has('AUTHOR') ? `<button type="button" class="btn primary" data-action="add-clause" data-version="${esc(selectedVersion?.id || scope.specific?.id || '')}" data-instrument="${esc(selected?.instrument_id || scope.instrument?.id || '')}">${icon('plus')}<span>Add clause</span></button>` : ''}`) +
    `<nav class="clause-view-switch" aria-label="Clause views"><a href="#${esc(workspacePath)}" ${registerView ? '' : 'aria-current="page"'}>${icon('layers')}Workspace</a><a href="#${esc(registerPath)}" ${registerView ? 'aria-current="page"' : ''}>${icon('grid')}Register</a></nav>` +
    `<form id="clause-filters" class="filters">
      ${registerView ? '<input type="hidden" name="view" value="register">' : ''}
      <input type="hidden" name="instrument" value="${esc(scope.instrumentId)}">
      <input type="hidden" name="edition" value="${esc(scope.editionFilter)}">
      <div class="search-field">${icon('search')}${input('q', query.get('q') || '', 'search', 'placeholder="Search clauses in this selection…" aria-label="Search clauses"')}</div>
      <select class="filter-select" name="status" aria-label="Clause approval status">
        <option value="">All clause statuses</option>
        ${['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map((value) => `<option value="${value}" ${status === value ? 'selected' : ''}>${esc(title(value))}</option>`).join('')}
      </select>
      <button class="btn small primary search-submit" type="submit">Search</button>
      ${search || status ? link(clearPath, 'Clear filters', 'btn small') : ''}
    </form>` +
    (registerView ? navigationControls + clauseRegister(rows, contextQuery) : editionNotice + renderClauseWorkingView({
      rows, allRows, allEditions: true, navigationControls, selectedId: selected?.id, provenance: record?.clause_carry_forward||[],
      pathFor: (row) => workingPath(row, contextQuery, matchingIds),
      editAction: (editable ? `<button type="button" class="btn small" data-action="workspace-edit-clause" data-id="${esc(selected.id)}" data-instrument="${esc(selected.instrument_id)}">${icon('pen')}<span>Edit Draft clause</span></button>` : '')+(selected&&record&&(editable||selectedVersion?.approval_status==='APPROVED')&&covered(record.instrument.regulatory_owner_unit_id,['AUTHOR'])?`<button type="button" class="btn small" data-action="link-earlier-clause" data-id="${esc(selected.id)}" data-instrument="${esc(selected.instrument_id)}">Link earlier clause</button>`:''),
      sourceDocument, emptyAction: search || status ? link(clearPath, 'Clear filters', 'btn') : '',
    })) +
    `<div class="source-note">Showing ${rows.length} of ${population.length} authorised clauses / paras in this selection. Each clause retains its exact source edition.</div>`;
}

export function clauseHandlers({ render }) {
  return {
    actions: {
      'workspace-edit-clause': async ({ id, instrument }) => {
        const record = await api('/instruments/' + instrument);
        const clause = record.clauses.find((row) => row.id === id);
        const version = record.versions.find((row) => row.id === clause?.instrument_version_id);
        if (!clause || clause.approval_status !== 'DRAFT' || version?.approval_status !== 'DRAFT' || version.created_by !== state.identity.user.id || !covered(record.instrument.regulatory_owner_unit_id, ['AUTHOR'])) {
          throw new Error('Only the maker can edit clauses in this Draft source edition.');
        }
        openClauseDialog([{
          id: version.id, instrument_id: instrument,
          name: `${record.instrument.code} · Version ${versionLabel(version.version_number)}`,
          clauses: record.clauses.filter((row) => row.instrument_version_id === version.id),
        }], 'workspace-edit-clause', clause);
        document.querySelector<HTMLFormElement>('#workspace-edit-clause').dataset.clauseId = id;
      },
      'add-clause': async ({ version, instrument }, trigger: HTMLButtonElement) => {
        trigger.disabled = true;
        try {
          const tasks = (await api('/tasks')).filter((task) => task.kind === 'DRAFT');
          const instrumentIds = [...new Set<string>(tasks.map((task) => task.instrument_id))];
          const records = await Promise.all(instrumentIds.map((id) => api('/instruments/' + id)));
          const targets: ClauseDraftTarget[] = records.flatMap((record) => record.versions
            .filter((version) => version.approval_status === 'DRAFT' && version.created_by === state.identity.user.id)
            .map((version) => ({
              id: version.id,
              instrument_id: record.instrument.id,
              name: `${record.instrument.code} · ${record.instrument.short_title || record.instrument.title} · Version ${versionLabel(version.version_number)}`,
              clauses: record.clauses.filter((clause) => clause.instrument_version_id === version.id),
            })));
          if (!targets.length) {
            modal('Add a source-linked clause', `<div class="notice">No editable Draft source edition is available to you. Create a Draft instrument, or open an approved instrument and add a subsequent Draft source version.</div><div class="actions"><a class="btn primary" href="#repository" data-action="close">Open regulatory library</a></div>`, '', '', 'A clause belongs to an exact source edition.');
            return;
          }
          const priority = (target: ClauseDraftTarget) => target.id === version ? 2 : target.instrument_id === instrument ? 1 : 0;
          targets.sort((a, b) => priority(b) - priority(a));
          openClauseDialog(targets, 'create-clause');
        } finally {
          if (trigger.isConnected) trigger.disabled = false;
        }
      },
    },
    forms: {
      'workspace-edit-clause': async (form: HTMLFormElement) => {
        const result = await api('/versions/' + form.dataset.versionId + '/clauses/' + form.dataset.clauseId, 'PUT', clausePayload(form));
        close();
        message('Draft clause saved. Original wording and interpretation are kept separately.');
        location.hash = workingPath(result);
        await render();
      },
      'create-clause': async (form: HTMLFormElement) => {
        const versionId = form.dataset.versionId;
        const instrumentId = form.dataset.instrumentId;
        if (!versionId || !instrumentId) throw new Error('Choose a Draft source edition before saving.');
        const result = await api('/versions/' + versionId + '/clauses', 'POST', clausePayload(form));
        close();
        message('Clause / para saved in Draft. Submit its source edition when it is ready for review.');
        location.hash = workingPath(result);
        await render();
      },
      'clause-filters': (form) => {
        const data = new FormData(form);
        const query = new URLSearchParams();
        for (const key of ['q', 'status', 'view', 'instrument', 'edition']) {
          const value = String(data.get(key) || '').trim();
          if (value) query.set(key, value);
        }
        location.hash = 'clauses' + (query.size ? '?' + query.toString() : '');
      },
    },
  };
}
