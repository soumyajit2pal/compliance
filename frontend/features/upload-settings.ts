import { api } from '../core/api.ts';
import { state } from '../core/state.ts';
import { esc, field, input, message } from '../ui/components.ts';
import { heading } from '../ui/layout.ts';
import { note, panel } from '../ui/widgets.ts';

const path = '/admin/upload-settings';
const limits = [
  ['source_mib', 'Source documents', 'Regulatory sources, import attachments and retained result files.'],
  ['evidence_mib', 'Evidence attachments', 'Files attached to work items as proof.'],
  ['workbook_mib', 'Regulatory and obligation imports', 'Workbook or CSV files where supported by the import.'],
  ['organisation_mib', 'Organisation import', 'Excel workbooks used to add organisation units.'],
];

export async function uploadSettingsPage() {
  const config = await api(path);
  const fields = limits.map(([key, label, help]) => field(label + ' (MiB)',
    input(key, config[key], 'number', `required min="1" max="${esc(config.max_file_mib)}" step="1"`), help)).join('');
  const formats = state.identity?.upload_policy?.document_extensions || [];
  return heading('Upload settings', 'Set the maximum size of each file the portal accepts.') +
    `<form id="upload-settings">
      <input type="hidden" name="revision" value="${esc(config.revision)}">
      ${panel('Maximum size per file', `<div class="form-grid">${fields}</div>`, {
        sub: `Enter a whole number from 1 to ${config.max_file_mib} MiB. Changes apply to new uploads.`,
      })}
      <div class="mt16">${note('Combined regulatory imports have a 100 MiB total file limit. Import workbooks also have their own row and expanded-size limits.')}</div>
      <p class="inline-error" data-form-error role="alert"></p>
      <div class="wizard-footer"><button type="submit" class="btn primary">Save upload settings</button></div>
    </form>` + (formats.length ? `<div class="mt16">${panel('Supported attachment formats',
      `<p>${esc(formats.join(', '))}</p><p class="mt8">Executables, scripts, archives, SVG and macro-enabled or legacy Office formats are blocked.</p>`)}</div>` : '');
}

export function uploadSettingsHandlers({ render }) {
  return { actions: {}, forms: {
    'upload-settings': async (form: HTMLFormElement) => {
      const values = new FormData(form);
      const payload = Object.fromEntries(limits.map(([key]) => [key, Number(values.get(key))]));
      const result = await api(path, 'PUT', {...payload, revision: values.get('revision')});
      if (state.identity) {
        state.identity.upload_policy = {...state.identity.upload_policy,
          ...Object.fromEntries(limits.map(([key]) => [key, result[key]]))};
      }
      message('Upload limits saved.');
      await render();
    },
  }};
}
