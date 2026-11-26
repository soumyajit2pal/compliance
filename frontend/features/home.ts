import { state } from '../core/state.ts';
import { api } from '../core/api.ts';
import { bankDateAfter, businessDate } from '../core/bank-time.ts';
import { has } from '../core/access.ts';
import { esc, title, date, localDate, link } from '../ui/components.ts';
import { icon } from '../ui/icons.ts';
import { dashboardInfo } from '../ui/dashboard-info.ts';
import { stat, person } from '../ui/widgets.ts';
import { canNavigate } from '../ui/layout.ts';

function taskLink(t) {
  if(t.action_path)return t.action_path;
  if(t.workflow_kind==='OWNERSHIP_CHANGE')return 'obligations/'+t.obligation_id+'?tab=owners&ownership_change='+t.ownership_change_id;
  if(t.workflow_kind==='OBLIGATION')return 'obligations/'+t.obligation_id+'?tab=owners';
  if(t.workflow_kind==='FAMILY')return 'notification-families/'+t.instrument_id+'?proposal='+t.proposal_id;
  if(t.workflow_kind==='METADATA_CORRECTION')return 'repository/'+t.instrument_id+'?tab=workflow&correction='+t.correction_id;
  return 'repository/' + t.instrument_id + '?version=' + t.version_id + '&tab=workflow';
}
function taskPresentation(t) {
  if(t.workflow_kind==='CLAUSE_INTERPRETATION')return {label:'Bank interpretation',description:'Review the proposed interpretation on the approved source clause.',action:'Open interpretation',icon:'file'};
  if(t.workflow_kind==='MIGRATION_IMPORT')return t.kind==='DECISION'
    ? {label:'Import content review',description:'Compare the imported rows with the authoritative source and confirm the review.',action:'Open import review',icon:'file'}
    : {label:'Import ready to load',description:'Load the independently validated rows as Drafts.',action:'Open ready import',icon:'file'};
  if(t.workflow_kind==='LEAVE_DELEGATION')return {label:'Leave cover',description:'Check the existing roles, scope and dates before deciding.',action:'Review leave cover',icon:'users'};
  if(t.workflow_kind==='CONTROL')return {label:'Check and obligation link review',description:'Review the check or obligation link and record your named decision.',action:t.kind==='DRAFT'?'Continue preparation':'Review proposal',icon:'shield'};
  if(['ACTION','ACTION_EXTENSION'].includes(t.workflow_kind))return {label:t.workflow_kind==='ACTION_EXTENSION'?'Internal target request':'Assigned action',description:'Record the outcome and proof, then follow independent review.',action:t.kind==='DECISION'?'Review assigned work':'Continue work',icon:'checkSquare'};
  if(t.workflow_kind==='OWNERSHIP_CHANGE')return {label:'Ownership change',description:'Review the proposed ownership change and your assigned decision.',action:'Review ownership',icon:'users'};
  if(t.workflow_kind==='OBLIGATION')return {label:'Obligation ownership',description:'Review the obligation and your named responsibility.',action:'Open assignment',icon:'checkSquare'};
  if(t.workflow_kind==='FAMILY')return {label:'Notification family',description:'Review the proposal and follow your assigned decision stage.',action:'Review proposal',icon:'org'};
  if(t.workflow_kind==='METADATA_CORRECTION')return {label:'Source correction',description:'Review the proposed source correction and record your decision.',action:'Review correction',icon:'pen'};
  if(t.kind==='DRAFT')return {label:'Source preparation',description:'Complete the source and its Clauses / Para before independent review.',action:'Continue preparation',icon:'file'};
  return {label:t.stage?title(t.stage):'Review & approval',description:'Read the source and record the decision for your assigned stage.',action:'Open decision',icon:'shield'};
}
function workTitle(task,sources) {
  return (['OBLIGATION','OWNERSHIP_CHANGE','ACTION','ACTION_EXTENSION','CONTROL','LEAVE_DELEGATION','MIGRATION_IMPORT'].includes(task.workflow_kind)?task.title:sources.find(r=>r.id===task.instrument_id)?.title||task.title)||'Assigned work';
}
function dueLabel(task) {
  const overdue=task.due_at&&businessDate(task.due_at)<localDate();
  return `<span class="home-due ${overdue?'is-overdue':''}">${icon(overdue?'alert':'calendar')}${task.due_at?(overdue?'Overdue · ':'Due ')+date(task.due_at):'No due date'}</span>`;
}
export async function homePage() {
  const admin = state.identity.roles.every((r) => r === 'ADMIN');
  const oversight = has('CCO', 'ZONE_VIEWER');
  const tasks = [...(state.work || [])].sort((a, b) =>
    (a.due_at || '9999').localeCompare(b.due_at || '9999'),
  );
  const decisions = tasks.filter((t) => t.kind === 'DECISION');
  const today = localDate();
  const end = bankDateAfter(7);
  const due = tasks.filter(
    (t) => t.due_at && businessDate(t.due_at) >= today && businessDate(t.due_at) <= end,
  );
  let users = [],
    sources = [];
  if (admin) users = (await api('/admin/users')).users;
  else sources = await api('/instruments');
  const stats: [string, number, string, string, string, string, string][] = admin
    ? [
        [
          'Active users',
          users.filter((u) => u.active_flag).length,
          'Manage accounts and access',
          'users',
          'users',
          'sage',
          'Counts enabled user accounts. Access also depends on approved roles and any required profile steps.',
        ],
        [
          'Access action required',
          state.adminAccess?.action_required || 0,
          'Review approvals and missing roles',
          'users?tab=ACTION_REQUIRED',
          'users',
          'plum',
          'Counts accounts that an administrator needs to review for access approval or a role assignment.',
        ],
        [
          'Application roles',
          state.masters.role.filter((r) => r.active_flag).length,
          'Understand responsibilities',
          'help?tab=roles',
          'shield',
          'sand',
          'Counts active application roles in Master data. One person can have several roles.',
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
            'Counts regulatory instruments visible to you, including drafts and retained instruments.',
          ],
          [
            'Current sources',
            sources.filter((i) => i.regulatory_status === 'CURRENT').length,
            'Approved and effective editions',
            'repository?regulatory_status=CURRENT',
            'checkSquare',
            'plum',
            'Counts visible instruments whose regulatory status is current.',
          ],
          [
            'My decisions',
            decisions.length,
            'Your named decision tasks',
            'approvals',
            'shield',
            'sand',
            'Counts review, approval and other decision tasks currently assigned to you.',
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
            'Counts the assignments in My tasks that are currently actionable by you.',
          ],
          [
            'Decisions waiting',
            decisions.length,
            'Assigned to you for a decision',
            'approvals',
            'shield',
            'plum',
            'Counts the review, approval and other decision tasks within your current assignments.',
          ],
          [
            'Due in the next 7 days',
            due.length,
            'Plan your next steps',
            'tasks?tab=due',
            'calendar',
            'sand',
            'Counts your assignments with a due date from today through seven days from today, inclusive.',
          ],
        ];
  const quick = admin
    ? [
        ['Manage people', 'Create accounts and review access', 'users', 'users', 'Manage accounts, approved roles and department scope in Users & access.'],
        [
          'Maintain departments',
          'Keep the organisation hierarchy clear',
          'masters?tab=organisation',
          'org',
          'Review departments, their parent units and the available changes in the organisation hierarchy.',
        ],
        ['Review settings', 'Maintain approved reference data', 'masters', 'settings', 'Maintain the reference lists used on forms in Master data.'],
      ]
    : [
        ...(has('AUTHOR')
          ? [['Register a notification', 'Add a new regulatory source', 'repository/new', 'plus', 'Start a draft regulatory instrument and register its first source edition.']]
          : [['Find a notification', 'Search the regulatory library', 'repository', 'book', 'Search visible instruments and browse their source editions.']]),
        ['Open my work', 'Follow your assigned next steps', 'tasks', 'checkSquare', 'Opens My tasks with the work and decisions assigned to you.'],
        ['Check my decisions', 'Review requests assigned to you', 'approvals', 'shield', 'Opens your assigned reviews, approvals and other decisions that need a response.'],
      ];
  const next = tasks[0];
  const nextInfo = next ? taskPresentation(next) : null;
  const accessRequired = state.adminAccess?.action_required || 0;
  const primaryPath = admin ? (accessRequired ? 'users?tab=ACTION_REQUIRED' : 'users')
    : next ? taskLink(next) : canNavigate('repository') ? 'repository' : 'help';
  const primaryTitle = admin ? (accessRequired ? 'Access needs your attention.' : 'Make room for the right people.')
    : next ? workTitle(next, sources) : oversight ? 'Your regulatory library, in view.' : 'No personal assignments waiting.';
  const primaryCopy = admin ? (accessRequired ? `${accessRequired} account${accessRequired===1?' needs':'s need'} access approval or role assignment.` : 'Manage accounts, department scope and approved access from one place.')
    : next ? nextInfo.description : oversight ? 'Explore the sources in your authorised area and follow their current editions.' : 'Explore the sources available to your role or use the guide to plan your next step.';
  const primaryAction = admin ? (accessRequired ? 'Review access requests' : 'Manage people')
    : next ? nextInfo.action : canNavigate('repository') ? 'Explore the library' : 'Open the guide';
  const work = tasks.slice(0,4).map(t=>{
    const info=taskPresentation(t),name=workTitle(t,sources);
    return `<li><a class="home-work-item" href="#${esc(taskLink(t))}" title="${esc(name)}">
      <span class="home-work-symbol">${icon(info.icon)}</span>
      <div class="home-work-copy"><span class="home-task-type">${esc(info.label)}</span><strong>${esc(name)}</strong><p>${esc(info.description)}</p>${dueLabel(t)}</div>
      <span class="home-work-arrow" aria-hidden="true">${icon('arrow')}</span>
    </a></li>`;
  }).join('');
  const people = users.slice(0,5).map(u=>`<li><a class="home-person-row" href="#users">${person(u.full_name,title(u.login_type))}<span class="home-account-state ${u.active_flag?'':'is-inactive'}">${u.active_flag?'Active':'Inactive'}</span>${icon('chevron')}</a></li>`).join('');
  const shortcuts = quick.filter(q=>canNavigate(q[2].split(/[/?]/)[0]));
  const journey = [
    ['01', 'Start at the source', 'Read the official notification.', 'repository', 'book'],
    ['02', 'Make the requirement clear', 'Keep source and interpretation together.', 'clauses', 'file'],
    ['03', 'Decide independently', 'Follow your named review assignments.', 'approvals', 'shield'],
  ].filter(step=>canNavigate(step[3]));
  return `<div class="home-dashboard">
    <header class="home-intro"><div><span class="home-eyebrow">${admin?'ADMINISTRATION':oversight?'YOUR AUTHORISED OVERVIEW':'YOUR WORKSPACE'}</span>
      <h1>${admin?'Your administration workspace':`Welcome back, <span>${esc(state.identity.user.full_name)}</span>`}</h1>
      <p>${admin?'People, departments and access, brought into focus.':'Your assigned work, decisions and next steps. One clear view.'}</p></div>
      <div class="actions">${canNavigate('team')?link('team','Team overview','btn'):''}<time class="home-today" datetime="${localDate()}">${icon('calendar')}${date(localDate())}</time></div>
    </header>
    <div class="home-summary">
      <section class="home-priority" aria-labelledby="home-priority-title"><div class="home-priority-top"><span class="home-eyebrow">${admin?'PEOPLE & ACCESS':next?'UP NEXT':oversight?'YOUR LIBRARY':'A CLEAR START'}</span>${!admin&&next?dueLabel(next):`<span class="home-priority-mark" aria-hidden="true">${icon(admin?'users':'book')}</span>`}</div>
        <div class="home-priority-copy">${next&&!admin?`<span class="home-priority-stage">${esc(nextInfo.label)}</span>`:''}<h2 id="home-priority-title" title="${esc(primaryTitle)}">${esc(primaryTitle)}</h2><p>${esc(primaryCopy)}</p></div>
        <a class="home-primary" href="#${esc(primaryPath)}">${esc(primaryAction)}${icon('arrow')}</a>
      </section>
      <section class="home-metrics" aria-label="${admin?'Administration totals':oversight?'Your authorised overview':'Your work at a glance'}">${stats.map(s=>stat(...s)).join('')}</section>
    </div>
    <div class="home-board">
      <section class="home-panel home-queue" aria-labelledby="home-queue-title"><div class="home-panel-heading"><div><span class="home-eyebrow">${admin?'WORKSPACE DIRECTORY':'YOUR ASSIGNED WORK'}</span><h2 id="home-queue-title">${admin?'People & access':'Your next steps'}<span class="home-count">${admin?users.length:tasks.length}</span></h2><p>${admin?'A quick view of accounts in your workspace.':tasks.length>4?'Showing your next 4 assignments, ordered by due date.':'Open an assignment to pick up where you left off.'}</p></div>${link(admin?'users':'tasks',admin?'Manage users':'View all work','home-text-link')}</div>
        ${admin?(people?`<ul class="home-people">${people}</ul>`:'<div class="home-empty"><h3>No accounts to show</h3><p>Open user management to review the available accounts.</p></div>')
          :work?`<ul class="home-work-list">${work}</ul>`:`<div class="home-empty"><span>${icon('check')}</span><h3>Nothing waiting in your queue</h3><p>Assigned work will appear here. Records available to your role remain in the registers.</p></div>`}
        <div class="home-queue-foot">${icon('info')}<span>${admin?'Account status and effective role assignments are separate access checks.':'Your personal assignments are shown here. Department-wide records are available in the registers.'}</span></div>
      </section>
      <section class="home-panel home-actions" aria-labelledby="home-actions-title"><div class="home-panel-heading"><div><span class="home-eyebrow">COMMON TASKS</span><h2 id="home-actions-title">Quick actions</h2><p>A shorter route to what you need.</p></div>${icon('sparkle')}</div>
        <div class="home-action-list">${shortcuts.map(([name,sub,path,ic,explanation])=>`<div class="home-action-frame"><a class="home-action" href="#${esc(path)}"><span class="home-action-symbol">${icon(ic)}</span><div><strong>${esc(name)}</strong><small>${esc(sub)}</small></div>${icon('arrow')}</a>${dashboardInfo(name,explanation)}</div>`).join('')}</div>
        <a class="home-help-link" href="#help">${icon('book')}<span>Need a hand?<small>Open the step-by-step guide.</small></span>${icon('arrow')}</a>
      </section>
    </div>
    <section class="home-guidance" aria-label="${admin?'Access guidance':'Workflow guidance'}"><div class="home-guide-intro"><span class="home-eyebrow">${admin?'ACCESS, WITH CLARITY':'EVERY STEP CONNECTED'}</span><h2>${admin?'The right access.<br>A clear responsibility.':'From source<br>to a clear decision.'}</h2>${link(admin?'help?tab=roles':'help',admin?'View roles & responsibilities':'Explore the workflow','home-text-link')}</div>
      ${admin?`<div class="home-admin-guidance"><span>${icon('shield')}</span><div><h3>Roles, scope and named assignments</h3><p>Home organisation, role scope and individual assignments have separate purposes. Technical administration retains its existing approval limits.</p></div></div>`
      :`<ol class="home-journey">${journey.map(([n,name,sub,path,ic])=>`<li><a href="#${esc(path)}"><span class="home-step-number">${n}</span><span class="home-step-copy"><strong>${esc(name)}</strong><small>${esc(sub)}</small></span>${icon(ic)}</a></li>`).join('')}</ol>`}
    </section>
  </div>`;
}
