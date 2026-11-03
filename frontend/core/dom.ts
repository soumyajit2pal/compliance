import { loadingMarkup } from '../ui/loading.ts';
export const initialMarkup = '<p class="loading">' + loadingMarkup('Opening Compliance by Design…') + '</p>';
let renderRoot = null;
let lastMarkup = initialMarkup;
let mountDialogCollections: (scope: HTMLElement) => () => void = () => () => {};
let disposeDialogCollections = () => {};
export function bindDialogCollections(mount: (scope: HTMLElement) => () => void) {
  mountDialogCollections = mount;
}
export function setDialogMarkup(markup: string) {
  disposeDialogCollections();
  dialog.innerHTML = markup;
  disposeDialogCollections = mountDialogCollections(dialog);
}

export function bindReactRoot(render) {
  renderRoot = render;
  renderRoot(lastMarkup);
}

export const root = {
  get innerHTML() {
    return lastMarkup;
  },
  set innerHTML(markup) {
    lastMarkup = String(markup);
    renderRoot?.(lastMarkup);
  },
};
export const dialog = document.querySelector<HTMLDialogElement>('#dialog');
dialog.addEventListener('close', () => { disposeDialogCollections(); disposeDialogCollections = () => {}; });
