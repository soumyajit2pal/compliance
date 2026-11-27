import {activateNavigation,closeNavigation,toggleNavigation,watchNavigationBreakpoint} from './navigation-state.ts';
import {downloadProtected} from './api.ts';
import {selectedDelegationId} from './delegation-context.ts';
import { state } from './state.ts';
import { withoutPaging } from './pagination.ts';
import { clauseFilterQuery } from './clause-scope.ts';
import { dialog } from './dom.ts';
import { render } from './router.ts';
import { selectDemoUser, clearDemoSelection } from '../features/auth.ts';
import { syncLdapForm } from '../features/settings.ts';
import { close } from '../ui/dialog.ts';
import { clearFormError, reportError } from '../ui/feedback.ts';
import { domainGuidance, syncSecondaryDomainPicker } from '../ui/domains.ts';
import { beginInteraction, isBusy } from '../ui/loading.ts';
import { installDashboardInfo } from '../ui/dashboard-info.ts';
import { installNavigationOverlays } from '../ui/navigation-overlays.ts';
import { updateRelationshipHint } from '../ui/relationship-guidance.ts';
import { installReferenceRefresh, refreshReferenceForm, refreshScopedAssignees, unavailableSelection, validateReferenceSelections } from '../ui/reference-options.ts';
import { unavailableChoiceMessage } from '../ui/refresh-options.ts';

