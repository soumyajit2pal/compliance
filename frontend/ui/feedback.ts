/** Keep feedback in the active native dialog's top layer, or in the page toast. */
let messageTimer: number | undefined;
const errorSelector = '#form-error, #login-error, [data-dialog-feedback="error"]';
const fallbackError = 'The action could not be completed. Please try again.';

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

function showError(node: HTMLElement, text: string) {
  clearMessage();
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
export function reportError(text: unknown, scope?: HTMLElement) {
  const value = typeof text === 'string' && text.trim() ? text : fallbackError;
  const modal = activeDialog();
  const enclosingDialog = scope?.closest<HTMLDialogElement>('dialog');
  const visibleScope = scope?.isConnected && (!enclosingDialog || enclosingDialog.open) && (!modal || modal.contains(scope));
  const inline = visibleScope ? scope.querySelector<HTMLElement>(errorSelector) : null;
  if (inline) {
    modal?.querySelector('[data-dialog-feedback="status"]')?.replaceChildren();
    showError(inline, value);
  } else if (modal) {
    modal.querySelector('[data-dialog-feedback="status"]')?.replaceChildren();
    showError(dialogFeedback(modal, true), value);
  } else {
    message(value, true);
  }
}

export function message(text: unknown, error = false) {
  const value = typeof text === 'string' ? text : error ? fallbackError : String(text ?? '');
  const modal = activeDialog();
  if (modal) {
    if (error) reportError(value, modal);
    else {
      clearMessage();
      clearFormError(modal);
      const node = dialogFeedback(modal, false);
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
  node.className = error ? 'error' : '';
  node.setAttribute('role', error ? 'alert' : 'status');
  node.setAttribute('aria-live', error ? 'assertive' : 'polite');
  node.textContent = value;
  messageTimer = window.setTimeout(clearMessage, 7000);
}
