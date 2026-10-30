import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { has } from '../core/access.ts';
import { esc, title, date, localDate, link } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { stat, person, note } from '../ui/widgets.ts';
import { canNavigate } from '../ui/layout.ts';

function taskLink(t) {
  if(t.workflow_kind==='FAMILY')return 'notification-families/'+t.instrument_id+'?proposal='+t.proposal_id;
  if(t.workflow_kind==='METADATA_CORRECTION')return 'repository/'+t.instrument_id+'?tab=workflow&correction='+t.correction_id;
  return 'repository/' + t.instrument_id + '?version=' + t.version_id + '&tab=workflow';
}
export async function homePage() {
  const admin = state.identity.roles.every((r) => r === 'ADMIN');
  const oversight = has('CCO', 'ZONE_VIEWER');
  const tasks = [...(state.work || [])].sort((a, b) =>
    (a.due_at || '9999').localeCompare(b.due_at || '9999'),
  );
  const decisions = tasks.filter((t) => t.kind === 'DECISION');
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const end = week.toLocaleDateString('en-CA');
  const due = tasks.filter(
    (t) => t.due_at && t.due_at.slice(0, 10) >= localDate() && t.due_at.slice(0, 10) <= end,
  );
  let users = [],
    sources = [];
  if (admin) users = (await api('/admin/users')).users;
  else sources = await api('/instruments');
  const stats = admin
    ? [
        [
          'Active users',
          users.filter((u) => u.active_flag).length,
          'Manage accounts and access',
          'users',
          'users',
          'sage',
        ],
        [
          'Access action required',
          state.adminAccess?.action_required || 0,
          'Review approvals and missing roles',
          'users?tab=ACTION_REQUIRED',
          'users',
          'plum',
        ],
        [
          'Application roles',
          state.masters.role.filter((r) => r.active_flag).length,
          'Understand responsibilities',
          'help?tab=roles',
          'shield',
          'sand',
        ],
      ]
    : oversight
      ? [
          [
            'Registered notifications',
            sources.length,
            'Within your authorised area',
            'repository',
            'book',
            'sage',
          ],
          [
            'Current sources',
            sources.filter((i) => i.regulatory_status === 'CURRENT').length,
            'Approved and effective editions',
            'repository?regulatory_status=CURRENT',
            'checkSquare',
            'plum',
          ],
          [
            'My decisions',
            decisions.length,
            'Your named decision tasks',
            'approvals',
            'shield',
            'sand',
          ],
        ]
      : [
          [
            'Work to do',
            tasks.length,
            'Your named, actionable assignments',
            'tasks',
            'checkSquare',
            'sage',
          ],
          [
            'Decisions waiting',
            decisions.length,
            'Assigned to you for a decision',
            'approvals',
            'shield',
            'plum',
          ],
          [
            'Due in the next 7 days',
            due.length,
            'Plan your next steps',
            'tasks?tab=due',
            'calendar',
            'sand',
          ],
        ];
  const quick = admin
    ? [
        ['Manage people', 'Create accounts and review access', 'users', 'users'],
        [
          'Maintain departments',
          'Keep the organisation hierarchy clear',
          'masters?tab=organisation',
          'org',
        ],
        ['Review settings', 'Maintain approved reference data', 'masters', 'settings'],
      ]
    : [
        ...(has('AUTHOR')
          ? [['Register a notification', 'Add a new regulatory source', 'repository/new', 'plus']]
          : [['Find a notification', 'Search the regulatory library', 'repository', 'book']]),
        ['Open my work', 'Follow your assigned next steps', 'tasks', 'checkSquare'],
        ['Check my decisions', 'Review requests assigned to you', 'approvals', 'shield'],
      ];
  const work = tasks
    .slice(0, 4)
    .map(
      (t) =>
        `<a class="portal-work-row" href="#${taskLink(t)}"><span class="portal-work-icon ${t.due_at && t.due_at.slice(0, 10) < localDate() ? 'urgent' : ''}">${icon(t.kind === 'DECISION' ? 'shield' : 'file')}</span><div class="portal-work-copy"><small>${t.kind === 'DRAFT' ? 'Source preparation' : 'Review & approval'}</small><strong>${esc(sources.find((r) => r.id === t.instrument_id)?.title || t.title)}</strong><p>${t.kind === 'DRAFT' ? 'Complete the source, capture clauses / paras and submit for independent review.' : 'Read the source and record the decision for your assigned stage.'}</p></div><div class="portal-work-date"><span>${date(t.due_at)}</span><small>${t.due_at ? 'Due date' : 'Draft preparation'}</small></div>${icon('chevron')}</a>`,
    )
    .join('');
  const people = users
    .slice(0, 5)
    .map(
      (u) =>
        `<a href="#users">${person(u.full_name, title(u.login_type))}<span class="tag ${u.active_flag ? 'green' : 'neutral'}">${u.active_flag ? 'Active' : 'Inactive'}</span></a>`,
    )
    .join('');
  const journey = [
    ['1', 'Read the notification', 'Find the official source', 'repository'],
    ['2', 'Capture clauses / paras', 'Keep source and interpretation separate', 'repository'],
    ['3', 'Review independently', 'Follow named decision assignments', 'approvals'],
  ];
  return `<section class="portal-welcome"><div><span class="portal-section-kicker">${admin ? 'ADMINISTRATION' : oversight ? 'YOUR OVERVIEW' : 'LET’S GET STARTED'}</span><h1>${esc(admin ? 'Your administration workspace' : 'Welcome, ' + state.identity.user.full_name)}</h1><p>${admin ? 'Manage people, departments and approved settings in one place.' : oversight ? 'See the regulatory sources in your authorised area and follow the work that needs attention.' : 'A clear place to start. See what needs your attention and take the next step.'}</p></div><div class="portal-welcome-note">${icon('shield')}<span>Clear ownership.<br><strong>Every step connected.</strong></span></div></section>
  <div class="portal-stats">${stats.map((s) => stat(...(s as [string, string | number, string, string, string?, string?]))).join('')}</div>
  <section class="portal-shortcuts"><div class="portal-section-title"><h2>What would you like to do?</h2><span>Start with a common task</span></div><div class="portal-quick-grid">${quick
    .filter((q) => canNavigate(q[2].split(/[/?]/)[0]))
    .map(
      ([name, sub, path, ic]) =>
        `<a class="portal-quick" href="#${path}"><span>${icon(ic)}</span><div><strong>${name}</strong><small>${sub}</small></div>${icon('arrow')}</a>`,
    )
    .join('')}</div></section>
  <div class="portal-home-grid"><section class="portal-card portal-work-card"><div class="portal-card-heading"><div><span class="portal-section-kicker">${admin ? 'PEOPLE AND ACCESS' : 'YOUR NEXT STEPS'}</span><h2>${admin ? 'The people in your workspace' : 'Start with these items'}</h2></div>${link(admin ? 'users' : 'tasks', admin ? 'Manage users' : 'See all my work', 'text-link')}</div>${admin ? `<div class="portal-admin-people">${people}</div>` : work || `<div class="portal-caught-up">${icon('check')}<h3>Nothing waiting for you here</h3><p>Work appears when an eligible task is assigned to you. You can still explore the records in your role.</p></div>`}<div class="portal-work-foot">${icon('info')} ${admin ? 'Access changes need approved role and department instructions.' : 'Personal tasks are assigned to a person. Department-wide records remain available in the registers.'}</div></section>
  <section class="portal-card portal-start-card"><span class="portal-section-kicker">${admin ? 'ACCESS AND RESPONSIBILITY' : 'A LITTLE GUIDANCE'}</span><h2>${admin ? 'Give the right access<br>to the right people.' : 'One notification.<br>A clear path forward.'}</h2><p>${admin ? 'Roles, department scope and named assignments work together. Technical administration has its own approval limits.' : 'Preserve the regulatory source, capture its clauses / paras and follow independent review.'}</p>${admin ? link('help?tab=roles', 'View roles and responsibilities', 'btn primary') : journey.map(([n, name, sub, path]) => `<a class="portal-journey-step" href="#${path}"><span>${n}</span><div><strong>${name}</strong><small>${sub}</small></div>${icon('chevron')}</a>`).join('')}<a class="portal-journey-link" href="#help">Read the step-by-step guide ${icon('arrow')}</a></section></div>
  <section class="portal-bottom-help"><div class="portal-help-symbol">${icon('book')}</div><div><h2>A helping hand, whenever you need it.</h2><p>Read a step-by-step example or check what your role can do.</p></div>${link('help', 'Open the help guide', 'btn')}</section><div class="portal-sample-note">Live authorised records · ${date(localDate())}</div>`;
}
