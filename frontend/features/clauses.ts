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
import { heading } from '../ui/layout.ts';
import { close, modal } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { note, recordCell, table, tablePanel } from '../ui/widgets.ts';
import { clausePayload, openClauseDialog, type ClauseDraftTarget } from './clause-dialog.ts';
import { clauseEditionBadges, renderClauseDetail } from './clause-workspace.ts';
import { browsePath, clauseBatch, clauseBrowserActions, renderLazyHierarchy, type BrowserClause, type ClauseBatch } from './clause-browser.ts';
import { sourceEditionStatus } from '../core/source-editions.ts';
import { selectClauseScope } from '../core/clause-scope.ts';
import { clauseWorkspacePath } from '../core/source-navigation.ts';

interface OpenClause {
  clause: BrowserClause;
  ancestors: BrowserClause[];
  edition: BrowserClause;
  owner_unit_id: string;
  source_document?: { id: string; name: string };
  provenance?: BrowserClause;
  original?: BrowserClause;
}

function pageLinks(query: URLSearchParams, page: number, batch: ClauseBatch) {
  const to = (pageNumber: number) => {
    const next = new URLSearchParams(query);
    next.delete('clause');
    next.set('page', String(pageNumber));
    return 'clauses?' + next;
  };
  if (page === 1 && !batch.next_page) return '';
  return `<nav class="actions clause-browser-paging" aria-label="Clause result pages">
    ${page > 1 ? link(to(page - 1), 'Previous results', 'btn small') : ''}
    <span>Page ${page}</span>
    ${batch.next_page ? link(to(batch.next_page), 'Next results', 'btn small') : ''}
  </nav>`;
}

function parentPath(row: BrowserClause) {
  return row.parent_path?.length ? row.parent_path.join(' → ') : 'Top level';
}

function clauseRegister(batch: ClauseBatch, query: URLSearchParams, page: number) {
  return tablePanel(table(
    ['Clause', 'Instrument', 'Source edition', 'Parent path', 'Page', 'Clause approval'],
    batch.items.map(row => [
      recordCell(row.code, row.heading || 'Source clause / para', browsePath(row, query), row.source_clause_reference || ''),
      `${link('repository/' + encodeURIComponent(row.instrument_id), row.instrument_code, 'text-link')}<small>${esc(row.instrument_short_title || row.instrument_title)}</small>`,
      clauseEditionBadges(row),
      esc(parentPath(row)),
      esc(row.source_page_reference || '—'),
      badge(row.approval_status),
    ]),
    { caption: 'Authorised source clauses and Para', empty: 'No clauses or Para match this search.', paginate: false, summary: false },
  ) + pageLinks(query, page, batch), 'Clause and para register', '', 'clause-register-panel');
}

function searchNavigation(batch: ClauseBatch, query: URLSearchParams, page: number) {
  return `<section class="panel clause-results-panel" aria-labelledby="clause-results-heading">
    <h2 id="clause-results-heading">Search results</h2>
    <nav class="clause-browser-results" aria-label="Clause search results">
    ${batch.items.length ? `<ul class="clause-hierarchy-list">${batch.items.map(row =>
      `<li><a class="clause-tree-node ${query.get('clause') === row.id ? 'active' : ''}" href="#${esc(browsePath(row, query))}"
        ${query.get('clause') === row.id ? 'aria-current="true"' : ''}><span>
        <strong>${esc([row.source_clause_reference, row.heading || 'Source clause / para'].filter(Boolean).join(' · '))}</strong>
        <code>${esc(row.code)}</code><small>${esc(row.instrument_short_title || row.instrument_title)}</small>
        ${clauseEditionBadges(row)}<small>Parent path · ${esc(parentPath(row))}</small></span></a></li>`,
    ).join('')}</ul>` : '<p class="clause-hierarchy-empty">No clauses match this search.</p>'}
    ${pageLinks(query, page, batch)}
    </nav>
  </section>`;
}

