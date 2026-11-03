import { state } from '../../core/state.ts';
import { esc, ref, date, title, link } from '../../ui/components.ts';
import { sourceDocumentActions } from '../../ui/source-document.ts';

export function renderInstrumentMateriality(value) {
  return '<span class="record-materiality ' + esc(String(value || '').toLowerCase()) + '"><span class="materiality-marker" aria-hidden="true"></span>' + esc(title(value || 'Not set')) + '</span>';
}

/** One metadata renderer for the full instrument and its read-only library preview. */
export function renderInstrumentSummary(record, edition) {
  const i = record.instrument, secondary = record.secondary_domains || [], documents = record.source_documents || {};
  const regulator = state.masters?.regulator?.find(row => row.id === i.regulator_id);
  const regulatorName = regulator
    ? (regulator.code ? esc(regulator.code) + ' — ' : '') + esc(regulator.name)
    : esc(ref('regulator', i.regulator_id));
  const row = (key, label, value) =>
    '<div class="record-summary-row" data-summary-field="' + key + '"><dt>' + label + '</dt><dd>' + (value || '—') + '</dd></div>';
  const source = edition?.source_document_id
    ? sourceDocumentActions(edition.source_document_id,documents[edition.source_document_id] || i.title || 'Source document')
    : '<span class="record-unlinked">Not recorded</span>';
  return '<section class="record-summary-card" aria-label="Instrument details"><div class="record-summary-grid"><dl class="record-summary-column">' +
    row('regulator','Regulator',regulatorName) +
    row('type','Type',esc(ref('instrument_type',i.instrument_type_id))) +
    row('primary-domain','Primary domain',esc(ref('regulatory_domain',i.primary_domain_id))) +
    row('other-domains','Other domains',secondary.length ? secondary.map(domain=>esc(domain.name)).join(', ') : '—') +
    row('reference','Official reference',esc(i.official_reference_number || '—')) +
    (i.legacy_codes?.length ? row('legacy-references','Legacy references',i.legacy_codes.map(esc).join(', ')) : '') +
    row('materiality','Materiality',renderInstrumentMateriality(i.materiality)) +
    '</dl><dl class="record-summary-column">' +
    row('issue-date','Issue date',esc(date(i.issue_date))) +
    row('effective-date','Effective date',esc(date(i.effective_date))) +
    row('department','Lead regulatory department',esc(ref('organisational_unit',i.regulatory_owner_unit_id))) +
    row('owner','Interpretation owner',esc(ref('user',i.interpretation_owner_user_id))) +
    row('source','Source document',source) +
    row('keywords','Keywords',esc(i.keywords || '—')) +
    row('family','Notification family',link('notification-families/'+i.id,'Open notification family','text-link')) +
    '</dl></div></section>';
}
