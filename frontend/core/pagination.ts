/** Shared paging contract for API registers and already-authorised local collections. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export interface PageInfo {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  start: number;
  end: number;
}
export interface PageResult<T> { items: T[]; pagination: PageInfo; summary?: Record<string, number>; }
export const pageParam = (key: string) => 'page.' + key;
export const sizeParam = (key: string) => 'size.' + key;
export function withoutPaging(query: URLSearchParams) {
  const next = new URLSearchParams(query);
  for (const key of [...next.keys()]) if (key.startsWith('page.') || key.startsWith('size.')) next.delete(key);
  return next;
}
function positive(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
export function pageRequest(query: URLSearchParams, key: string) {
  const requested = positive(query.get(sizeParam(key)), DEFAULT_PAGE_SIZE);
  return {page: positive(query.get(pageParam(key)), 1),
    page_size: PAGE_SIZES.includes(requested as any) ? requested : DEFAULT_PAGE_SIZE};
}
export function pageInfo(total: number, page = 1, size = DEFAULT_PAGE_SIZE): PageInfo {
  total = Math.max(0, Math.trunc(Number(total) || 0));
  size = PAGE_SIZES.includes(size as any) ? size : DEFAULT_PAGE_SIZE;
  const total_pages = Math.ceil(total / size);
  page = Math.min(positive(page, 1), Math.max(1, total_pages));
  return {page, page_size: size, total, total_pages,
    start: total ? (page - 1) * size + 1 : 0, end: Math.min(page * size, total)};
}
export function initialPage(total: number, query: URLSearchParams, key: string, revealIndex = -1) {
  const request = pageRequest(query, key);
  if (!query.has(pageParam(key)) && revealIndex >= 0) request.page = Math.floor(revealIndex / request.page_size) + 1;
  return pageInfo(total, request.page, request.page_size);
}
export function pageNumbers(page: number, total: number): Array<number | 'ellipsis'> {
  if (!total) return [];
  const numbers = [...new Set([1, total, page - 1, page, page + 1].filter(n => n >= 1 && n <= total))].sort((a,b) => a-b);
  return numbers.flatMap((number, i) => i && number - numbers[i-1] > 1 ? ['ellipsis' as const, number] : [number]);
}
export function pagePath(hash: string, key: string, page: number, size: number) {
  const [path, text = ''] = hash.replace(/^#/, '').split('?');
  const query = new URLSearchParams(text);
  query.set(pageParam(key), String(page));
  query.set(sizeParam(key), String(size));
  return '#' + path + '?' + query;
}
export function apiPageQuery(query: URLSearchParams, key: string) {
  const next = withoutPaging(query), request = pageRequest(query, key);
  next.set('page', String(request.page)); next.set('page_size', String(request.page_size));
  return next;
}
export function collectionKey(text: string) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 'list-' + (hash >>> 0).toString(36);
}