async function openClause(identifier: string): Promise<OpenClause | null> {
  try {
    return await api<OpenClause>('/clause-browser/' + encodeURIComponent(identifier));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

type ClauseScope = ReturnType<typeof selectClauseScope>;

function sourceControls(instruments: BrowserClause[], scope: ClauseScope, today: string) {
  const editionOptions = scope.instrument ? scope.scopedEditions.map(version => {
    const approval = scope.currentIds.has(version.id) ? 'Current approved' : title(sourceEditionStatus(version));
    const position = version.effective_from > today ? ' · Future effective' :
      version.approval_status === 'APPROVED' && version.effective_to && version.effective_to <= today ? ' · Historical' : '';
    return `<option value="${esc(version.id)}" ${version.id === scope.editionFilter ? 'selected' : ''}>Version ${esc(versionLabel(version.version_number))} · ${esc(approval)}${position}</option>`;
  }).join('') : '';
  return `<div class="clause-browse-fields">
    <div>
      <label for="clause-instrument">Instrument</label>
      <select id="clause-instrument" name="clause_workspace_instrument" data-popup-min-width="480"
        data-search-placeholder="Find by instrument title or reference">
        <option value="all" ${scope.instrumentId === 'all' ? 'selected' : ''}>All instruments</option>
        ${instruments.map(row => {
          const name = row.short_title || row.title;
          const terms = [row.title, row.official_reference_number, ...(row.legacy_codes || [])].filter(Boolean).join(' ');
          return `<option value="${esc(row.id)}" ${row.id === scope.instrumentId ? 'selected' : ''}
            data-option-title="${esc(name)}" data-option-detail="${esc(row.code)}" data-search="${esc(terms)}">${esc(name)} · ${esc(row.code)}</option>`;
        }).join('')}
      </select>
    </div>
    <div>
      <label for="clause-source-edition">Source edition</label>
      <select id="clause-source-edition" name="clause_workspace_edition" data-instrument-id="${esc(scope.instrumentId)}">
        <option value="all" ${scope.editionFilter === 'all' ? 'selected' : ''}>All editions</option>
        <option value="current" ${scope.editionFilter === 'current' ? 'selected' : ''}>Current approved</option>
        ${editionOptions}
      </select>
    </div>
  </div>
  ${scope.specific ? `<p class="clause-scope-note">Effective from ${date(scope.specific.effective_from)}${scope.specific.effective_to ? ' until ' + date(scope.specific.effective_to) + ' (exclusive)' : ''}</p>` : ''}`;
}

function searchForm(scope: ClauseScope, search: string, searchType: string, status: string, registerView: boolean) {
  const clearQuery = new URLSearchParams({ instrument: scope.instrumentId, edition: scope.editionFilter });
  if (registerView) clearQuery.set('view', 'register');
  const edition = scope.specific ? 'version ' + versionLabel(scope.specific.version_number) :
    scope.editionFilter === 'current' ? 'current approved editions' : 'all editions';
  const source = scope.instrument ? scope.instrument.short_title || scope.instrument.title : 'all authorised instruments';
  return `<form id="clause-filters" class="panel clause-search-panel" role="search" aria-label="Find clauses">
    ${registerView ? '<input type="hidden" name="view" value="register">' : ''}
    <input type="hidden" name="instrument" value="${esc(scope.instrumentId)}">
    <input type="hidden" name="edition" value="${esc(scope.editionFilter)}">
    <label for="clause-query">Search clauses</label>
    <div class="clause-search-row">
      <div class="search-field">${icon('search')}${input('q', search, 'search', 'id="clause-query" maxlength="200" placeholder="Enter a reference, heading or wording" aria-label="Search clauses"')}</div>
      <button class="btn primary search-submit" type="submit">Search</button>
    </div>
    <div class="clause-search-meta">
      <p class="clause-scope-note">Searching ${esc(source)} · ${esc(edition)}</p>
      ${search || status || searchType !== 'keyword' ? link('clauses?' + clearQuery, 'Clear filters', 'text-link') : ''}
    </div>
    <details class="clause-options" ${status || searchType !== 'keyword' ? 'open' : ''}>
      <summary>Search options</summary>
      <div class="clause-browse-fields">
        <div>
          <label for="clause-search-type">Search type</label>
          <select id="clause-search-type" name="search_type">
            <option value="keyword" ${searchType === 'keyword' ? 'selected' : ''}>Words or reference</option>
            <option value="phrase" ${searchType === 'phrase' ? 'selected' : ''}>Phrase</option>
            <option value="reference" ${searchType === 'reference' ? 'selected' : ''}>Reference only</option>
            <option value="literal" ${searchType === 'literal' ? 'selected' : ''} ${scope.specific ? '' : 'disabled'}>Exact wording${scope.specific ? '' : ' (choose an edition)'}</option>
          </select>
        </div>
        <div>
          <label for="clause-status">Clause approval status</label>
          <select id="clause-status" name="status">
            <option value="">All clause statuses</option>
            ${['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map(value => `<option value="${value}" ${status === value ? 'selected' : ''}>${esc(title(value))}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="clause-scope-note">Phrase matches consecutive words. Choose a specific source edition to search for exact wording.</p>
    </details>
  </form>`;
}

export async function clausesPage(_id, query = new URLSearchParams()) {
  const request = state.routeNumber;
  const registerView = query.get('view') === 'register';
  const identifier = query.get('clause');
  const search = (query.get('q') || '').trim();
  const requestedSearchType = query.get('search_type');
  const searchType = ['phrase', 'reference', 'literal'].includes(requestedSearchType) ? requestedSearchType : 'keyword';
  const status = query.get('status') || '';
  const filtering = Boolean(search || status);
  const [instruments, detail] = await Promise.all([
    api('/instruments'),
    identifier && !registerView ? openClause(identifier) : Promise.resolve(null),
  ]);
  if (request !== state.routeNumber || !state.identity) return '';
  const selected = detail?.clause;
  const today = localDate();
  instruments.sort((a, b) => a.title.localeCompare(b.title));
  const filters = new URLSearchParams(query);
  const requestedInstrument = filters.get('instrument');
  const requestedEdition = filters.get('edition') || filters.get('version');
  if (selected && !filtering && (
    requestedInstrument !== selected.instrument_id ||
    (!requestedEdition || requestedEdition === 'current') && !selected.version_is_effective_current ||
    requestedEdition && !['all', 'current', selected.instrument_version_id].includes(requestedEdition)
  )) {
    filters.set('instrument', selected.instrument_id);
    filters.set('edition', selected.instrument_version_id);
  }
  const instrument = instruments.find(row => row.id === filters.get('instrument'));
  const legacy = !filters.has('edition') && filters.has('version');
  const editionInstrument = instrument?.id || (!legacy ? selected?.instrument_id : '');
  const editions = editionInstrument || legacy
    ? await api('/source-editions' + (editionInstrument ? '?instrument=' + encodeURIComponent(editionInstrument) : '')) : [];
  if (instrument && !filters.has('edition') && !legacy) filters.set('edition', 'current');
  const scope = selectClauseScope(instruments, editions, filters, today);
  const exactUnavailable = Boolean(search && searchType === 'literal' && !scope.specific);
  const context = new URLSearchParams({ instrument: scope.instrumentId, edition: scope.editionFilter });
  if (search) context.set('q', search);
  if (searchType !== 'keyword') context.set('search_type', searchType);
  if (status) context.set('status', status);
  if (selected) context.set('clause', selected.id);
  if (selected && query.get('return_view') === 'register') context.set('return_view', 'register');
  const requestedPage = Number(query.get('page'));
  const page = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1_000_000 ? requestedPage : 1;
  const searchMode = registerView || filtering;
  if (searchMode && page > 1) context.set('page', String(page));
  if (registerView) context.set('view', 'register');
  const browsing = Boolean(scope.instrument || filtering);
  const readerScope = selected ? new URLSearchParams({ instrument: selected.instrument_id, edition: selected.instrument_version_id }) : null;
  const parameters = new URLSearchParams({ instrument: scope.instrumentId, edition: scope.editionFilter });
  if (searchMode) {
    parameters.set('mode', 'search');
    if (searchType !== 'keyword') parameters.set('search_type', searchType);
    if (search) parameters.set('q', search);
    if (status) parameters.set('status', status);
    if (page > 1) parameters.set('page', String(page));
  }
  const batch = readerScope || (browsing && !exactUnavailable)
    ? await clauseBatch(readerScope || parameters) : { items: [], next_page: null };
  if (request !== state.routeNumber || !state.identity) return '';

  const viewQuery = new URLSearchParams(context);
  viewQuery.delete('view');
  const workspacePath = 'clauses?' + viewQuery;
  viewQuery.delete('clause');
  viewQuery.delete('return_view');
  const backQuery = new URLSearchParams(viewQuery);
  if (context.has('return_view')) backQuery.set('view', 'register');
  viewQuery.set('view', 'register');
  const registerPath = 'clauses?' + viewQuery;
  let notices = '';
  if (scope.invalidInstrument || scope.invalidEdition)
    notices += note('The requested instrument or edition is unavailable. Choose from the available filters.', 'warn');
  if (identifier && !registerView && !detail)
    notices += note('The requested clause is unavailable in your authorised area.', 'warn');
  if (!selected && scope.instrument && scope.editionFilter === 'current' && !scope.visibleEditions.length)
    notices += note('No approved source edition is effective today. Select an available Draft, historical or other edition to browse it.', 'warn');
  if (exactUnavailable && !selected)
    notices += note('Choose a specific source edition to use Exact wording, or switch to Words or reference to search across editions.', 'warn');

  const pageHeading = heading(registerView ? 'Clause register' : selected ? 'Clause workspace' : 'Find a clause',
    selected ? '' : 'Search the regulatory catalogue by clause reference, heading or wording.',
    `<nav class="clause-view-switch" aria-label="Clause views"><a href="#${esc(workspacePath)}" ${registerView ? '' : 'aria-current="page"'}>${icon('layers')}Workspace</a><a href="#${esc(registerPath)}" ${registerView ? 'aria-current="page"' : ''}>${icon('grid')}Register</a></nav>` +
    (has('AUTHOR') ? `<button type="button" class="btn" data-action="add-clause" data-version="${esc(detail?.edition.id || scope.specific?.id || '')}" data-instrument="${esc(selected?.instrument_id || scope.instrument?.id || '')}">${icon('plus')}<span>Add clause</span></button>` : ''));
  const hierarchy = (treeScope: URLSearchParams, trail: BrowserClause[], open: boolean) =>
    `<details class="clause-hierarchy-disclosure" ${open ? 'open' : ''}>
      <summary><span><strong>Instrument &amp; clause hierarchy</strong><small>Expand a branch to load its children</small></span>${icon('down')}</summary>
      ${renderLazyHierarchy(batch, treeScope, trail, context)}
    </details>`;

  if (!selected) {
    const browse = `<section class="panel clause-browse-panel" aria-labelledby="clause-browse-heading">
      <h2 id="clause-browse-heading">Browse an instrument</h2>
      <p>Choose an instrument to explore its clause hierarchy by source edition.</p>
      ${sourceControls(instruments, scope, today)}
    </section>`;
    const results = !browsing || exactUnavailable ? '' : registerView ? clauseRegister(batch, context, page) :
      filtering ? searchNavigation(batch, context, page) : `<section class="panel">${hierarchy(context, [], true)}</section>`;
    return `<div class="clause-workspace-page">${pageHeading}
      <div class="clause-workspace-stack">${searchForm(scope, search, searchType, status, registerView)}${notices}
        ${filtering && results ? results + browse : browse + results}
      </div>
    </div>`;
  }

  const canAuthor = detail && covered(detail.owner_unit_id, ['AUTHOR']);
  const editable = canAuthor && detail.edition.approval_status === 'DRAFT' &&
    detail.edition.created_by === state.identity.user.id && selected.approval_status === 'DRAFT';
  const editAction = (editable ? `<button type="button" class="btn small" data-action="workspace-edit-clause" data-id="${esc(selected.id)}" data-instrument="${esc(selected.instrument_id)}">${icon('pen')}<span>Edit Draft clause</span></button>` : '') +
    (canAuthor && (editable || detail.edition.approval_status === 'APPROVED')
      ? `<button type="button" class="btn small" data-action="link-earlier-clause" data-id="${esc(selected.id)}" data-instrument="${esc(selected.instrument_id)}">Link earlier clause</button>` : '');
  const reader = renderClauseDetail({
    selected, parent: detail.ancestors.at(-1), carry: detail.provenance, original: detail.original,
    ancestors: detail.ancestors,
    pathFor: row => browsePath(row, row.instrument_version_id === selected.instrument_version_id ? context :
      new URLSearchParams({ instrument: row.instrument_id, edition: row.instrument_version_id })),
    editAction, sourceDocument: detail.source_document,
  });
  const readerEditions = editions.some(row => row.id === selected.instrument_version_id) ? editions :
    [...editions, { ...detail.edition, instrument_id: selected.instrument_id, cancelled_draft: selected.version_cancelled_draft }];
  const readerControls = selectClauseScope(instruments, readerEditions, readerScope, today);
  return `<div class="clause-workspace-page">${pageHeading}
    <div id="clause-working-view" class="clause-workspace-stack">
      ${notices}
      <section class="panel clause-reader-source" aria-label="Selected source">
        <div class="clause-reader-source-row">
          <div class="clause-reader-instrument">
            <strong>${esc(selected.instrument_short_title || selected.instrument_title)}</strong>
            <code>${esc(selected.instrument_code)}</code>
          </div>
          ${clauseEditionBadges(selected)}
          ${link('clauses?' + backQuery, filtering ? 'Back to results' : backQuery.has('view') ? 'Back to register' : 'Back to browse', 'btn small')}
        </div>
        <details class="clause-options"><summary>Change instrument or edition</summary>
          ${sourceControls(instruments, readerControls, today)}
        </details>
      </section>
      <div class="clause-working-layout clause-reader-layout">
        <aside class="panel clause-hierarchy-panel">${hierarchy(readerScope, [...detail.ancestors, selected], !window.matchMedia('(max-width: 900px)').matches)}</aside>
        ${reader}
      </div>
    </div>
  </div>`;
}

export function clauseHandlers({ render }) {
  return {
    actions: {
      ...clauseBrowserActions,
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
        location.hash = clauseWorkspacePath(result.id);
        await render();
      },
      'create-clause': async (form: HTMLFormElement) => {
        const versionId = form.dataset.versionId;
        const instrumentId = form.dataset.instrumentId;
        if (!versionId || !instrumentId) throw new Error('Choose a Draft source edition before saving.');
        const result = await api('/versions/' + versionId + '/clauses', 'POST', clausePayload(form));
        close();
        message('Clause / para saved in Draft. Submit its source edition when it is ready for review.');
        location.hash = clauseWorkspacePath(result.id);
        await render();
      },
      'clause-filters': (form) => {
        const data = new FormData(form);
        const query = new URLSearchParams();
        for (const key of ['q', 'status', 'search_type', 'view', 'instrument', 'edition']) {
          const value = String(data.get(key) || '').trim();
          if (value) query.set(key, value);
        }
        location.hash = 'clauses' + (query.size ? '?' + query.toString() : '');
      },
    },
  };
}
