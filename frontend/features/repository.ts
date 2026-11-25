import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { apiPageQuery } from '../core/pagination.ts';
import { renderRegister } from './repository/register.ts';
import { renderRecord } from './repository/detail.ts';
import { instrumentWizard } from './repository/wizard.ts';
export { repositoryHandlers } from './repository/mutations.ts';

export async function repositoryPage(id, query) {
  if (id === 'new') return instrumentWizard(query);
  const request = state.routeNumber;
  const overview = !query.get('tab') || query.get('tab') === 'overview';
  const requestUrl = id
    ? '/instruments/' + id + (overview ? '?include_implementation_progress=true' : '')
    : '/instruments?' + apiPageQuery(query, 'instruments');
  const data = await api(requestUrl);
  if (request !== state.routeNumber || !state.identity) return '';
  if (!id) return renderRegister(Array.isArray(data) ? data : data.items, query, data.pagination, data.library_counts, requestUrl);
  if (query.get('tab') === 'clauses' && query.has('interpretation')) {
    const clause = data.clauses.find(row => row.id === query.get('clause') &&
      row.instrument_version_id === query.get('version') && row.approval_status === 'APPROVED');
    if (clause) data.interpretation_requests = await api('/clauses/' + encodeURIComponent(clause.id) + '/interpretation-requests');
  }
  if (request !== state.routeNumber || !state.identity) return '';
  state.record = data;
  return renderRecord(query);
}
