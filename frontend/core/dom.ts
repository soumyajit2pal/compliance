let renderRoot = null;
let lastMarkup = '<p class="loading">Opening Compliance by Design…</p>';

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
