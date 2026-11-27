export type ColumnFilter = { value: string } | { values: string[] };
export type ColumnFilters = Record<string, ColumnFilter>;
export interface ColumnChoice { value: string; label: string; }

export function tableColumns(headers: string[], keys: Array<string | null> = []) {
  const used = new Set<string>();
  return headers.map((header, index) => {
    const label = header.trim() || 'Actions';
    const base = keys[index] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'column';
    let key = base;
    while (used.has(key)) key += '_' + (index + 1);
    used.add(key);
    return {key, label};
  });
}

const textPrefix = (table: string) => 'col.' + table + '.';
const choicePrefix = (table: string) => 'choice.' + table + '.';
export const isColumnFilterParam = (key: string) => key.startsWith('col.') || key.startsWith('choice.');

export function readColumnFilters(query: URLSearchParams, table: string): ColumnFilters {
  const result: ColumnFilters = Object.create(null);
  for (const [key, value] of query) {
    if (key.startsWith(textPrefix(table)) && value.trim()) {
      result[key.slice(textPrefix(table).length)] = {value: value.trim().slice(0, 160)};
    }
  }
  const selections = new Map<string, Set<string>>();
  for (const [key, value] of query) {
    if (key.startsWith(choicePrefix(table)) && value.trim()) {
      const column = key.slice(choicePrefix(table).length);
      const values = selections.get(column) ?? new Set<string>();
      values.add(value);
      selections.set(column, values);
    }
  }
  for (const [column, values] of selections) result[column] = {values: [...values]};
  return result;
}

export function writeColumnFilters(query: URLSearchParams, table: string, filters: ColumnFilters) {
  for (const key of [...query.keys()]) {
    if (key.startsWith(textPrefix(table)) || key.startsWith(choicePrefix(table))) query.delete(key);
  }
  for (const [column, filter] of Object.entries(filters)) {
    if ('values' in filter) {
      for (const value of filter.values) query.append(choicePrefix(table) + column, value);
    } else {
      query.set(textPrefix(table) + column, filter.value);
    }
  }
}

export function apiColumnFilters(request: URLSearchParams, query: URLSearchParams, table: string) {
  const filters = Object.entries(readColumnFilters(query, table))
    .map(([key, filter]) => [key, 'values' in filter
      ? {equals: filter.values.length === 1 ? filter.values[0] : filter.values}
      : filter.value]);
  if (filters.length) request.set('columns', JSON.stringify(Object.fromEntries(filters)));
}

export function matchesCell(text: string, filter: ColumnFilter) {
  const value = normalizedCell(text);
  return 'values' in filter
    ? filter.values.some(selection => normalizedCell(selection) === value)
    : value.includes(normalizedCell(filter.value));
}

export function normalizedCell(value: string) {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}
