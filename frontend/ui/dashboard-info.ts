import { esc } from './components.ts';
import { icon } from './icons.ts';

let sequence = 0;

export function dashboardInfo(label: string, explanation: string) {
  const id = 'dashboard-info-' + ++sequence;
  return `<span class="dashboard-info" data-dashboard-info>
    <button type="button" class="dashboard-info-button" aria-label="${esc('About ' + label)}"
      aria-describedby="${id}" aria-controls="${id}" aria-expanded="false">${icon('info')}</button>
    <span class="dashboard-info-popup" id="${id}" role="tooltip" hidden>${esc(explanation)}</span>
  </span>`;
}

export function installDashboardInfo() {
  let active: { wrapper: HTMLElement; button: HTMLButtonElement; popup: HTMLElement; pinned: boolean } | null = null;
  let hideTimer = 0;
  const wrapperFor = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-dashboard-info]') : null;

  function close() {
    window.clearTimeout(hideTimer);
    if (!active) return;
    active.popup.hidden = true;
    active.button.setAttribute('aria-expanded', 'false');
    active = null;
  }

  function position() {
    if (!active) return;
    if (!active.button.isConnected) { close(); return; }
    const rect = active.button.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) { close(); return; }
    const { offsetWidth: width, offsetHeight: height, style } = active.popup;
    const below = rect.bottom + 4;
    const preferredTop = below + height <= window.innerHeight - 8 ? below : rect.top - height - 4;
    style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + 'px';
    style.top = Math.max(8, preferredTop) + 'px';
  }

  function show(wrapper: HTMLElement, pinned = false) {
    window.clearTimeout(hideTimer);
    if (active?.wrapper === wrapper) {
      if (pinned) active.pinned = true;
      return;
    }
    close();
    const button = wrapper.querySelector('button');
    const popup = wrapper.querySelector<HTMLElement>('[role="tooltip"]');
    if (!button || !popup) return;
    active = { wrapper, button, popup, pinned };
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    position();
  }

  document.addEventListener('pointerover', event => {
    const wrapper = wrapperFor(event.target);
    if (wrapper && event.pointerType !== 'touch' && wrapperFor(event.relatedTarget) !== wrapper) show(wrapper);
  });
  document.addEventListener('pointerout', event => {
    const wrapper = wrapperFor(event.target);
    if (!active || active.wrapper !== wrapper || active.pinned || active.button.matches(':focus-visible')
        || wrapperFor(event.relatedTarget) === wrapper) return;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(close, 120);
  });
  document.addEventListener('focusin', event => {
    const wrapper = wrapperFor(event.target);
    if (wrapper && event.target instanceof Element && event.target.matches(':focus-visible')) show(wrapper);
  });
  document.addEventListener('focusout', event => {
    if (active && event.target === active.button && !active.pinned && !active.wrapper.matches(':hover')) close();
  });
  document.addEventListener('click', event => {
    const wrapper = wrapperFor(event.target);
    if (wrapper && event.target instanceof Element && event.target.closest('.dashboard-info-button')) {
      if (active?.wrapper === wrapper && active.pinned) close();
      else show(wrapper, true);
    } else if (wrapper !== active?.wrapper) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    if (!active.button.isConnected) { close(); return; }
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);
  window.addEventListener('scroll', position, { capture: true, passive: true });
  window.addEventListener('resize', position);
  window.addEventListener('hashchange', close);
}
