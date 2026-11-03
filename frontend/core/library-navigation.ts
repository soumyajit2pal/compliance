import { state } from './state.ts';

interface LibraryContext { hash: string; scrollY: number; recordId: string; ownerId: string; }
const key = 'cbdLibraryReturn';
let last: LibraryContext | null = null;
function valid(value: any): value is LibraryContext {
  return value && typeof value.hash === 'string' && value.hash.split('?')[0] === '#repository' &&
    Number.isFinite(value.scrollY) && value.scrollY >= 0 && value.scrollY <= 10000000 &&
    typeof value.recordId === 'string' && value.ownerId === state.identity?.user.id;
}
/** Save list location and scroll, never instrument details, in browser history. */
export function rememberLibraryLocation(recordId: string) {
  if (location.hash.split('?')[0] !== '#repository' || !state.identity) return;
  last = {hash:location.hash, scrollY:window.scrollY, recordId, ownerId:state.identity.user.id};
  history.replaceState({...history.state, [key]:last}, '', location.href);
}
export function libraryReturnPath(recordId: string) {
  const candidate = valid(last) ? last : history.state?.[key];
  if (!valid(candidate) || candidate.recordId !== recordId) return 'repository';
  last = candidate;
  return candidate.hash.slice(1);
}
/** Keep return context on the details entry as well, so refreshing it is safe. */
export function retainLibraryLocation(recordId: string) {
  const candidate = valid(last) ? last : history.state?.[key];
  if (!valid(candidate) || candidate.recordId !== recordId) return;
  last = candidate;
  history.replaceState({...history.state, [key]:candidate}, '', location.href);
}
export function restoreLibraryLocation() {
  const candidate = history.state?.[key];
  const context = valid(candidate) ? candidate : last;
  if (!valid(context) || context.hash !== location.hash || !document.getElementById('filters')) return;
  requestAnimationFrame(() => {
    if (location.hash !== context.hash || state.identity?.user.id !== context.ownerId) return;
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, context.scrollY);
    document.documentElement.style.scrollBehavior = previous;
  });
}
