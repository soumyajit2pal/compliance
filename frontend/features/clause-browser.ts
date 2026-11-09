import { api } from '../core/api.ts';
import { clauseWorkspacePath } from '../core/source-navigation.ts';
import { esc } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { clauseEditionBadges } from './clause-workspace.ts';

export type BrowserClause = Record<string, any>;
export interface ClauseBatch {
  items: BrowserClause[];
  next_page: number | null;
}

export function browsePath(row: BrowserClause, query: URLSearchParams) {
  const next = new URLSearchParams(query);
  if (next.get('view') === 'register') next.set('return_view', 'register');
  next.delete('view');
  return clauseWorkspacePath(row.id, next);
}

export function clauseBatch(scope: URLSearchParams) {
  return api<ClauseBatch>('/clause-browser?' + scope);
}

function more(page: number, parent: string, edition: string, label: string) {
  return `<button type="button" class="btn small clause-browser-more" data-action="more-clause-rows"
    data-page="${page}" data-parent="${esc(parent)}" data-edition="${esc(edition)}">${esc(label)}</button>`;
}

function node(row: BrowserClause, query: URLSearchParams, trail: BrowserClause[] = []): string {
  const label = row.source_clause_reference || row.heading || row.code;
  const selected = query.get('clause') === row.id;
  const expanded = trail.length > 0;
  return `<li data-clause-row="${esc(row.id)}"><div class="clause-browser-row">
    <a class="clause-tree-node ${selected ? 'active' : ''}" data-edition="${esc(row.instrument_version_id)}"
      href="#${esc(browsePath(row, query))}" ${selected ? 'aria-current="true"' : ''}>
      ${icon(row.parent_clause_id ? 'file' : 'layers')}<span><strong>${row.source_clause_reference ? esc(row.source_clause_reference) + ' · ' : ''}${esc(row.heading || 'Source clause / para')}</strong>
      <code>${esc(row.code)}</code>${clauseEditionBadges(row)}</span>
    </a>
    ${row.has_children || expanded ? `<button type="button" class="icon-button clause-branch-toggle"
      aria-label="${esc((expanded ? 'Collapse' : 'Expand') + ' children of ' + label)}" aria-expanded="${expanded}"
      aria-controls="children-${esc(row.id)}" data-action="toggle-clause-children" data-parent="${esc(row.id)}"
      data-label="${esc(label)}" data-edition="${esc(row.instrument_version_id)}">${icon('down')}</button>` : ''}
  </div>
  ${row.has_children || expanded ? `<div class="clause-browser-children" id="children-${esc(row.id)}" ${expanded ? '' : 'hidden'}>
    <ul class="clause-hierarchy-list" data-clause-items>${expanded ? node(trail[0], query, trail.slice(1)) : ''}</ul>
    ${expanded ? more(1, row.id, row.instrument_version_id, 'Load children') : ''}
  </div>` : ''}</li>`;
}

export function renderLazyHierarchy(batch: ClauseBatch, scope: URLSearchParams, trail: BrowserClause[], query = scope) {
  const root = trail[0];
  const rows = root && !batch.items.some(row => row.id === root.id) ? [...batch.items, root] : batch.items;
  return `<nav class="clause-hierarchy clause-browser-tree" aria-label="Instrument and clause hierarchy"
    data-clause-query="${esc(query.toString())}" data-browse-instrument="${esc(scope.get('instrument'))}"><div>
    <ul class="clause-hierarchy-list" data-clause-items>${rows.map(row => node(row, query, root?.id === row.id ? trail.slice(1) : [])).join('')}</ul>
    ${batch.next_page ? more(batch.next_page, '', scope.get('edition') || 'current', 'Load more top-level clauses') : ''}
    ${rows.length ? '' : '<p class="clause-hierarchy-empty">No clauses in this edition selection.</p>'}
  </div></nav>`;
}

async function loadRows(container: HTMLElement, parent: string, edition: string, page: number) {
  const navigation = container.closest<HTMLElement>('[data-clause-query]');
  const query = new URLSearchParams(navigation.dataset.clauseQuery);
  const parameters = new URLSearchParams({ instrument: navigation.dataset.browseInstrument, edition, page: String(page) });
  if (parent) parameters.set('parent', parent);
  const batch = await clauseBatch(parameters);
  if (!container.isConnected) return;
  const list = container.querySelector<HTMLElement>(':scope > [data-clause-items]');
  const existing = new Map([...list.children].map((element: HTMLElement) => [element.dataset.clauseRow, element]));
  let firstNew: HTMLElement;
  for (const row of batch.items) {
    const loaded = existing.get(row.id);
    if (loaded) {
      list.append(loaded);
    } else {
      list.insertAdjacentHTML('beforeend', node(row, query));
      firstNew ||= list.lastElementChild?.querySelector('a');
    }
  }
  list.dataset.loaded = 'true';
  container.querySelector(':scope > .clause-browser-more')?.remove();
  if (batch.next_page) {
    container.insertAdjacentHTML('beforeend', more(batch.next_page, parent, edition, parent ? 'Load more children' : 'Load more top-level clauses'));
  }
  if (!list.children.length) container.insertAdjacentHTML('beforeend', '<p class="clause-hierarchy-empty">No child clauses.</p>');
  return firstNew;
}

export const clauseBrowserActions = {
  'toggle-clause-children': async ({ parent, edition, label }, trigger: HTMLButtonElement) => {
    const container = document.getElementById(trigger.getAttribute('aria-controls'));
    const expand = container.hidden;
    container.hidden = !expand;
    trigger.setAttribute('aria-expanded', String(expand));
    trigger.setAttribute('aria-label', (expand ? 'Collapse' : 'Expand') + ' children of ' + label);
    const list = container.querySelector<HTMLElement>(':scope > [data-clause-items]');
    if (!expand || list.dataset.loaded || list.children.length) return;
    try {
      await loadRows(container, parent, edition, 1);
    } catch (error) {
      if (trigger.isConnected) {
        container.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', 'Expand children of ' + label);
      }
      throw error;
    }
  },
  'more-clause-rows': async ({ parent, edition, page }, trigger: HTMLButtonElement) => {
    const firstNew = await loadRows(trigger.parentElement, parent, edition, Number(page));
    firstNew?.focus();
  },
};
