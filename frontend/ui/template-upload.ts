import { esc } from './components.ts';
import { modal } from './dialog.ts';
import { note } from './widgets.ts';

type TemplateUploadOptions = {
  formId: string;
  submitLabel: string;
  excelTemplate: string;
  csvTemplate?: string;
  subtitle?: string;
};

export function templateUploadModal(title: string, fields: string, options: TemplateUploadOptions) {
  const { formId, submitLabel, excelTemplate, csvTemplate, subtitle } = options;
  const notice = note(`
    <strong>Use the latest template</strong>
    <p>Download a fresh template before each upload. The Excel template includes the current dropdown choices and selectable values.</p>
    ${csvTemplate ? '<p>Use the CSV template for the current column headings.</p>' : ''}
    <div class="actions mt8">
      <a class="btn small" href="${esc(excelTemplate)}" download>Download latest Excel template</a>
      ${csvTemplate ? `<a class="btn small" href="${esc(csvTemplate)}" download>Download latest CSV template</a>` : ''}
    </div>`);
  modal(title, `${notice}${fields}
    <label class="check-label mt16">
      <input type="checkbox" required>
      I confirm I used the latest template for this upload.
    </label>`, formId, submitLabel, subtitle);
}
