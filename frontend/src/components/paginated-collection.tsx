import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { PAGE_SIZES, pageInfo, pageNumbers, pagePath, pageRequest, type PageInfo } from '../../core/pagination.ts';
import { SearchableSelectField } from './searchable-select';

interface Props {
  pageKey: string; initial: PageInfo; server: boolean; revision: string; label: string; summary: boolean;
  items: ReactNode[]; empty: ReactNode[]; renderItems: (items: ReactNode[]) => ReactNode;
}
export function PaginatedCollection({pageKey, initial, server, revision, label, summary, items, empty, renderItems}: Props) {
  const element = useRef<HTMLDivElement>(null), sizeId = useId();
  const focusRequested = useRef(false);
  const [choice, setChoice] = useState(initial), [pending, setPending] = useState(false);
  useLayoutEffect(() => { setChoice(initial); setPending(false); }, [revision]);
  useLayoutEffect(() => {
    const restore = () => {
      if (element.current?.closest('dialog')) return;
      const request = pageRequest(new URLSearchParams(location.hash.split('?')[1] || ''), pageKey);
      setChoice(pageInfo(initial.total, request.page, request.page_size));
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [initial.total, pageKey]);
  const info = server ? initial : pageInfo(initial.total, choice.page, choice.page_size);
  const visible = !info.total ? empty : server ? items : items.slice(info.start - 1, info.end);
  useLayoutEffect(() => {
    if (pending || !focusRequested.current) return;
    if (!element.current?.contains(document.activeElement)) element.current?.querySelector<HTMLElement>('.pagination-range')?.focus();
    focusRequested.current = false;
  }, [choice, pending, revision]);
  const navigate = (page: number, size = info.page_size) => {
    if (pending) return;
    const next = pageInfo(info.total, page, size), url = pagePath(location.hash, pageKey, next.page, next.page_size);
    focusRequested.current = true;
    if (element.current?.closest('dialog')) { setChoice(next); return; }
    if (server) { setPending(true); location.hash = url.slice(1); return; }
    // Local lists page without refetching or replacing the rest of the workspace.
    history.pushState(null, '', url); setChoice(next);
  };
  const control = (page: number, text: string, aria: string, disabled: boolean, current = false) =>
    disabled || current ? <button key={aria} type="button" disabled aria-label={aria} aria-current={current ? 'page' : undefined} className={current ? 'active' : ''}>{text}</button> :
      <a key={aria} href={pagePath(location.hash, pageKey, page, info.page_size)} aria-label={aria}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); navigate(page);
        }}>{text}</a>;
  return <div className="paged-collection" data-pagination-key={pageKey} data-pagination-total={info.total} data-pagination-page={info.page} ref={element} aria-busy={pending || undefined}>
    {renderItems(visible)}
    {(summary || info.total > info.page_size) && <div className="table-summary shared-pagination">
      <span className="pagination-range" tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{info.total ? `Showing ${info.start}–${info.end} of ${info.total} ${label}` : `0 ${label}`}</span>
      {info.total > 0 && <div className="pagination-size"><label htmlFor={sizeId}>Per page</label><SearchableSelectField id={sizeId} aria-label={'Items per page for ' + label} value={info.page_size}
        disabled={pending} onChange={event => navigate(1, Number(event.target.value))}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</SearchableSelectField></div>}
      {info.total_pages > 1 && <nav className="pagination" aria-label={'Pagination for ' + label}>
        {control(1, '«', 'First page', pending || info.page <= 1)}
        {control(info.page - 1, '‹', 'Previous page', pending || info.page <= 1)}
        {pageNumbers(info.page, info.total_pages).map((number, i) => number === 'ellipsis' ? <span className="pagination-ellipsis" key={'gap' + i} aria-hidden="true">…</span> : control(number, String(number), 'Page ' + number, pending, number === info.page))}
        {control(info.page + 1, '›', 'Next page', pending || info.page >= info.total_pages)}
        {control(info.total_pages, '»', 'Last page', pending || info.page >= info.total_pages)}
      </nav>}
    </div>}
  </div>;
}
