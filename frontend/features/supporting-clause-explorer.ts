import { dialog } from '../core/dom.ts';
import { badge, esc } from '../ui/components.ts';
import { close, modal } from '../ui/dialog.ts';
import { clauseTitle, selectedSupportingClauses, sourceLabel, supportingClauseIds, supportingClausesInSourceOrder, type SourceClause } from './supporting-clauses.ts';

const limit = 100;

export function openSupportingClauseExplorer(editor: HTMLFormElement, clauses: SourceClause[], trigger: HTMLElement) {
  const primaryId = (editor.elements.namedItem('primary_clause_id') as HTMLSelectElement).value;
  const eligible = supportingClausesInSourceOrder(clauses).filter(clause => clause.id !== primaryId);
  const byId = new Map(eligible.map(clause => [clause.id, clause]));
  const selected = new Set(supportingClauseIds(editor).filter(id => id !== primaryId));
  const searchable = eligible.map(clause => ({
    clause,
    search: [clauseTitle(clause), clause.code, sourceLabel(clause)].join(' ').toLocaleLowerCase(),
  }));
  let previewId = eligible.find(clause => selected.has(clause.id))?.id || eligible[0]?.id;

  modal('Choose supporting clauses', `
    <div class="supporting-clause-tools">
      <div class="field"><label for="supporting-clause-search">Search approved clauses</label>
        <input type="search" id="supporting-clause-search" placeholder="Document, clause number or heading">
      </div>
      <p role="status" aria-live="polite" data-clause-selection-count></p>
    </div>
    <div class="supporting-clause-explorer">
      <ul class="supporting-clause-results" aria-label="Approved clauses" data-clause-results></ul>
      <section class="supporting-clause-preview" aria-label="Clause preview" id="supporting-clause-preview" tabindex="0"></section>
    </div>`, 'supporting-clause-explorer', 'Apply selection', 'Read the wording and check the clauses that support the same requirement.', trigger);

  const form = dialog.querySelector<HTMLFormElement>('#supporting-clause-explorer');
  const search = form.querySelector<HTMLInputElement>('#supporting-clause-search');
  const results = form.querySelector<HTMLElement>('[data-clause-results]');
  const preview = form.querySelector<HTMLElement>('#supporting-clause-preview');
  const count = form.querySelector<HTMLElement>('[data-clause-selection-count]');
  const showCount = () => {
    count.textContent = `${selected.size} selected${selected.size >= limit ? ' · Selection limit reached' : ''}`;
  };
  const showPreview = () => {
    const clause = byId.get(previewId);
    results.querySelectorAll<HTMLButtonElement>('[data-preview-clause]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.previewClause === previewId));
    });
    preview.innerHTML = clause ? `<h3>${esc(clauseTitle(clause))}</h3>
      <p class="small muted">${esc(sourceLabel(clause))} · ${esc(clause.code)}</p>
      <h4>Original regulatory text</h4><div class="source-wording">${esc(clause.clause_text || 'Original wording unavailable.')}</div>
      <h4>Bank interpretation</h4>${badge(clause.interpretation_status === 'APPROVED' ? 'APPROVED' : 'INTERPRETATION_PENDING')}
      <div class="source-wording">${esc(clause.internal_interpretation || 'Interpretation unavailable.')}</div>`
      : '<p class="muted">Choose a clause to read its wording.</p>';
  };
  const showResults = () => {
    const terms = search.value.toLocaleLowerCase().trim().split(/\s+/);
    const matching = searchable.filter(entry => terms.every(term => entry.search.includes(term))).map(entry => entry.clause);
    if (!matching.some(clause => clause.id === previewId)) previewId = matching[0]?.id;
    results.innerHTML = matching.map(clause => `<li>
      <input type="checkbox" value="${esc(clause.id)}" aria-label="${esc('Select ' + clauseTitle(clause) + ' · ' + sourceLabel(clause))}" ${selected.has(clause.id) ? 'checked' : ''}>
      <button type="button" data-preview-clause="${esc(clause.id)}" aria-controls="supporting-clause-preview">
        <strong>${esc(clauseTitle(clause))}</strong><small>${esc(sourceLabel(clause))}</small>
      </button>
    </li>`).join('') || `<li class="muted">${eligible.length ? 'No clauses match this search.' : 'No other approved clauses are available.'}</li>`;
    showPreview();
  };

  search.addEventListener('input', showResults);
  search.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  results.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-preview-clause]');
    if (!button) return;
    previewId = button.dataset.previewClause;
    showPreview();
    if (window.matchMedia('(max-width: 680px)').matches) preview.scrollIntoView({ block: 'nearest' });
  });
  results.addEventListener('change', event => {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox.checked && selected.size >= limit) checkbox.checked = false;
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
    showCount();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const list = editor.querySelector('[data-obl-list=citations]');
    if (editor.isConnected && list) list.innerHTML = selectedSupportingClauses([...selected], clauses);
    close();
  });
  showCount();
  showResults();
}
