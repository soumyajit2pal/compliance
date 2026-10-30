import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { childIndex, subtreeIds } from '../core/hierarchy.ts';
import { esc, title, ref, badge, button, field, select, input, area, fixedSelect, localDate, message } from '../ui/components.ts';
import { modal, close } from '../ui/dialog.ts';
import { icon } from '../ui/icons.ts';
import { heading } from '../ui/layout.ts';
import { domainStatus } from '../ui/domains.ts';
import { panel, table, tablePanel, tabs, note, searchForm, detailFields } from '../ui/widgets.ts';

const otherLookups = ['frequency', 'evidence_type', 'confidentiality_class', 'process', 'role'];
const availableNow = (row) => row.active_flag &&
  (!row.effective_from || row.effective_from <= localDate()) &&
  (!row.effective_to || row.effective_to > localDate());
const editButton = (key, row) => key === 'regulator' && row.approval_status !== 'DRAFT'
  ? '<span class="small muted">Retained approval record</span>'
  : button('edit-master', 'Edit', `data-key="${esc(key)}" data-id="${esc(row.id)}"`, 'small');
const addButton = (key, parent = '') => {
  const definition = state.view.masterCatalogue.find((d) => d.key === key);
  return definition?.can_create ? button('add-master', 'Add ' + definition.label.toLowerCase(),
    `data-key="${esc(key)}" data-parent="${esc(parent)}"`, 'primary') : '';
};

function organisationView(query) {
  const all = state.masters.organisational_unit,
    selected =
      all.find((u) => u.id === query.get('unit')) || all.find((u) => u.code === 'BANK') || all[0];
  if (!selected) return heading('Organisation hierarchy', '', addButton('organisational_unit')) +
    panel('No organisation units', '<p>Add the first organisation unit to start the hierarchy.</p>');
  const indexed = childIndex(all, 'parent_org_unit_id');
  const children = indexed.get(selected.id) || [];
  function branch(parent = null, seen = new Set()) {
    return (indexed.get(parent) || [])
      .map((u) => {
        if (seen.has(u.id)) return '';
        const next = new Set(seen);
        next.add(u.id);
        return `<div class="runtime-tree-branch"><a class="tree-node ${u.id === selected.id ? 'active' : ''}" href="#masters?tab=organisation&unit=${u.id}">${icon(u.unit_type === 'BRANCH' ? 'home' : 'org')}<span>${esc(u.name)}${u.active_flag ? '' : ' · inactive'}</span></a><div class="runtime-tree-children">${branch(u.id, next)}</div></div>`;
      })
      .join('');
  }
  return (
    heading(
      'Organisation hierarchy',
      '',
      addButton('organisational_unit'),
    ) +
    `<div class="tree-layout">${panel('Organisation units', `<div class="tree">${branch()}</div>`, { sub: all.length + ' active and retained units' })}<div class="stack">${panel(
      selected.name,
      detailFields([
        ['Code', esc(selected.code)],
        ['Unit type', esc(title(selected.unit_type))],
        ['Parent organisation', esc(ref('organisational_unit', selected.parent_org_unit_id))],
        ['Status', badge(selected.active_flag ? 'ACTIVE' : 'INACTIVE')],
        ['Effective from', esc(selected.effective_from || '—')],
        ['Effective to', esc(selected.effective_to || 'Open-ended')],
      ]),
      { action: `<div class="row">${editButton('organisational_unit', selected)}${availableNow(selected) ? button('add-master', 'Add child unit', `data-key="organisational_unit" data-parent="${esc(selected.id)}"`, 'small') : '<span class="small muted">Child units need an active, effective parent.</span>'}</div>` },
    )}${panel(
      'Direct child units',
      table(
        ['Unit', 'Type', 'Status', ''],
        children.map((c) => [
          esc(c.name),
          esc(title(c.unit_type)),
          badge(c.active_flag ? 'ACTIVE' : 'INACTIVE'),
          `<a class="btn small" href="#masters?tab=organisation&unit=${c.id}">Open unit</a>`,
        ]),
        { summary: false },
      ),
    )}${note('Role scope applies to the assigned organisation and its active, effective descendants. Home organisation describes membership; a task still needs a named owner.')}</div></div>`
  );
}
export async function renderMasters(_id, query = new URLSearchParams()) {
  const request = state.routeNumber;
  const [masters, catalogue] = await Promise.all([api('/masters'), api('/masters/catalogue')]);
  if (request !== state.routeNumber || !state.identity) return '';
  state.masters = masters;
  state.view.masterCatalogue = catalogue;
  if (query.get('tab') === 'organisation') return organisationView(query);
  const key = query.get('tab') || 'domains',
    q = (query.get('q') || '').toLowerCase();
  const definitions = {
    domains: ['Regulatory domains', 'regulatory_domain'],
    regulators: ['Regulators', 'regulator'],
    types: ['Instrument types', 'instrument_type'],
    categories: ['Obligation categories', 'obligation_category'],
    other: ['Other lookups', null],
  };
  const [tabName, tabSource] = definitions[key] || definitions.domains;
  const source = tabSource || (otherLookups.includes(query.get('lookup')) ? query.get('lookup') : otherLookups[0]);
  const definition = catalogue.find((d) => d.key === source);
  const name = tabSource ? tabName : definition.label;
  let rows = state.masters[source] || [];
  rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  return (
    heading(
      'Master data',
      '',
      addButton(source),
    ) +
    tabs(
      [
        ['domains', 'Regulatory domains', state.masters.regulatory_domain.length],
        ['regulators', 'Regulators', state.masters.regulator.length],
        ['types', 'Instrument types', state.masters.instrument_type.length],
        ['categories', 'Obligation categories', state.masters.obligation_category.length],
        ['other', 'Other lookups'],
      ],
      key,
      'masters',
      query,
    ) +
    searchForm(
      'view-filter',
      'Search ' + name.toLowerCase() + '…',
      query.get('q') || '',
      `<input type="hidden" name="tab" value="${esc(key)}">${key === 'other' ? field('Lookup type', select('lookup', catalogue.filter((d) => otherLookups.includes(d.key)).map((d) => ({ id: d.key, name: d.label })), source, 'name', 'required')) : ''}`,
    ) +
    tablePanel(
      table(
        ['Code', name, 'Classification / owner', 'Status', ''],
        rows.map((r) => [
          `<code>${esc(r.code)}</code>`,
          `<span class="record-title">${esc(r.name)}</span>`,
          key === 'domains'
            ? esc(
                r.domain_owner_unit_id
                  ? ref('organisational_unit', r.domain_owner_unit_id)
                  : 'Not assigned',
              )
            : esc(r.classification || 'Controlled reference'),
          key === 'domains' ? domainStatus(r) : badge(r.active_flag ? 'ACTIVE' : 'INACTIVE'),
          `<div class="row">${editButton(source, r)}${key === 'domains' ? button('domain', 'Set owner', `data-id="${r.id}"`, 'small') : ''}</div>`,
        ]),
      ),
    ) +
    (definition.note ? `<div class="mt16">${note(esc(definition.note))}</div>` : '')
  );
}

