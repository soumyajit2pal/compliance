const sourceNumberOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Source numbering orders siblings; unnumbered clauses retain their automatic order. */
export function compareSourceClauses(a, b) {
  const left = String(a.source_clause_reference || '').trim();
  const right = String(b.source_clause_reference || '').trim();
  if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
  return (left && right ? sourceNumberOrder.compare(left, right) : 0) ||
    Number(a.sequence_number) - Number(b.sequence_number) || sourceNumberOrder.compare(String(a.code), String(b.code));
}
