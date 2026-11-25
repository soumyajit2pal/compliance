import {workflowLink} from '../ui/workflow-actions.ts';
import { rbiWorkflowPath, showRbiWorkflowGuide, taskQueue } from '../core/task-queues.ts';
import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import {
  esc,
  ref,
  title,
  badge,
  date,
  localDate,
  link,
  button,
  versionLabel,
} from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { heading, pageHelp } from '../ui/layout.ts';
import { note, tabs, table, tablePanel, person, searchForm, recordCell, pagedCollection } from '../ui/widgets.ts';
import { rbiWorkflowPage } from './rbi-workflow.ts';

export async function tasksPage(page, query = new URLSearchParams()) {
  const queue=query.get('queue')||'';
  const rbi=queue==='rbi';
  if (page==='tasks' && showRbiWorkflowGuide(query)) {
    return rbiWorkflowPage();
  }
  const tab = query.get('tab') || 'all',
    q = (query.get('q') || '').toLowerCase();
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const end = week.toLocaleDateString('en-CA');
  const sourceRows = await api('/instruments');
  const sources = new Map<string, any>(sourceRows.map((r) => [r.id, r]));
  const all = taskQueue((state.work || []).filter((t) => page !== 'approvals' || t.kind === 'DECISION'),queue,sourceRows,state.masters.regulator||[]);
  let rows = all.filter(
    (t) =>
      !q ||
      JSON.stringify({ ...t, source: sources.get(t.instrument_id) })
        .toLowerCase()
        .includes(q),
  );
  if (tab === 'due')
    rows = rows.filter(
      (t) => t.due_at && t.due_at.slice(0, 10) >= localDate() && t.due_at.slice(0, 10) <= end,
    );
  if (tab === 'overdue') rows = rows.filter((t) => t.due_at && t.due_at.slice(0, 10) < localDate());
  if (tab === 'returned') rows=rows.filter(t=>t.return_reason);
  if (tab === 'draft') rows = rows.filter((t) => t.kind === 'DRAFT');
  rows.sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999'));
  const taskPath = (task) => task.action_path || (task.workflow_kind === 'OWNERSHIP_CHANGE'
    ? 'obligations/'+task.obligation_id+'?tab=owners&ownership_change='+task.ownership_change_id
    : task.workflow_kind === 'OBLIGATION'
    ? 'obligations/'+task.obligation_id+'?tab=workflow'
    : task.workflow_kind === 'FAMILY'
    ? 'notification-families/'+task.instrument_id+'?proposal='+task.proposal_id
    : task.workflow_kind === 'METADATA_CORRECTION'
    ? 'repository/' + task.instrument_id + '?tab=workflow&correction=' + task.correction_id
    : 'repository/' + task.instrument_id + '?version=' + task.version_id + '&tab=workflow');
  const nextAction = (task) => {
    if (task.workflow_kind === 'MIGRATION_IMPORT') return task.kind === 'DECISION'
      ? workflowLink(taskPath(task), 'Open import review')
      : link(taskPath(task), 'Open ready import', 'btn small');
    if (page !== 'approvals') return task.kind === 'DECISION'
      ? workflowLink(taskPath(task), 'Open assigned work')
      : link(taskPath(task), 'Open assigned work', 'btn small');
    const editionDecision = !task.workflow_kind && task.version_id;
    if (editionDecision && task.stage === 'COMPLIANCE_REVIEW')
      return workflowLink(taskPath(task), 'Open Compliance review');
    if (editionDecision && task.stage === 'FINAL_APPROVAL')
      return workflowLink(taskPath(task), 'Open final approval');
    return workflowLink(taskPath(task), 'Open decision');
  };
  return (
    pageHelp(
      page === 'approvals' ? 'Know which decisions are yours' : 'Your personal work',
      'Work appears here when it is assigned to you or your role can act on an item in a shared queue.',
      page === 'approvals' ? 'decisions' : 'work-evidence',
    ) +
    heading(
      rbi?(page==='approvals'?'My RBI decisions':'My RBI assignments'):page === 'approvals' ? 'My decisions' : 'My tasks',
      rbi?'Your named assignments linked to RBI instruments you can access.':page === 'approvals'
        ? 'Open an available review or approval and record your decision.'
        : 'Assignments and shared tasks you can act on within your role and organisation scope.',
      `<div class="actions">${rbi?link(rbiWorkflowPath,'RBI workflow guide','btn'):''}${link('tasks','All my tasks','btn '+(page==='tasks'&&!rbi?'primary':''))}${link('approvals','My decisions','btn '+(page==='approvals'&&!rbi?'primary':''))}${state.identity.menu.some(i=>i.id==='actions')?link('actions','Compliance work tracker','btn'):''}</div>`,
    ) +
    note(all.some(task => task.shared)
      ? 'Independent import reviews appear in a shared Reviewer queue. Once an eligible Reviewer validates a batch, that review closes for everyone.'
      : 'Department visibility does not assign its work to you. Open a register to see the team’s work.') +
    tabs(
      [
        ['all', page === 'approvals' ? 'My decision tasks' : 'All assigned work', all.length],
        ['due', 'Due in next 7 days'],
        ['overdue', 'Overdue'],
        ...(page === 'tasks' ? [['returned','Returned actions'],['draft', 'Drafts to complete']] : []),
      ],
      tab,
      page,
      query,
    ) +
    searchForm(
      'view-filter',
      'Search your ' + (page === 'approvals' ? 'decisions' : 'tasks') + '…',
      query.get('q') || '',
      `<input type="hidden" name="tab" value="${esc(tab)}">${queue?`<input type="hidden" name="queue" value="${esc(queue)}">`:''}${rbi&&page==='tasks'?'<input type="hidden" name="view" value="assignments">':''}`,
    ) +
    tablePanel(
      table(
        [
          'Assigned record',
          'Workflow stage',
          'Who can act',
          'Department',
          'Due date',
          'Next step',
        ],
        rows.map((t) => [
          recordCell(
            ['OBLIGATION','OWNERSHIP_CHANGE','ACTION','ACTION_EXTENSION','CONTROL','LEAVE_DELEGATION','MIGRATION_IMPORT'].includes(t.workflow_kind)?t.code:sources.get(t.instrument_id)?.code || t.kind,
            ['OBLIGATION','OWNERSHIP_CHANGE','ACTION','ACTION_EXTENSION','CONTROL','LEAVE_DELEGATION','MIGRATION_IMPORT'].includes(t.workflow_kind)?t.title:sources.get(t.instrument_id)?.title || t.title,
            taskPath(t),
          )+(t.return_reason?`<small class="portal-overdue">Returned: ${esc(t.return_reason)}</small>`:''),
          badge(t.kind === 'DRAFT' ? 'DRAFT' : t.stage || 'DECISION'),
          t.shared ? 'Shared Reviewer queue' : person(state.identity.user.full_name),
          esc(ref('organisational_unit', t.department_id||sources.get(t.instrument_id)?.regulatory_owner_unit_id)),
          date(t.due_at) +
            (t.due_at && t.due_at.slice(0, 10) < localDate()
              ? '<small class="portal-overdue">Overdue</small>'
              : ''),
          nextAction(t),
        ]),
      ),
      page === 'approvals' ? 'Assigned decisions' : 'Assigned work',
    )
  );
}
export async function notificationsPage(_id, query = new URLSearchParams()) {
  const tab = query.get('tab') || 'all',
    all = state.notifications || [],
    rows = all.filter((r) => tab !== 'unread' || !r.read_at);
  return (
    heading(
      'Notifications',
      'Access updates, assignments and decisions — with a direct route to the next step.',
      all.some((r) => !r.read_at) ? button('read-all-notifications', 'Mark all read') : '',
    ) +
    tabs(
      [
        ['all', 'All notifications', all.length],
        ['unread', 'Unread', all.filter((r) => !r.read_at).length],
      ],
      tab,
      'notifications',
      query,
    ) +
    tablePanel(
      pagedCollection(rows
        .map(
          (r) =>
            `<div class="notification-item ${r.read_at ? '' : 'unread'}"><div class="notification-icon">${icon('bell')}</div><div class="grow"><h3>${esc(({EMPLOYEE_DEPARTMENT_APPROVAL_REQUIRED: 'Employee department review required', EMPLOYEE_DEPARTMENT_APPROVED: 'Employee department approved — sign in again', EMPLOYEE_DEPARTMENT_REJECTED: 'Employee department request rejected', LDAP_DEPARTMENT_APPROVAL_REQUIRED: 'LDAP department approval required', LDAP_DEPARTMENT_APPROVED: 'LDAP department approved — sign in again', LDAP_DEPARTMENT_REJECTED: 'LDAP department request rejected', LDAP_PROFILE_CONFIRMATION_PENDING: 'LDAP profile confirmation pending', ACCESS_APPROVAL_REQUIRED: 'Access approval or role assignment required', ACCESS_ROLES_ASSIGNED: 'User roles assigned', LDAP_PROFILE_CONFIRMED: 'LDAP profile confirmed', USER_ACCESS_UPDATED: 'User access updated'})[r.notification_type] || title(r.notification_type))}</h3><p>${esc(r.source_title || 'Historical workflow update')}</p>${r.message ? `<p>${esc(r.message)}</p><span class="tag neutral">Current status: ${esc(r.access_status_label)}</span>` : ''}<small>${date(r.triggered_at)}${r.version_number ? ' · Version ' + esc(versionLabel(r.version_number)) : ''}</small>${r.action_path ? link(r.action_path, r.action_label + ' →', 'text-link') : r.instrument_id ? link('repository/' + r.instrument_id + (r.entity_type === 'metadata_correction' ? '?tab=workflow&correction=' + r.entity_id : '?version=' + r.entity_id + '&tab=workflow'), r.entity_type === 'metadata_correction' ? 'Open correction request →' : 'Open source version →', 'text-link') : ''}</div>${!r.read_at ? button('read-notification', 'Mark read', `data-id="${r.id}"`, 'small') : ''}</div>`,
        ),{pageKey:'notifications',label:'notifications',empty:
        `<div class="empty">${icon('check')}<h3>You’re all caught up</h3><p>There are no ${tab === 'unread' ? 'unread ' : ''}notifications.</p></div>`}),
    )
  );
}
export function workHandlers({ render }) {
  return {
    actions: {
      'read-notification': async ({ id }) => {
        await api('/notifications/' + id + '/read', 'POST', {});
        await render();
      },
      'read-all-notifications': async () => {
        for (const r of state.notifications.filter((n) => !n.read_at))
          await api('/notifications/' + r.id + '/read', 'POST', {});
        await render();
      },
    },
    forms: {},
  };
}