function masterDialog(key, id = '', parent = '') {
  const definition = state.view.masterCatalogue.find((d) => d.key === key);
  if (!definition) throw new Error('Reload Master data before editing.');
  const row = id ? state.masters[key].find((r) => r.id === id) : null;
  if (id && !row) throw new Error('This record no longer exists. Reload the page.');
  state.view.masterEdit = { key, id, definition };
  // Exclude the current record and all its descendants from a parent picker.
  const excluded = definition.parent_field ? subtreeIds(state.masters[key], definition.parent_field, id) : new Set();
  const fields = definition.fields.map((f) => {
    let value = row?.[f.name] ?? (f.name === definition.parent_field ? parent : f.default) ?? '';
    if (!row && f.kind === 'date' && f.name === 'effective_from') value = localDate();
    if (!row && f.name === 'scheme_id') value = state.masters.taxonomy_scheme.find((s) => s.code === 'REGULATORY')?.id || '';
    const required = f.required ? 'required' : '';
    const immutable = row && f.immutable;
    let control;
    if (f.kind === 'checkbox') {
      const label = key === 'regulatory_domain' && f.name === 'active_flag' ? 'Allow submissions for Compliance review' : f.label;
      return `<div class="field"><label class="check-label"><input type="checkbox" name="${esc(f.name)}" ${value ? 'checked' : ''}> ${esc(label)}</label></div>`;
    }
    if (f.kind === 'reference') {
      const choices = (state.masters[f.source] || []).filter((r) =>
        (availableNow(r) || (row && r.id === value)) && !(f.name === definition.parent_field && excluded.has(r.id)) &&
        (f.name !== 'domain_owner_unit_id' || r.unit_type === 'DEPARTMENT'));
      control = select(f.name, choices.map(r => ({ ...r, option_label: r.code + ' · ' + r.name })), value, 'option_label', required);
    } else if (f.kind === 'select') control = fixedSelect(f.name, f.choices, value, required);
    else if (f.kind === 'textarea') control = area(f.name, value, `${required} maxlength="${f.max_length || 10000}"`);
    else control = input(f.name, value, f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text',
      `${required} ${immutable ? 'readonly' : ''} ${f.max_length ? `maxlength="${f.max_length}"` : ''} ${f.minimum !== null ? `min="${f.minimum}"` : ''} ${f.maximum !== null ? `max="${f.maximum}"` : ''} ${f.kind === 'number' ? 'step="1"' : ''}`);
    return field(f.label, control, immutable ? 'Permanent code.' : '', f.kind === 'textarea' ? 'full' : '');
  }).join('');
  modal((row ? 'Edit ' : 'Add ') + definition.label.toLowerCase(),
    `<div class="form-grid">${fields}${field('Reason for change', area('reason', '', 'required minlength="5" maxlength="2000"'), '', 'full')}</div>`,
    'master-record', row ? 'Save changes' : 'Add record',
    key === 'organisational_unit' ? 'Parent changes also update descendant levels and organisation scope.' : 'Changes are retained in the audit history.');
}

