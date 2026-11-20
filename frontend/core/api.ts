import { state } from './state.ts';
import { encryptedSignIn } from './login-encryption.ts';
import { requestLabel, withActivity } from '../ui/loading.ts';
import {delegationHeaders,selectDelegation} from './delegation-context.ts';

export class SessionExpired extends Error {}

/** Shared JSON/file failure handling preserves the existing session boundary. */
export function throwApiError(status: number, data: any, path: string): never {
  const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message
    ? [data.detail.message, data.detail.guidance, data.detail.code ? '(' + data.detail.code + ')' : ''].filter(Boolean).join(' ')
    : Array.isArray(data?.detail)?data.detail.map(e=>e.msg||'Complete the required fields.').join(' '):JSON.stringify(data?.detail || data || 'The service returned an unexpected response.');
  if (status === 401 && path !== '/auth/login') {
    selectDelegation('');
    const hadIdentity = Boolean(state.identity);
    state.identity = null; state.ready = false; state.masters = null; state.record = null;
    state.batch = null; state.view = {}; state.work = []; state.notifications = [];
    if (hadIdentity) window.dispatchEvent(new Event('portal:session-expired'));
    throw new SessionExpired(detail);
  }
  throw Object.assign(new Error(detail), {status,delegationUnavailable:data?.detail?.code==='DELEGATION_UNAVAILABLE'});
}

export function apiHeaders(path:string):Record<string,string>{return {...delegationHeaders(path),...(state.identity?.csrf_token?{'X-CSRF-Token':state.identity.csrf_token}:{})};}

export async function downloadProtected(href:string){
 const url=new URL(href,location.href);
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))throw new Error('This file is outside the authenticated application.');
 const path=url.pathname.slice(4)+url.search,response=await fetch(url.href,{headers:apiHeaders(path),cache:'no-store'});
 if(!response.ok)throwApiError(response.status,await response.json(),path);
 const disposition=response.headers.get('Content-Disposition')||'',encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition),plain=/filename="?([^";]+)/i.exec(disposition);
 const name=encoded?decodeURIComponent(encoded[1]):plain?.[1]||'retained-record';
 const blob=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=blob;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(blob),1000);
}

export async function signIn(username: string, password: string) {
  return encryptedSignIn(api, username, password);
}

/** Same-origin cookie authentication; CSRF is required for every write. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  return withActivity(requestLabel(path, method), async () => {
    const headers: Record<string, string> = apiHeaders(path);
    if (state.identity?.csrf_token) headers['X-CSRF-Token'] = state.identity.csrf_token;
    let requestBody: BodyInit | undefined;
    if (body instanceof FormData) {
      requestBody = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch('/api' + path, { method, headers, body: requestBody });
    let data: any;
    try {
      data = await response.json();
    } catch {
      data = { detail: 'The service returned an unexpected response.' };
    }
    if (!response.ok) throwApiError(response.status,data,path);
    const revision=response.headers.get('X-Dropdown-Revision');
    if(path==='/tasks' && revision && state.masters &&
        Number(revision)!==state.masters.dropdown_configuration?.[0]?.revision){
      const identity=state.identity;
      const fresh=await api<Record<string,any[]>>('/masters');
      if(state.identity===identity && (fresh.dropdown_configuration?.[0]?.revision||0)>=(state.masters?.dropdown_configuration?.[0]?.revision||0))state.masters=fresh;
    }
    return data as T;
  });
}
