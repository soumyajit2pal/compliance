import { dialog, setDialogMarkup } from '../core/dom.ts';
import { esc, button } from './components.ts';
import { icon } from './icons.ts';
import { clearMessage } from './feedback.ts';
import { beginActivity } from './loading.ts';
import { sourceDocumentUrl, sourceDocumentDownload } from './source-document.ts';
let lastFocus: HTMLElement | null = null;
function restoreFocus() {
  const target = lastFocus;
  lastFocus = null;
  if (target?.isConnected) target.focus();
}
dialog.addEventListener('close', restoreFocus);
export function modal(name, contents, form = '', save = 'Save', sub = '') {
  clearMessage();
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.className = 'modal wide runtime-dialog';
  const footer = `<div class="modal-footer"><span class="keyboard-hint">Esc to close</span><div class="row">${button('close', 'Cancel')}<button class="btn primary" type="submit">${esc(save)}</button></div></div>`;
  const body = form
    ? `<form id="${esc(form)}" class="dialog-form"><div class="modal-body"><p class="inline-error dialog-feedback" id="form-error" role="alert" aria-atomic="true" tabindex="-1"></p>${contents}</div>${footer}</form>`
    : `<div class="modal-body">${contents}</div>`;
  setDialogMarkup(`<div class="modal-header"><div><h2 id="dialog-title">${esc(name)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><button type="button" class="icon-button" data-action="close" aria-label="Close">${icon('x')}</button></div>${body}`);
  dialog.showModal();
  dialog.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea,button')?.focus();
}
export function sourceDocumentPreview(identifier: string, fileName: string) {
  clearMessage();
  lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const extension = fileName.split('.').pop()?.toLowerCase();
  const browserPreviewSupported = extension === 'pdf' || extension === 'txt';
  const preview = browserPreviewSupported
    ? `<iframe class="source-preview-frame" title="Preview of ${esc(fileName)}" src="${esc(sourceDocumentUrl(identifier,true))}"></iframe>`
    : `<div class="source-preview-unavailable"><div class="source-preview-file-icon">${icon('file')}</div><h3>Preview is not available for this file type</h3><p>Download the original source to review its contents.</p></div>`;
  dialog.className = 'modal wide runtime-dialog source-document-dialog';
  setDialogMarkup(`<div class="modal-header source-preview-header"><div><h2 id="source-preview-title">${esc(fileName)}</h2><p>Document preview · Read-only source file</p></div><button type="button" class="icon-button source-preview-close" data-action="close" aria-label="Close document preview">${icon('x')}</button></div><div class="source-preview-body" aria-labelledby="source-preview-title">${preview}</div><div class="modal-footer source-preview-footer"><span class="keyboard-hint">Source document · Read-only preview</span><div class="actions">${sourceDocumentDownload(identifier,fileName,'Download original','btn primary')}<button type="button" class="btn" data-action="close">Close</button></div></div>`);
  dialog.showModal();
  const frame = dialog.querySelector<HTMLIFrameElement>('.source-preview-frame');
  if (frame) {
    const finish = beginActivity('Loading document…', { scope: frame.parentElement });
    const completed = () => {
      finish(); dialog.removeEventListener('close', completed);
      frame.removeEventListener('load', completed); frame.removeEventListener('error', completed);
    };
    frame.addEventListener('load', completed, { once: true });
    frame.addEventListener('error', completed, { once: true });
    dialog.addEventListener('close', completed, { once: true });
  }
}
export function close() {
  if (dialog.open) dialog.close();
  else restoreFocus();
}
