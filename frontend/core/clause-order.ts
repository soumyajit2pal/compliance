const sourceNumberOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const parenthesizedRoman = /\(([ivxlcdm]+)\)/gi;
const romanNumeral = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
const romanDigits = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanNumber(numeral: string) {
  const digits = Array.from(numeral.toLowerCase(), letter => romanDigits[letter]);
  return digits.reduce((sum, digit, index) => sum + (digit < digits[index + 1] ? -digit : digit), 0);
}

/** Source numbering orders siblings; unnumbered clauses retain their automatic order. */
export function compareSourceClauses(a, b) {
  const left = String(a.source_clause_reference || '').trim();
  const right = String(b.source_clause_reference || '').trim();
  if (Boolean(left) !== Boolean(right)) return left ? -1 : 1;
  return (left && right ? sourceNumberOrder.compare(left, right) : 0) ||
    Number(a.sequence_number) - Number(b.sequence_number) || sourceNumberOrder.compare(String(a.code), String(b.code));
}

type OrderedSourceClause = {
  source_clause_reference?: string;
  sequence_number?: number;
  code: string;
};

/** Compare a single edition, using Roman order where sibling references identify Roman numbering. */
export function orderSourceEdition<T extends OrderedSourceClause>(clauses: T[]): T[] {
  const romanPrefixes = new Set<string>();
  const references = clauses.map(clause => String(clause.source_clause_reference || '').trim().toLowerCase());
  for (const reference of references) {
    for (const match of reference.matchAll(parenthesizedRoman)) {
      const numeral = match[1];
      // A single letter such as (c) could be part of an alphabetical list.
      if (numeral.length > 1 && romanNumeral.test(numeral)) romanPrefixes.add(reference.slice(0, match.index));
    }
  }
  return clauses.map((clause, index) => ({
    clause,
    source_clause_reference: references[index].replace(parenthesizedRoman, (token, numeral, offset, reference) =>
      romanPrefixes.has(reference.slice(0, offset)) && romanNumeral.test(numeral) ? `(${romanNumber(numeral)})` : token),
    sequence_number: clause.sequence_number,
    code: clause.code,
  })).sort(compareSourceClauses).map(row => row.clause);
}
