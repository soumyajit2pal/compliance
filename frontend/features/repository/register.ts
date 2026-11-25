import { referenceSelect } from '../../ui/reference-options.ts';
import { has } from '../../core/access.ts';
import {
  esc,
  badge,
  title,
  field,
  input,
  fixedSelect,
  link,
  versionLabel,
} from '../../ui/components.ts';
import { icon } from '../../ui/icons.ts';
import { heading, pageHelp } from '../../ui/layout.ts';
import { table, tablePanel, recordCell } from '../../ui/widgets.ts';
import { withoutPaging } from '../../core/pagination.ts';
import { instrumentWorkspacePath } from '../../core/source-navigation.ts';
import { dashboardTiles } from '../../ui/dashboard.ts';

const libraryStages=[
  ['current','Current instruments','book','Instruments marked current in the regulatory library.'],
  ['draft','Draft instruments','pen','Draft instruments that are still being prepared for review.'],
  ['in_review','In review','eye','Instruments submitted for review that are awaiting a reviewer’s decision.'],
  ['awaiting_approval','Awaiting final approval','shield','Instruments that have completed review and are waiting for a final decision.'],
  ['retained','Other instruments','folder','Instruments outside the current and preparation stages, including superseded and withdrawn records.'],
];

const editionDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
});

function versionCell(record) {
  if (record.current_version_number) {
    return `<span class="current-version">${esc(versionLabel(record.current_version_number))}</span>`;
  }
  const edition = record.approved_edition;
  if (!edition) return '—';
  return `<div class="library-approved-edition">
    <span class="current-version">${esc(versionLabel(edition.version_number))}</span>
    ${edition.upcoming ? ' · ' + badge('UPCOMING') : ''}
    <small>Effective ${esc(editionDate.format(new Date(edition.effective_from)))}</small>
  </div>`;
}

function libraryTiles(counts:Record<string,number>|undefined, query:URLSearchParams) {
  if(!counts)return '';
  return dashboardTiles('Regulatory library stages',libraryStages.map(([key,title,symbol,explanation])=>{
    const next=withoutPaging(query);
    const selected=next.get('library_stage')===key;
    if(selected)next.delete('library_stage');
    else next.set('library_stage',key);
    return {title,symbol,explanation,count:counts[key]||0,href:'repository'+(next.size?'?'+next:''),selected,
      description:selected?'Clear stage filter':'View instruments'};
  }));
}

export function renderRegister(rows, q, pagination = undefined, counts = undefined, columnOptionsUrl = '') {
  const statusCell = (record) => {
    const position = record.regulatory_status;
    const status = ['CURRENT', 'SUPERSEDED', 'WITHDRAWN'].includes(position)
      ? position
      : record.approval_status || position;
    return badge(status) + (status === 'APPROVED' && !record.current_version_id
      ? `<div class="library-secondary-status">${badge('NOT_CURRENT')}</div>` : '');
  };
  const selectedDomain = q.get('domain_id') || q.get('primary_domain_id') || '';
  const moreFilterKeys = ['regulator_id', 'instrument_type_id', 'approval_status', 'interpretation_owner_user_id', 'from_date', 'to_date'];
  const activeMoreFilters = moreFilterKeys.filter((key) => q.get(key)).length;
  return (
    pageHelp(
      'Your regulatory repository',
      'Select Quick view for a summary, Open Notification for the full record, or Open notification family for related notifications.',
      'regulatory-sources',
    ) +
    heading(
      'Regulatory repository',
      'Each notification has one record, may affect multiple domains, and retains its source editions, Clauses / Para and independent review.',
      has('AUTHOR')
        ? '<a class="btn primary" href="#repository/new">' + icon('plus') + 'New instrument</a>'
        : '',
    ) +
    libraryTiles(counts,q)+
    `<form id="filters">
      ${q.get('library_stage')?input('library_stage',q.get('library_stage'),'hidden'):''}
      <div class="filters">
        <div class="search-field">${icon('search')}${input('q', q.get('q') || '', 'search', 'placeholder="Search title, official reference number or keyword…" aria-label="Search regulatory repository"')}</div>
        ${referenceSelect('domain_id','regulatory_domain',selectedDomain||'','class="filter-select" aria-label="Affected domain"','All domains',{historical:true})}
        ${referenceSelect('regulatory_owner_unit_id','organisational_unit',q.get('regulatory_owner_unit_id')||'','class="filter-select" aria-label="Department"','All departments',{historical:true})}
        <select class="filter-select" name="materiality" aria-label="Materiality"><option value="">All materialities</option>${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((value) => `<option value="${value}" ${q.get('materiality') === value ? 'selected' : ''}>${esc(title(value))}</option>`).join('')}</select>
        <select class="filter-select" name="regulatory_status" aria-label="Status"><option value="">All statuses</option>${['DRAFT', 'CURRENT', 'SUPERSEDED', 'WITHDRAWN'].map((status) => `<option value="${status}" ${q.get('regulatory_status') === status ? 'selected' : ''}>${esc(title(status))}</option>`).join('')}</select>
        <button class="btn small primary search-submit" type="submit">Search</button>
        ${withoutPaging(q).toString() ? link('repository', 'Clear filters', 'btn small') : ''}
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
            ${field('Regulator', referenceSelect('regulator_id','regulator',q.get('regulator_id')||'','',undefined,{historical:true}))}
            ${field('Instrument type', referenceSelect('instrument_type_id','instrument_type',q.get('instrument_type_id')||'','',undefined,{historical:true}))}
            ${field('Approval status', fixedSelect('approval_status', ['DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED', 'WITHDRAWN'], q.get('approval_status')))}
            ${field('Interpretation owner', referenceSelect('interpretation_owner_user_id','user',q.get('interpretation_owner_user_id')||'','',undefined,{label:'full_name',historical:true}))}
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
        rows.map((r) => {
          const notificationPath = instrumentWorkspacePath(r.id);
          return [
            '<div class="library-instrument-cell">' +
              recordCell(r.code, r.title, notificationPath, '', 'data-instrument-preview="' + esc(r.id) + '" aria-haspopup="dialog" aria-expanded="false" aria-controls="instrument-quick-view"') +
              '<button type="button" class="btn small library-quick-view-trigger" data-instrument-preview="' + esc(r.id) + '" aria-label="Quick view: ' + esc(r.title) + '" aria-haspopup="dialog" aria-expanded="false" aria-controls="instrument-quick-view">' + icon('eye') + 'Quick view</button></div>',
            esc(r.official_reference_number || 'Not provided by regulator'),
            esc(r.regulator_name) + '<small>' + esc(r.domain_name) + '</small>' +
              (r.secondary_domain_names?.length
                ? '<small>Also: ' + esc(r.secondary_domain_names.join(', ')) + '</small>'
                : ''),
            versionCell(r),
            `<span class="risk ${esc(String(r.materiality || '').toLowerCase())}"><i aria-hidden="true"></i>${esc(title(r.materiality))}</span>`,
            `${statusCell(r)}<div class="library-record-links">
              <a class="text-link" href="#${esc(notificationPath)}" data-library-record="${esc(r.id)}">Open Notification</a>
              ${link('notification-families/' + encodeURIComponent(r.id), 'Open notification family', 'text-link')}
            </div>`,
          ];
        }),
        { caption: 'Authorised regulatory notifications', pageKey: 'instruments', pagination, columnOptionsUrl },
      ),
    ) +
    `<div class="source-note">A source edition is a version of one library record. Original source wording and the bank’s interpretation are preserved separately.</div>`
  );
}