export function masterHandlers({ render }) {
  return {
    actions: {
      'add-master': ({ key, parent }) => masterDialog(key, '', parent),
      'edit-master': ({ key, id }) => masterDialog(key, id),
      domain: ({ id }) => {
        const d = state.masters.regulatory_domain.find((r) => r.id === id);
        state.view.domain = id;
        modal(
          'Configure domain ownership',
          `<div class="source-column mb16"><h4>REGULATORY DOMAIN</h4><p>${esc(d.code)} · ${esc(d.name)}</p></div><div class="form-grid">${field(
            'Bank-approved owning department',
            select(
              'domain_owner_unit_id',
              state.masters.organisational_unit.filter((u) => u.active_flag && u.unit_type === 'DEPARTMENT'),
              d.domain_owner_unit_id,
              'name',
              'required',
            ),
          )}<label class="check-label"><input type="checkbox" name="active_flag" ${d.active_flag ? 'checked' : ''}> Allow submissions for Compliance review</label></div><div class="mt24"><h4 class="mb16">Current saved status</h4>${domainStatus(d)}</div><div class="mt24">${note('Choose the bank-approved owning department and tick “Allow submissions for Compliance review” when the domain is ready. Leaving it unticked keeps the domain available for Drafts only. Your changes take effect when you save. A department’s presence in the hierarchy does not nominate it as domain owner.')}</div>`,
          'domain',
          'Save master configuration',
          'Complete the domain setup before Authors submit notifications for review.',
        );
      },
    },
    forms: {
      'master-record': async (form) => {
        const { key, id, definition } = state.view.masterEdit;
        const values = {};
        for (const f of definition.fields) {
          const control = form.elements.namedItem(f.name);
          values[f.name] = f.kind === 'checkbox' ? control.checked : f.kind === 'number'
            ? control.value === '' ? null : Number(control.value)
            : control.value || null;
        }
        const result = await api('/admin/masters/' + key + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
          values, reason: form.elements.reason.value,
        });
        for (const record of result.records) {
          const cached = state.masters[key].find(row => row.id === record.id);
          if (cached) Object.assign(cached, record);
          else state.masters[key].push(record);
        }
        close();
        message(id ? 'Changes saved.' : 'Record added.');
        if (key === 'organisational_unit' && new URLSearchParams(location.hash.split('?')[1]).get('unit') !== result.id)
          location.hash = 'masters?tab=organisation&unit=' + result.id;
        else await render();
      },
      domain: async (form) => {
        await api('/masters/domains/' + state.view.domain, 'PATCH', {
          domain_owner_unit_id: form.elements.domain_owner_unit_id.value,
          active_flag: form.elements.active_flag.checked,
        });
        close();
        state.masters = await api('/masters');
        message('Domain ownership configuration saved.');
        await render();
      },
    },
  };
}
