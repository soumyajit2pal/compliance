import { api } from '../core/api.ts';
import { state } from '../core/state.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { obligationViews, workspacePath, type ObligationView } from '../core/obligation-workspace.ts';
import { esc } from '../ui/components.ts';
import { heading } from '../ui/layout.ts';
import { icon } from '../ui/icons.ts';
import { obligationExportButton } from '../ui/obligation-export.ts';

const viewDetails = {
  register: {icon: 'checkSquare', description: 'Requirements & status'},
  applicability: {icon: 'target', description: 'Departments & scope'},
  accountability: {icon: 'users', description: 'People & responsibilities'},
};

export function workspaceTabs(view: ObligationView, query: URLSearchParams) {
  // These applied URLs belong to the current signed-in user and reset with state.view.
  const saved = state.view.obligationWorkspaceQueries ||= {};
  saved[view] = query.toString();
  return `<nav class="obligation-workspace-tabs" aria-label="Obligation views">${obligationViews.filter(([key]) => key === 'register' || state.identity.menu.some(item => item.id === key)).map(([key, name]) =>
    `<a class="obligation-view-link ${view === key ? 'active' : ''}" href="#${esc(workspacePath(key, new URLSearchParams(saved[key] || '')))}" aria-label="${name}" aria-describedby="obligation-view-help-${key}" ${view === key ? 'aria-current="page"' : ''}><span class="obligation-view-icon" aria-hidden="true">${icon(viewDetails[key].icon)}</span><span class="obligation-view-copy"><strong class="obligation-view-title">${name}</strong><small id="obligation-view-help-${key}">${esc(viewDetails[key].description)}</small></span></a>`).join('')}</nav>`;
}

export async function obligationWorkspacePage(view: 'applicability' | 'accountability', query: URLSearchParams) {
  const request = apiPageQuery(query, view);
  request.set('view', 'workspace');
  request.set('group_by', 'obligation');
  const data = await api('/' + view + '?' + request);
  const props = {view, data, query: query.toString(), returnPath: workspacePath(view, query), masters: state.masters};
  return heading('Obligations', 'Requirements, department applicability and named responsibilities.',obligationExportButton()) + workspaceTabs(view, query) +
    `<div data-obligation-workspace="${esc(JSON.stringify(props))}"></div>`;
}
