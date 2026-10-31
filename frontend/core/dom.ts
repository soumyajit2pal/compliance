import { loadingMarkup } from '../ui/loading.ts';
export const initialMarkup = '<p class="loading">' + loadingMarkup('Opening Compliance by Design…') + '</p>';
let renderRoot = null;
let lastMarkup = initialMarkup;

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
