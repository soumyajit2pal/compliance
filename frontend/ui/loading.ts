import { esc } from './components.ts';

type Activity = { label: string; priority: number; started: number; scope?: HTMLElement };
type Busy = { count: number; previous: string | null };
const pending = new Map<symbol, Activity>();
const busy = new WeakMap<HTMLElement, Busy>();
const locks = new WeakMap<HTMLElement, { count: number; disabled: boolean }>();
const showAfter = 160;
let host: HTMLElement;
let showTimer: number;
let longTimer: number;
let visible = false;

export function loadingMarkup(label: string) {
  return `<span class="loading-inline" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>${esc(label)}</span></span>`;
}

function holdBusy(element?: HTMLElement) {
  if (!element) return () => {};
  const state = busy.get(element) || { count: 0, previous: element.getAttribute('aria-busy') };
  state.count++; busy.set(element, state); element.setAttribute('aria-busy', 'true');
  return () => {
    if (--state.count) return;
    busy.delete(element);
    if (state.previous === null) element.removeAttribute('aria-busy');
    else element.setAttribute('aria-busy', state.previous);
  };
}

export function isBusy(element: HTMLElement) { return busy.has(element) || locks.has(element); }

export function lockControl(element?: HTMLButtonElement | HTMLInputElement | HTMLSelectElement) {
  if (!element) return () => {};
  const state = locks.get(element) || { count: 0, disabled: element.disabled };
  state.count++; locks.set(element, state); element.disabled = true;
  return () => {
    if (--state.count) return;
    locks.delete(element); element.disabled = state.disabled;
  };
}

function install() {
  if (host?.isConnected) return;
  host = document.createElement('div');
  host.id = 'app-loading'; host.hidden = true;
  host.innerHTML = '<div class="activity-track" aria-hidden="true"></div><div class="activity-status" role="status" aria-live="polite" aria-atomic="true"><span class="loading-spinner" aria-hidden="true"></span><span data-loading-label></span></div>';
  document.body.append(host);
  document.addEventListener('toggle', event => {
    if ((event.target as HTMLElement)?.tagName === 'DIALOG') update();
  }, true);
}

function update() {
  window.clearTimeout(longTimer);
  if (!pending.size) {
    window.clearTimeout(showTimer); visible = false;
    if (host) { host.hidden = true; host.dataset.pending = '0'; }
    document.querySelectorAll('[data-loading-dialog]').forEach(node => node.remove());
    return;
  }
  host.dataset.pending = String(pending.size);
  if (!visible) return;
  const activity = [...pending.values()].sort((a,b) => b.priority-a.priority || b.started-a.started)[0];
  const elapsed = performance.now()-activity.started;
  const label = elapsed >= 10000 ? activity.label + ' Still working…' : activity.label;
  host.hidden = false;
  const text = host.querySelector('[data-loading-label]');
  if (text.textContent !== label) text.textContent = label;
  const modal = document.querySelector<HTMLDialogElement>('dialog[open]');
  document.querySelectorAll('[data-loading-dialog]').forEach(node => { if (!modal?.contains(node)) node.remove(); });
  host.querySelector<HTMLElement>('.activity-status').hidden = Boolean(modal);
  if (modal) {
    let status = modal.querySelector<HTMLElement>('[data-loading-dialog]');
    if (!status) {
      status = document.createElement('div'); status.dataset.loadingDialog = '';
      status.setAttribute('aria-live', 'polite');
      (modal.querySelector('.modal-header > div') || modal).append(status);
    }
    if (status.dataset.label !== label) {
      status.innerHTML = loadingMarkup(label); status.dataset.label = label;
    }
  }
  if (elapsed < 10000) longTimer = window.setTimeout(update, 10000-elapsed);
}

/** Reference-count overlapping work; always release in finally. No fake percentage. */
export function beginActivity(label = 'Loading…', options: { priority?: number; scope?: HTMLElement } = {}) {
  install();
  const id = Symbol(); const releaseBusy = holdBusy(options.scope);
  pending.set(id, { label, priority: options.priority || 0, started: performance.now(), scope: options.scope });
  if (pending.size === 1) showTimer = window.setTimeout(() => { visible = true; update(); }, showAfter);
  update();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true; pending.delete(id); releaseBusy(); update();
  };
}

export async function withActivity<T>(label: string, work: () => Promise<T>) {
  const finish = beginActivity(label);
  try { return await work(); } finally { finish(); }
}

export function requestLabel(path: string, method: string) {
  const endpoint = path.split('?')[0];
  if (endpoint === '/auth/demo-users') return 'Loading demo users…';
  if (endpoint === '/auth/me') return 'Checking sign-in…';
  if (endpoint === '/auth/login-key' || endpoint === '/auth/login') return 'Signing in…';
  if (endpoint === '/auth/logout') return 'Signing out…';
  if (endpoint.endsWith('/test')) return 'Testing connection…';
  return method === 'GET' ? 'Loading…' : 'Saving changes…';
}

/** Keep labels and form fields intact. Only the initiating control/submit locks. */
export function beginInteraction(target: HTMLElement, label: string, options: { lockForm?: boolean } = {}) {
  const form = options.lockForm === false ? null : target instanceof HTMLFormElement ? target : target.closest('form');
  const submit = form?.querySelector<HTMLButtonElement>('button[type=submit],button:not([type])');
  const button = target instanceof HTMLButtonElement ? target : submit;
  const releaseButton = lockControl(button);
  const releaseSelect = target instanceof HTMLSelectElement ? lockControl(target) : () => {};
  const releaseTarget = form && target !== form ? holdBusy(target) : () => {};
  const releasePicker = target instanceof HTMLSelectElement ? holdBusy(target.closest('.searchable-select')) : () => {};
  const releaseSubmit = submit && submit !== button ? lockControl(submit) : () => {};
  const finish = beginActivity(label, { priority: 3, scope: form || target });
  // Display the spinner only for sustained operations, without replacing labels.
  const timer = window.setTimeout(() => button?.classList.add('is-loading'), showAfter);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer); button?.classList.remove('is-loading');
    releaseButton(); releaseSubmit(); releaseSelect(); releaseTarget(); releasePicker(); finish();
  };
}
