import { badge, esc, preservedText, title, versionLabel, localDate } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { compareSourceClauses } from '../core/clause-order.ts';
import { selectSourceEdition, sourceEditionStatus } from '../core/source-editions.ts';

type ClauseRow = Record<string, any>;
interface WorkingViewOptions {
  rows: ClauseRow[];
  allRows: ClauseRow[];
  editionId?: string;
  allEditions?: boolean;
  navigationControls?: string;
  selectedId?: string;
  pathFor: (row: ClauseRow) => string;
  editAction?: string;
  sourceDocument?: { id: string; name: string };
  emptyAction?: string;
  provenance?: ClauseRow[];
}

export function recordClauseRows(record): ClauseRow[] {
  const versions = new Map<string, any>(record.versions.map((version) => [version.id, version]));
  const parents = new Map<string, any>(record.clauses.map((clause) => [clause.id, clause]));
  const instrument = record.instrument;
  const current = selectSourceEdition(record.versions, instrument.current_version_id, null, localDate()).approvedEffective;
  return record.clauses.map((clause) => {
    const version = versions.get(clause.instrument_version_id);
    return {
      ...clause,
      instrument_id: instrument.id,
      instrument_code: instrument.code,
      instrument_title: instrument.title,
      instrument_short_title: instrument.short_title,
      regulator_code: instrument.regulator_code,
      regulator_name: instrument.regulator_name,
      official_reference_number: instrument.official_reference_number,
      domain_name: instrument.domain_name,
      version_number: version?.version_number,
      version_approval_status: version?.approval_status,
      version_current_flag: version?.current_version_flag,
      version_is_effective_current: version?.id === current?.id,
      version_cancelled_draft: version?.cancelled_draft,
      version_effective_from: version?.effective_from,
      version_effective_to: version?.effective_to,
      parent_code: parents.get(clause.parent_clause_id)?.code,
    };
  });
}

export function clauseEditionBadges(row) {
  const status = sourceEditionStatus({ approval_status: row.version_approval_status, cancelled_draft: row.version_cancelled_draft });
  const position = row.version_is_effective_current ? 'CURRENT_APPROVED' : status === 'APPROVED' && row.version_effective_from > localDate()
    ? 'FUTURE_EFFECTIVE' : status === 'APPROVED' && row.version_effective_to && row.version_effective_to <= localDate() ? 'HISTORICAL' : '';
  return `<span class="clause-edition-badges"><span class="clause-edition-label">v${esc(versionLabel(row.version_number))}</span>${badge(position === 'CURRENT_APPROVED' ? position : status || 'DRAFT')}${position && position !== 'CURRENT_APPROVED' ? badge(position) : ''}</span>`;
}

