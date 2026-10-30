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
import { note, tabs, table, tablePanel, person, searchForm, recordCell } from '../ui/widgets.ts';

export async function tasksPage(page, query = new URLSearchParams()) {
  const tab = query.get('tab') || 'all',
    q = (query.get('q') || '').toLowerCase();
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const end = week.toLocaleDateString('en-CA');
  const sourceRows = await api('/instruments');
  const sources = new Map<string, any>(sourceRows.map((r) => [r.id, r]));
  const all = (state.work || []).filter((t) => page !== 'approvals' || t.kind === 'DECISION');
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
  if (tab === 'draft') rows = rows.filter((t) => t.kind === 'DRAFT');
  rows.sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999'));
  const taskPath = (task) => task.workflow_kind === 'FAMILY'
    ? 'notification-families/'+task.instrument_id+'?proposal='+task.proposal_id
    : task.workflow_kind === 'METADATA_CORRECTION'
    ? 'repository/' + task.instrument_id + '?tab=workflow&correction=' + task.correction_id
    : 'repository/' + task.instrument_id + '?version=' + task.version_id + '&tab=workflow';
  return (
    pageHelp(
      page === 'approvals' ? 'Know which decisions are yours' : 'Your personal work',
      'A role grants eligibility. A named, in-scope assignment is still needed before work appears here.',
    ) +
    heading(
      page === 'approvals' ? 'My decisions' : 'My work',
      page === 'approvals'
        ? 'Review the source and record the decision for your assigned stage.'
        : 'Personal assignments that your role and organisation scope permit you to perform.',
    ) +
    note(
      'Department visibility does not assign its work to you. Open a register for the team population; this list contains your named actionable work.',
    ) +
    tabs(
      [
        ['all', page === 'approvals' ? 'My decision tasks' : 'All assigned work', all.length],
        ['due', 'Due in next 7 days'],
        ['overdue', 'Overdue'],
        ...(page === 'tasks' ? [['draft', 'Drafts to complete']] : []),
      ],
      tab,
      page,
      query,
    ) +
    searchForm(
      'view-filter',
      'Search your ' + (page === 'approvals' ? 'decisions' : 'tasks') + '…',
      query.get('q') || '',
      `<input type="hidden" name="tab" value="${esc(tab)}">`,
    ) +
    tablePanel(
      table(
        [
          'Assigned record',
          'Workflow stage',
          'Named recipient',
          'Department',
          'Due date',
          'Next step',
        ],
        rows.map((t) => [
          recordCell(
            sources.get(t.instrument_id)?.code || t.kind,
            sources.get(t.instrument_id)?.title || t.title,
            taskPath(t),
          ),
          badge(t.kind === 'DRAFT' ? 'DRAFT' : t.stage || 'DECISION'),
          person(state.identity.user.full_name),
          esc(ref('organisational_unit', sources.get(t.instrument_id)?.regulatory_owner_unit_id)),
          date(t.due_at) +
            (t.due_at && t.due_at.slice(0, 10) < localDate()
              ? '<small class="portal-overdue">Overdue</small>'
              : ''),
          link(
            taskPath(t),
            page === 'approvals' ? 'Open decision' : 'Open assigned work',
            'btn small',
          ),
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
      rows
        .map(
          (r) =>
            `<div class="notification-item ${r.read_at ? '' : 'unread'}"><div class="notification-icon">${icon('bell')}</div><div class="grow"><h3>${esc(({LDAP_DEPARTMENT_APPROVAL_REQUIRED: 'LDAP department approval required', LDAP_DEPARTMENT_APPROVED: 'LDAP department approved — sign in again', LDAP_DEPARTMENT_REJECTED: 'LDAP department request rejected', LDAP_PROFILE_CONFIRMATION_PENDING: 'LDAP profile confirmation pending', ACCESS_APPROVAL_REQUIRED: 'Access approval or role assignment required', ACCESS_ROLES_ASSIGNED: 'User roles assigned', LDAP_PROFILE_CONFIRMED: 'LDAP profile confirmed', USER_ACCESS_UPDATED: 'User access updated'})[r.notification_type] || title(r.notification_type))}</h3><p>${esc(r.source_title || 'Historical workflow update')}</p>${r.message ? `<p>${esc(r.message)}</p><span class="tag neutral">Current status: ${esc(r.access_status_label)}</span>` : ''}<small>${date(r.triggered_at)}${r.version_number ? ' · Version ' + esc(versionLabel(r.version_number)) : ''}</small>${r.action_path ? link(r.action_path, r.action_label + ' →', 'text-link') : r.instrument_id ? link('repository/' + r.instrument_id + (r.entity_type === 'metadata_correction' ? '?tab=workflow&correction=' + r.entity_id : '?version=' + r.entity_id + '&tab=workflow'), r.entity_type === 'metadata_correction' ? 'Open correction request →' : 'Open source version →', 'text-link') : ''}</div>${!r.read_at ? button('read-notification', 'Mark read', `data-id="${r.id}"`, 'small') : ''}</div>`,
        )
        .join('') ||
        `<div class="empty">${icon('check')}<h3>You’re all caught up</h3><p>There are no ${tab === 'unread' ? 'unread ' : ''}notifications.</p></div>`,
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
