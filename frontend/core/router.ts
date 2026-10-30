import { state } from './state.ts';
import { loginView } from '../features/auth.ts';
import { homePage } from '../features/home.ts';
import { repositoryPage } from '../features/repository.ts';
import { clausesPage } from '../features/clauses.ts';
import { notificationFamiliesPage } from '../features/notification-families.ts';
import { migrationPage } from '../features/migration.ts';
import { tasksPage, notificationsPage } from '../features/work.ts';
import { usersPage } from '../features/users.ts';
import { renderMasters } from '../features/masters.ts';
import { ldapPage, applicationsPage } from '../features/settings.ts';
import { baselinePage } from '../features/baseline.ts';
import { renderHelp } from '../features/help.ts';
import { shell } from '../ui/layout.ts';
import { panel, note } from '../ui/widgets.ts';
import { icon } from '../ui/icons.ts';
import { esc, empty, link, title, message } from '../ui/components.ts';
import { SessionExpired, api } from './api.ts';

const pages = {
  home: homePage,
  repository: repositoryPage,
  clauses: clausesPage,
  'notification-families': notificationFamiliesPage,
  migration: migrationPage,
  tasks: (_id, q) => tasksPage('tasks', q),
  approvals: (_id, q) => tasksPage('approvals', q),
  notifications: notificationsPage,
  masters: renderMasters,
  users: usersPage,
  ldap: ldapPage,
  applications: applicationsPage,
  baseline: baselinePage,
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
  const { page, id, query } = route();
  if (
    !pages[page] ||
    (!state.identity.menu.some((item) => item.id === page) && page !== 'notifications')
  ) {
    return shell(
      `<div class="access-boundary">${panel('This area is outside your role scope', note('Your approved role does not permit this workspace. No record details are shown.', 'warn') + '<div class="mt24">' + link('home', 'Return to Home', 'btn primary') + '</div>')}</div>`,
      page,
    );
  }
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
      (page === 'repository' && id && id !== 'new'
        ? state.record.instrument.code
        : page === 'clauses'
          ? query.get('view') === 'register' ? 'Clause register' : 'Clause workspace'
        : page === 'migration'
          ? 'Import existing regulatory records'
          : title(page)) + ' · Compliance by Design';
  } catch (error) {
    if (error instanceof SessionExpired) return;
    if (request === state.routeNumber && state.identity) {
      shell(
        /* HTML */ `<div class="notice error" role="alert">${esc(error.message)}</div>
          ${link('home', 'Return home', 'button')}`,
        page,
      );
    }
    message(error.message, true);
  }
}
