import { useEffect, useId, useState } from 'react';
import { api } from '../../core/api.ts';
import { selectedDelegationId } from '../../core/delegation-context.ts';
import { state, type PortalIdentity } from '../../core/state.ts';
import { normalizedCell, type ColumnChoice, type ColumnFilters } from '../../core/table-filters.ts';
import { icon } from '../../ui/icons.ts';

type Labels = Map<string, Map<string, string>>;
type LabelMemory = { scope: string; labels: Labels };
// Keep selected labels across server page remounts within the same signed-in search scope.
const labelMemory = new WeakMap<PortalIdentity, Map<string, LabelMemory>>();
const serverChipExpansions = new WeakMap<PortalIdentity, Map<string, Set<string>>>();
const CHIP_PREVIEW_LIMIT = 3;

function labelsFor(identity: PortalIdentity, requestUrl: string, remember: boolean): Labels {
  if (!identity || !requestUrl) return new Map();
  const [path, query] = requestUrl.split('?');
  const params = new URLSearchParams(query);
  for (const key of ['columns', 'page', 'page_size', 'older', 'newer', 'through']) params.delete(key);
  params.sort();
  const key = JSON.stringify([selectedDelegationId(), path]);
  let tables = labelMemory.get(identity);
  const saved = tables?.get(key);
  const scope = params.toString();
  if (saved?.scope === scope) return saved.labels;

  const labels: Labels = new Map();
  if (remember) {
    if (!tables) labelMemory.set(identity, tables = new Map());
    tables.set(key, {scope, labels});
  }
  return labels;
}

export function rememberColumnChoices(requestUrl: string, column: string, values: string[], choices: ColumnChoice[] = []) {
  if (!requestUrl) return;
  const labels = labelsFor(state.identity, requestUrl, true);
  const known = new Map(labels.get(column));
  for (const {value, label} of choices) known.set(value, label);
  const applied = new Map<string, string>();
  for (const value of values) {
    const label = known.get(value);
    if (label !== undefined) applied.set(value, label);
  }
  labels.set(column, applied);
}

export function AppliedColumnFilters({pageKey, columns, filters, cells, requestUrl, disabled, remove, clearAll}: {
  pageKey: string;
  columns: {key: string; label: string}[];
  filters: ColumnFilters;
  cells?: string[][];
  requestUrl?: string;
  disabled: boolean;
  remove: (column: string, value?: string) => void;
  clearAll: () => void;
}) {
  const identity = state.identity;
  const delegationId = selectedDelegationId();
  const listId = useId();
  const scope = JSON.stringify([delegationId, location.hash.split('?')[0], pageKey]);
  const [expandedColumns, setExpandedColumns] = useState(() =>
    (requestUrl && identity ? serverChipExpansions.get(identity)?.get(scope) : undefined) ?? new Set<string>());
  const [labels, setLabels] = useState(() => labelsFor(identity, requestUrl, false));

  const updateExpansion = (expanded: Set<string>) => {
    setExpandedColumns(expanded);
    // Retain open groups while a server table reloads after removing a chip.
    if (!requestUrl || !identity) return;
    let tables = serverChipExpansions.get(identity);
    if (!tables) serverChipExpansions.set(identity, tables = new Map());
    if (expanded.size) tables.set(scope, expanded);
    else tables.delete(scope);
  };

  const setColumnExpanded = (column: string, expanded: boolean) => {
    const next = new Set(expandedColumns);
    if (expanded) next.add(column);
    else next.delete(column);
    updateExpansion(next);
  };

  useEffect(() => {
    if (!requestUrl) return;
    const remembered = labelsFor(identity, requestUrl, false);
    const missing = Object.entries(filters).flatMap(([column, filter]) => {
      if (!('values' in filter)) return [];
      const values = filter.values.filter(value => !remembered.get(column)?.has(value));
      return values.length ? [{column, values: new Set(values)}] : [];
    });
    if (!missing.length) return;

    let current = true;
    // Shared links contain exact-match keys. Resolve them using the same scoped choices as the dropdown.
    void Promise.allSettled(missing.map(async ({column, values}) => {
      const result = await api<{options: ColumnChoice[]}>(requestUrl + '&options_for=' + encodeURIComponent(column));
      return {column, choices: result.options.filter(choice => values.has(choice.value))};
    })).then(results => {
      if (!current || state.identity !== identity || selectedDelegationId() !== delegationId) return;
      const labels = labelsFor(identity, requestUrl, true);
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const {column, choices} = result.value;
        const known = new Map(labels.get(column));
        for (const {value, label} of choices) known.set(value, label);
        labels.set(column, known);
      }
      setLabels(new Map(labels));
    });
    return () => { current = false; };
  }, [filters, requestUrl, identity, delegationId]);

  const groups = columns.map(({key, label}, columnIndex) => {
    const filter = filters[key];
    if (!filter) return null;
    const values = 'values' in filter ? filter.values : [filter.value];
    const expanded = expandedColumns.has(key);
    const extraCount = values.length - CHIP_PREVIEW_LIMIT;
    const visibleValues = expanded ? values : values.slice(0, CHIP_PREVIEW_LIMIT);
    const selected = new Set(visibleValues);
    const localLabels = new Map<string, string>();
    if (cells && 'values' in filter) {
      for (const row of cells) {
        const text = row[columnIndex] || '—';
        const value = normalizedCell(text);
        if (selected.has(value) && !localLabels.has(value)) localLabels.set(value, text);
        if (localLabels.size === selected.size) break;
      }
    }
    const chips = visibleValues.map((value, index) => {
      const display = 'values' in filter
        ? localLabels.get(value) ?? labels.get(key)?.get(value) ??
          (value.startsWith('sha256:') ? 'Unavailable value ' + (index + 1) : value)
        : value;
      return <li key={value} className="column-filter-chip">
        <span className="column-filter-chip-label">{display}</span>
        <button type="button" aria-label={`Remove ${label} filter for ${display}`} disabled={disabled}
          onClick={() => {
            if (expanded && values.length - 1 <= CHIP_PREVIEW_LIMIT) setColumnExpanded(key, false);
            remove(key, value);
          }} dangerouslySetInnerHTML={{__html: icon('x')}} />
      </li>;
    });
    const chipsId = listId + '-' + key;
    const toggleLabel = expanded ? 'Show less' : '+' + extraCount + ' more';
    return <div className="column-filter-group" key={key}>
      <div className="column-filter-group-heading">
        <strong className="column-filter-group-label">{label}</strong>
        <button type="button" className="btn small column-filter-group-clear" disabled={disabled}
          aria-label={`Clear ${label} filter`} onClick={() => {
            if (expanded) setColumnExpanded(key, false);
            remove(key);
          }}>Clear</button>
      </div>
      <ul id={chipsId} className="column-filter-chips" role="list" aria-label={label}>
        {chips.slice(0, CHIP_PREVIEW_LIMIT)}
        {extraCount > 0 && <li role="presentation">
          <button type="button" className="btn small column-filter-chip-toggle" aria-expanded={expanded}
            aria-controls={chipsId} aria-label={toggleLabel + ' for ' + label}
            onClick={() => setColumnExpanded(key, !expanded)}>{toggleLabel}</button>
        </li>}
        {chips.slice(CHIP_PREVIEW_LIMIT)}
      </ul>
    </div>;
  });

  return <div className="applied-column-filters" role="group" aria-label="Applied column filters">
    <button type="button" className="btn small clear-column-filters" disabled={disabled} onClick={() => {
      updateExpansion(new Set());
      clearAll();
    }}>Clear all</button>
    <div className="column-filter-groups">{groups}</div>
  </div>;
}
