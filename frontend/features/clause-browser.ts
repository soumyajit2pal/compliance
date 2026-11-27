import { pageParam, sizeParam, type PageInfo } from '../core/pagination.ts';
import { api } from '../core/api.ts';
import { clauseWorkspacePath } from '../core/source-navigation.ts';
import { esc } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { clauseTreeContent } from './clause-workspace.ts';

export type BrowserClause = Record<string, any>;
export interface ClauseBatch {
  items: BrowserClause[];
  next_page?: number | null;
  pagination?: PageInfo;
}
export type OpenBranches = Record<string, ClauseBatch>;
export const clauseRegisterKey = 'clause-register';
export const clauseListKey = 'clause-list';

export function browsePath(row: BrowserClause, query: URLSearchParams) {
  const next = new URLSearchParams(query);
  if (next.get('view') === 'register') next.set('return_view', 'register');
  next.delete('view');
  const path = clauseWorkspacePath(row.id, next);
  const from = next.get('return_view');
  if (!from) return path;
  const key = from === 'register' ? clauseRegisterKey : clauseListKey;
  const page = new URLSearchParams();
  for (const param of [pageParam(key), sizeParam(key)]) {
    if (next.has(param)) page.set(param, next.get(param));
  }
  return page.size ? path + '&' + page : path;
}

export function clauseBatch(scope: URLSearchParams) {
  return api<ClauseBatch>('/clause-browser?' + scope);
}

function more(page: number, parent: string, edition: string, label = '') {
  const text = parent ? 'Show more clauses' : 'Show more top-level clauses';
  return `<button type="button" class="btn small clause-browser-more" data-action="more-clause-rows"
    ${label ? `aria-label="${esc(text + ' under ' + label)}"` : ''}
    data-page="${page}" data-parent="${esc(parent)}" data-edition="${esc(edition)}" data-label="${esc(label)}">${text}</button>`;
}

function treeRows(rows: BrowserClause[], query: URLSearchParams, trail: BrowserClause[], branches: OpenBranches) {
  const next = trail[0];
  const nodes = rows.map(row => node(row, query, row.id === next?.id ? trail : [], branches));
  if (next && !rows.some(row => row.id === next.id)) nodes.push(node(next, query, trail, branches, true));
  return nodes.join('');
}

function node(row: BrowserClause, query: URLSearchParams, trail: BrowserClause[] = [], branches: OpenBranches = {}, pinned = false): string {
  const label = row.heading_only_flag ? row.heading || 'Document heading' : row.source_clause_reference || row.heading || row.code;
  const selected = query.get('clause') === row.id;
  const batch = trail.length ? branches[row.id] : undefined;
  const children = trail.slice(1);
  const expanded = Boolean(batch || children.length);
  return `<li data-clause-row="${esc(row.id)}" ${pinned ? 'data-clause-pinned' : ''}><div class="clause-browser-row">
    <a class="clause-tree-node ${selected ? 'active' : ''}" data-edition="${esc(row.instrument_version_id)}"
      href="#${esc(browsePath(row, query))}" ${selected ? 'aria-current="true"' : ''}>
      ${clauseTreeContent(row)}
    </a>
    ${row.has_children || expanded ? `<button type="button" class="icon-button clause-branch-toggle"
      aria-label="${esc((expanded ? 'Collapse' : 'Expand') + ' children of ' + label)}" aria-expanded="${expanded}"
      aria-controls="children-${esc(row.id)}" data-action="toggle-clause-children" data-parent="${esc(row.id)}"
      data-label="${esc(label)}" data-edition="${esc(row.instrument_version_id)}">${icon('down')}</button>` : ''}
  </div>
  ${row.has_children || expanded ? `<div class="clause-browser-children" id="children-${esc(row.id)}" ${expanded ? '' : 'hidden'}>
    <ul class="clause-hierarchy-list" data-clause-items ${batch ? 'data-loaded="true"' : ''}>${treeRows(batch?.items || [], query, children, branches)}</ul>
    ${batch?.next_page ? more(batch.next_page, row.id, row.instrument_version_id, label) : ''}
  </div>` : ''}</li>`;
}

export function renderLazyHierarchy(batch: ClauseBatch, scope: URLSearchParams, trail: BrowserClause[], query = scope, branches: OpenBranches = {}) {
  return `<nav class="clause-hierarchy clause-browser-tree" aria-label="Instrument and clause hierarchy"
    data-clause-query="${esc(query.toString())}" data-browse-instrument="${esc(scope.get('instrument'))}"><div>
    <ul class="clause-hierarchy-list" data-clause-items>${treeRows(batch.items, query, trail, branches)}</ul>
    ${batch.next_page ? more(batch.next_page, '', scope.get('edition') || 'current') : ''}
    ${batch.items.length || trail.length ? '' : '<p class="clause-hierarchy-empty">No clauses in this edition selection.</p>'}
  </div></nav>`;
}

async function loadRows(container: HTMLElement, parent: string, edition: string, page: number, label: string) {
  const navigation = container.closest<HTMLElement>('[data-clause-query]');
  const query = new URLSearchParams(navigation.dataset.clauseQuery);
  const parameters = new URLSearchParams({ instrument: navigation.dataset.browseInstrument, edition, page: String(page) });
  if (parent) parameters.set('parent', parent);
  const batch = await clauseBatch(parameters);
  if (!container.isConnected) return;
  const list = container.querySelector<HTMLElement>(':scope > [data-clause-items]');
  const existing = new Map([...list.children].map((element: HTMLElement) => [element.dataset.clauseRow, element]));
  let pinned = list.querySelector<HTMLElement>(':scope > [data-clause-pinned]');
  let matchedPin: HTMLElement;
  let firstNew: HTMLElement;
  for (const row of batch.items) {
    const loaded = existing.get(row.id);
    if (loaded) {
      if (loaded === pinned) {
        loaded.removeAttribute('data-clause-pinned');
        matchedPin = loaded.querySelector('a');
        pinned = null;
      }
      list.append(loaded);
    } else {
      list.insertAdjacentHTML('beforeend', node(row, query));
      firstNew ||= list.lastElementChild?.querySelector('a');
    }
  }
  if (pinned) list.append(pinned);
  list.dataset.loaded = 'true';
  container.querySelector(':scope > .clause-browser-more')?.remove();
  if (batch.next_page) {
    container.insertAdjacentHTML('beforeend', more(batch.next_page, parent, edition, label));
  }
  if (!list.children.length) container.insertAdjacentHTML('beforeend', '<p class="clause-hierarchy-empty">No child clauses.</p>');
  return firstNew || matchedPin;
}

export const clauseBrowserActions = {
  'toggle-clause-children': async ({ parent, edition, label }, trigger: HTMLButtonElement) => {
    const container = document.getElementById(trigger.getAttribute('aria-controls'));
    const expand = container.hidden;
    container.hidden = !expand;
    trigger.setAttribute('aria-expanded', String(expand));
    trigger.setAttribute('aria-label', (expand ? 'Collapse' : 'Expand') + ' children of ' + label);
    const list = container.querySelector<HTMLElement>(':scope > [data-clause-items]');
    if (!expand || list.dataset.loaded) return;
    try {
      await loadRows(container, parent, edition, 1, label);
    } catch (error) {
      if (trigger.isConnected) {
        container.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Expand children of ' + label);
      }
      throw error;
    }
  },
  'more-clause-rows': async ({ parent, edition, page, label }, trigger: HTMLButtonElement) => {
    const firstNew = await loadRows(trigger.parentElement, parent, edition, Number(page), label);
    firstNew?.focus();
  },
};
