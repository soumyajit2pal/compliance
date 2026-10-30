import { esc, title, badge, link } from './components.ts';
import { icon } from './icons.ts';

export function panel(name, body, { sub = '', action = '', foot = '', cls = '' } = {}) {
  return `<section class="panel ${cls}"><div class="panel-head"><div><h2>${esc(name)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${action}</div><div class="panel-body">${body}</div>${foot ? `<div class="panel-foot">${foot}</div>` : ''}</section>`;
}
export function note(text, kind = 'info') {
  return `<div class="note ${kind}">${icon(kind === 'danger' || kind === 'warn' ? 'alert' : 'info')}<div>${text}</div></div>`;
}
export function table(
  headers,
  rows,
  { summary = true, caption = '', empty = 'No records match this view.' } = {},
) {
  return `<div class="table-wrap"><table class="data-table">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}"><div class="empty">${icon('search')}<h3>${esc(empty)}</h3><p>Change the search or filters, or return when work is assigned.</p></div></td></tr>`}</tbody></table></div>${summary ? `<div class="table-summary"><span>${rows.length ? `Showing 1–${rows.length} of ${rows.length} records` : '0 records'} · Authorised population</span><div class="pagination"><button type="button" disabled aria-label="Previous page">‹</button><button type="button" class="active" disabled aria-current="page">1</button><button type="button" disabled aria-label="Next page">›</button></div></div>` : ''}`;
}
export function tablePanel(content, name = '', actions = '', cls = '') {
  return name
    ? panel(name, content, { action: actions, cls: `table-panel ${cls}`.trim() })
    : `<section class="panel table-panel"><div class="panel-body">${content}</div></section>`;
}
export function tabs(items, active, base, query = new URLSearchParams()) {
  return `<nav class="tabs" aria-label="Page sections">${items
    .map(([key, label, count]) => {
      const q = new URLSearchParams(query);
      q.set('tab', key);
      return `<a class="tab ${key === active ? 'active' : ''}" href="#${base}?${esc(q.toString())}" ${key === active ? 'aria-current="page"' : ''}>${esc(label)}${count !== undefined ? `<span class="count-bubble">${count}</span>` : ''}</a>`;
    })
    .join('')}</nav>`;
}
export function detailFields(entries) {
  return `<div class="detail-grid">${entries.map(([label, value, full]) => `<div class="detail-field ${full ? 'full' : ''}"><label>${esc(label)}</label><div>${value || '—'}</div></div>`).join('')}</div>`;
}
export function recordCell(code, name, path, sub = '') {
  return `<a href="#${esc(path)}"><span class="record-code">${esc(code)}</span><span class="record-title">${esc(name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`;
}
export function person(name, sub = '') {
  const initials = String(name || '?')
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return `<span class="person"><span class="avatar">${esc(initials)}</span><span><strong>${esc(name)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span></span>`;
}
export function searchForm(id, placeholder, value = '', extra = '') {
  return `<form id="${esc(id)}" class="filters"><div class="search-field">${icon('search')}<input type="search" name="q" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}" value="${esc(value)}"></div>${extra}<button class="btn small" type="submit">Search</button></form>`;
}
export function stat(label, value, sub, path, ic = 'file', color = 'sage') {
  return `<a class="portal-stat ${color}" href="#${esc(path)}"><span class="portal-stat-icon">${icon(ic)}</span><span class="portal-stat-label">${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small><span class="portal-stat-arrow">${icon('arrow')}</span></a>`;
}
export function stepFlow(status) {
  const stages = ['Draft', 'Compliance review', 'Final approval', 'Approved'];
  const position = { DRAFT: 0, IN_REVIEW: 1, REVIEWED: 2, APPROVED: 3 }[status] ?? 0;
  return `<ol class="runtime-stage-flow">${stages.map((name, i) => `<li class="${i === position ? 'active' : i < position ? 'done' : ''}"><span>${i < position ? icon('check') : i + 1}</span><strong>${name}</strong></li>`).join('')}</ol>`;
}
