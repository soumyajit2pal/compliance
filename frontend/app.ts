import { installEvents } from './core/events.ts';
import { render } from './core/router.ts';
import { SessionExpired } from './core/api.ts';
import { message } from './ui/components.ts';
import { close } from './ui/dialog.ts';
import { loginView, loadIdentity, authHandlers } from './features/auth.ts';
import { repositoryHandlers } from './features/repository.ts';
import { migrationHandlers } from './features/migration.ts';
import { workHandlers } from './features/work.ts';
import { userHandlers } from './features/users.ts';
import { masterHandlers } from './features/masters.ts';
import { settingsHandlers } from './features/settings.ts';
import { workspaceHandlers } from './features/workspace.ts';
import { clauseHandlers } from './features/clauses.ts';
import { notificationFamilyHandlers } from './features/notification-families.ts';
import { installSearchableSelects } from './ui/searchable-select.ts';

installSearchableSelects();

const context = { render, loadIdentity, loginView };
const features = [
  authHandlers,
  repositoryHandlers,
  migrationHandlers,
  workHandlers,
  userHandlers,
  masterHandlers,
  settingsHandlers,
  workspaceHandlers,
  clauseHandlers,
  notificationFamilyHandlers,
].map((factory) => factory(context));

installEvents({
  actions: Object.assign({}, ...features.map((feature) => feature.actions)),
  forms: Object.assign({}, ...features.map((feature) => feature.forms)),
});
window.addEventListener('portal:session-expired', () => { close(); loginView(); });

try {
  if (await loadIdentity()) await render();
} catch (error) {
  if (!document.querySelector('#login')) loginView();
  if (!(error instanceof SessionExpired)) message(error.message, true);
}
