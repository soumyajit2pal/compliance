import { useCallback, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { PAGE_SIZES, pageInfo, pageNumbers, pagePath, pageRequest, type PageCursors, type PageInfo } from '../../core/pagination.ts';
import { matchesCell, normalizedCell, readColumnFilters, writeColumnFilters, type ColumnChoice, type ColumnFilters } from '../../core/table-filters.ts';
import { SearchableSelectField } from './searchable-select';
import { ColumnFilterPopup, ColumnFilterTrigger } from './table-column-filter';
import { AppliedColumnFilters, rememberColumnChoices } from './applied-column-filters';

interface Props {
  pageKey: string; initial: PageInfo; server: boolean; revision: string; label: string; summary: boolean;
  paginationTop?: boolean;
  columnOptionsUrl?: string;
  columns?: Array<{key: string; label: string}>; cells?: string[][]; cursors?: PageCursors;
  items: ReactNode[]; empty: ReactNode[]; renderItems: (items: ReactNode[], headings?: ReactNode[]) => ReactNode;
}
type PagerPosition = 'top' | 'bottom';
const logCount = new Intl.NumberFormat('en-IN');
const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');

export function PaginatedCollection({pageKey, initial, server, revision, label, summary, paginationTop, items, empty, renderItems, columns, cells, cursors, columnOptionsUrl}: Props) {
  const element = useRef<HTMLDivElement>(null), sizeId = useId();
  const focusRequested = useRef<PagerPosition | null>(null);
  const previousRevision = useRef(revision);
  const [choice, setChoice] = useState(initial), [pending, setPending] = useState(false);
  const [filters, setFilters] = useState(() => columns ? readColumnFilters(hashQuery(), pageKey) : {});
  const [openFilter, setOpenFilter] = useState<{key: string; anchor: HTMLButtonElement}>(null);
  const closeFilter = useCallback(() => setOpenFilter(null), []);
  const popupId = sizeId + '-column-filter';
  const selectedColumn = columns?.find(column => column.key === openFilter?.key);
  const restoreFilters = () => setFilters(columns ? readColumnFilters(hashQuery(), pageKey) : {});
  useLayoutEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    setChoice(initial);
    setPending(false);
    closeFilter();
    if (!element.current?.closest('dialog')) restoreFilters();
  }, [revision]);
  useLayoutEffect(() => {
    if (server) return;
    const restore = () => {
      if (element.current?.closest('dialog')) return;
      const request = pageRequest(hashQuery(), pageKey);
      setChoice(pageInfo(initial.total, request.page, request.page_size));
      restoreFilters();
      closeFilter();
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [initial.total, pageKey, columns, server]);
  const active = (columns || []).flatMap(({key}, index) => filters[key] ? [[index, filters[key]] as const] : []);
  const matching = cells && active.length ? items.filter((_, row) =>
    active.every(([column, filter]) => matchesCell(cells[row][column] || '', filter))) : items;
  const selectedIndex = columns?.findIndex(column => column.key === selectedColumn?.key);
  const choices = new Map<string, string>();
  if (selectedColumn && cells) {
    for (const row of cells) {
      if (!active.every(([index, filter]) => index === selectedIndex || matchesCell(row[index] || '', filter))) continue;
      const label = row[selectedIndex] || '—';
      const value = normalizedCell(label);
      if (!choices.has(value)) choices.set(value, label);
    }
  }
  const options = [...choices].map(([value, label]) => ({value, label})).sort((left, right) =>
    left.label.localeCompare(right.label, 'en-IN', {numeric: true, sensitivity: 'base'}));
  const info = server ? initial : pageInfo(matching.length, choice.page, choice.page_size);
  const visible = !matching.length ? empty : server ? matching : matching.slice(info.start - 1, info.end);
  const urlFor = (page: number, size: number, update?: (query: URLSearchParams) => void) => {
    const [path, text] = pagePath(location.hash, pageKey, page, size).split('?');
    const query = new URLSearchParams(text);
    if (cursors) {
      query.delete('older');
      query.delete('newer');
      query.delete('through');
    }
    update?.(query);
    return path + '?' + query;
  };
  const applyFilters = (values: ColumnFilters) => {
    if (pending) return;
    const url = urlFor(1, info.page_size, query => writeColumnFilters(query, pageKey, values));
    if (server) {
      if (url !== location.hash) { setPending(true); location.hash = url.slice(1); }
      return;
    }
    if (!element.current?.closest('dialog') && url !== location.hash) history.pushState(null, '', url);
    setFilters(values);
    setChoice(pageInfo(items.length, 1, info.page_size));
  };
  const applyColumnFilter = (column: string, values: string[], choices?: ColumnChoice[]) => {
    const next = {...filters};
    if (values.length) next[column] = {values};
    else delete next[column];
    rememberColumnChoices(columnOptionsUrl, column, values, choices);
    applyFilters(next);
  };
  useLayoutEffect(() => {
    const position = focusRequested.current;
    if (pending || !position) return;
    if (!element.current?.contains(document.activeElement)) {
      const pager = element.current?.querySelector(`[data-pagination-position="${position}"]`);
      pager?.querySelector<HTMLElement>('.pagination-range')?.focus();
    }
    focusRequested.current = null;
  }, [choice, pending, revision]);
  const navigate = (page: number, size: number, position: PagerPosition) => {
    if (pending) return;
    const next = pageInfo(info.total, page, size), url = urlFor(next.page, next.page_size);
    focusRequested.current = position;
    if (element.current?.closest('dialog')) { setChoice(next); return; }
    if (server) {
      if (url !== location.hash) { setPending(true); location.hash = url.slice(1); }
      return;
    }
    // Local lists page without refetching or replacing the rest of the workspace.
    history.pushState(null, '', url); setChoice(next);
  };
  const control = (position: PagerPosition, page: number, text: string, aria: string, disabled: boolean, current = false) =>
    disabled || current ? <button key={aria} type="button" disabled aria-label={aria} aria-current={current ? 'page' : undefined} className={current ? 'active' : ''}>{text}</button> :
      <a key={aria} href={pagePath(location.hash, pageKey, page, info.page_size)} aria-label={aria} className={aria === 'Next page' ? 'pagination-next' : undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); navigate(page, info.page_size, position);
        }}>{text}</a>;
  const cursorControl = (direction: 'newer' | 'older', text: string) => {
    const cursor = cursors?.[direction];
    const next = direction === 'older';
    const aria = next ? 'Next page' : 'Previous page';
    return !cursor || pending ? <button type="button" aria-label={aria} disabled>{text}</button> :
      <a href={urlFor(1, info.page_size, query => {
        query.set(direction, cursor);
        if (cursors.through) query.set('through', cursors.through);
      })} aria-label={aria}
        className={next ? 'pagination-next' : undefined} title={next ? 'Show older entries' : 'Show newer entries'}>{text}</a>;
  };
  const headings = columns?.map(({key, label}) => <span className="column-filter-heading">
    <span>{label}</span>
    <ColumnFilterTrigger label={label} applied={Boolean(filters[key])} expanded={openFilter?.key === key}
      popupId={popupId} disabled={pending} open={anchor => setOpenFilter(current => current?.key === key ? null : {key, anchor})} />
  </span>);

  const showPagination = columns || summary || info.total > info.page_size;
  const showTop = showPagination && paginationTop && info.total > 0;
  const renderPagination = (position: PagerPosition) => {
    const fieldId = position === 'top' ? sizeId + '-top' : sizeId;
    const navigationLabel = `Pagination for ${label}${showTop ? ` (${position})` : ''}`;
    const announce = position === 'top' || !showTop;
    return <div className="table-summary shared-pagination" data-pagination-position={position}
      role={showTop ? 'group' : undefined} aria-label={showTop ? navigationLabel : undefined}>
      <span className="pagination-range" tabIndex={-1} role={announce ? 'status' : undefined}
        aria-live={announce ? 'polite' : undefined} aria-atomic={announce || undefined}>{cursors
        ? cursors.total != null && cursors.end != null
          ? `Showing ${logCount.format(cursors.end)} of ${logCount.format(cursors.total)} ${cursors.total === 1 ? 'entry' : 'entries'}`
          : (items.length ? `Showing ${items.length} ${items.length === 1 ? 'entry' : 'entries'}` : '0 entries')
        : info.total ? `Showing ${info.start}–${info.end} of ${info.total} ${label}` : `0 ${label}`}</span>
      {(columns || info.total > 0) && <div className="pagination-size"><label htmlFor={fieldId}>Per page</label><SearchableSelectField data-choice-key="page_size" id={fieldId} aria-label={'Items per page for ' + label} value={info.page_size}
        disabled={pending} onChange={event => navigate(1, Number(event.target.value), position)}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</SearchableSelectField></div>}
      {cursors ? <nav className="pagination" aria-label={navigationLabel}>
        {(hashQuery().has('older') || hashQuery().has('newer')) && <a href={urlFor(1, info.page_size)}>Newest entries</a>}
        {cursorControl('newer', 'Previous')}
        {cursorControl('older', 'Next')}
      </nav> : info.total_pages > 1 && <nav className="pagination" aria-label={navigationLabel}>
        {control(position, 1, '«', 'First page', pending || info.page <= 1)}
        {control(position, info.page - 1, 'Previous', 'Previous page', pending || info.page <= 1)}
        {pageNumbers(info.page, info.total_pages).map((number, i) => number === 'ellipsis' ? <span className="pagination-ellipsis" key={'gap' + i} aria-hidden="true">…</span> : control(position, number, String(number), 'Page ' + number, pending, number === info.page))}
        {control(position, info.page + 1, 'Next', 'Next page', pending || info.page >= info.total_pages)}
        {control(position, info.total_pages, '»', 'Last page', pending || info.page >= info.total_pages)}
      </nav>}
    </div>;
  };

  return <div className="paged-collection" data-pagination-key={pageKey} data-pagination-total={cursors ? cursors.total : info.total} data-pagination-page={cursors ? undefined : info.page} ref={element} aria-busy={pending || undefined}>
    {active.length > 0 && <AppliedColumnFilters pageKey={pageKey} columns={columns} filters={filters} cells={cells}
      requestUrl={columnOptionsUrl} disabled={pending} clearAll={() => {
        closeFilter();
        applyFilters({});
        element.current?.querySelector<HTMLButtonElement>('.column-filter-trigger[data-filtered]')?.focus({preventScroll: true});
      }} remove={(column, value) => {
        const filter = filters[column];
        const remaining = value !== undefined && 'values' in filter ? filter.values.filter(selected => selected !== value) : [];
        closeFilter();
        applyColumnFilter(column, remaining);
        const index = columns.findIndex(({key}) => key === column);
        element.current?.querySelectorAll<HTMLButtonElement>('.column-filter-trigger')[index]?.focus({preventScroll: true});
      }} />}
    {showTop && renderPagination('top')}
    {renderItems(visible, headings)}
    {selectedColumn && <ColumnFilterPopup key={selectedColumn.key} id={popupId} label={selectedColumn.label}
      anchor={openFilter.anchor} filter={filters[selectedColumn.key]} options={options}
      requestUrl={columnOptionsUrl && columnOptionsUrl + '&options_for=' + encodeURIComponent(selectedColumn.key)}
      close={closeFilter} apply={(values, selectedChoices) => {
        closeFilter();
        openFilter.anchor.focus({preventScroll: true});
        applyColumnFilter(selectedColumn.key, values, selectedChoices);
      }} />}
    {showPagination && renderPagination('bottom')}
  </div>;
}
