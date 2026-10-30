import { api } from './api.ts';
import { state } from './state.ts';

export async function uploadSource(form) {
  const data = new FormData();
  data.set('file', form.elements.source_file.files[0]);
  data.set(
    'owner_unit_id',
    form.elements.regulatory_owner_unit_id?.value ||
      state.record.instrument.regulatory_owner_unit_id,
  );
  data.set(
    'confidentiality_class_id',
    form.elements.confidentiality_class_id?.value ||
      state.record.instrument.confidentiality_class_id,
  );
  return api('/documents', 'POST', data);
}
