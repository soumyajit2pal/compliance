import { covered } from '../../core/access.ts';
import { isPendingEdition, sourceEditionStatus } from '../../core/source-editions.ts';
import { state } from '../../core/state.ts';
import { button, date, esc, link, localDate, ref, versionLabel } from '../../ui/components.ts';
import { domainReadiness } from '../../ui/domains.ts';
import { workflowActionGroup, workflowButton } from '../../ui/workflow-actions.ts';

interface EditionStep {
  tone?: 'action' | 'blocked' | 'waiting';
  heading: string;
  text: string;
  details?: string;
  action?: string;
  secondary?: string;
  shortcut?: {
    label: string;
    heading?: string;
    text?: string;
    opensSubmission?: boolean;
  };
}

export function missingInterpretations(record, version) {
  return record.clauses.filter(clause => clause.instrument_version_id === version.id &&
    !clause.heading_only_flag && !(clause.internal_interpretation || '').trim());
}

export function missingInterpretationLinks(record, version, clauses) {
  return `<ul>${clauses.map(clause => `<li>${link('repository/' + record.instrument.id + '?' +
    new URLSearchParams({ version: version.id, tab: 'clauses', clause: clause.id }),
    clause.source_clause_reference || clause.code, 'text-link')} · ${esc(clause.heading || 'Clause / Para')}</li>`).join('')}</ul>`;
}

function draftSubmission(record, version, editable, clausesPath): EditionStep {
  if (!editable) {
    return {
      heading: 'Waiting for the draft maker',
      text: `${ref('user', version.created_by)} prepares this edition and submits it for Compliance review. The named reviewer receives the first decision in My decisions.`,
    };
  }
  const domainIds = new Set([record.instrument.primary_domain_id, ...(record.secondary_domains || []).map(domain => domain.id)]);
  const blockedDomains = [...domainIds].flatMap(id => {
    const domain = state.masters.regulatory_domain.find(item => item.id === id);
    const readiness = domainReadiness(domain);
    return readiness?.ready ? [] : [`${domain?.name || 'Affected domain'} · ${readiness?.reason || 'Setup information unavailable'}`];
  });
  const missingClauses = !record.clauses.some(clause =>
    clause.instrument_version_id === version.id && !clause.heading_only_flag);
  const blockers = [
    ...(!version.source_document_id ? ['Attach the source document.'] : []),
    ...(missingClauses ? ['Add at least one source clause or para to this edition.'] : []),
    ...blockedDomains,
    ...(record.versions.some(other => other.id !== version.id && isPendingEdition(other))
      ? ['Resolve the other pending edition before submitting this one.'] : []),
  ];
  if (blockers.length) {
    const adminPath = 'Administration → Master data → Regulatory domains → Set owner';
    return {
      tone: 'blocked',
      heading: 'Submission blocked',
      text: 'Complete the outstanding items before you can send this draft for review.',
      details: `<ul>${blockers.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` + (blockedDomains.length
        ? `<p>Ask an Admin to complete domain setup in <strong>${esc(adminPath)}</strong>. Refresh after setup is complete.</p>`
        : ''),
      action: (!version.source_document_id ? button('edit-version', 'Attach source document') : '') +
        (missingClauses ? link(clausesPath, 'Open Clauses', 'btn') : '') +
        (blockedDomains.length && state.identity.menu.some(item => item.id === 'masters')
          ? link('masters?tab=domains', 'Open Regulatory domains', 'btn') : ''),
      shortcut: { label: 'Check submission requirements', text: blockers[0] },
    };
  }
  const missing = missingInterpretations(record, version);
  if (missing.length) return {
    tone: 'blocked',
    heading: 'Bank interpretation required',
    text: 'Add an interpretation to the clauses below before submitting this edition. You can request an exception with a reason and confirmation.',
    details: missingInterpretationLinks(record, version, missing),
    action: link(clausesPath, 'Open Clauses / Para', 'btn primary') +
      button('submit-version', 'Request interpretation exception', 'data-exception="true"'),
    shortcut: { label: 'Check missing interpretations' },
  };
  return {
    tone: 'action',
    heading: 'Ready to submit for review',
    text: 'Choose a Compliance reviewer and a different final approver. The reviewer gets the first task after you send the draft.',
    action: button('submit-version', 'Submit for Compliance review', '', 'primary'),
    shortcut: {
      heading: 'Send this draft for Compliance review',
      label: 'Choose reviewer and approver',
      opensSubmission: true,
    },
  };
}

