/** Workspace navigation is separate from the tabs inside an individual obligation. */
export type ObligationView = 'register' | 'applicability' | 'accountability';
export const obligationViews: Array<[ObligationView, string]> = [['register', 'Register'], ['applicability', 'Applicability'], ['accountability', 'Accountability']];
export function obligationView(query: URLSearchParams): ObligationView {
  return query.get('view') === 'applicability' ? 'applicability' : query.get('view') === 'accountability' ? 'accountability' : 'register';
}
export function workspacePath(view: ObligationView, query = new URLSearchParams()) {
  const next = new URLSearchParams(query);
  if (view === 'register') next.delete('view'); else next.set('view', view);
  return 'obligations' + (next.size ? '?' + next : '');
}
export function workspaceAlias(page: string, query: URLSearchParams) {
  return page === 'applicability' || page === 'accountability' ? workspacePath(page, query) : '';
}
export function obligationBackLabel(path: string) {
  const [page, text = ''] = path.split('?');
  const view = page === 'applicability' || page === 'accountability' ? page : obligationView(new URLSearchParams(text));
  return '← ' + (view === 'register' ? 'Obligation register' : obligationViews.find(([key]) => key === view)[1]);
}
