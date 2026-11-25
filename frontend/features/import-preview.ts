import { esc, badge, link, button, date, title } from '../ui/components.ts';
import { panel, note, pagedCollection } from '../ui/widgets.ts';
import { compareSourceClauses } from '../core/clause-order.ts';
import { clauseWorkspacePath, instrumentWorkspacePath } from '../core/source-navigation.ts';

export function importedClausePath(row) {
  return clauseWorkspacePath(row.target_entity_id, new URLSearchParams({
    instrument: row.profile.target_instrument_id || 'all',
    edition: row.profile.target_version_id || 'all',
  }));
}

export function hasReadyFamilyLinks(data) {
  return data.groups?.some(group => group.status === 'MIGRATION_READY' && group.family_link) ?? false;
}

export function draftLoadingInstructions(data) {
  if (data.permissions.can_load) {
    if (hasReadyFamilyLinks(data)) {
      return 'Choose a Compliance Reviewer and Final Approver when you load the Drafts. The import will submit the notification proposals for their decisions. Then submit the Draft source editions for separate approval.';
    }
    return 'Load the validated rows as Drafts in the Regulatory Library, then submit the Draft editions for review and approval.';
  }
  const author = data.combined
    ? data.uploader_name ? `${data.uploader_name}, the uploading Regulatory Author,` : 'The uploading Regulatory Author'
    : 'A global Regulatory Author';
  return `${author} needs to load the validated rows as Drafts in the Regulatory Library. The Author can then submit the Draft editions for review and approval.`;
}

function findings(row) {
  const errors = row.profile.errors || [];
  return errors.length ? `<ul class="import-findings">${errors.map((error) => `<li>${esc(error)}</li>`).join('')}</ul>` : '';
}

function orderedClauses(rows) {
  const references = new Map();
  for (const row of rows) {
    const reference = row.profile.clause_reference;
    references.set(reference, [...(references.get(reference) || []), row]);
  }
  const children = new Map(), roots = [];
  for (const row of rows) {
    const parent = references.get(row.profile.parent_reference);
    if (parent?.length === 1) {
      children.set(parent[0].id, [...(children.get(parent[0].id) || []), row]);
    } else roots.push(row);
  }
  const compare = (a, b) => compareSourceClauses(
    {...a.profile.normalised, sequence_number: a.row_number},
    {...b.profile.normalised, sequence_number: b.row_number},
  );
  roots.sort(compare);
  for (const siblings of children.values()) siblings.sort(compare);
  const result = [], visited = new Set();
  const stack = roots.reverse().map((row) => ({row, depth: 0}));
  // Unresolved/cyclic rows remain visible with their findings.
  const append = () => {
    while (stack.length) {
      const item = stack.pop();
      if (visited.has(item.row.id)) continue;
      visited.add(item.row.id);
      result.push(item);
      for (const child of [...(children.get(item.row.id) || [])].reverse()) {
        stack.push({row: child, depth: item.depth + 1});
      }
    }
  };
  append();
  for (const row of [...rows].sort(compare)) {
    if (!visited.has(row.id)) {
      stack.push({row, depth: 0});
      append();
    }
  }
  return result;
}

