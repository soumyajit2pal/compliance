import { icon } from './icons.ts';

/** Keep feedback in the active native dialog's top layer, or in the page toast. */
let messageTimer: number | undefined;
const errorSelector = '#form-error, #login-error, [data-dialog-feedback="error"]';
const fallbackError = 'The action could not be completed. Please try again.';
type FeedbackTone = 'success' | 'info' | 'exception' | 'error';
const feedbackIcons = { success: 'check', info: 'info', exception: 'alert', error: 'alert' };
const isAlert = (tone: FeedbackTone) => tone === 'error' || tone === 'exception';

export function clearMessage() {
  if (messageTimer !== undefined) window.clearTimeout(messageTimer);
  messageTimer = undefined;
  const node = document.querySelector<HTMLElement>('#message');
  if (node) {
    node.textContent = '';
    node.className = '';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
  }
}

export function clearFormError(scope: ParentNode) {
  scope.querySelectorAll<HTMLElement>(errorSelector).forEach((node) => { node.textContent = ''; });
  scope.querySelectorAll<HTMLElement>('[data-dialog-feedback="status"]').forEach((node) => { node.textContent = ''; });
}

function activeDialog() {
  return document.querySelector<HTMLDialogElement>('dialog[open]');
}

function showError(node: HTMLElement, text: string, tone: FeedbackTone) {
  clearMessage();
  node.classList.toggle('exception', tone === 'exception');
  node.setAttribute('role', 'alert');
  node.setAttribute('aria-atomic', 'true');
  node.tabIndex = -1;
  node.textContent = text;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
}

function dialogFeedback(modal: HTMLDialogElement, error: boolean) {
  let node = error ? modal.querySelector<HTMLElement>(errorSelector)
    : modal.querySelector<HTMLElement>('[data-dialog-feedback="status"]');
  if (!node) {
    node = document.createElement('p');
    node.dataset.dialogFeedback = error ? 'error' : 'status';
    node.className = error ? 'inline-error dialog-feedback' : 'dialog-feedback-info';
    (modal.querySelector('.modal-body') || modal).prepend(node);
  }
  return node;
}

/** Show one persistent, focused error in its visible form; never behind a modal. */
export function reportError(error: unknown, scope?: HTMLElement) {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const tone = [400, 409, 413, 415, 422, 429].some(code => code === status) ? 'exception' : 'error';
  const text = error instanceof Error ? error.message : error;
  const value = typeof text === 'string' && text.trim() ? text : fallbackError;
  const modal = activeDialog();
  const enclosingDialog = scope?.closest<HTMLDialogElement>('dialog');
  const visibleScope = scope?.isConnected && (!enclosingDialog || enclosingDialog.open) && (!modal || modal.contains(scope));
  const inline = visibleScope ? scope.querySelector<HTMLElement>(errorSelector) : null;
  if (inline) {
    modal?.querySelector('[data-dialog-feedback="status"]')?.replaceChildren();
    showError(inline, value, tone);
  } else {
    message(value, tone);
  }
}

export function message(text: unknown, tone: FeedbackTone = 'success') {
  const alert = isAlert(tone);
  const value = typeof text === 'string' ? text : alert ? fallbackError : String(text ?? '');
  const modal = activeDialog();
  if (modal) {
    if (alert) {
      modal.querySelector('[data-dialog-feedback="status"]')?.replaceChildren();
      showError(dialogFeedback(modal, true), value || fallbackError, tone);
    } else {
      clearMessage();
      clearFormError(modal);
      const node = dialogFeedback(modal, false);
      node.classList.toggle('success', tone === 'success');
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.textContent = value;
      node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
    return;
  }
  clearMessage();
  const node = document.querySelector<HTMLElement>('#message');
  if (!node || !value) return;
  node.className = tone;
  node.setAttribute('role', alert ? 'alert' : 'status');
  node.setAttribute('aria-live', alert ? 'assertive' : 'polite');
  node.innerHTML = icon(feedbackIcons[tone]);
  node.append(document.createTextNode(value));
  messageTimer = window.setTimeout(clearMessage, 7000);
}