function hierarchy(rows: ClauseRow[], allRows: ClauseRow[], selected: ClauseRow, pathFor, controls: string) {
  const matches = new Set(rows.map((row) => row.id));
  const byId = new Map(allRows.map((row) => [row.id, row]));
  const included = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    const seen = new Set([row.id]);
    let parent = byId.get(row.parent_clause_id);
    while (parent && parent.instrument_id === row.instrument_id && parent.instrument_version_id === row.instrument_version_id && !seen.has(parent.id)) {
      seen.add(parent.id);
      included.set(parent.id, parent);
      parent = byId.get(parent.parent_clause_id);
    }
  }
  const instruments = new Map<string, ClauseRow[]>();
  for (const row of included.values()) {
    if (!instruments.has(row.instrument_id)) instruments.set(row.instrument_id, []);
    instruments.get(row.instrument_id).push(row);
  }
  const groups = [...instruments.values()].sort((a, b) => String(a[0].instrument_title).localeCompare(String(b[0].instrument_title))).map((instrumentRows) => {
    const instrument = instrumentRows[0];
    const ids = new Set(instrumentRows.map((row) => row.id));
    const byParent = new Map<string | null, ClauseRow[]>();
    for (const row of instrumentRows) {
      const candidate = byId.get(row.parent_clause_id);
      const parent = ids.has(row.parent_clause_id) && candidate?.instrument_id === row.instrument_id &&
        candidate?.instrument_version_id === row.instrument_version_id ? row.parent_clause_id : null;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(row);
    }
    for (const children of byParent.values()) children.sort((a, b) => compareSourceClauses(a, b) ||
      String(b.version_number).localeCompare(String(a.version_number), undefined, { numeric: true }) || String(a.id).localeCompare(String(b.id)));
    const renderNodes = (parentId: string | null, ancestors = new Set<string>()): string => {
      const children = byParent.get(parentId) || [];
      if (!children.length) return '';
      return `<ul class="clause-hierarchy-list">${children.filter((row) => !ancestors.has(row.id)).map((row) => {
        const next = new Set(ancestors).add(row.id);
        const node = `<a class="clause-tree-node ${row.id === selected?.id ? 'active' : ''} ${matches.has(row.id) ? '' : 'context-node'}" data-edition="${esc(row.instrument_version_id)}" data-instrument="${esc(row.instrument_id)}" href="#${esc(pathFor(row))}" ${row.id === selected?.id ? 'aria-current="true"' : ''}>${icon(row.parent_clause_id ? 'file' : 'layers')}<span><strong>${row.source_clause_reference ? `<span class="clause-source-number">${esc(row.source_clause_reference)}</span> · ` : ''}${esc(row.heading || 'Source clause / para')}</strong><code>${esc(row.code)}</code>${clauseEditionBadges(row)}${matches.has(row.id) ? '' : '<small>Parent context</small>'}</span></a>`;
        const descendants = renderNodes(row.id, next);
        return `<li>${descendants ? `<details class="clause-branch" open><summary>${node}${icon('down')}</summary>${descendants}</details>` : node}</li>`;
      }).join('')}</ul>`;
    };
    return `<details class="clause-instrument-group" open><summary><span><strong>${esc(instrument.instrument_short_title || instrument.instrument_title)}</strong><code>${esc(instrument.instrument_code)}</code></span>${icon('down')}</summary>${renderNodes(null)}</details>`;
  }).join('');
  return `<aside class="panel clause-hierarchy-panel">${controls}<details class="clause-hierarchy-disclosure" ${window.matchMedia('(max-width: 900px)').matches ? '' : 'open'}><summary><span><strong>Instrument &amp; clause hierarchy</strong><small>${rows.length} matching ${rows.length === 1 ? 'clause / para' : 'clauses / paras'}</small></span>${icon('down')}</summary><nav class="clause-hierarchy" aria-label="Instrument and clause hierarchy">${groups || '<p class="clause-hierarchy-empty">No clauses match this selection.</p>'}</nav></details></aside>`;
}

