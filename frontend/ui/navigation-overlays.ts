/** Render collapsed navigation labels and group links outside the rail's scroll container. */
export function installNavigationOverlays() {
  const selector = '.navigation-collapsed .sidebar [data-nav-label]';
  let active: { trigger: HTMLElement; popup: HTMLElement; flyout: boolean; activated: boolean } | null = null;
  let hideTimer = 0;

  const triggerFor = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(selector) : null;

  function close(restoreFocus = false) {
    window.clearTimeout(hideTimer);
    if (!active) return;
    if (restoreFocus) active.trigger.focus({ preventScroll: true });
    if (active.flyout) active.trigger.setAttribute('aria-expanded', 'false');
    active.popup.hidden = true;
    active = null;
  }

  function position() {
    if (!active) return;
    const { trigger, popup, flyout } = active;
    if (!trigger.isConnected || !trigger.matches(selector)) { close(); return; }
    const bounds = trigger.getBoundingClientRect();
    const scrollBox = trigger.closest('.nav-scroll')?.getBoundingClientRect();
    const top = Math.max(bounds.top, scrollBox?.top ?? 0, 0);
    const bottom = Math.min(bounds.bottom, scrollBox?.bottom ?? window.innerHeight, window.innerHeight);
    if (bottom <= top) { close(); return; }
    const height = popup.offsetHeight;
    popup.style.left = `${trigger.closest('.sidebar').getBoundingClientRect().right + 6}px`;
    const preferredTop = flyout ? top : (top + bottom - height) / 2;
    popup.style.top = `${Math.max(8, Math.min(preferredTop, window.innerHeight - height - 8))}px`;
  }

  function show(trigger: HTMLElement, flyout = false, activate = false) {
    window.clearTimeout(hideTimer);
    if (active?.trigger !== trigger || active.flyout !== flyout) {
      close();
      const popup = trigger.closest('.app-shell')?.querySelector<HTMLElement>(flyout ? '.portal-nav-flyout' : '.portal-nav-tooltip');
      if (!popup) return;
      if (flyout) {
        const group = trigger.closest('.nav-scroll')?.querySelector(`[data-nav-group="${CSS.escape(trigger.dataset.navGroupTrigger)}"]`);
        const links = [...(group?.querySelectorAll<HTMLAnchorElement>('a.nav-item') ?? [])].map(link => {
          const shortcut = link.cloneNode(true) as HTMLAnchorElement;
          shortcut.className = 'portal-nav-flyout-link';
          return shortcut;
        });
        if (!links.length) return;
        popup.querySelector('h2').textContent = trigger.dataset.navLabel;
        popup.querySelector('.portal-nav-flyout-links').replaceChildren(...links);
        trigger.setAttribute('aria-expanded', 'true');
      } else popup.textContent = trigger.dataset.navLabel;
      active = { trigger, popup, flyout, activated: false };
      popup.hidden = false;
      if (flyout) popup.scrollTop = 0;
      position();
    }
    if (active && activate) {
      active.activated = true;
      active.popup.querySelector('a')?.focus();
    }
  }

  function scheduleClose() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (active && !active.trigger.matches(':hover, :focus-visible') && !active.popup.matches(':hover, :focus-within')) close();
    }, 180);
  }

  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const trigger = triggerFor(event.target);
    if (trigger && (!active?.popup.matches(':focus-within') || active.trigger === trigger)) {
      show(trigger, trigger.hasAttribute('data-nav-group-trigger'));
    } else if (active?.popup.contains(event.target as Node)) window.clearTimeout(hideTimer);
  });
  document.addEventListener('pointerout', event => {
    if (active && (triggerFor(event.target) === active.trigger || active.popup.contains(event.target as Node))) scheduleClose();
  });
  document.addEventListener('focusin', event => {
    const trigger = triggerFor(event.target);
    if (trigger?.matches(':focus-visible') && (active?.trigger !== trigger || !active.flyout)) show(trigger);
  });
  document.addEventListener('focusout', event => {
    if (active && (event.target === active.trigger || active.popup.contains(event.target as Node))) scheduleClose();
  });
  document.addEventListener('click', event => {
    const trigger = triggerFor(event.target);
    if (trigger?.hasAttribute('data-nav-group-trigger')) {
      if (active?.trigger === trigger && active.activated) close();
      else show(trigger, true, true);
    } else if (active?.flyout && active.popup.contains(event.target as Node)) {
      if ((event.target as Element).closest('a')) close(true);
    } else close();
  });
  document.addEventListener('keydown', event => {
    const trigger = triggerFor(event.target);
    if (event.key === 'ArrowDown' && trigger?.hasAttribute('data-nav-group-trigger')) {
      event.preventDefault();
      show(trigger, true, true);
    } else if (event.key === 'Escape' && active) {
      const restore = active.flyout && active.popup.matches(':focus-within');
      if (restore || (active.flyout && event.target === active.trigger)) event.stopImmediatePropagation();
      close(restore);
    } else if (event.key === 'Tab' && active?.flyout) {
      const { trigger, popup } = active;
      const links = [...popup.querySelectorAll<HTMLAnchorElement>('a')];
      let destination: HTMLElement;
      if (event.target === trigger && !event.shiftKey) destination = links[0];
      else if (event.target === links[0] && event.shiftKey) destination = trigger;
      else if (event.target === links.at(-1) && !event.shiftKey) {
        const rail = [...trigger.closest('.sidebar').querySelectorAll<HTMLElement>('[data-nav-label]')].filter(item => item.getClientRects().length);
        destination = rail[rail.indexOf(trigger) + 1] ?? document.querySelector<HTMLElement>('.portal-nav-toggle');
        close();
      }
      if (destination) {
        event.preventDefault();
        destination.focus();
      }
    }
  });
  window.addEventListener('scroll', position, { capture: true, passive: true });
  window.addEventListener('resize', position);
  window.addEventListener('hashchange', () => close());
}
