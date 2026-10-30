import { api } from './api.ts';

export async function choosePeople(role, unit, exclude = []) {
  const query = new URLSearchParams({
    role,
    unit_id: unit,
    exclude: exclude.filter(Boolean).join(','),
  });
  return api('/assignees?' + query);
}
