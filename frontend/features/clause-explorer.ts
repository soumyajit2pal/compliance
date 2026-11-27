const widthPreference = 'cbd.clause-explorer-width';
let preferredWidth = readWidth();

function readWidth() {
  try {
    const width = Number(localStorage.getItem(widthPreference));
    if (Number.isFinite(width) && width > 0) return Math.round(width);
  } catch { /* Resizing also works when browser storage is unavailable. */ }
}

function saveWidth() {
  try {
    localStorage.setItem(widthPreference, String(preferredWidth));
  } catch { /* Keep the current width in this tab. */ }
}

export function clauseExplorerLayout(hierarchy: string, content: string, recordView = false) {
  return `<div class="clause-working-layout${recordView ? '' : ' clause-reader-layout'}" data-clause-explorer-layout${recordView ? ' id="clause-working-view"' : ''}>
    <aside class="panel clause-hierarchy-panel" id="clause-explorer">${hierarchy}</aside>
    <div class="clause-explorer-divider" role="separator" tabindex="0" aria-orientation="vertical"
      aria-label="Resize clause explorer" aria-controls="clause-explorer" title="Drag to resize the clause explorer"></div>
    ${content}
  </div>`;
}

export function mountClauseExplorer(layout: HTMLElement) {
  const explorer = layout.querySelector<HTMLElement>('#clause-explorer');
  const divider = layout.querySelector<HTMLElement>('.clause-explorer-divider');
  const events = new AbortController();
  const options = { signal: events.signal };
  let drag: { pointerId: number; startX: number; startWidth: number; changed: boolean } | undefined;
  let minimum = 220;
  let maximum = minimum;

  function syncWidth() {
    if (!divider.offsetWidth) return;
    const available = layout.clientWidth - divider.offsetWidth;
    maximum = Math.max(0, Math.floor(Math.min(available * 0.6, available - 320)));
    minimum = Math.min(220, maximum);
    if (preferredWidth !== undefined) {
      const width = Math.min(maximum, Math.max(minimum, preferredWidth));
      const value = width + 'px';
      if (layout.style.getPropertyValue('--clause-explorer-width') !== value)
        layout.style.setProperty('--clause-explorer-width', value);
    }
    divider.setAttribute('aria-valuemin', String(minimum));
    divider.setAttribute('aria-valuemax', String(maximum));
    divider.setAttribute('aria-valuenow', String(explorer.offsetWidth));
  }

  function resizeTo(target: number) {
    const width = Math.min(maximum, Math.max(minimum, Math.round(target)));
    if (width === explorer.offsetWidth || !divider.offsetWidth) return false;
    preferredWidth = width;
    syncWidth();
    return true;
  }

  function endDrag() {
    if (drag?.changed) saveWidth();
    drag = undefined;
    delete divider.dataset.resizing;
  }

  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    divider.focus({ preventScroll: true });
    divider.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: explorer.offsetWidth, changed: false };
    divider.dataset.resizing = '';
  }, options);
  divider.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (resizeTo(drag.startWidth + event.clientX - drag.startX)) drag.changed = true;
  }, options);
  divider.addEventListener('lostpointercapture', endDrag, options);
  divider.addEventListener('keydown', (event) => {
    const width = explorer.offsetWidth;
    const sizes = { ArrowLeft: width - 24, ArrowRight: width + 24, Home: minimum, End: maximum };
    if (!Object.hasOwn(sizes, event.key)) return;
    event.preventDefault();
    if (resizeTo(sizes[event.key])) saveWidth();
  }, options);
  syncWidth();
  let resizeFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(syncWidth);
  });
  observer.observe(layout);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(resizeFrame);
    events.abort();
    endDrag();
  };
}
