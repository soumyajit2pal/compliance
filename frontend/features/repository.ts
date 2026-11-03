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
  const data = await api(id ? '/instruments/' + id : '/instruments?' + apiPageQuery(query, 'instruments'));
  if (request !== state.routeNumber || !state.identity) return '';
  if (!id) return renderRegister(Array.isArray(data) ? data : data.items, query, data.pagination);
  state.record = data;
  return renderRecord(query);
}
