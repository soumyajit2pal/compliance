import { esc } from './components.ts';
import { initialPage, withoutPaging, type PageInfo } from '../core/pagination.ts';

let revision = 0;
export interface CollectionOptions {
  pageKey: string;
  pagination?: PageInfo;
  label?: string;
  summary?: boolean;
  revealIndex?: number;
  className?: string;
  empty?: string;
}
/** Items are complete records or whole hierarchy groups; no child is sliced from its parent. */
function attributes(count: number, options: CollectionOptions) {
  const [path, text = ''] = (typeof location === 'undefined' ? '' : location.hash.slice(1)).split('?');
  const query = new URLSearchParams(text);
  const info = options.pagination || initialPage(count, query, options.pageKey, options.revealIndex);
  const scope = path + '?' + withoutPaging(query);
  return `data-paged-collection data-page-key="${esc(options.pageKey)}" data-page-scope="${esc(scope)}" data-page-revision="${++revision}" data-page-info="${esc(JSON.stringify(info))}" data-page-server="${options.pagination ? '1' : '0'}" data-page-label="${esc(options.label || 'records')}" data-page-summary="${options.summary === false ? '0' : '1'}"`;
}
export function pagedCollection(items: string[], options: CollectionOptions) {
  return `<div ${attributes(items.length, options)}><div class="${esc(options.className || '')}" data-page-items>${items.join('') || options.empty || ''}</div></div>`;
}

/** Table markup uses the same controller without invalid wrappers around table rows. */
export function pagedTable(content: string, count: number, options: CollectionOptions) {
  return `<div ${attributes(count, options)}>${content}</div>`;
}
