import { state } from './state.ts';
import { encryptLogin, type LoginKey } from './login-encryption.ts';

export class SessionExpired extends Error {}

export async function signIn(username: string, password: string) {
  const key = await api<LoginKey>('/auth/login-key');
  return api('/auth/login', 'POST', await encryptLogin(key, username, password));
}

/** Same-origin cookie authentication; CSRF is required for every write. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
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
  if (!response.ok) {
    const detail =
      typeof data.detail === 'string' ? data.detail : data.detail?.message
        ? [data.detail.message, data.detail.guidance, data.detail.code ? '(' + data.detail.code + ')' : ''].filter(Boolean).join(' ')
        : JSON.stringify(data.detail || data);
    if (response.status === 401 && path !== '/auth/login') {
      state.identity = null;
      state.ready = false;
      state.masters = null;
      state.record = null;
      state.batch = null;
      state.view = {};
      state.work = [];
      state.notifications = [];
      window.dispatchEvent(new Event('portal:session-expired'));
      throw new SessionExpired(detail);
    }
    throw new Error(detail);
  }
  return data as T;
}
