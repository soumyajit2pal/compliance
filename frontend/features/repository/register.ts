import { state } from '../../core/state.ts';
import { has } from '../../core/access.ts';
import {
  esc,
  badge,
  title,
  field,
  input,
  select,
  fixedSelect,
  link,
  versionLabel,
} from '../../ui/components.ts';
import { icon } from '../../ui/icons.ts';
import { heading, pageHelp } from '../../ui/layout.ts';
import { table, tablePanel, recordCell } from '../../ui/widgets.ts';
export function renderRegister(rows, q) {
  const statusCell = (record) => {
    const position = record.regulatory_status;
    const status = ['CURRENT', 'SUPERSEDED', 'WITHDRAWN'].includes(position)
      ? position
      : record.approval_status || position;
    return badge(status) + (status === 'APPROVED' && !record.current_version_id ? '<small>Not current</small>' : '');
  };
  const selectedDomain = q.get('domain_id') || q.get('primary_domain_id') || '';
  const moreFilterKeys = ['regulator_id', 'instrument_type_id', 'approval_status', 'interpretation_owner_user_id', 'from_date', 'to_date'];
  const activeMoreFilters = moreFilterKeys.filter((key) => q.get(key)).length;
  return (
    pageHelp(
      'Your regulatory repository',
      'Find an issued notification and open its authoritative source, source editions, clauses / paras and review history.',
    ) +
    heading(
      'Regulatory repository',
      'Each notification has one record, may affect multiple domains, and retains its source editions, clauses / paras and independent review.',
      has('AUTHOR')
        ? '<a class="btn primary" href="#repository/new">' + icon('plus') + 'New instrument</a>'
        : '',
    ) +
    `<form id="filters">
      <div class="filters">
        <div class="search-field">${icon('search')}${input('q', q.get('q') || '', 'search', 'placeholder="Search title, official reference number or keyword…" aria-label="Search regulatory repository"')}</div>
        <select class="filter-select" name="domain_id" aria-label="Affected domain"><option value="">All domains</option>${state.masters.regulatory_domain.map((d) => `<option value="${d.id}" ${selectedDomain === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        <select class="filter-select" name="regulatory_owner_unit_id" aria-label="Department"><option value="">All departments</option>${state.masters.organisational_unit.map((unit) => `<option value="${unit.id}" ${q.get('regulatory_owner_unit_id') === unit.id ? 'selected' : ''}>${esc(unit.name)}</option>`).join('')}</select>
        <select class="filter-select" name="materiality" aria-label="Materiality"><option value="">All materialities</option>${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((value) => `<option value="${value}" ${q.get('materiality') === value ? 'selected' : ''}>${esc(title(value))}</option>`).join('')}</select>
        <select class="filter-select" name="regulatory_status" aria-label="Status"><option value="">All statuses</option>${['DRAFT', 'CURRENT', 'SUPERSEDED', 'WITHDRAWN'].map((status) => `<option value="${status}" ${q.get('regulatory_status') === status ? 'selected' : ''}>${esc(title(status))}</option>`).join('')}</select>
        <button class="btn small primary search-submit" type="submit">Search</button>
        ${q.toString() ? link('repository', 'Clear filters', 'btn small') : ''}
      </div>
      <details class="filter-more">
        <summary aria-controls="repository-more-filters">${icon('filter')}More filters${activeMoreFilters ? `<span class="count-bubble" aria-label="${activeMoreFilters} active additional filters">${activeMoreFilters}</span>` : ''}${icon('down')}</summary>
        <section id="repository-more-filters" class="filter-more-panel" aria-labelledby="repository-more-filters-heading">
          <div class="filter-more-head">
            <div><h2 id="repository-more-filters-heading">More filters</h2><p>Choose filters, then apply to update results.</p></div>
            <button class="icon-button" type="button" data-action="close-repository-filters" aria-label="Close filters" title="Close filters">${icon('x')}</button>
          </div>
          <div class="filter-more-fields">
          <div class="form-grid">
            ${field('Regulator', select('regulator_id', state.masters.regulator, q.get('regulator_id')))}
            ${field('Instrument type', select('instrument_type_id', state.masters.instrument_type, q.get('instrument_type_id')))}
            ${field('Approval status', fixedSelect('approval_status', ['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN'], q.get('approval_status')))}
            ${field('Interpretation owner', select('interpretation_owner_user_id', state.masters.user, q.get('interpretation_owner_user_id'), 'full_name'))}
            ${field('Issued from', input('from_date', q.get('from_date') || '', 'date'))}
            ${field('Issued to', input('to_date', q.get('to_date') || '', 'date'))}
          </div>
          </div>
          <div class="filter-more-footer"><button class="text-link filter-more-clear" type="button" data-action="clear-repository-filters">Clear filters</button><div class="actions"><button class="btn" type="button" data-action="close-repository-filters">Close</button><button class="btn primary" type="submit">Apply filters</button></div></div>
        </section>
      </details>
    </form>` +
    tablePanel(
      table(
        [
          'Instrument',
          'Official reference number',
          'Regulator / domain',
          'Current version',
          'Materiality',
          'Status',
        ],
        rows.map((r) => [
          recordCell(r.code, r.title, 'repository/' + r.id),
          esc(r.official_reference_number || 'Not provided by regulator'),
          esc(r.regulator_name) + '<small>' + esc(r.domain_name) + '</small>' +
            (r.secondary_domain_names?.length
              ? '<small>Also: ' + esc(r.secondary_domain_names.join(', ')) + '</small>'
              : ''),
          r.current_version_number
            ? `<span class="current-version">${esc(versionLabel(r.current_version_number))}</span>`
            : '—',
          `<span class="risk ${esc(String(r.materiality || '').toLowerCase())}"><i aria-hidden="true"></i>${esc(title(r.materiality))}</span>`,
          statusCell(r)+'<br>'+link('notification-families/'+r.id,'Open notification family','text-link'),
        ]),
        { caption: 'Authorised regulatory notifications' },
      ),
    ) +
    `<div class="source-note">A source edition is a version of one library record. Original source wording and the bank’s interpretation are preserved separately.</div>`
  );
}
