import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { renderRegister } from './repository/register.ts';
import { renderRecord } from './repository/detail.ts';
import { instrumentWizard } from './repository/wizard.ts';
export { repositoryHandlers } from './repository/mutations.ts';

export async function repositoryPage(id, query) {
  if (id === 'new') return instrumentWizard(query);
  const request = state.routeNumber;
  const data = await api(id ? '/instruments/' + id : '/instruments?' + query.toString());
  if (request !== state.routeNumber || !state.identity) return '';
  if (!id) return renderRegister(data, query);
  state.record = data;
  return renderRecord(query);
}