export function combinedImportPreview(data, query) {
  if (!data.combined) return '';
  const q = (query.get('q') || '').toLowerCase();
  const status = query.get('status'), entity = query.get('entity');
  const byId = new Map(data.rows.map((row) => [row.id, row]));
  const visible = data.groups.filter((group) => group.row_ids.some((id) => {
    const row: any = byId.get(id);
    return (!status || row.validation_status === status) &&
      (!entity || row.profile.entity_type === entity) && JSON.stringify(row).toLowerCase().includes(q);
  }));
  const sources = data.sources.length ? pagedCollection(data.sources.map((source) =>
    `<div><a class="btn small" href="/api/migration/${esc(data.batch.id)}/sources/${esc(source.id)}" download>Download ${esc(source.file_name)}</a><details><summary>Source integrity</summary><small>${esc(source.file_size)} bytes</small><code>${esc(source.file_hash)}</code></details></div>`),{pageKey:'import-sources',className:'import-sources',label:'source files',summary:false}) : '';
  const ready = data.populations.MIGRATION_READY || 0;
  const nextStep = ready ? `<section id="import-draft-loading" aria-labelledby="import-draft-loading-title" tabindex="-1">${note(`
    <h3 id="import-draft-loading-title">Next step · Load validated rows as Drafts</h3>
    <p>${esc(draftLoadingInstructions(data))}</p>
    ${data.permissions.can_load ? `<div class="actions mt8">${button('load-batch', 'Load ready rows as Drafts', '', 'primary')}</div>` : ''}`)}</section>` : '';
  const groups = visible.map((group) => {
    const members: any[] = group.row_ids.map((id) => byId.get(id));
    const record = members.find((row) => row.profile.entity_type === 'instrument');
    const clauses = members.filter((row) => row.profile.entity_type === 'clause');
    const source = record?.profile.source_attachment || record?.profile.source_document;
    const family = group.family_link;
    const proposal = group.family_proposal;
    const relationship = family ? `<p class="small"><strong>Notification relationship</strong> · ${esc(title(family.relationship_type))} ${esc(family.parent_reference)} · Effective ${date(family.effective_from)}</p>` : '';
    const proposalLink = proposal ? `<p>${link('notification-families/' + encodeURIComponent(proposal.instrument_id) + '?proposal=' + encodeURIComponent(proposal.id), 'Open notification proposal', 'text-link')}</p>` : '';
    const rows = orderedClauses(clauses).map(({row, depth}) => {
      const p = row.profile, values = p.normalised || {};
      return `<li style="--clause-depth:${Math.min(depth, 10)}"><span class="import-source-number">${esc(values.source_clause_reference || 'Unnumbered')}</span><div><strong>${esc(values.heading || p.clause_reference || 'Clause')}</strong><small>${esc(p.clause_reference)}${p.parent_reference ? ` · Parent: ${esc(p.parent_reference)}` : ' · Top level'} · ${esc(values.source_page_reference || 'Page reference missing')} · ${esc(row.sheet_name)} row ${esc(row.row_number)}</small>${findings(row)}<details class="import-wording"><summary>Review wording</summary><div><strong>Original regulatory text</strong><p>${esc(values.clause_text || 'Missing')}</p><strong>Bank’s internal interpretation</strong><p>${esc(values.internal_interpretation || 'Not supplied')}</p></div></details>${row.target_entity_id ? link(importedClausePath(row), 'Open clause →', 'text-link') : ''}</div></li>`;
    }).join('');
    return `<details class="import-group" ${visible.length === 1 ? 'open' : ''}><summary><span><strong>${esc(group.title)}</strong><small>${esc(group.reference)} · Edition ${esc(group.edition_number || 'unresolved')} · ${group.existing_draft ? 'Existing Draft' : 'New regulatory record'} · ${clauses.length} clauses</small></span>${badge(group.status)}</summary><div class="import-group-body">${record ? findings(record) : note('The Regulatory records row is missing or ambiguous.', 'warn')}${source ? `<p class="small">Source: ${esc(source.file_name)}</p>` : ''}${relationship}${proposalLink}${record?.target_entity_id ? `<p>${link(instrumentWorkspacePath(record.target_entity_id, record.profile.target_version_id), 'Open regulatory record →', 'text-link')}</p>` : ''}${rows ? `<ol class="import-clause-preview" aria-label="Clause hierarchy for ${esc(group.reference)}">${rows}</ol>` : '<p class="small muted">No clauses in this group.</p>'}</div></details>`;
  });
  return panel('Validation preview',
    `<p class="small muted">Regulatory records: ${data.entity_counts.instrument || 0} · Clauses: ${data.entity_counts.clause || 0} · Sources: ${data.sources.length}. Parent clauses stay within their record and edition. Validation and Draft loading apply to the complete batch.</p>${sources}${nextStep}${pagedCollection(groups,{pageKey:'import-groups',label:'regulatory record groups',empty:'<p>No groups match these filters.</p>'})}`,
    {cls: 'import-preview'});
}
