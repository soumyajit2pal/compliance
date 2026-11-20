"""Business-facing option lists. Technical pickers stay in the build inventory."""
from typing import NamedTuple


class BusinessField(NamedTuple):
    label: str
    forms: tuple[str, ...]
    source: str | None = None
    fixed: tuple[str, ...] = ()


BUSINESS_FIELDS = {
    'category_id': BusinessField('Category', ('Obligation',), 'obligation_category'),
    'obligation_nature': BusinessField('Nature of the requirement', ('Obligation',), 'obligation_nature'),
    'frequency_id': BusinessField('Review / execution frequency', ('Obligation', 'Check or procedure'), 'frequency'),
    'primary_domain_id': BusinessField('Regulatory domain', ('Obligation', 'Regulatory instrument'), 'regulatory_domain'),
    'regulator_id': BusinessField('Regulator', ('Regulatory instrument',), 'regulator'),
    'instrument_type_id': BusinessField('Instrument type', ('Regulatory instrument',), 'instrument_type'),
    'confidentiality_class_id': BusinessField('Confidentiality', ('Regulatory instrument', 'Evidence'), 'confidentiality_class'),
    'evidence_type_id': BusinessField('Evidence type', ('Check or procedure', 'Compliance work assignment'), 'evidence_type'),
    'control_type': BusinessField('Check type', ('Check or procedure',), 'control_type'),
    'execution_mode': BusinessField('Operation', ('Check or procedure',), 'execution_mode'),
    'system_id': BusinessField('Related system', ('Check or procedure',), 'system'),
    'legal_entity_id': BusinessField('Legal entity', ('Obligation applicability',), 'legal_entity'),
    'product_id': BusinessField('Product', ('Obligation applicability',), 'product'),
    'channel_id': BusinessField('Channel', ('Obligation applicability', 'Product'), 'channel'),
    'customer_segment_id': BusinessField('Customer segment', ('Obligation applicability', 'Product'), 'customer_segment'),
    'geography_id': BusinessField('Geography', ('Obligation applicability',), 'geography'),
    'process_id': BusinessField('Process', ('Obligation applicability', 'Obligation process mapping'), 'process'),
    'materiality': BusinessField('Materiality', ('Regulatory instrument',), fixed=('CRITICAL','HIGH','MEDIUM','LOW')),
    'criticality': BusinessField('Criticality', ('Obligation','Process'), fixed=('CRITICAL','HIGH','MEDIUM','LOW')),
    'coverage_type': BusinessField('Coverage', ('Obligation link',), fixed=('FULL','PARTIAL','COMPENSATING')),
    'applicability_status': BusinessField('Applicability', ('Obligation applicability',), fixed=('APPLICABLE','PARTIALLY_APPLICABLE','NOT_APPLICABLE')),
    'relevance_type': BusinessField('How this process relates to the obligation', ('Obligation process mapping',), fixed=('PRIMARY','DIRECT','INDIRECT','SUPPORTING')),
    'priority': BusinessField('Priority', ('Compliance work assignment',), fixed=('CRITICAL','HIGH','MEDIUM','LOW')),
    'action_type': BusinessField('Type of work', ('Compliance work assignment',), fixed=('IMPLEMENTATION','PERIODIC_REVIEW','CORRECTIVE','FOLLOW_UP')),
}
BUSINESS_MASTERS = frozenset(field.source for field in BUSINESS_FIELDS.values() if field.source)
