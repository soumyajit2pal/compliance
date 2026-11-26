import { api } from '../../core/api.ts';
import { choosePeople } from '../../core/assignees.ts';
import { state } from '../../core/state.ts';
import { dateTime, area, badge, button, date, esc, field, message, preservedText, ref, select, title } from '../../ui/components.ts';
import { close, modal } from '../../ui/dialog.ts';
import { workflowActionGroup, workflowButton, workflowSubmit } from '../../ui/workflow-actions.ts';

const decisionLabels = {
  REVIEW: 'Record Compliance review', APPROVE: 'Approve bank interpretation',
  RETURN: 'Return for correction', REJECT: 'Reject interpretation', WITHDRAW: 'Withdraw request',
};

export function interpretationPanel(clause, register, selectedId) {
  const actions = register.can_submit
    ? button('submit-clause-interpretation', 'Submit bank interpretation for review', `data-id="${esc(clause.id)}"`, 'primary')
    : '';
  const requests = register.requests.map(request => {
    const status = request.record_status === 'OPEN'
      ? request.current_stage === 'COMPLIANCE_REVIEW' ? 'IN_REVIEW' : 'REVIEWED'
      : request.record_status;
    const decisions = request.decisions.map(decision => workflowButton('decide-clause-interpretation',
      decisionLabels[decision], decision, `data-id="${esc(request.id)}" data-decision="${esc(decision)}"`)).join('');
    const history = request.decisions_history.map(task => `<li><strong>${esc(title(task.decision))}</strong> · ${esc(ref('user', task.acted_by))}
      · ${dateTime(task.acted_at)}<p>${esc(task.comments || '')}</p></li>`).join('');
    return `<details class="obligation-extra-details" ${request.id === selectedId || request.record_status === 'OPEN' ? 'open' : ''}>
      <summary>${esc(ref('user', request.started_by))} · ${dateTime(request.created_at)} ${badge(status)}</summary>
      <div>${request.assigned_to ? `<p>Assigned to ${esc(ref('user', request.assigned_to))}</p>` : ''}
        <p>${esc(request.reason)}</p>${preservedText('clause-working-text', request.interpretation)}
        ${history ? `<ul>${history}</ul>` : ''}${decisions ? workflowActionGroup(decisions) : ''}
      </div></details>`;
  }).join('');
  return `<section class="panel" id="clause-interpretation-panel" aria-labelledby="clause-interpretation-heading">
    <div class="panel-head"><div><h3 id="clause-interpretation-heading">Bank interpretation review</h3>
    <p>Decisions apply to this exact clause and source edition.</p></div>${actions}</div>
    <div class="panel-body">${requests || '<p>No separate bank interpretation requests have been submitted.</p>'}</div>
  </section>`;
}

export function interpretationHandlers(render) {
  return {
    actions: {
      'submit-clause-interpretation': async ({ id }, trigger: HTMLElement) => {
        const { regulatory_owner_unit_id: unit } = state.record.instrument;
        const { id: actor } = state.identity.user;
        const [reviewers, approvers] = await Promise.all([
          choosePeople('REVIEWER', unit, [actor]), choosePeople('APPROVER', unit, [actor]),
        ]);
        if (!trigger.isConnected) return;
        if (!reviewers.some(reviewer => approvers.some(approver => approver.id !== reviewer.id))) {
          modal('Review assignments unavailable', '<p>Select an independent reviewer and final approver for this department. Ask an Admin to check the role assignments.</p>');
          return;
        }
        const previous = state.record.interpretation_requests?.requests.find(request => request.started_by === actor);
        modal('Submit bank interpretation for review',
          field('Bank interpretation', area('interpretation', previous?.interpretation || '', 'required maxlength="50000"')) +
          field('Submission notes', area('comments', '', 'required minlength="3" maxlength="10000"')) +
          field('Compliance reviewer', select('reviewer_id', reviewers, '', 'full_name', 'required')) +
          field('Final approver', select('approver_id', approvers, '', 'full_name', 'required')),
          'clause-interpretation-submit', 'Send for Compliance review', '', trigger);
        document.querySelector<HTMLFormElement>('#clause-interpretation-submit').dataset.clauseId = id;
      },
      'decide-clause-interpretation': ({ id, decision }, trigger: HTMLElement) => {
        const request = state.record.interpretation_requests?.requests.find(row => row.id === id);
        if (!request?.decisions.includes(decision)) throw new Error('Refresh to see which decisions are available.');
        const label = decisionLabels[decision];
        modal(label, preservedText('clause-working-text', request.interpretation) +
          field('Decision and rationale', area('comments', '', 'required minlength="3" maxlength="10000"')),
          'clause-interpretation-decision', workflowSubmit(label, decision), '', trigger);
        const form = document.querySelector<HTMLFormElement>('#clause-interpretation-decision');
        Object.assign(form.dataset, { requestId: id, decision });
      },
    },
    forms: {
      'clause-interpretation-submit': async (form: HTMLFormElement) => {
        const values = Object.fromEntries(new FormData(form));
        if (values.reviewer_id === values.approver_id) throw new Error('Choose a different person for final approval.');
        const result = await api('/clauses/' + encodeURIComponent(form.dataset.clauseId) + '/interpretation-requests', 'POST', values);
        close();
        location.hash = result.action_path;
        message('Bank interpretation sent for independent Compliance review.');
      },
      'clause-interpretation-decision': async (form: HTMLFormElement) => {
        await api('/clause-interpretation-requests/' + encodeURIComponent(form.dataset.requestId) + '/decision', 'POST', {
          ...Object.fromEntries(new FormData(form)), decision: form.dataset.decision,
        });
        close();
        message('Interpretation decision recorded.');
        await render();
      },
    },
  };
}
