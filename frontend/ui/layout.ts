import { localDate } from '../core/bank-time.ts';
import { assetUrl } from '../core/assets.ts';
import brandIconUrl from '../assets/compliance-by-design-audit-checklist.png';
import { state } from '../core/state.ts';
import { root } from '../core/dom.ts';
import { esc, title, ref } from './components.ts';
import { icon } from './icons.ts';
import { note } from './widgets.ts';
import {navigationModel,navigationLabel} from '../core/navigation.ts';
import {employeeWarning} from './employee-profile.ts';

const names = {
  controls: 'Checks and procedures', 'control-mappings': 'Obligation links', evidence: 'Evidence vault',
  actions: 'Compliance work tracker', team: 'Team overview', library: 'Compliance library',
  home: 'Home',
  tasks: 'My tasks',
  approvals: 'My decisions',
  repository: 'Regulatory library',
  clauses: 'Clauses / Para',
  obligations: 'Obligations',
  'clause-relationships': 'Clause / Para relationships',
  applicability: 'Obligations',
  accountability: 'Obligations',
  'notification-families': 'Notification families',
  migration: 'Import existing regulatory records',
  masters: 'Master data',
  users: 'Users & access',
  ldap: 'LDAP settings',
  applications: 'Connected applications',
  notifications: 'Notifications',
  help: 'Help & workflow guide',
};
const icons = {
  controls: 'shield', 'control-mappings': 'link', evidence: 'folder',
  actions: 'clock', team: 'chart', library: 'book',
  home: 'home',
  tasks: 'checkSquare',
  approvals: 'shield',
  repository: 'book',
  clauses: 'file',
  obligations: 'checkSquare',
  'clause-relationships': 'link',
  applicability: 'target',
  accountability: 'users',
  'notification-families': 'org',
  migration: 'upload',
  masters: 'settings',
  users: 'users',
  ldap: 'lock',
  applications: 'external',
  help: 'book',
};
export function canNavigate(key) {
  return state.identity?.menu.some((item) => item.id === key);
}
function navigation(key) {
  if (!state.ready)return `<div class="nav-scroll"><p class="small muted">Finish sign-in to open your workspace.</p></div>`;
  const model=navigationModel(state.identity,key,new URLSearchParams(location.hash.split('?')[1]||''));
  const navItem=(i)=>{
    const count=i.id==='tasks'?state.work?.length:i.id==='users'?state.adminAccess?.action_required||0:undefined;
    return `<a class="nav-item ${i.id===model.selected?'active':''}" href="#${esc(i.href)}" data-nav-label="${esc(i.label)}" ${i.id===model.selected?'aria-current="page"':''}>${icon(i.icon)}<span class="nav-label">${esc(i.label)}</span>${count!==undefined?`<span class="nav-count">${count}</span>`:''}</a>`;
  };
  const primary=model.primary.map(navItem).join('');
  const groups=model.groups.map(g=>{
    const current=g.items.some(i=>i.id===model.selected);
    return `<details class="portal-nav-group" data-nav-group="${g.id}" ${g.id!=='administration'||current?'open':''}><summary>${icon(g.icon)}<span>${esc(g.label)}</span>${icon('down')}</summary><div class="portal-nav-children">${g.items.map(navItem).join('')}</div></details>
      <button type="button" class="portal-nav-group-trigger${current?' active':''}" data-nav-group-trigger="${g.id}" data-nav-label="${esc(g.label)}" aria-label="${esc(g.label)}" aria-controls="portal-nav-flyout" aria-expanded="false">${icon(g.icon)}</button>`;
  }).join('');
  return `<nav class="nav-scroll" aria-label="Portal navigation" data-nav-owner="${esc(state.identity.actual_user?.id||state.identity.user.id)}:${esc(state.identity.acting_for?.id||'own')}"><div class="portal-primary-nav">${primary}</div>${groups}</nav>`;
}
function scopeBanner() {
  const scoped = state.identity.grants.filter((g) => !g.global_scope_flag);
  if (!scoped.length) return '';
  return `<div class="scope-banner">${icon('lock')}<span>${scoped.map((g) => esc(title(g.role_code)) + ': ' + esc(ref('organisational_unit', g.scope_org_unit_id)) + ' and authorised descendants').join(' · ')}${state.identity.roles.includes('ZONE_VIEWER') ? ' · Read-only access' : ''}</span></div>`;
}
export function shell(contents, key, {showEmployeeWarning = true} = {}) {
  const user = state.identity.user;
  const label =
    key === 'repository' && location.hash.includes('/new')
      ? 'New instrument'
      : navigationLabel(key,new URLSearchParams(location.hash.split('?')[1]||'')) || names[key] || 'Workspace';
  const initials = user.full_name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const approvedDesignation = user.employee_approved?.designation;
  const designation = typeof approvedDesignation === 'string' ? approvedDesignation.trim() : '';
  const profileDetails = `<span class="shell-profile-details">
    <strong class="profile-name" title="${esc(user.full_name)}">${esc(user.full_name)}</strong>
    ${designation ? `<span class="shell-profile-designation" title="${esc(designation)}">${esc(designation)}</span>` : ''}
    <small>${esc(state.identity.roles.map(title).join(' · ') || 'Awaiting access')}</small>
  </span>`;
  const unread = state.notifications?.filter((n) => !n.read_at).length || 0;
  document.body.classList.add('portal-mode');
  root.innerHTML = `<div class="app-shell${key === 'home' ? ' home-mode' : ''}" data-workspace="${esc(key)}"><aside id="portal-sidebar" class="sidebar" aria-label="Main navigation">
    <a class="brand" href="#home" data-nav-label="Compliance by Design"><img class="brand-mark" src="${brandIconUrl}" width="42" height="42" alt=""><span class="brand-name nav-label">Compliance<span>by Design</span></span></a>
    <button class="icon-button portal-nav-close" type="button" data-action="menu" aria-label="Close navigation">${icon('x')}</button>
    <div class="portal-bank"><img src="${assetUrl('assets/bank-of-maharashtra-wordmark.png')}" alt="Bank of Maharashtra"><span>Your compliance workspace</span></div>
    ${navigation(key)}
    <div class="nav-bottom">${state.ready ? `<a class="portal-help" href="#help" data-nav-label="Help &amp; workflow guide">${icon('book')}<span class="nav-label">Need a hand?<small>Step-by-step help</small></span>${icon('arrow','nav-help-arrow')}</a><div class="portal-footer-links"><button type="button" data-action="profile" data-nav-label="My role">${icon('users','nav-footer-icon')}<span class="nav-label">My role</span></button><span>·</span><a href="#applications" data-nav-label="Other applications">${icon('external','nav-footer-icon')}<span class="nav-label">Other applications</span></a></div>` : ''}
    <div class="profile"><span class="avatar">${esc(initials)}</span>${profileDetails}</div></div>
  </aside><button class="portal-nav-scrim" type="button" data-action="menu" aria-label="Close navigation"></button><span class="portal-nav-tooltip" aria-hidden="true" hidden></span>
  <nav id="portal-nav-flyout" class="portal-nav-flyout" aria-labelledby="portal-nav-flyout-title" hidden><h2 id="portal-nav-flyout-title"></h2><div class="portal-nav-flyout-links"></div></nav>
  <div class="main-shell"><header class="topbar"><div class="portal-location">
    <button class="icon-button portal-nav-toggle" type="button" data-action="menu" aria-controls="portal-sidebar" aria-expanded="false">
      ${icon('menu','portal-nav-menu')}${icon('panelCollapse','portal-nav-collapse')}${icon('panelExpand','portal-nav-expand')}
      <span class="portal-nav-toggle-label">Open navigation</span>
    </button><div class="breadcrumb"><a href="#home">My workspace</a><span>/</span><strong>${esc(label)}</strong></div></div>
  <div class="topbar-right">${state.ready ? `<button class="global-search" type="button" data-action="workspace-search" aria-label="Search the workspace">${icon('search')}<span>${canNavigate('repository') ? 'Find a notification or task' : 'Find a person or setting'}</span><span class="kbd">⌘ K</span></button><a class="portal-help-top" href="#help">${icon('book')}Help</a><a class="icon-button portal-notifications" href="#notifications" aria-label="Notifications">${icon('bell')}${unread ? '<i class="notification-dot"></i>' : ''}</a>` : ''}<button class="portal-person" type="button" data-action="profile"><span class="avatar">${esc(initials)}</span>${profileDetails}</button><button type="button" class="icon-button" data-action="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button></div></header>
  <main class="content" id="main-content">${showEmployeeWarning ? employeeWarning(state.identity.user.employee_warning?{...state.identity.employee_profile,warning:state.identity.user.employee_warning}:state.identity.employee_profile) : ''}${state.ready ? actingBanner() + scopeBanner() + adminAccessNotice() : ''}${contents}</main>
  <footer class="page-footer">
    <span class="footer-brand"><img src="${brandIconUrl}" width="22" height="22" alt="">COMPLIANCE BY DESIGN</span>
    <span>© ${localDate().slice(0, 4)} Bank of Maharashtra. All rights reserved.</span>
  </footer></div></div>`;
}
function adminAccessNotice() {
  const summary = state.identity?.roles.includes('ADMIN') ? state.adminAccess : null;
  if (!summary || (!summary.action_required && !summary.profile_pending)) return '';
  const messages = [summary.action_required ? `${summary.action_required} account${summary.action_required === 1 ? ' needs' : 's need'} access approval or role assignment.` : '',
    summary.profile_pending ? `${summary.profile_pending} LDAP profile${summary.profile_pending === 1 ? ' awaits' : 's await'} user confirmation.` : ''].filter(Boolean).join(' ');
  return `<aside class="admin-access-notice" aria-label="User access attention" role="status">${icon('users')}<div class="grow"><strong>User access needs attention</strong><p>${messages}</p></div><div class="actions">${summary.action_required ? '<a class="btn small" href="#users?tab=ACTION_REQUIRED">Review access requests</a>' : ''}${summary.profile_pending ? '<a class="text-link" href="#users?tab=LDAP&status=PROFILE_PENDING">View pending profiles</a>' : ''}</div></aside>`;
}
export function heading(name, description, actions = '') {
  return `<div class="page-header workspace-page-header"><div class="page-header-copy"><span class="page-header-eyebrow">YOUR COMPLIANCE WORKSPACE</span><h1>${esc(name)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
export function pageHelp(name, text, topic: string) {
  const guide = 'help?' + new URLSearchParams({topic});
  return `<details class="portal-page-help"><summary>${icon('info')}<span>${esc(name)}</span><small>How to use this page</small>${icon('down')}</summary><div><p>${text}</p><p><a class="text-link" href="#${esc(guide)}">Read the guide ${icon('arrow')}</a></p></div></details>`;
}

function actingBanner(){const d=state.identity.acting_for;if(!d)return '';return `<aside class="scope-banner leave-acting-banner" role="status" aria-label="Active leave cover">${icon('users')}<span><strong>${esc(d.actual_user_name)}</strong> acting on behalf of <strong>${esc(d.principal_name)}</strong> · ${esc(title(d.role_code))} · ${esc(ref('organisational_unit',d.scope_unit_id))} · until ${esc(d.ends_on)}. Decisions record both names.</span>${buttonStop()}</aside>`;}
function buttonStop(){return '<button type="button" class="btn small" data-action="leave-stop">Stop leave cover</button>';}
