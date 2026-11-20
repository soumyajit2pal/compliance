import { has } from '../core/access.ts';
import { state } from '../core/state.ts';
import { rbiWorkflowPath } from '../core/task-queues.ts';
import { esc } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { canNavigate } from '../ui/layout.ts';

interface WorkflowLink {
  permission: string;
  path: string;
  label: string;
}

interface WorkflowStep {
  title: string;
  description: string;
  links: WorkflowLink[];
}

function workflowLink(path: string, label: string, primary = false) {
  return `<a class="btn ${primary ? 'primary' : ''}" href="#${esc(path)}">${esc(label)}${icon('arrow')}</a>`;
}

export function rbiWorkflowPage() {
  const regulator = state.masters?.regulator?.find(record => record.code === 'RBI');
  const library = regulator ? 'repository?' + new URLSearchParams({regulator_id: regulator.id}) : 'repository';
  const author = has('AUTHOR');
  const steps: WorkflowStep[] = [
    {
      title: 'Register the notification',
      description: 'Register the official reference and attach the original RBI document to create a draft. Use Notification families to record how an amendment, clarification or superseding notification relates to the earlier source.',
      links: [
        ...(author ? [{permission: 'repository', path: 'repository/new', label: 'Register notification'}] : []),
        {permission: 'notification-families', path: 'notification-families', label: 'Notification families'},
      ],
    },
    {
      title: 'Capture the edition and clauses',
      description: 'Open the draft source edition and enter Clauses / Para using RBI’s original numbering. Keep the bank’s interpretation separate from the source wording. Create a new edition when the source wording changes.',
      links: [{permission: 'repository', path: library, label: regulator ? 'Open RBI library' : 'Regulatory library'}],
    },
    {
      title: 'Review and approve the source',
      description: 'The named Compliance reviewer checks the source, clauses and interpretation. A separate approver records the final decision before the edition can become current.',
      links: [{permission: 'approvals', path: 'approvals?queue=rbi', label: 'My RBI decisions'}],
    },
    {
      title: 'Create obligations from approved clauses',
      description: 'Capture each actionable requirement as an obligation. Link the approved clause and record what evidence is required, its criticality and how often it must be reviewed.',
      links: author && canNavigate('obligations')
        ? [{permission: 'obligations', path: 'obligations/new', label: 'Add obligation'}]
        : [{permission: 'clauses', path: 'clauses?view=register', label: 'Browse clauses'}],
    },
    {
      title: 'Assign ownership and confirm responsibilities',
      description: 'Set the accountable department and name the required business and check owners. After Compliance review, the assigned owners confirm their responsibilities or request changes.',
      links: canNavigate('obligations')
        ? [{permission: 'accountability', path: 'obligations?view=accountability', label: 'Accountability'}] : [],
    },
    {
      title: 'Assess applicability and record the decision',
      description: 'Record which departments and activities the obligation covers. Explain any partial or non-applicability and record the required review and final approval in the obligation workflow.',
      links: canNavigate('obligations')
        ? [{permission: 'applicability', path: 'obligations?view=applicability', label: 'Applicability'}] : [],
    },
    {
      title: 'Assign work and review period evidence',
      description: 'Assign work for an active obligation. The owner submits the outcome and evidence for that period. The independent reviewer accepts the required evidence and any required check results before closing the work item.',
      links: [
        {permission: 'actions', path: 'actions', label: 'Compliance work tracker'},
        {permission: 'evidence', path: 'evidence', label: 'Evidence library'},
      ],
    },
  ];

  return `<section class="rbi-workflow" aria-labelledby="rbi-workflow-title">
    <header class="rbi-workflow-header">
      <div><h1 id="rbi-workflow-title">RBI notification workflow</h1>
      <p>Follow an RBI circular or amendment from registration through independent approvals, department work and evidence review.</p></div>
      ${workflowLink(rbiWorkflowPath + '&view=assignments', 'My RBI assignments', true)}
    </header>
    <ol class="rbi-workflow-steps" role="list">
      ${steps.map((step, index) => {
        const links = step.links.filter(item => canNavigate(item.permission));
        return `<li class="rbi-workflow-step">
          <span class="rbi-workflow-number" aria-hidden="true">${index + 1}</span>
          <div><h2>${esc(step.title)}</h2><p>${esc(step.description)}</p></div>
          ${links.length ? `<div class="rbi-workflow-links">${links.map(item => workflowLink(item.path, item.label)).join('')}</div>` : ''}
        </li>`;
      }).join('')}
    </ol>
  </section>`;
}
