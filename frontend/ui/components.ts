import { state } from '../core/state.ts';

export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const title = (value) =>
  ['LDAP', 'CCO', 'RBI', 'UAT'].includes(value)
    ? value
    : String(value ?? '')
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
export const versionLabel = (value) =>
  /^\d+$/.test(String(value ?? '')) ? `${value}.0` : String(value ?? '—');
export const badge = (value) => {
  const good = [
    'APPROVED',
    'CURRENT',
    'CURRENT_APPROVED',
    'LOADED',
    'MIGRATION_READY',
    'ACTIVE',
    'AVAILABLE',
    'RECONCILED',
    'COMPLETED',
    'NO_IMPACT',
    'RESOLVED',
  ];
  const bad = ['REJECTED', 'CORRECTION_REQUIRED', 'OVERDUE', 'REASSESSMENT_REQUIRED'];
  const color = good.includes(value)
    ? 'green'
    : bad.includes(value)
      ? 'red'
      : /PENDING|IN_REVIEW|REVIEWED|REVIEW_REQUIRED/.test(value)
        ? 'amber'
        : 'neutral';
  return `<span class="tag badge ${color}">${esc(title(value))}</span>`;
};
export const date = (value) =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(value))
    : '—';
export const localDate = () => new Date().toLocaleDateString('en-CA');
export const ref = (name, id) =>
  state.masters?.[name]?.find((r) => r.id === id)?.name ||
  state.masters?.[name]?.find((r) => r.id === id)?.full_name ||
  id ||
  '—';
export const link = (url, label, css = '') =>
  /* HTML */ `<a class="${css.replace(/\bbutton\b/, 'btn')}" href="#${url}">${esc(label)}</a>`;
export const button = (action, label, data = '', css = '') =>
  /* HTML */ `<button type="button" class="btn ${css}" data-action="${action}" ${data}>
    ${esc(label)}
  </button>`;
export const empty = (heading, text) =>
  /* HTML */ `<div class="empty">
    <h2>${esc(heading)}</h2>
    <p>${esc(text)}</p>
  </div>`;
let fieldSequence = 0;
export const field = (label, control, help = '', css = '') => {
  if (control.startsWith('<label')) return `<div class="field ${css}">${control}</div>`;
  const id = 'field-' + ++fieldSequence;
  const hint = id + '-hint';
  const required = /\srequired\b/.test(control);
  control = control
    .replace(/aria-label="[^"]*"/, `aria-label="${esc(label)}"`)
    .replace(
      /<(input|select|textarea)\b/,
      `<$1 id="${id}"${help ? ` aria-describedby="${hint}"` : ''}`,
    );
  return `<div class="field ${css}"><label for="${id}">${esc(label)}${required ? '<span aria-hidden="true">*</span>' : ''}</label>${control}${help ? `<small class="field-hint" id="${hint}">${esc(help)}</small>` : ''}</div>`;
};
export const input = (name, value = '', type = 'text', extra = '') => {
  const explicit = /aria-label="([^"]*)"/.exec(extra);
  const label = explicit ? explicit[1] : title(name);
  extra = extra.replace(/aria-label="[^"]*"/g, '');
  return `<input aria-label="${esc(label)}" name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}>`;
};
export const options = (rows, value = '', label = 'name', blank = 'Select…') =>
  /* HTML */ `<option value="">${esc(blank)}</option>` +
  (rows || [])
    .map(
      (r) =>
        /* HTML */ `<option value="${esc(r.id)}" data-search="${esc([r.code, r.name, r.full_name, r.username].filter(Boolean).join(' '))}" ${r.id === value ? 'selected' : ''}>
          ${esc(r[label] || r.full_name || r.code)}${r.option_status !== undefined
            ? r.option_status
              ? ' · ' + esc(r.option_status)
              : ''
            : r.active_flag === 0
              ? ' · inactive'
              : ''}
        </option>`,
    )
    .join('');
export const select = (name, rows, value = '', label = 'name', extra = '', blank = 'Select…') => {
  const explicit = /aria-label="([^"]*)"/.exec(extra);
  const accessibleName = explicit ? explicit[1] : title(name);
  extra = extra.replace(/aria-label="[^"]*"/g, '');
  return /* HTML */ `<select aria-label="${esc(accessibleName)}" name="${esc(name)}" ${extra}>
    ${options(rows, value, label, blank)}
  </select>`;
};
export const fixedSelect = (name, items, value, extra = '') =>
  select(
    name,
    items.map((x) => ({ id: x, name: title(x) })),
    value,
    'name',
    extra,
  );
export const area = (name, value = '', extra = '') =>
  `<textarea aria-label="${esc(title(name))}" name="${name}" ${extra}>` +
  esc(value) +
  '</textarea>';
// Preserve source whitespace exactly, without template indentation around it.
export const preservedText = (css, value) => `<div class="${css}">` + esc(value) + '</div>';
export { message } from './feedback.ts';
