import { state } from '../core/state.ts';
import { root } from '../core/dom.ts';
import { esc, title, ref } from './components.ts';
import { icon } from './icons.ts';
import { note } from './widgets.ts';

const names = {
  home: 'Home',
  tasks: 'My work',
  approvals: 'My decisions',
  repository: 'Regulatory library',
  clauses: 'Clauses / Paras',
  'notification-families': 'Notification families',
  migration: 'Import existing regulatory records',
  masters: 'Master data',
  users: 'Users & access',
  ldap: 'LDAP settings',
  applications: 'Connected applications',
  baseline: 'Release baseline',
  notifications: 'Notifications',
  help: 'Help & workflow guide',
};
const icons = {
  home: 'home',
  tasks: 'checkSquare',
  approvals: 'shield',
  repository: 'book',
  clauses: 'file',
  'notification-families': 'org',
  migration: 'upload',
  masters: 'settings',
  users: 'users',
  ldap: 'lock',
  baseline: 'file',
  applications: 'external',
  help: 'book',
};
export function canNavigate(key) {
  return state.identity?.menu.some((item) => item.id === key);
}
function navItem(key, selected, extra = '') {
  if (!canNavigate(key)) return '';
  const href = key + extra;
  const current =
    (key === selected &&
      !(key === 'masters' && extra === '?tab=organisation') &&
      !(
        key === 'masters' &&
        !extra &&
        new URLSearchParams(location.hash.split('?')[1]).get('tab') === 'organisation'
      )) ||
    (key === 'masters' &&
      extra &&
      selected === 'masters' &&
      new URLSearchParams(location.hash.split('?')[1]).get('tab') === 'organisation');
  const label = extra ? 'Organisation hierarchy' : names[key] || title(key);
  const count =
    key === 'tasks'
      ? state.work?.length
      : key === 'approvals'
        ? state.work?.filter((t) => t.kind === 'DECISION').length
        : key === 'users' ? state.adminAccess?.action_required || 0 : undefined;
  return `<a class="nav-item ${current ? 'active' : ''}" href="#${href}" ${current ? 'aria-current="page"' : ''}>${icon(extra ? 'org' : icons[key])}<span>${esc(label)}</span>${count !== undefined ? `<span class="nav-count">${count}</span>` : ''}</a>`;
}
function navigation(key) {
  if (!state.ready)
    return `<div class="nav-scroll"><p class="small muted">Finish sign-in to open your workspace.</p></div>`;
  const primary = ['home', 'tasks', 'approvals'].map((i) => navItem(i, key)).join('');
  const groups = [
    { name: 'Regulations', hint: 'Notifications and source records', icon: 'book', items: ['repository', 'notification-families', 'clauses'] },
    { name: 'Reports and history', hint: 'Alerts and release records', icon: 'chart', items: ['notifications'] },
    {
      name: 'Administration',
      hint: 'People, departments and settings',
      icon: 'settings',
      items: ['users', 'masters', 'ldap', 'migration', 'applications'],
    },
  ];
  const groupMarkup = groups
    .map(({ name, hint, icon: groupIcon, items }) => {
      const body = items
        .map((i) => navItem(i, key) + (i === 'masters' ? navItem(i, key, '?tab=organisation') : ''))
        .join('');
      if (!body) return '';
      return `<details class="portal-nav-group" ${items.includes(key) ? 'open' : ''}><summary>${icon(groupIcon)}<span>${esc(name)}<small>${esc(hint)}</small></span>${icon('down')}</summary><div class="portal-nav-children">${body}</div></details>`;
    })
    .join('');
  return `<nav class="nav-scroll" aria-label="Portal navigation"><div class="portal-primary-nav">${primary}</div>${groupMarkup}</nav>`;
}
function scopeBanner() {
  const scoped = state.identity.grants.filter((g) => !g.global_scope_flag);
  if (!scoped.length) return '';
  return `<div class="scope-banner">${icon('lock')}<span>${scoped.map((g) => esc(title(g.role_code)) + ': ' + esc(ref('organisational_unit', g.scope_org_unit_id)) + ' and authorised descendants').join(' · ')}${state.identity.roles.includes('ZONE_VIEWER') ? ' · Read-only access' : ''}</span></div>`;
}
export function shell(contents, key) {
  const user = state.identity.user,
    environment = state.identity.environment === 'prod' ? 'Production' : 'UAT';
  const label =
    key === 'repository' && location.hash.includes('/new')
      ? 'New instrument'
      : names[key] || 'Workspace';
  const initials = user.full_name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const unread = state.notifications?.filter((n) => !n.read_at).length || 0;
  document.body.classList.add('portal-mode');
  root.innerHTML = `<div class="app-shell"><aside id="portal-sidebar" class="sidebar" aria-label="Main navigation">
    <a class="brand" href="#home"><span class="brand-mark">${icon('shield')}</span><span class="brand-name">Compliance<span>by Design</span></span></a>
    <button class="icon-button portal-nav-close" type="button" data-action="menu" aria-label="Close navigation">${icon('x')}</button>
    <div class="portal-bank"><img src="/assets/assets/bank-of-maharashtra-wordmark.png" alt="Bank of Maharashtra"><span>Your compliance workspace</span></div>
    ${navigation(key)}
    <div class="nav-bottom">${state.ready ? `<a class="portal-help" href="#help">${icon('book')}<span>Need a hand?<small>Step-by-step help</small></span>${icon('arrow')}</a><div class="portal-footer-links"><button type="button" data-action="profile">My role</button><span>·</span><a href="#applications">Other applications</a></div>` : ''}
    <div class="profile"><span class="avatar">${esc(initials)}</span><div class="grow"><strong class="profile-name">${esc(user.full_name)}</strong><small>${esc(state.identity.roles.map(title).join(' · ') || 'Awaiting access')}</small></div></div></div>
  </aside><button class="portal-nav-scrim" type="button" data-action="menu" aria-label="Close navigation"></button>
  <div class="main-shell"><header class="topbar"><div class="portal-location"><button class="icon-button mobile-menu" type="button" data-action="menu" aria-label="Open navigation" aria-controls="portal-sidebar" aria-expanded="false">${icon('menu')}</button><div class="breadcrumb"><a href="#home">My workspace</a><span>/</span><strong>${esc(label)}</strong></div></div>
  <div class="topbar-right">${state.ready ? `<button class="global-search" type="button" data-action="workspace-search" aria-label="Search the workspace">${icon('search')}<span>${canNavigate('repository') ? 'Find a notification or task' : 'Find a person or setting'}</span><span class="kbd">⌘ K</span></button><a class="portal-help-top" href="#help">${icon('book')}Help</a><a class="icon-button portal-notifications" href="#notifications" aria-label="Notifications">${icon('bell')}${unread ? '<i class="notification-dot"></i>' : ''}</a>` : ''}<button class="portal-person" type="button" data-action="profile"><span class="avatar">${esc(initials)}</span><span>${esc(user.full_name)}<small>${esc(state.identity.roles.map(title).join(' · ') || 'Awaiting access')}</small></span></button><button type="button" class="icon-button" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></header>
  <main class="content" id="main-content">${state.ready ? scopeBanner() + adminAccessNotice() : ''}${contents}</main><footer class="page-footer"><span class="footer-brand">${icon('shield')}COMPLIANCE BY DESIGN</span><span>Oracle connected · ${environment} · Approved history retained</span></footer></div></div>`;
}
function adminAccessNotice() {
  const summary = state.identity?.roles.includes('ADMIN') ? state.adminAccess : null;
  if (!summary || (!summary.action_required && !summary.profile_pending)) return '';
  const messages = [summary.action_required ? `${summary.action_required} account${summary.action_required === 1 ? ' needs' : 's need'} access approval or role assignment.` : '',
    summary.profile_pending ? `${summary.profile_pending} LDAP profile${summary.profile_pending === 1 ? ' awaits' : 's await'} user confirmation.` : ''].filter(Boolean).join(' ');
  return `<aside class="admin-access-notice" aria-label="User access attention" role="status">${icon('users')}<div class="grow"><strong>User access needs attention</strong><p>${messages}</p></div><div class="actions">${summary.action_required ? '<a class="btn small" href="#users?tab=ACTION_REQUIRED">Review access requests</a>' : ''}${summary.profile_pending ? '<a class="text-link" href="#users?tab=LDAP&status=PROFILE_PENDING">View pending profiles</a>' : ''}</div></aside>`;
}
export function heading(name, description, actions = '') {
  return `<div class="page-header"><div><h1>${esc(name)}</h1><p>${esc(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
export function pageHelp(name, text) {
  return `<details class="portal-page-help"><summary>${icon('info')}<span>${esc(name)}</span><small>How to use this page</small>${icon('down')}</summary><div><p>${text}</p><p><a class="text-link" href="#help">Read the guide ${icon('arrow')}</a></p></div></details>`;
}
