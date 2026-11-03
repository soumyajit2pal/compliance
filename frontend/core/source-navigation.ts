/** Canonical deep link, shared by workspace, registers and import targets. */
import { withoutPaging } from './pagination.ts';
export function clauseWorkspacePath(clauseId: string, query = new URLSearchParams()) {
  const next = withoutPaging(query);
  next.set('clause', clauseId);
  if (!next.has('instrument')) next.set('instrument', 'all');
  if (!next.has('edition')) next.set('edition', 'all');
  next.delete('view');
  next.delete('version');
  return 'clauses?' + next;
}

export function instrumentWorkspacePath(instrumentId: string, editionId = '', query = new URLSearchParams()) {
  const next = withoutPaging(query);
  if (editionId) next.set('version', editionId);
  return 'repository/' + encodeURIComponent(instrumentId) + (next.size ? '?' + next : '');
}