export function renderClauseWorkingView({ rows, allRows, editionId, allEditions = false, navigationControls = '', selectedId, pathFor, editAction = '', sourceDocument, emptyAction = '', provenance = [] }: WorkingViewOptions) {
  // Record tabs stay pinned to one edition; the global workspace opts into all editions.
  if (!allEditions) rows = rows.filter((row) => row.instrument_version_id === editionId);
  const selected = rows.find((row) => row.id === selectedId) || rows[0];
  const navigation = hierarchy(rows, allRows, selected, pathFor, navigationControls);
  if (!selected) return `<div class="clause-working-layout" id="clause-working-view">${navigation}<section class="panel clause-workspace-empty"><span>${icon('layers')}</span><h2>No clauses to display</h2><p>Adjust the search or filters, or add a clause to a Draft source edition.</p>${emptyAction}</section></div>`;
  const flags = ['mandatory', 'conditional', 'reporting', 'disclosure', 'retention'].filter((flag) => selected[flag + '_flag']);
  const parent = allRows.find((row) => row.id === selected.parent_clause_id && row.instrument_id === selected.instrument_id && row.instrument_version_id === selected.instrument_version_id);
  const carry=provenance.find(row=>row.target_clause_id===selected.id);
  const original=carry&&allRows.find(row=>row.id===carry.source_clause_id);
  const versionQuery = new URLSearchParams({ version: selected.instrument_version_id, tab: 'versions' });
  const workflowQuery = new URLSearchParams({ version: selected.instrument_version_id, tab: 'workflow' });
  return `<div class="clause-working-layout" id="clause-working-view">${navigation}<div class="clause-working-content">
    <article class="panel clause-working-detail" id="working-clause-detail" aria-labelledby="working-clause-heading">
      <div class="clause-working-heading"><h2 id="working-clause-heading" tabindex="-1">${esc(selected.heading || 'Source clause / para')}</h2>${editAction}</div>
      <div class="clause-working-meta"><code class="clause-reference-chip">${esc(selected.code)}</code>${selected.source_clause_reference ? `<span>Source clause / para ${esc(selected.source_clause_reference)}</span>` : ''}<span>${esc(selected.source_page_reference || 'Page reference not recorded')}</span>${clauseEditionBadges(selected)}<span class="clause-approval-label">Clause approval ${badge(selected.approval_status || 'DRAFT')}</span></div>
      <div class="clause-wording-columns">
        ${carry?`<div class="carry-provenance full">Carried forward from ${original?`<a class="text-link" href="#${esc(pathFor(original))}">${esc(original.code)} · v${esc(versionLabel(original.version_number))}</a>`:'an earlier source clause'}. ${esc(carry.basis)} New citations and independent review apply to this edition.</div>`:''}
        <section class="clause-wording-panel original"><h3>Original regulatory text</h3>${preservedText('clause-working-text original-wording', selected.clause_text)}<p class="clause-wording-note">Source wording is retained as supplied by the regulator.</p></section>
        <section class="clause-wording-panel bank-interpretation"><h3>Bank’s internal interpretation</h3>${preservedText('clause-working-text', selected.internal_interpretation || 'Interpretation pending. Add the bank’s explanation while this source edition is Draft.')}<p class="clause-wording-note">A separate explanation linked to this exact source edition.</p></section>
      </div>
      <dl class="clause-working-facts"><div><dt>Instrument</dt><dd><a class="text-link" href="#repository/${esc(selected.instrument_id)}">${esc(selected.instrument_code)} ${icon('arrow')}</a><small>${esc(selected.instrument_short_title || selected.instrument_title)}</small></dd></div><div><dt>Control flags</dt><dd>${flags.length ? flags.map((flag) => `<span class="clause-control-chip">${esc(title(flag))}</span>`).join('') : 'No control flags recorded'}</dd></div><div><dt>Parent clause</dt><dd>${parent ? `<a class="text-link" href="#${esc(pathFor(parent))}">${esc(selected.parent_code || 'Parent clause')}${icon('arrow')}</a>` : 'Top-level clause'}</dd></div><div><dt>Source edition approval</dt><dd>${badge(sourceEditionStatus({ approval_status: selected.version_approval_status, cancelled_draft: selected.version_cancelled_draft }))}${selected.version_is_effective_current ? '<span class="clause-current-note">Current source</span>' : ''}</dd></div></dl>
      <div class="clause-working-links">${sourceDocument ? `<button type="button" class="btn small" data-action="source-document-preview" data-id="${esc(sourceDocument.id)}" data-name="${esc(sourceDocument.name)}">${icon('file')}<span>Source document</span></button>` : ''}<a class="btn small" href="#repository/${esc(selected.instrument_id)}?${esc(versionQuery.toString())}">${icon('book')}<span>Source edition</span></a><a class="text-link" href="#repository/${esc(selected.instrument_id)}?${esc(workflowQuery.toString())}">Review workflow ${icon('arrow')}</a></div>
    </article>
  </div></div>`;
}
