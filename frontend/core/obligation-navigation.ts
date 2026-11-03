import { state } from './state.ts';
import { obligationReturnPath } from './obligation-detail.ts';

type Context = {hash:string; scrollY:number; recordId:string; ownerId:string};
const key = 'cbdObligationReturn';
let last: Context | null = null;
const valid = (value:any): value is Context => value && typeof value.hash === 'string' &&
  Boolean(obligationReturnPath(value.hash.slice(1))) &&
  value.hash.startsWith('#') && Number.isFinite(value.scrollY) && value.scrollY >= 0 &&
  value.scrollY <= 10000000 && typeof value.recordId === 'string' && value.ownerId === state.identity?.user.id;

export function rememberObligationLocation(recordId:string) {
  if (!state.identity || !obligationReturnPath(location.hash.slice(1))) return;
  last = {hash:location.hash, scrollY:window.scrollY, recordId, ownerId:state.identity.user.id};
  history.replaceState({...history.state, [key]:last}, '', location.href);
}
export function retainObligationLocation(recordId:string) {
  const candidate = valid(last) ? last : history.state?.[key];
  if (!valid(candidate) || candidate.recordId !== recordId) return;
  last = candidate;
  history.replaceState({...history.state, [key]:candidate}, '', location.href);
}
export function restoreObligationLocation() {
  const candidate = history.state?.[key];
  const context = valid(candidate) ? candidate : last;
  if (!valid(context) || context.hash !== location.hash || !document.getElementById('view-filter')) return;
  requestAnimationFrame(() => {
    if (location.hash !== context.hash || state.identity?.user.id !== context.ownerId) return;
    const previous = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, context.scrollY);
    document.documentElement.style.scrollBehavior = previous;
  });
}
