import { icon } from './icons.ts';

const controls = new Map<HTMLSelectElement, SearchableSelect>();
let sequence = 0;
let installed = false;
let pending = false;
let active: SearchableSelect | null = null;

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();
const eligible = (select: HTMLSelectElement) => !select.multiple && select.size <= 1;
const labelText = (label: HTMLLabelElement) => {
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('input, select, textarea, button, .searchable-select, [aria-hidden="true"]').forEach(node => node.remove());
  return copy.textContent?.trim();
};

/** The native select remains authoritative for FormData, validation and existing change handlers. */
export class SearchableSelect {
  readonly input = document.createElement('input');
  private readonly toggle = document.createElement('button');
  private readonly popup = document.createElement('div');
  private readonly list = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly error = document.createElement('span');
  private matches: number[] = [];
  private highlighted = -1;
  private opened = false;
  private query = '';
  private invalid = false;
  private label = '';
  private optionSignature = '';
  private selection = '';

  constructor(readonly select: HTMLSelectElement, readonly wrapper: HTMLElement) {
    const id = 'searchable-select-' + ++sequence;
    wrapper.dataset.enhanced = 'true';
    this.input.id = id;
    this.input.type = 'text';
    this.input.className = 'searchable-select-input';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-haspopup', 'listbox');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-controls', id + '-options');
    this.toggle.type = 'button';
    this.toggle.tabIndex = -1;
    this.toggle.className = 'searchable-select-toggle';
    this.toggle.innerHTML = icon('down');
    this.popup.className = 'searchable-select-popup';
    this.popup.setAttribute('popover', 'manual');
    this.list.id = id + '-options';
    this.list.className = 'searchable-select-options';
    this.list.setAttribute('role', 'listbox');
    this.status.className = 'searchable-select-status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.error.id = id + '-error';
    this.error.className = 'searchable-select-error';
    this.error.hidden = true;
    this.popup.append(this.list, this.status);
    wrapper.append(this.input, this.toggle, this.popup, this.error);
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.classList.add('searchable-select-native');
    select.addEventListener('focus', this.focusSource);
    select.addEventListener('invalid', this.reportInvalid);
    this.input.addEventListener('pointerdown', () => { if (!this.opened) this.open(''); });
    this.input.addEventListener('focus', () => { if (!this.opened) this.input.select(); });
    this.input.addEventListener('input', () => this.open(this.input.value));
    this.input.addEventListener('keydown', this.keydown);
    this.input.addEventListener('blur', () => this.close());
    this.toggle.addEventListener('pointerdown', event => event.preventDefault());
    this.toggle.addEventListener('click', () => { this.input.focus(); this.opened ? this.close() : this.open(''); });
    this.list.addEventListener('pointerdown', event => event.preventDefault());
    this.list.addEventListener('click', event => {
      const option = (event.target as Element).closest<HTMLElement>('[data-option-index]');
      if (option) this.choose(Number(option.dataset.optionIndex));
    });
    this.refresh();
    if (document.activeElement === select) this.input.focus();
  }

  private focusSource = () => this.input.focus();
  private reportInvalid = (event: Event) => {
    event.preventDefault();
    this.invalid = true;
    this.refresh();
    this.input.focus();
    this.open('');
  };

  refresh() {
    if (!this.select.isConnected) return;
    this.label = this.select.getAttribute('aria-label') ||
      (this.select.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ') ||
      Array.from(this.select.labels || []).map(labelText).join(' ') ||
      this.select.name.replaceAll('_', ' ') || 'Option';
    // Keep the visible label in the accessible name; distinguish the searchable proxy from the native form control.
    this.input.setAttribute('aria-label', 'Search ' + this.label);
    this.list.setAttribute('aria-label', this.label + ' options');
    this.toggle.setAttribute('aria-label', 'Toggle ' + this.label + ' options');
    const disabled = this.select.matches(':disabled');
    this.input.disabled = disabled;
    this.toggle.disabled = disabled;
    this.wrapper.hidden = this.select.hidden;
    this.wrapper.classList.toggle('is-disabled', disabled);
    this.input.setAttribute('aria-required', String(this.select.required));
    if (this.select.validity.valid) this.invalid = false;
    this.error.hidden = !this.invalid;
    this.error.textContent = this.invalid ? this.select.validationMessage : '';
    this.input.setAttribute('aria-invalid', String(this.invalid));
    const hints = [this.select.getAttribute('aria-describedby'), this.invalid ? this.error.id : ''].filter(Boolean).join(' ');
    if (hints) this.input.setAttribute('aria-describedby', hints); else this.input.removeAttribute('aria-describedby');
    const selection = this.select.value + '\u001f' + this.select.selectedIndex;
    if (this.opened && selection !== this.selection) this.close();
    this.selection = selection;
    const selected = this.select.selectedOptions[0]?.label.trim() || '';
    this.input.title = selected;
    if (!this.opened) this.input.value = selected;
    if (disabled || this.select.hidden || !eligible(this.select)) this.close();
    const signature = Array.from(this.select.options).map(option =>
      [option.label, option.value, option.disabled, option.hidden, option.parentElement?.getAttribute('disabled'), option.dataset.search].join('\u001f')
    ).join('\u001e');
    if (this.opened && signature !== this.optionSignature) this.renderOptions();
    this.optionSignature = signature;
  }

  private enabled(index: number) {
    const option = this.select.options[index];
    return option && !option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
  }

  private renderOptions() {
    const words = normalize(this.query).split(/\s+/).filter(Boolean);
    this.matches = [];
    this.list.replaceChildren();
    let lastGroup: Element | null = null;
    let container = this.list;
    let visible = 0;
    Array.from(this.select.options).forEach((option, index) => {
      if (option.hidden || option.parentElement?.hidden) return;
      const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null;
      const text = [option.label, option.value, option.dataset.search, group?.label].join(' ');
      if (!words.every(word => normalize(text).includes(word))) return;
      if (group && group !== lastGroup) {
        container = document.createElement('div');
        container.setAttribute('role', 'group');
        container.setAttribute('aria-label', group.label);
        const heading = document.createElement('div');
        heading.className = 'searchable-select-group';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = group.label;
        container.append(heading);
        this.list.append(container);
      } else if (!group) container = this.list;
      lastGroup = group;
      const row = document.createElement('div');
      row.id = this.input.id + '-option-' + index;
      row.className = 'searchable-select-option';
      row.dataset.optionIndex = String(index);
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      row.setAttribute('aria-disabled', String(!this.enabled(index)));
      row.textContent = option.label.trim() || 'Select…';
      if (option.selected) {
        const check = document.createElement('span');
        check.className = 'searchable-select-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        row.append(check);
      }
      container.append(row);
      visible++;
      if (this.enabled(index)) this.matches.push(index);
    });
    this.highlighted = this.matches.includes(this.select.selectedIndex) ? this.select.selectedIndex : this.matches[0] ?? -1;
    this.status.textContent = this.matches.length ? this.matches.length + (this.matches.length === 1 ? ' option' : ' options') : visible ? 'No available options' : 'No matching options';
    this.highlight();
    if (this.opened) this.position();
  }

  private highlight() {
    this.list.querySelectorAll<HTMLElement>('[data-option-index]').forEach(row =>
      row.classList.toggle('is-highlighted', Number(row.dataset.optionIndex) === this.highlighted));
    if (this.highlighted < 0) this.input.removeAttribute('aria-activedescendant');
    else {
      const id = this.input.id + '-option-' + this.highlighted;
      this.input.setAttribute('aria-activedescendant', id);
      this.list.querySelector<HTMLElement>('#' + id)?.scrollIntoView({ block: 'nearest' });
    }
  }

  private choose(index: number) {
    if (this.select.matches(':disabled') || !this.enabled(index) || !this.matches.includes(index)) return;
    const changed = this.select.selectedIndex !== index;
    this.select.selectedIndex = index;
    this.invalid = false;
    this.close();
    this.refresh();
    this.input.focus();
    if (changed) {
      this.select.dispatchEvent(new Event('input', { bubbles: true }));
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private keydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.opened) { this.open(''); return; }
      const position = this.matches.indexOf(this.highlighted);
      const next = Math.max(0, Math.min(this.matches.length - 1, position + (event.key === 'ArrowDown' ? 1 : -1)));
      this.highlighted = this.matches[next] ?? -1;
      this.highlight();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!this.opened) this.open(''); else if (this.highlighted >= 0) this.choose(this.highlighted);
    } else if (event.key === 'Escape' && this.opened) {
      event.preventDefault(); event.stopPropagation(); this.close();
    } else if (event.key === 'Tab') this.close();
  };

  open(query: string) {
    if (this.select.matches(':disabled') || this.select.hidden || !eligible(this.select)) return;
    if (active && active !== this) active.close();
    active = this;
    this.query = query;
    this.opened = true;
    this.input.value = query;
    this.input.placeholder = 'Search options…';
    this.input.setAttribute('aria-expanded', 'true');
    this.wrapper.classList.add('is-open');
    this.renderOptions();
    if (!this.popup.matches(':popover-open')) this.popup.showPopover();
    this.position();
    this.highlight();
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    if (active === this) active = null;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.wrapper.classList.remove('is-open');
    if (this.popup.matches(':popover-open')) this.popup.hidePopover();
    this.input.value = this.select.selectedOptions[0]?.label.trim() || '';
    this.input.placeholder = 'Select…';
  }

  position() {
    if (!this.opened || !this.wrapper.isConnected) return;
    const anchor = this.wrapper.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || innerHeight);
    const width = Math.min(Math.max(anchor.width, 220), innerWidth - 16);
    const below = bottom - anchor.bottom - 8;
    const above = anchor.top - top - 8;
    const upwards = below < 180 && above > below;
    const height = Math.max(70, Math.min(280, upwards ? above : below));
    this.popup.style.width = width + 'px';
    this.popup.style.maxHeight = height + 'px';
    this.popup.style.left = Math.max(8, Math.min(anchor.left, innerWidth - width - 8)) + 'px';
    this.popup.style.top = (upwards ? Math.max(top + 8, anchor.top - Math.min(this.popup.scrollHeight, height) - 4) : anchor.bottom + 4) + 'px';
  }

  contains(node: Node | null) { return !!node && this.wrapper.contains(node); }
  reset() { this.invalid = false; this.close(); this.refresh(); }
  destroy() {
    if (controls.get(this.select) !== this) return;
    this.close();
    this.select.removeEventListener('focus', this.focusSource);
    this.select.removeEventListener('invalid', this.reportInvalid);
    this.input.remove(); this.toggle.remove(); this.popup.remove(); this.error.remove();
    this.select.removeAttribute('aria-hidden');
    this.select.removeAttribute('tabindex');
    this.select.classList.remove('searchable-select-native');
    delete this.wrapper.dataset.enhanced;
    controls.delete(this.select);
  }
}

