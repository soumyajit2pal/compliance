"""Recognize Oracle's equivalent equality/IN and simple CASE indexes.

Only equivalent predicates, literals, results and uniqueness are excluded from
autogenerate. Real index changes remain visible. Same pattern as the existing
Compliance by Design Oracle comparator.
"""
import re
from sqlalchemy.dialects import oracle

IDENTIFIER = r'(?:"[A-Za-z_][A-Za-z0-9_$#]*"|[A-Za-z_][A-Za-z0-9_$#]*)'
COLUMN = rf'(?:{IDENTIFIER}\.)?{IDENTIFIER}'
LITERAL = r"(?:[0-9]+|'(?:''|[^'])*')"
BRANCH = re.compile(rf'WHEN\s+(?P<literal>{LITERAL})\s+THEN\s+(?P<result>{COLUMN})',re.IGNORECASE)
SIMPLE = re.compile(rf'CASE\s+(?P<column>{COLUMN})\s+(?P<branches>(?:WHEN\s+{LITERAL}\s+THEN\s+{COLUMN}\s*)+)(?:ELSE\s+NULL\s+)?END',re.IGNORECASE)
SEARCHED = re.compile(rf'CASE\s+WHEN\s+\(?\s*(?P<column>{COLUMN})\s*=\s*(?P<literal>{LITERAL})\s*\)?\s+THEN\s+(?P<result>{COLUMN})(?:\s+ELSE\s+NULL)?\s+END', re.IGNORECASE)
IN_CASE = re.compile(rf'CASE\s+WHEN\s+(?P<predicate>.+?)\s+THEN\s+(?P<result>{COLUMN})(?:\s+ELSE\s+NULL)?\s+END',re.IGNORECASE)
IN_PREDICATE = re.compile(rf'(?P<column>{COLUMN})\s+IN\s*\(\s*(?P<values>{LITERAL}(?:\s*,\s*{LITERAL})*)\s*\)',re.IGNORECASE)


def _column(value):
    name = value.rsplit('.', 1)[-1]
    return name[1:-1] if name.startswith('"') else name.upper()


def _signature(expression):
    sql = str(expression.compile(dialect=oracle.dialect(), compile_kwargs={'literal_binds': True})).strip()
    normal=lambda value:value if value.startswith("'") else str(int(value))
    match=SIMPLE.fullmatch(sql)
    if match:
        branches=list(BRANCH.finditer(match['branches']))
        results={_column(branch['result']) for branch in branches}
        if len(results)!=1:return None
        return (_column(match['column']),tuple(sorted({normal(branch['literal']) for branch in branches})),results.pop())
    match=SEARCHED.fullmatch(sql)
    if match:return (_column(match['column']),(normal(match['literal']),),_column(match['result']))
    match=IN_CASE.fullmatch(sql)
    if not match:return None
    predicate=match['predicate'].strip()
    if predicate.startswith('(') and predicate.endswith(')'):predicate=predicate[1:-1].strip()
    values=IN_PREDICATE.fullmatch(predicate)
    if not values:return None
    return (_column(values['column']),tuple(sorted({normal(value.group()) for value in re.finditer(LITERAL,values['values'])})),_column(match['result']))


def equivalent_case_indexes(left, right):
    if left.name != right.name or left.unique != right.unique or not left.expressions or len(left.expressions)!=len(right.expressions):
        return False
    pairs=[(_signature(a),_signature(b)) for a,b in zip(left.expressions,right.expressions)]
    return all(a is not None and a==b for a,b in pairs)