/** Bind once; replacement views and dialogs use delegated events. */
export function installEvents({ actions, forms }) {
  installDashboardInfo();
  installNavigationOverlays();
  installReferenceRefresh();
  watchNavigationBreakpoint();
  actions.close = close;
  actions['refresh-reference-options'] = (_data, trigger: HTMLElement) => refreshReferenceForm(trigger.closest('form'));
  const closeFilters = (details: HTMLDetailsElement, restoreFocus = false) => {
    const focusInside = details.contains(document.activeElement);
    details.open = false;
    if (restoreFocus || focusInside)
      details.querySelector('summary')?.focus();
  };
  actions['close-repository-filters'] = (_data, trigger: HTMLElement) => {
    const details = trigger.closest<HTMLDetailsElement>('.filter-more');
    if (details) closeFilters(details, true);
  };
  document.addEventListener('toggle', (event) => {
    const details = event.target as HTMLDetailsElement;
    if (details.matches?.('.filter-more[open]'))
      details.querySelector('.filter-more-panel')?.scrollIntoView({ block: 'nearest' });
  }, true);
  document.addEventListener('focusin', (event) => {
    document.querySelectorAll<HTMLDetailsElement>('.filter-more[open]').forEach((details) => {
      if (!details.contains(event.target as Node)) closeFilters(details);
    });
  });
  actions.menu = toggleNavigation;
  document.addEventListener('click', async (event) => {
    activateNavigation(event, () => { void render(); });
    const anchor=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');
    if(selectedDelegationId()&&anchor){const url=new URL(anchor.href,location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/')){event.preventDefault();try{await downloadProtected(anchor.href);}catch(error){reportError(error);}return;}}
    document.querySelectorAll<HTMLDetailsElement>('.filter-more[open]').forEach((details) => {
      if (!details.contains(event.target as Node)) closeFilters(details);
    });
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!target || !actions[target.dataset.action] || isBusy(target)) return;
    const finish = beginInteraction(target, target.dataset.action === 'logout' ? 'Signing out…'
      : target.dataset.action === 'ldap-test' ? 'Testing connection…' : 'Loading…',
      { lockForm: target.dataset.action !== 'retry-demo-users' });
    try {
      await actions[target.dataset.action]?.(target.dataset, target);
    } catch (error) {
      reportError(error);
    } finally {
      finish();
    }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target as HTMLFormElement;
    if (!forms[form.id]) return;
    event.preventDefault();
    if (isBusy(form)) return;
    if (!form.hasAttribute('data-wizard') && !validateReferenceSelections(form)) return;
    clearFormError(form);
    const finish = beginInteraction(event.submitter instanceof HTMLElement ? event.submitter : form, form.id === 'login' ? 'Signing in…'
      : form.id.includes('search') ? 'Searching…'
      : form.id.includes('filter') ? 'Loading results…'
      : form.id.includes('export') ? 'Preparing export…'
      : form.id.includes('upload') ? 'Uploading…' : 'Saving changes…');
    try {
      await forms[form.id](form, event.submitter);
    } catch (error) {
      reportError(error, form);
    } finally {
      finish();
    }
  });
  document.addEventListener('input', clearDemoSelection);
  document.addEventListener('input', syncLdapForm);
  document.addEventListener('change', async (event) => {
    const control = event.target as HTMLElement;
    const target = control as HTMLInputElement | HTMLSelectElement;
    if (target.validationMessage === unavailableChoiceMessage && !unavailableSelection(target)) target.setCustomValidity('');
    const finish = beginInteraction(control, 'Loading options…');
    try {
      syncLdapForm(event);
      selectDemoUser(event);
      if (target instanceof HTMLSelectElement) updateRelationshipHint(target);
      if (target.name === 'primary_domain_id' && target.closest('#instrument')) {
        const guidance = target.closest('form')?.querySelector<HTMLElement>('[data-domain-guidance]');
        if (guidance)
          guidance.innerHTML = domainGuidance(
            state.masters.regulatory_domain.find((d) => d.id === target.value),
          );
        syncSecondaryDomainPicker(target.closest('form'));
      }
      if (target.name === 'secondary_domain_ids' && target.closest('#instrument, #metadata-correction'))
        syncSecondaryDomainPicker(target.closest('form'));
      if (target.name === 'login_type' && target.closest('#user')) {
        const password = target.closest('form')?.querySelector<HTMLInputElement>('[name=password]');
        if (!password) return;
        password.disabled = target.value === 'LDAP';
        password.required = !password.disabled && !(target.closest('form') as HTMLFormElement).dataset.existing;
        if (password.disabled) password.value = '';
      }
      if (target instanceof HTMLSelectElement && target.name === 'regulatory_owner_unit_id' &&
          target.closest('#instrument, #metadata-correction')) await refreshScopedAssignees(target);
      if (target.name === 'selected_source_version') {
        const [path, qs = ''] = location.hash.slice(1).split('?');
        const query = withoutPaging(new URLSearchParams(qs));
        query.set('version', target.value);
        query.delete('clause');
        location.hash = path + '?' + query;
      }
      if (target.name === 'clause_workspace_edition' || target.name === 'clause_workspace_instrument') {
        const form = target.closest<HTMLFormElement>('#clause-filters');
        const next = form ? clauseFilterQuery(form) : new URLSearchParams();
        const instrumentChanged = target.name === 'clause_workspace_instrument';
        const instrument = instrumentChanged ? target.value : target.dataset.instrumentId || 'all';
        const edition = instrumentChanged ? (instrument === 'all' ? 'all' : 'current') : target.value;
        next.set('instrument', instrument);
        next.set('edition', edition);
        if (next.get('search_type') === 'literal' && ['all', 'current'].includes(edition)) next.delete('search_type');
        location.hash = 'clauses?' + next;
      }
      if (target.name === 'global_scope_flag') {
        const row = target.closest('.role-line');
        if (row) {
          const checked = (target as HTMLInputElement).checked;
          const scope = row.querySelector<HTMLSelectElement>('[name=scope_org_unit_id]');
          const scopeField = row.querySelector<HTMLElement>('.scope-field');
          if (scope) {
            scope.disabled = checked;
            scope.required = !checked;
          }
          if (scopeField) scopeField.hidden = checked;
        }
      }
    } catch (error) {
      reportError(error);
    } finally {
      finish();
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && state.ready) {
      event.preventDefault();
      actions['workspace-search']();
    }
    if (event.key === 'Escape') {
      const filters = document.querySelector<HTMLDetailsElement>('.filter-more[open]');
      if (filters && !dialog.open && !event.defaultPrevented) {
        event.preventDefault();
        closeFilters(filters, true);
      }
      closeNavigation();
    }
  });
  window.addEventListener('hashchange', () => {
    closeNavigation();
    const [path, queryString = ''] = location.hash.slice(1).split('?');
    const [page, id] = path.split('/');
    const recordSectionNavigation =
      page === 'repository' && Boolean(id) && id !== 'new' && new URLSearchParams(queryString).has('tab');
    const clauseWorkingNavigation = page === 'clauses' && new URLSearchParams(queryString).has('clause') && new URLSearchParams(queryString).get('view') !== 'register';
    render();
    if (!recordSectionNavigation && !clauseWorkingNavigation) window.scrollTo(0, 0);
  });
}