export function enhanceSelect(select: HTMLSelectElement, wrapper?: HTMLElement) {
  if (controls.has(select)) return controls.get(select);
  if (!eligible(select) || typeof HTMLElement.prototype.showPopover !== 'function') return null;
  if (!wrapper) {
    wrapper = document.createElement('span');
    wrapper.className = ('searchable-select ' + select.className).trim();
    select.before(wrapper);
    wrapper.append(select);
  }
  const control = new SearchableSelect(select, wrapper);
  controls.set(select, control);
  return control;
}

/** Shared refresh for callers that change a native value without dispatching an event. */
export function refreshSearchableSelects() {
  document.querySelectorAll<HTMLSelectElement>('#app select, #dialog select').forEach(select => enhanceSelect(select, select.parentElement?.classList.contains('searchable-select') ? select.parentElement : undefined));
  for (const [select, control] of controls) select.isConnected && eligible(select) ? control.refresh() : control.destroy();
}

function scheduleRefresh() {
  if (pending) return;
  pending = true;
  // Run after the complete event dispatch, including legacy bubbling handlers that set .value.
  setTimeout(() => { pending = false; refreshSearchableSelects(); }, 0);
}

/** One adapter covers imperative dialogs, async options and existing delegated form handlers. */
export function installSearchableSelects() {
  if (installed) return;
  installed = true;
  const observer = new MutationObserver(records => {
    if (records.some(record => (record.target as Element).closest?.('select') || record.target instanceof HTMLFieldSetElement ||
      Array.from(record.addedNodes).some(node => node instanceof Element && (node.matches('select') || node.querySelector('select'))) ||
      Array.from(record.removedNodes).some(node => node instanceof Element && (node.matches('select') || node.querySelector('select'))))) scheduleRefresh();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['disabled', 'required', 'selected', 'value', 'hidden', 'label', 'data-search', 'multiple', 'size', 'aria-label', 'aria-labelledby', 'aria-describedby'] });
  for (const event of ['input', 'change', 'click']) document.addEventListener(event, scheduleRefresh, true);
  document.addEventListener('reset', event => queueMicrotask(() => {
    for (const [select, control] of controls) if (select.form === event.target) control.reset();
  }), true);
  document.addEventListener('pointerdown', event => { if (active && !active.contains(event.target as Node)) active.close(); }, true);
  document.addEventListener('scroll', () => active?.position(), true);
  window.addEventListener('resize', () => active?.position());
  window.visualViewport?.addEventListener('resize', () => active?.position());
  document.addEventListener('close', () => active?.close(), true);
  refreshSearchableSelects();
}
