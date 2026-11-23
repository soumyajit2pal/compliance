import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../core/api.ts';
import { normalizedCell, type ColumnChoice, type ColumnFilter } from '../../core/table-filters.ts';
import { icon } from '../../ui/icons.ts';

export function ColumnFilterTrigger({ label, applied, expanded, popupId, disabled, open }: {
  label: string; applied: boolean; expanded: boolean; popupId: string; disabled: boolean;
  open: (anchor: HTMLButtonElement) => void;
}) {
  const name = 'Filter ' + label + (applied ? ' (applied)' : '');
  return <button type="button" className="column-filter-trigger" title={name} aria-label={name}
    aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? popupId : undefined}
    data-filtered={applied || undefined} disabled={disabled} onClick={event => open(event.currentTarget)}
    dangerouslySetInnerHTML={{__html: icon('filter')}} />;
}

export function ColumnFilterPopup({ id, label, anchor, filter, options, requestUrl, close, apply }: {
  id: string; label: string; anchor: HTMLButtonElement; filter?: ColumnFilter;
  options: ColumnChoice[]; requestUrl?: string; close: () => void; apply: (values: string[], choices: ColumnChoice[]) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(() => new Set(filter && 'values' in filter ? filter.values : []));
  const [remote, setRemote] = useState<ColumnChoice[]>();
  const [error, setError] = useState('');
  const choices = requestUrl ? remote || [] : options;
  const loading = Boolean(requestUrl && !remote && !error);
  const query = normalizedCell(search);
  const visibleChoices = choicesWithSavedValues(choices, draft).filter(({label}) => normalizedCell(label).includes(query));
  const allVisibleSelected = visibleChoices.length > 0 && visibleChoices.every(({value}) => draft.has(value));
  const someVisibleSelected = visibleChoices.some(({value}) => draft.has(value));
  const allChoicesSelected = choices.length > 0 && choices.every(({value}) => draft.has(value));

  const setSelected = (values: string[], checked: boolean) => {
    setDraft(current => {
      const next = new Set(current);
      for (const value of values) {
        if (checked) next.add(value);
        else next.delete(value);
      }
      return next;
    });
  };

  useLayoutEffect(() => {
    selectAll.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);
  useEffect(() => {
    if (!requestUrl) return;
    let current = true;
    void api<{options: ColumnChoice[]}>(requestUrl).then(result => {
      if (!Array.isArray(result.options)) throw new Error('Could not load filter options.');
      if (current) setRemote(result.options);
    }).catch(error => {
      if (current) setError(error.message || 'Could not load filter options.');
    });
    return () => { current = false; };
  }, [requestUrl]);
  const native = typeof HTMLElement.prototype.showPopover === 'function';
  useLayoutEffect(() => {
    const popup = panel.current;
    if (native) popup.showPopover();
    const position = () => {
      const bounds = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const height = viewport?.height ?? innerHeight;
      popup.style.maxHeight = Math.max(0, height - 16) + 'px';
      const { width, height: panelHeight } = popup.getBoundingClientRect();
      const below = bounds.bottom + 6;
      const above = bounds.top - panelHeight - 6;
      const preferred = below + panelHeight <= top + height - 8 ? below : above;
      popup.style.top = Math.max(top + 8, Math.min(preferred, top + height - panelHeight - 8)) + 'px';
      popup.style.left = Math.max(8, Math.min(bounds.left, innerWidth - width - 8)) + 'px';
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.contains(event.target) && !anchor.contains(event.target)) close();
    };
    position();
    popup.focus({preventScroll: true});
    const observer = new ResizeObserver(position);
    observer.observe(popup);
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    window.visualViewport?.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position);
      if (native && popup.matches(':popover-open')) popup.hidePopover();
    };
  }, [anchor, native, close]);

  return <div id={id} ref={panel} className="column-filter-popup" popover={native ? 'manual' : undefined}
    role="dialog" tabIndex={-1} aria-label={'Filter ' + label} onKeyDown={event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        anchor.focus({preventScroll: true});
      }
    }}>
    <div className="column-filter-summary">
      <strong id={id + '-label'}>{label}</strong>
      <span role="status">{draft.size} selected</span>
    </div>
    <input type="search" className="column-filter-search" aria-label="Search values" placeholder="Search values…"
      value={search} onChange={event => {
        setSearch(event.target.value);
        if (list.current) list.current.scrollTop = 0;
      }}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
    <label className="column-filter-check column-filter-select-all">
      <input ref={selectAll} type="checkbox" checked={allVisibleSelected} disabled={loading || !visibleChoices.length}
        onChange={event => setSelected(visibleChoices.map(({value}) => value), event.currentTarget.checked)} />
      <span>{query ? 'Select all matches' : 'Select all'}</span>
    </label>
    {loading && <p role="status">Loading options…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !visibleChoices.length && <p role="status">No matching values</p>}
    {!loading && visibleChoices.length > 0 && <div ref={list} className="column-filter-options" role="group" aria-labelledby={id + '-label'}>
      {visibleChoices.map(({value, label}) => <label key={value} className="column-filter-check">
        <input type="checkbox" checked={draft.has(value)} onChange={event => setSelected([value], event.currentTarget.checked)} />
        <span>{label}</span>
      </label>)}
    </div>}
    <div className="actions">
      <button type="button" className="btn small" disabled={!filter && !draft.size} onClick={() => apply([], [])}>Clear</button>
      <button type="button" className="btn small primary" disabled={loading || (!filter && !draft.size)}
        onClick={() => apply(allChoicesSelected ? [] : [...draft], allChoicesSelected ? [] : choices.filter(choice => draft.has(choice.value)))}>
        Apply
      </button>
    </div>
  </div>;
}

function choicesWithSavedValues(choices: ColumnChoice[], selected: Set<string>) {
  const known = new Set(choices.map(choice => choice.value));
  const saved = [...selected].filter(value => !known.has(value))
    .map((value, index) => ({value, label: value.startsWith('sha256:') ? 'Unavailable value ' + (index + 1) : value}));
  return [...choices, ...saved];
}
