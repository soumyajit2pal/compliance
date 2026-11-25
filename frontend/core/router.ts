import {dropdownsPage} from '../features/dropdowns.ts';
import { state } from './state.ts';
import { loginView } from '../features/auth.ts';
import { homePage } from '../features/home.ts';
import { repositoryPage } from '../features/repository.ts';
import { clausesPage } from '../features/clauses.ts';
import { regulationRegistersPage } from '../features/regulation-registers.ts';
import { obligationsPage } from '../features/obligations.ts';
import { notificationFamiliesPage } from '../features/notification-families.ts';
import { migrationPage } from '../features/migration.ts';
import { tasksPage, notificationsPage } from '../features/work.ts';
import { usersPage } from '../features/users.ts';
import { renderMasters } from '../features/masters.ts';
import { ldapPage, applicationsPage } from '../features/settings.ts';
import { auditTrailPage } from '../features/audit-trail.ts';
import { renderHelp } from '../features/help.ts';
import { canNavigate, shell } from '../ui/layout.ts';
import { panel, note } from '../ui/widgets.ts';
import { icon } from '../ui/icons.ts';
import { esc, empty, link, title } from '../ui/components.ts';
import { reportError } from '../ui/feedback.ts';
import { SessionExpired, api } from './api.ts';
import { beginActivity } from '../ui/loading.ts';
import { obligationView, workspaceAlias } from './obligation-workspace.ts';
import { actionsPage,teamPage,libraryPage } from '../features/delivery.ts';

import {ccoViewAllowed,navigationLabel} from './navigation.ts';
import {controlsPage,controlMappingsPage,evidencePage} from '../features/controls.ts';

import {delegationsPage} from '../features/delegations.ts';
import {employeeSettingsPage} from '../features/employee-settings.ts';
import {emailSettingsPage} from '../features/email-settings.ts';
import {uploadSettingsPage} from '../features/upload-settings.ts';
const pages = {
  'email-settings':emailSettingsPage,
  'upload-settings':uploadSettingsPage,
  'employee-api':employeeSettingsPage,
  'audit-trail': (_id, query) => auditTrailPage(query),
  'approval-workflow-log': (_id, query) => auditTrailPage(query, true),
  delegations:delegationsPage,
  controls:controlsPage,
  'control-mappings':controlMappingsPage,
  evidence:evidencePage,
  actions: actionsPage,
  team: teamPage,
  library: libraryPage,
  home: homePage,
  repository: repositoryPage,
  clauses: clausesPage,
  obligations: obligationsPage,
  'clause-relationships': (_id,q)=>regulationRegistersPage('clause-relationships',q),
  'notification-families': notificationFamiliesPage,
  migration: migrationPage,
  tasks: (_id, q) => tasksPage('tasks', q),
  approvals: (_id, q) => tasksPage('approvals', q),
  notifications: notificationsPage,
  masters: renderMasters,
  dropdowns: dropdownsPage,
  users: usersPage,
  ldap: ldapPage,
  applications: applicationsPage,
  help: renderHelp,
};

export function route() {
  const [path, query = ''] = (location.hash.slice(1) || 'home').split('?');
  const [page, id] = path.split('/');
  return { page, id, query: new URLSearchParams(query) };
}

export async function render() {
  if (!state.identity) return loginView();
  // Password change and LDAP profile confirmation finish before navigation.
  if (!state.ready) return;
  const request = ++state.routeNumber;
  let { page, id, query } = route();
  if (page === 'baseline') {
    history.replaceState(history.state, '', '#home');
    ({ page, id, query } = route());
  }
  const alias = workspaceAlias(page, query);
  if(alias && !id) {
    history.replaceState(history.state, '', '#' + alias);
    page='obligations';
    query=new URLSearchParams(alias.split('?')[1]);
  }
  const view=obligationView(query);
  if (
    !pages[page] || (page==='team'&&!ccoViewAllowed(state.identity.roles,query)) ||
    (!canNavigate(page) && page !== 'notifications') ||
    (page==='audit-trail'&&!state.identity.roles.includes('ADMIN')) ||
    ((page==='tasks'||page==='approvals')&&query.get('queue')==='rbi'&&!canNavigate('repository')) ||
    (page==='obligations'&&!id&&view!=='register'&&!canNavigate(view))
  ) {
    return shell(
      `<div class="access-boundary">${panel('This area is outside your role scope', note('Your approved role does not permit this workspace. No record details are shown.', 'warn') + '<div class="mt24">' + link('home', 'Return to Home', 'btn primary') + '</div>')}</div>`,
      page,
    );
  }
  const label = navigationLabel(page,query)||state.identity.menu.find(item => item.id === page)?.label || title(page);
  const finish = beginActivity('Loading ' + label.toLowerCase() + '…', { priority: 2, scope: document.getElementById('root') });
  try {
    const [work, notifications, access] = await Promise.all([api('/tasks'), api('/notifications'),
      state.identity.roles.includes('ADMIN') ? api('/admin/access-summary') : Promise.resolve(null)]);
    if (request !== state.routeNumber || !state.identity) return;
    state.work = work;
    state.notifications = notifications;
    state.adminAccess = access;
    const contents = await pages[page](id, query);
    if (request !== state.routeNumber || !state.identity) return;
    shell(contents, page);
    document.title =
      (page === 'actions' && !id ? 'Compliance work tracker' : page === 'repository' && id && id !== 'new'
        ? state.record.instrument.code
        : page === 'obligations' && !id ? 'Obligations · '+(view==='register'?(query.get('tab')==='reports'?'Exceptions':'Register'):title(view))
        : page === 'team' ? label : page === 'clauses'
          ? query.get('view') === 'register' ? 'Clause register' : 'Clause workspace'
        : page === 'migration'
          ? 'Import existing regulatory records'
          : navigationLabel(page,query)||title(page)) + ' · Compliance by Design';
  } catch (error) {
    if (error instanceof SessionExpired) return;
    if (request === state.routeNumber && state.identity) {
      shell(
        /* HTML */ `<div class="notice error" role="alert">${esc(error.message)}</div>
          ${link('home', 'Return home', 'button')}`,
        page,
      );
    }
    reportError(error);
  } finally {
    finish();
  }
}
