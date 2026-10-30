/** Shared indexes for master trees and parent choices; API validation remains authoritative. */
export function childIndex(rows: Record<string, any>[], parentField: string) {
  const children = new Map<string | null, Record<string, any>[]>();
  for (const row of rows) {
    const parent = row[parentField] || null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  }
  return children;
}

export function subtreeIds(rows: Record<string, any>[], parentField: string, root: string) {
  const children = childIndex(rows, parentField), found = new Set<string>();
  const pending = root ? [root] : [];
  while (pending.length) {
    const id = pending.pop();
    if (found.has(id)) continue;
    found.add(id);
    pending.push(...(children.get(id) || []).map(row => row.id));
  }
  return found;
}
