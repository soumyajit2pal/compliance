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
  const data = await api(id
    ? '/instruments/' + id + (overview ? '?include_implementation_progress=true' : '')
    : '/instruments?' + apiPageQuery(query, 'instruments'));
  if (request !== state.routeNumber || !state.identity) return '';
  if (!id) return renderRegister(Array.isArray(data) ? data : data.items, query, data.pagination, data.library_counts);
  state.record = data;
  return renderRecord(query);
}