export function editionNextStep(record, version, active, editable, clausesPath): EditionStep {
  const status = sourceEditionStatus(version);
  const unit = record.instrument.regulatory_owner_unit_id;
  const actor = state.identity.user.id;
  if (status === 'DRAFT') return draftSubmission(record, version, editable, clausesPath);
  if (active && ['IN_REVIEW', 'REVIEWED'].includes(status)) {
    const isReview = active.stage === 'COMPLIANCE_REVIEW';
    const stage = isReview ? 'Compliance review' : 'Final approval';
    const isAssignee = active.assignee_user_id === actor;
    const canDecide = isAssignee && actor !== version.created_by &&
      (isReview ? status === 'IN_REVIEW' : active.stage === 'FINAL_APPROVAL' && status === 'REVIEWED' &&
        version.reviewed_by && actor !== version.reviewed_by) &&
      covered(unit, [isReview ? 'REVIEWER' : 'APPROVER']);
    const approver = isReview && record.tasks.find(task =>
      task.instance_id === active.instance_id && task.stage === 'FINAL_APPROVAL' && !task.decision);
    const missing = missingInterpretations(record, version);
    const exceptionReason = active.interpretation_exception_reason;
    const canAdvance = !missing.length || Boolean(exceptionReason);
    const assignee = ref('user', active.assignee_user_id);
    const assignment = `<p><strong>${esc(stage)} assigned to ${esc(assignee)}</strong>${active.due_at ? ' · Due ' + date(active.due_at) : ''}</p>`;
    const handoff = approver
      ? `<p>After review, ${esc(ref('user', approver.assignee_user_id))} receives final approval in My decisions.</p>`
      : '';
    const secondary = (canDecide
      ? workflowButton('decision', 'Delegate task', 'DELEGATE', 'data-decision="DELEGATE"')
      : '') + (version.created_by === actor && covered(unit, ['AUTHOR'])
        ? workflowButton('decision', 'Withdraw to Draft', 'WITHDRAW', 'data-decision="WITHDRAW"')
        : '');
    return {
      tone: canDecide ? 'action' : 'waiting',
      heading: canDecide ? (isReview ? 'Your Compliance review' : 'Your final approval') : `Waiting for ${isReview ? 'Compliance review' : 'final approval'}`,
      text: canDecide
        ? (isReview ? 'Check the source document and clauses, then record your Compliance review here.' :
          'Compliance review is complete. Check the source and clauses, then record your final decision here.')
        : (isAssignee ? 'This assignment requires current role, scope and independence checks before you can act.' :
          'The named recipient opens this edition from My decisions to record the decision.'),
      details: assignment + handoff + (missing.length ? `<p><strong>${exceptionReason ? 'Interpretation exception requested' : 'Interpretation exception required'}</strong></p>
        <p>${exceptionReason ? esc(exceptionReason) : 'Return this edition to Draft so the Author can add interpretations or submit an exception.'}</p>
        ${missingInterpretationLinks(record, version, missing)}` : ''),
      action: canDecide
        ? workflowActionGroup((canAdvance ? workflowButton('decision', isReview ? 'Record Compliance review' : 'Approve source edition',
          isReview ? 'REVIEW' : 'APPROVE', isReview ? 'data-decision="REVIEW"' : 'data-decision="APPROVE"') : '') +
          workflowButton('decision', 'Return for correction', 'RETURN', 'data-decision="RETURN"') +
          workflowButton('decision', 'Reject', 'REJECT', 'data-decision="REJECT"')) +
          link(clausesPath, 'View source clauses', 'btn')
        : '',
      secondary,
      shortcut: canDecide
        ? { label: isReview ? 'Open Compliance review' : 'Open final approval' }
        : { label: 'View review status', text: isAssignee ? undefined : `${assignee} has the ${stage} task in My decisions.` },
    };
  }
  if (['IN_REVIEW', 'REVIEWED'].includes(status))
    return { heading: 'Decision assignment unavailable', text: 'Refresh this edition to check for a current assignment.' };
  if (status === 'APPROVED') {
    const canActivate = !version.current_version_flag && !version.effective_to &&
      version.effective_from <= localDate() && covered(unit, ['APPROVER']);
    const pending = record.clauses.some(clause => clause.instrument_version_id === version.id && !clause.heading_only_flag && clause.interpretation_status === 'PENDING');
    return {
      heading: 'Source edition approved',
      text: pending ? 'Some clauses still need an approved bank interpretation. Open Clauses / Para to see their status.' : 'Compliance review and final approval are complete for this edition.',
      action: (pending ? link(clausesPath, 'Open Clauses / Para', 'btn') : '') + (canActivate ? button('activate', 'Make effective version current') : ''),
    };
  }
  return { heading: `Source edition ${status.toLowerCase()}`, text: 'The workflow is closed. Previous decisions remain in the history.' };
}

export function renderEditionHeaderNextStep(step: EditionStep, workflowPath: string) {
  const shortcut = step.shortcut;
  if (!shortcut) return '';
  const action = shortcut.opensSubmission
    ? button('submit-version', shortcut.label, 'aria-describedby="record-next-step-description"', 'primary', 'users')
    : link(workflowPath, shortcut.label, step.tone === 'action' ? 'btn primary' : 'btn', 'arrow');
  return `<section class="record-edition-next-step" data-tone="${step.tone}" aria-labelledby="record-next-step-heading">
    <div>
      <span class="record-next-step-label">${step.tone === 'waiting' ? 'Review status' : 'Next step'}</span>
      <h2 id="record-next-step-heading">${esc(shortcut.heading || step.heading)}</h2>
      <p id="record-next-step-description">${esc(shortcut.text || step.text)}</p>
    </div>
    ${action}
  </section>`;
}

export function renderEditionNextStep(step: EditionStep, version) {
  return `<div class="edition-next-step ${step.tone || ''}">
    <span class="edition-next-step-label">Next step · Edition ${esc(versionLabel(version.version_number))}</span>
    <h3 id="edition-next-step-heading" tabindex="-1">${esc(step.heading)}</h3>
    <p>${esc(step.text)}</p>
    ${step.details || ''}
    ${step.action ? `<div class="actions edition-next-step-actions">${step.action}</div>` : ''}
  </div>${step.secondary ? `<div class="edition-other-actions"><strong>Other workflow actions</strong><div class="actions">${step.secondary}</div></div>` : ''}`;
}
