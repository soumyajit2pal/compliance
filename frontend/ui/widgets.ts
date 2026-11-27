import { esc, title, badge, link } from './components.ts';
import { icon } from './icons.ts';
import { collectionKey, withoutPaging, type PageInfo, type PageCursors } from '../core/pagination.ts';
import { pagedTable } from './pagination.ts';
import { dashboardInfo } from './dashboard-info.ts';
export { pagedCollection } from './pagination.ts';

export function panel(name, body, { sub = '', action = '', foot = '', cls = '', explanation = '' } = {}) {
  const heading = `<h2>${esc(name)}</h2>`;
  const title = explanation ? `<div class="dashboard-panel-title">${heading}${dashboardInfo(name, explanation)}</div>` : heading;
  return `<section class="panel ${cls}"><div class="panel-head"><div>${title}${sub ? `<p>${esc(sub)}</p>` : ''}</div>${action}</div><div class="panel-body">${body}</div>${foot ? `<div class="panel-foot">${foot}</div>` : ''}</section>`;
}
export function note(text, kind = 'info') {
  return `<div class="note ${kind}">${icon(kind === 'danger' || kind === 'warn' ? 'alert' : 'info')}<div>${text}</div></div>`;
}
export function table(
  headers,
  rows,
  { summary = true, caption = '', empty = 'No records match this view.', pageKey = '', label = '', pagination = undefined as PageInfo | undefined,
    cursors = undefined as PageCursors | undefined, columnOptionsUrl = '', columnKeys = undefined as Record<string, string> | undefined,
    cardLayout = true, tableClass = '', rowHeaders = false, paginationTop = false } = {},
) {
  const cards = cardLayout && headers.length <= 7;
  const emptyRow = `<tr data-empty-row${cards ? ' role="row"' : ''}><td colspan="${headers.length}"${cards ? ' role="cell"' : ''}><div class="empty">${icon('search')}<h3>${esc(empty)}</h3><p>Change the search or filters, or return when work is assigned.</p></div></td></tr>`;
  const body = rows.map(cells => `<tr${cards ? ' role="row"' : ''}>${cells.map((cell, index) => rowHeaders && index === 0
    ? `<th scope="row">${cell}</th>`
    : `<td${cards ? ` role="cell" data-label="${esc(headers[index] || 'Actions')}"` : ''}>${cell}</td>`).join('')}</tr>`).join('');
  const headings = headers.map(header => {
    const key = columnKeys && Object.hasOwn(columnKeys, header) ? ` data-column-key="${esc(columnKeys[header])}"` : '';
    return `<th scope="col"${cards ? ' role="columnheader"' : ''}${key}>${esc(header)}</th>`;
  }).join('');
  const content = `<div class="table-wrap"><table class="data-table${cards ? ' record-table' : ''}${tableClass ? ' ' + esc(tableClass) : ''}"${cards ? ' role="table"' : ''}>${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ''}<thead${cards ? ' role="rowgroup"' : ''}><tr${cards ? ' role="row"' : ''}>${headings}</tr></thead><tbody data-page-items${cards ? ' role="rowgroup"' : ''}>${body || emptyRow}</tbody></table></div>${rows.length ? `<template data-table-empty>${emptyRow}</template>` : ''}`;
  return pagedTable(content, rows.length, {pageKey: pageKey || collectionKey(caption || headers.join('|')), label, pagination, cursors, summary, columnOptionsUrl, paginationTop});
}

export function tablePanel(content, name = '', actions = '', cls = '') {
  return name
    ? panel(name, content, { action: actions, cls: `table-panel ${cls}`.trim() })
    : `<section class="panel table-panel"><div class="panel-body">${content}</div></section>`;
}
export function tabs(items, active, base, query = new URLSearchParams()) {
  return `<nav class="tabs" aria-label="Page sections">${items
    .map(([key, label, count]) => {
      const q = withoutPaging(query);
      q.set('tab', key);
      return `<a class="tab ${key === active ? 'active' : ''}" href="#${base}?${esc(q.toString())}" ${key === active ? 'aria-current="page"' : ''}>${esc(label)}${count !== undefined ? `<span class="count-bubble">${count}</span>` : ''}</a>`;
    })
    .join('')}</nav>`;
}
export function detailFields(entries) {
  return `<div class="detail-grid">${entries.map(([label, value, full]) => `<div class="detail-field ${full ? 'full' : ''}"><label>${esc(label)}</label><div>${value || '—'}</div></div>`).join('')}</div>`;
}
export function recordCell(code, name, path, sub = '', attributes = '') {
  return `<a href="#${esc(path)}" ${attributes}><span class="record-code">${esc(code)}</span><span class="record-title">${esc(name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</a>`;
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
export function stat(label, value, sub, path, ic = 'file', color = 'sage', explanation = '') {
  const tile = `<a class="portal-stat ${color}" href="#${esc(path)}"><span class="portal-stat-icon">${icon(ic)}</span><span class="portal-stat-label">${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small><span class="portal-stat-arrow">${icon('arrow')}</span></a>`;
  return explanation ? `<div class="dashboard-stat-frame">${tile}${dashboardInfo(label, explanation)}</div>` : tile;
}
export function stepFlow(status) {
  const stages = ['Draft', 'Compliance review', 'Final approval', 'Approved'];
  const position = { DRAFT: 0, IN_REVIEW: 1, REVIEWED: 2, APPROVED: 3 }[status] ?? 0;
  return `<ol class="runtime-stage-flow" aria-label="Source edition approval stages">${stages.map((name, i) => `<li class="${i === position ? 'active' : i < position ? 'done' : ''}"${i === position ? ' aria-current="step"' : ''}><span aria-hidden="true">${i < position ? icon('check') : i + 1}</span><strong>${name}</strong></li>`).join('')}</ol>`;
}
