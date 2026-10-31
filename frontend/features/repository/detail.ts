import { state } from '../../core/state.ts';
import { selectSourceEdition, sourceEditionStatus } from '../../core/source-editions.ts';
import { instrumentWorkspacePath } from '../../core/source-navigation.ts';
import { covered } from '../../core/access.ts';
import {
  esc,
  title,
  badge,
  date,
  localDate,
  versionLabel,
  ref,
  link,
  button,
  area,
  field,
} from '../../ui/components.ts';
import { icon } from '../../ui/icons.ts';
import { domainGuidance, domainReadiness } from '../../ui/domains.ts';
import { recordClauseRows, renderClauseWorkingView } from '../clause-workspace.ts';
import {
  panel,
  table,
  tablePanel,
  tabs,
  note,
  stepFlow,
  person,
} from '../../ui/widgets.ts';

function recordPath(i, v, tab, extra = {}) {
  return instrumentWorkspacePath(i.id, v.id, new URLSearchParams({ tab, ...extra }));
}
function correctionPath(i, v, correctionId, tab = 'workflow') {
  return recordPath(i, v, tab, { correction: correctionId });
}
function correctionValues(row, field) {
  try { return JSON.parse(row[field] || '{}'); } catch { return {}; }
}
function correctionLabel(key) {
  return ({ official_reference_number: 'Official reference', title: 'Title', short_title: 'Short title',
    applicability_date: 'Applicability date', materiality: 'Materiality',
    regulatory_owner_unit_id: 'Regulatory owner unit', interpretation_owner_user_id: 'Interpretation owner',
    keywords: 'Keywords', secondary_domain_ids: 'Additional affected domains' })[key] || title(key);
}
function correctionValue(key, value) {
  if (key === 'secondary_domain_ids') return (value || []).map((id) => ref('regulatory_domain', id)).join(', ') || 'None';
  if (key === 'regulatory_owner_unit_id') return ref('organisational_unit', value);
  if (key === 'interpretation_owner_user_id') return ref('user', value);
  if (key === 'applicability_date') return date(value);
  if (key === 'materiality') return title(value);
  return value || '—';
}
function correctionSummary(row) {
  const before = correctionValues(row, 'before_values_json');
  const proposed = correctionValues(row, 'proposed_values_json');
  return `<div class="metadata-correction-values">${Object.keys(proposed).map((key) =>
    `<div><strong>${esc(correctionLabel(key))}</strong><span>${esc(correctionValue(key, before[key]))} <span aria-label="changes to">→</span> ${esc(correctionValue(key, proposed[key]))}</span></div>`).join('')}</div>`;
}
function workflowActions(v, active, editable) {
  const assignedDomains = [
    state.record.instrument.primary_domain_id,
    ...(state.record.secondary_domains || []).map((domain) => domain.id),
  ].map((id) => state.masters.regulatory_domain.find((domain) => domain.id === id));
  const domainsReady = assignedDomains.every((domain) => domainReadiness(domain)?.ready);
  let html = editable
    ? button(
        'submit-version',
        'Submit for Compliance review',
        domainsReady
          ? ''
          : 'disabled title="Ask an Admin to complete setup for every affected domain before review submission."',
        'primary',
      )
    : '';
  if (
    active &&
    v.created_by === state.identity.user.id &&
    covered(state.record.instrument.regulatory_owner_unit_id, ['AUTHOR'])
  )
    html += button('decision', 'Withdraw to Draft', 'data-decision="WITHDRAW"');
  if (
    active?.assignee_user_id === state.identity.user.id &&
    covered(state.record.instrument.regulatory_owner_unit_id, [
      active.stage === 'COMPLIANCE_REVIEW' ? 'REVIEWER' : 'APPROVER',
    ])
  )
    html +=
      button(
        'decision',
        active.stage === 'COMPLIANCE_REVIEW' ? 'Record review' : 'Approve version',
        `data-decision="${active.stage === 'COMPLIANCE_REVIEW' ? 'REVIEW' : 'APPROVE'}"`,
        'primary',
      ) +
      button('decision', 'Return for correction', 'data-decision="RETURN"') +
      button('decision', 'Reject', 'data-decision="REJECT"', 'danger') +
      button('decision', 'Delegate task', 'data-decision="DELEGATE"');
  if (
    v.approval_status === 'APPROVED' &&
    !v.current_version_flag &&
    !v.effective_to &&
    v.effective_from <= localDate() &&
    covered(state.record.instrument.regulatory_owner_unit_id, ['APPROVER'])
  )
    html += button('activate', 'Make effective version current');
  return html;
}
function activity(events) {
  return `<div class="runtime-audit-list">${events.map((r) => `<div class="runtime-audit-event">${icon('activity')}<div><strong>${esc(title(r.action || r.new_status || r.stage))}</strong><p>${esc(r.reason || r.comments || '')}</p><small>${date(r.event_at || r.changed_at)}${r.actor_user_id ? ' · ' + esc(ref('user', r.actor_user_id)) : ''}</small>${r.old_value || r.new_value ? `<details><summary>Retained change details</summary><pre>${esc(r.old_value || '')}\n${esc(r.new_value || '')}</pre></details>` : ''}</div></div>`).join('') || '<p class="small muted">No activity recorded in this view.</p>'}</div>`;
}
function regulatoryPositionDescription(status) {
  return {
    DRAFT: 'Not yet in force as the bank’s regulatory position.',
    CURRENT: 'The active regulatory position.',
    SUPERSEDED: 'Replaced by a later regulatory source.',
    WITHDRAWN: 'Withdrawn from the regulatory register.',
  }[status] || 'Regulatory position recorded for this instrument.';
}
function versionApprovalDescription(status, current) {
  return {
    DRAFT: 'Not submitted for independent Compliance review; this version is not active.',
    IN_REVIEW: 'Under independent Compliance review.',
    REVIEWED: 'Compliance review is complete; awaiting final approval.',
    APPROVED: current
      ? 'Approved and active as the current source.'
      : 'Approved, but not active as the current source.',
    REJECTED: 'Rejected and retained in the version history.',
    CANCELLED: 'Draft cancelled by its maker; its source, clauses, reason and history are retained. This edition cannot be reopened.',
    WITHDRAWN: 'Withdrawn from the approval workflow.',
  }[status] || 'Approval status recorded for this source version.';
}
function clauseView(i, v, editable, q) {
  const allRows = recordClauseRows(state.record);
  const rows = allRows.filter((clause) => clause.instrument_version_id === v.id);
  const selected = rows.find((clause) => clause.id === q.get('clause')) || rows[0];
  const documentId = v.source_document_id;
  const toolbar = `<div class="clause-workspace-toolbar"><div><h2>Clause workspace</h2><p>Choose a clause to compare source wording with the bank’s interpretation.</p></div><div class="clause-list-actions">${editable ? `<button type="button" class="btn primary" data-action="clause">${icon('plus')}<span>Add clause</span></button>` : ''}</div></div>`;
  return toolbar + renderClauseWorkingView({
    rows,
    allRows,
    editionId: v.id,
    provenance: state.record.clause_carry_forward||[],
    selectedId: selected?.id,
    pathFor: (row) => recordPath(i, { id: row.instrument_version_id }, 'clauses', { clause: row.id }),
    editAction: (editable && selected?.approval_status === 'DRAFT'
      ? button('clause', 'Edit Draft clause', `data-id="${esc(selected.id)}"`, 'small')
      : '')+(selected && (editable || v.approval_status === 'APPROVED') && covered(i.regulatory_owner_unit_id, ['AUTHOR']) ? button('link-earlier-clause', 'Link earlier clause', `data-id="${esc(selected.id)}" data-instrument="${esc(i.id)}"`, 'small') : ''),
    sourceDocument: documentId ? { id: documentId, name: state.record.source_documents[documentId] || i.title } : undefined,
  });
}
export function renderRecord(q) {
  const {
    instrument: i,
    versions,
    secondary_domains = [],
    source_documents = {},
    clauses,
    tasks,
    audit,
    history,
    comments,
    metadata_corrections = [],
  } = state.record;
  const selection = selectSourceEdition(versions, i.current_version_id, q.get('version'), localDate());
  const v = selection.selected;
  if (!v) return note('No source editions are available for this instrument.');
  // Keep all workspace links pinned to the edition currently displayed.
  q = new URLSearchParams(q);
  q.set('version', v.id);
  state.view.version = v;
  const domain = state.masters.regulatory_domain.find((d) => d.id === i.primary_domain_id);
  const editable =
    v.approval_status === 'DRAFT' &&
    v.created_by === state.identity.user.id &&
    covered(i.regulatory_owner_unit_id, ['AUTHOR']);
  const active = tasks.find(
    (t) =>
      t.entity_id === v.id &&
      t.workflow_status === 'OPEN' &&
      t.stage === t.current_stage &&
      !t.decision,
  );
  const correction = metadata_corrections.find((r) => r.id === q.get('correction')) ||
    metadata_corrections.find((r) => ['IN_REVIEW', 'REVIEWED'].includes(r.correction_status));
  const correctionTask = correction && tasks.find((t) => t.entity_id === correction.id &&
    t.workflow_status === 'OPEN' && t.stage === t.current_stage && !t.decision);
  const selectedClauses = clauses.filter((c) => c.instrument_version_id === v.id),
    tab = q.get('tab') || 'overview';
  const source = v.source_document_id
    ? `<button type="button" class="record-summary-link source-document-link" data-action="source-document-preview" data-id="${esc(v.source_document_id)}" data-name="${esc(source_documents[v.source_document_id] || i.title || 'Source document')}">${icon('file')}<span>${esc(source_documents[v.source_document_id] || i.title || 'Open source document')}</span></button>`
    : '<span class="record-unlinked">Not recorded</span>';
  let actions = editable ? button('edit-version', 'Edit draft version', '', 'primary') : '';
  if (editable && !active) actions += button('cancel-draft', 'Cancel draft', '', 'danger');
  if (selection.pending.length)
    actions += link(recordPath(i, selection.pending[0], 'overview'), 'Open pending edition', 'btn');
  const openCorrection = metadata_corrections.find((r) => ['IN_REVIEW', 'REVIEWED'].includes(r.correction_status));
  if (
    editable && i.approval_status === 'DRAFT' &&
    i.created_by === state.identity.user.id &&
    covered(i.regulatory_owner_unit_id, ['AUTHOR'])
  )
    actions += button('edit-instrument', 'Edit draft instrument');
  if (i.approval_status === 'APPROVED' && covered(i.regulatory_owner_unit_id, ['AUTHOR']))
    actions += (selection.pending.length ? '' : button('version', 'New version', '', 'primary')) + (openCorrection
      ? link(correctionPath(i, v, openCorrection.id), 'View pending metadata correction', 'btn')
      : button('request-metadata-correction', 'Request metadata correction'));
  const regulator = state.masters.regulator.find((r) => r.id === i.regulator_id);
  const regulatorName = regulator
    ? `${regulator.code ? esc(regulator.code) + ' — ' : ''}${esc(regulator.name)}`
    : esc(ref('regulator', i.regulator_id));
  const mainTitle = i.short_title || i.title;
  const subtitle = i.short_title && i.short_title !== i.title ? i.title : '';
  const summaryRow = (label, value) =>
    `<div class="record-summary-row"><dt>${label}</dt><dd>${value || '—'}</dd></div>`;
  const summaryCard = `<section class="record-summary-card" aria-label="Instrument details"><div class="record-summary-grid"><dl class="record-summary-column">${summaryRow('Regulator', regulatorName)}${summaryRow('Type', esc(ref('instrument_type', i.instrument_type_id)))}${summaryRow('Primary domain', esc(ref('regulatory_domain', i.primary_domain_id)))}${summaryRow('Other domains', secondary_domains.length ? secondary_domains.map((d) => esc(d.name)).join(', ') : '—')}${summaryRow('Official reference', esc(i.official_reference_number || '—'))}${summaryRow('Materiality', `<span class="record-materiality ${esc(String(i.materiality || '').toLowerCase())}"><span class="materiality-marker" aria-hidden="true"></span>${esc(title(i.materiality || 'Not set'))}</span>`)}</dl><dl class="record-summary-column">${summaryRow('Issue date', esc(date(i.issue_date)))}${summaryRow('Effective date', esc(date(i.effective_date)))}${summaryRow('Lead regulatory department', esc(ref('organisational_unit', i.regulatory_owner_unit_id)))}${summaryRow('Interpretation owner', esc(ref('user', i.interpretation_owner_user_id)))}${summaryRow('Source document', source)}${summaryRow('Keywords', esc(i.keywords || '—'))}${summaryRow('Notification family', link('notification-families/'+i.id,'Open notification family','text-link'))}</dl></div></section>`;
  const statusClassification = `<div class="record-classifications" aria-label="Regulatory and approval status"><div class="record-classification record-classification--position"><span class="record-classification-label">Regulatory position</span>${badge(i.regulatory_status)}<small>${esc(regulatoryPositionDescription(i.regulatory_status))}</small></div><div class="record-classification record-classification--approval"><span class="record-classification-label">Version approval</span>${badge(sourceEditionStatus(v))}<small>${esc(versionApprovalDescription(sourceEditionStatus(v), Boolean(v.current_version_flag)))}</small></div></div>`;
  const hero = `<div class="record-detail-header"><div class="record-detail-heading"><nav class="record-breadcrumb" aria-label="Breadcrumb"><a href="#repository">Regulatory library</a><span aria-hidden="true">/</span><code>${esc(i.code)}</code></nav><div class="record-title-line"><h1>${esc(mainTitle)}</h1></div>${subtitle ? `<p class="record-subtitle">${esc(subtitle)}</p>` : ''}${statusClassification}</div><nav class="record-shortcuts" aria-label="Related record views">${link(recordPath(i, v, 'versions'), `Source editions (${versions.length})`, 'btn')}${link(recordPath(i, v, 'clauses'), `Clauses (${clauses.length})`, 'btn')}</nav>${actions ? `<div class="record-primary-actions">${actions}</div>` : ''}</div>${summaryCard}`;
  const strip = `<div class="source-edition-strip"><label for="selected-source">Source edition</label><select id="selected-source" name="selected_source_version" aria-label="Source edition">${versions.map((r) => `<option value="${r.id}" ${v.id === r.id ? 'selected' : ''}>Version ${esc(versionLabel(r.version_number))} · ${esc(title(sourceEditionStatus(r)))}${r.current_version_flag ? ' · Current' : ''}</option>`).join('')}</select><span class="small muted">Effective from ${date(v.effective_from)}${v.effective_to ? ' until ' + date(v.effective_to) + ' (exclusive)' : ''}</span>${v.effective_from > localDate() ? '<span class="tag amber">Future effective</span>' : ''}</div>`;
  const approved = selection.approvedEffective;
  let editionNotice = '';
  if (selection.invalidRequest)
    editionNotice += note('The requested edition is unavailable. The source edition shown below was selected from this record’s available editions.', 'warn');
  if (!selection.approved.length) {
    editionNotice += note('No approved source edition is available yet. You are viewing version ' + esc(versionLabel(v.version_number)) + ' · ' + esc(title(sourceEditionStatus(v))) + '.', 'warn');
  } else if (!approved) {
    editionNotice += note('No approved source edition is effective today. This edition is displayed for reference; its approval status and effective dates are shown above.', 'warn');
  } else if (v.id !== approved.id) {
    editionNotice += note('Viewing version ' + esc(versionLabel(v.version_number)) + ' · ' + esc(title(sourceEditionStatus(v))) + '. Approved version ' + esc(versionLabel(approved.version_number)) + ' remains the effective source. ' + link(recordPath(i, approved, tab), 'View approved edition', 'text-link'), v.approval_status === 'DRAFT' ? 'warn' : 'info');
  }
  if (selection.pending.length)
    editionNotice += note(selection.pending.map((pending) => 'Version ' + esc(versionLabel(pending.version_number)) + ' is pending (' + esc(title(pending.approval_status)) + '). ' +
      link(recordPath(i, pending, tab), 'Open pending edition ' + versionLabel(pending.version_number), 'text-link')).join(' ') +
      ' Complete approval or cancel the Draft before creating another edition. Withdrawing to Draft keeps it pending.' +
      (selection.pending.length > 1 ? ' Multiple pending editions were retained from earlier data. Their makers must cancel the extra Drafts before another edition can be submitted.' : ''), 'warn');
  if (v.cancelled_draft)
    editionNotice += note('<strong>Draft cancelled.</strong> ' + esc(v.cancellation_reason) +
      '<br>Cancelled by ' + esc(ref('user', v.cancelled_by)) + ' · ' + date(v.cancelled_at) +
      '. This edition is retained read-only with its source, clauses and earlier workflow history.');
  if (['IN_REVIEW', 'REVIEWED'].includes(v.approval_status)) {
    editionNotice += note('This edition is locked during review. The maker can withdraw it to Draft, or the assigned reviewer/approver can return it for correction. Editing then requires a fresh review.');
  }
  let body = '';
  if (tab === 'versions')
    body = tablePanel(
      table(
        [
          'Version',
          'Version date',
          'Effective',
          'Current',
          'Approval',
          'Clauses',
          'Change summary',
          'Approved by',
        ],
        versions.map((r) => [
          `${link(recordPath(i, r, 'overview'), esc(versionLabel(r.version_number)), 'version-row-link')}${r.id === v.id ? '<span class="version-selected-marker" aria-label="Selected version">◂</span>' : ''}`,
          date(r.version_date),
          `<span class="version-effective-range">${date(r.effective_from)} <span aria-hidden="true">→</span> ${r.effective_to ? date(r.effective_to) : 'open'}</span>`,
          r.current_version_flag ? badge('CURRENT') : '—',
          badge(sourceEditionStatus(r)),
          String(clauses.filter((c) => c.instrument_version_id === r.id).length),
          esc(r.change_summary || '—'),
          esc(r.approved_by ? ref('user', r.approved_by) : '—'),
        ]),
        { summary: false },
      ).replace('<table class="data-table">', '<table class="data-table version-history-table">'),
    );
  else if (tab === 'clauses') body = clauseView(i, v, editable, q);
  else if (tab === 'workflow')
    body = panel(
      'Review & approval lifecycle',
      (v.cancelled_draft ? note('This Draft was cancelled and has no active review workflow.') : stepFlow(v.approval_status)) +
        (v.approval_status === 'DRAFT' ? domainGuidance(domain) : '') +
        (active
          ? note(
              'Current task: ' +
                esc(title(active.stage)) +
                ' · assigned to ' +
                esc(ref('user', active.assignee_user_id)) +
                ' · due ' +
                date(active.due_at) +
                '.',
            )
          : '') +
        `<div class="record-actions actions">${workflowActions(v, active, editable)}</div>` +
        note(
          'Maker, Compliance reviewer and final approver must be different people. Technical Admin and CCO oversight do not confer content approval.',
        ) +
        `<div class="mt24">${table(
          ['Stage', 'Named decision maker', 'Decision', 'Comments'],
          tasks
            .filter((t) => t.entity_id === v.id)
            .map((t) => [
              esc(title(t.stage)),
              esc(ref('user', t.assignee_user_id)),
              esc(t.decision || 'Awaiting stage'),
              esc(t.comments || ''),
            ]),
          { summary: false },
        )}</div>`,
      { action: link('approvals', 'Open my decisions', 'btn small') },
    );
  if (tab === 'workflow' && correction) {
    const canWithdraw = correction.created_by === state.identity.user.id &&
      ['IN_REVIEW', 'REVIEWED'].includes(correction.correction_status) && covered(i.regulatory_owner_unit_id, ['AUTHOR']);
    const canDecide = correctionTask?.assignee_user_id === state.identity.user.id && covered(i.regulatory_owner_unit_id,
      [correctionTask.stage === 'COMPLIANCE_REVIEW' ? 'REVIEWER' : 'APPROVER']);
    const correctionActions = (canWithdraw ? button('correction-decision', 'Withdraw request', `data-id="${esc(correction.id)}" data-decision="WITHDRAW"`) : '') +
      (canDecide ? `<div class="row gap8">${button('correction-decision', correctionTask.stage === 'COMPLIANCE_REVIEW' ? 'Record review' : 'Approve correction', `data-id="${esc(correction.id)}" data-decision="${correctionTask.stage === 'COMPLIANCE_REVIEW' ? 'REVIEW' : 'APPROVE'}"`, 'primary')}${button('correction-decision', 'Return for correction', `data-id="${esc(correction.id)}" data-decision="RETURN"`)}${button('correction-decision', 'Reject', `data-id="${esc(correction.id)}" data-decision="REJECT"`, 'danger')}${button('correction-decision', 'Delegate task', `data-id="${esc(correction.id)}" data-decision="DELEGATE"`)}</div>` : '');
    body += `<div class="mt24">${panel('Metadata correction · ' + title(correction.correction_status),
      `<p><strong>Requested by</strong> ${esc(ref('user', correction.created_by))} · ${date(correction.created_at)}</p>${correctionSummary(correction)}<p><strong>Reason</strong><br>${esc(correction.reason)}</p>${correction.reviewer_id ? `<p class="small muted">Reviewer: ${esc(ref('user', correction.reviewer_id))}${correction.reviewed_by ? ' · Review recorded by ' + esc(ref('user', correction.reviewed_by)) : ''}${correction.approved_by ? ' · Approved by ' + esc(ref('user', correction.approved_by)) : ''}</p>` : ''}<div class="record-actions actions">${correctionActions || '<span class="small muted">This request is retained here with its review history.</span>'}</div>`,
      { action: metadata_corrections.length > 1 ? link(correctionPath(i, v, correction.id, 'history'), 'View request history', 'btn small') : '' })}</div>`;
  }
  if (tab === 'history')
    body =
      panel('Version & activity history', activity(audit)) +
      (metadata_corrections.length ? `<div class="mt24">${tablePanel(table(
        ['Requested', 'Requested by', 'Changes', 'Reason', 'Status', 'Review'],
        metadata_corrections.map((r) => [date(r.created_at), esc(ref('user', r.created_by)), correctionSummary(r), esc(r.reason), badge(r.correction_status), link(correctionPath(i, v, r.id), 'Open workflow', 'btn small')]),
        { summary: false },
      ), 'Metadata correction history')}</div>` : '') +
      `<div class="mt24">${panel('Status history', activity(history))}</div>`;
  else if (!['versions', 'clauses', 'workflow'].includes(tab))
    body = `<div class="detail-layout"><div class="stack">${panel('Source integrity', `<div class="stack-sm"><div class="row gap8">${icon('shield')}<span class="small">Source document preserved</span></div><p class="small muted">Regulatory wording and internal interpretation are maintained separately.</p><div class="divider"></div>${link(recordPath(i, v, 'clauses'), selectedClauses.length + ' source clauses / paras', 'text-link')}${link(recordPath(i, v, 'versions'), versions.length + ' source editions', 'text-link')}${link(recordPath(i, v, 'workflow'), 'Review & approval lifecycle', 'text-link')}</div>`)}${panel('Latest activity', activity(audit.slice(0, 2)))}</div></div><div class="mt24">${panel('Next step', `<div class="actions">${editable ? link(recordPath(i, v, 'clauses'), 'Capture source clauses / paras', 'btn') : ''}${workflowActions(v, active, editable) || link(recordPath(i, v, 'workflow'), 'View workflow', 'btn')}</div>`)}</div>`;
  const discussion = panel(
    'Discussion',
    comments
      .map(
        (c) =>
          `<div class="runtime-audit-event">${icon('message')}<div><strong>${esc(ref('user', c.created_by))}</strong><small> · ${date(c.created_at)}</small><p>${esc(c.comment_text)}</p></div></div>`,
      )
      .join('') +
      (covered(i.regulatory_owner_unit_id, [
        'AUTHOR',
        'REVIEWER',
        'APPROVER',
        'CCO',
        'BUSINESS_OWNER',
        'CONTROL_OWNER',
        'EVIDENCE_OWNER',
      ])
        ? `<form id="comment" class="mt16">${field('Add a comment', area('text', '', 'required minlength="3"'))}<button class="btn primary mt16" type="submit">Add comment</button></form>`
        : '<p class="small muted mt16">Your access to this scope is read-only.</p>'),
  );
  return (
    hero +
    `<div id="record-sections" class="record-sections">` +
      tabs(
      [
        ['overview', 'Overview'],
        ['versions', 'Versions', versions.length],
        ['clauses', 'Clauses', selectedClauses.length],
        ['workflow', 'Workflow'],
        ['history', 'History', audit.length + metadata_corrections.length],
      ],
      tab,
      'repository/' + i.id,
      q,
      ) +
      strip +
      `<div class="source-edition-notices">${editionNotice}</div>` +
      body +
      `<div class="mt24">${discussion}</div></div>`
  );
}
