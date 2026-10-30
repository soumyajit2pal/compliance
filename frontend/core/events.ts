import { state } from './state.ts';
import { dialog } from './dom.ts';
import { render } from './router.ts';
import { choosePeople } from './assignees.ts';
import { selectDemoUser, clearDemoSelection } from '../features/auth.ts';
import { syncLdapForm } from '../features/settings.ts';
import { options, message } from '../ui/components.ts';
import { close } from '../ui/dialog.ts';
import { clearFormError, reportError } from '../ui/feedback.ts';
import { domainGuidance, syncSecondaryDomainPicker } from '../ui/domains.ts';

/** Bind once; replacement views and dialogs use delegated events. */
export function installEvents({ actions, forms }) {
  actions.close = close;
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
  actions.menu = () => {
    const sidebar = document.querySelector('#portal-sidebar');
    sidebar?.classList.toggle('open');
    document
      .querySelector('.topbar .mobile-menu')
      ?.setAttribute('aria-expanded', String(sidebar?.classList.contains('open')));
  };
  document.addEventListener('click', async (event) => {
    document.querySelectorAll<HTMLDetailsElement>('.filter-more[open]').forEach((details) => {
      if (!details.contains(event.target as Node)) closeFilters(details);
    });
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action]');
    if (!target) return;
    try {
      await actions[target.dataset.action]?.(target.dataset, target);
    } catch (error) {
      message(error.message, true);
    }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target as HTMLFormElement;
    if (!forms[form.id]) return;
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit],button:not([type])');
    clearFormError(form);
    form.setAttribute('aria-busy', 'true');
    if (submit) submit.disabled = true;
    try {
      await forms[form.id](form);
    } catch (error) {
      reportError(error.message, form);
    } finally {
      form.removeAttribute('aria-busy');
      if (submit) submit.disabled = false;
    }
  });
  document.addEventListener('input', clearDemoSelection);
  document.addEventListener('input', syncLdapForm);
  document.addEventListener('change', async (event) => {
    syncLdapForm(event);
    selectDemoUser(event);
    const target = event.target as HTMLInputElement | HTMLSelectElement;
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
    if (target.name === 'regulatory_owner_unit_id' && target.closest('#instrument')) {
      try {
        const users = await choosePeople('AUTHOR', target.value);
        (target.closest('form')?.querySelector<HTMLSelectElement>('[name=interpretation_owner_user_id]')).innerHTML =
          options(users, state.identity.user.id, 'full_name');
        for(const [field,role] of [['family_reviewer_id','REVIEWER'],['family_approver_id','APPROVER']]){
          const control=target.closest('form').querySelector<HTMLSelectElement>('[name='+field+']');
          if(control)control.innerHTML=options(await choosePeople(role,target.value,[state.identity.user.id]),'','full_name');
        }
      } catch (error) {
        message(error.message, true);
      }
    }
    if (target.name === 'regulatory_owner_unit_id' && target.closest('#metadata-correction')) {
      try {
        const users = await choosePeople('AUTHOR', target.value);
        const owner = target.closest('form')?.querySelector<HTMLSelectElement>('[name=interpretation_owner_user_id]');
        if (owner) owner.innerHTML = options(users, '', 'full_name');
      } catch (error) {
        message(error.message, true);
      }
    }
    if (target.name === 'selected_source_version') {
      const [path, qs = ''] = location.hash.slice(1).split('?');
      const query = new URLSearchParams(qs);
      query.set('version', target.value);
      query.delete('clause');
      location.hash = path + '?' + query;
    }
    if (target.name === 'clause_workspace_edition') {
      const next = new URLSearchParams({ instrument: target.dataset.instrumentId || 'all', edition: target.value });
      if (new URLSearchParams(location.hash.split('?')[1]).get('view') === 'register') next.set('view', 'register');
      location.hash = 'clauses?' + next;
    }
    if (target.name === 'clause_workspace_instrument') {
      const previous = new URLSearchParams(location.hash.split('?')[1]);
      const next = new URLSearchParams({ instrument: target.value, edition: previous.get('edition') === 'current' ? 'current' : 'all' });
      if (previous.get('view') === 'register') next.set('view', 'register');
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
      document.querySelector('#portal-sidebar')?.classList.remove('open');
      document.querySelector('.topbar .mobile-menu')?.setAttribute('aria-expanded', 'false');
    }
  });
  window.addEventListener('hashchange', () => {
    document.querySelector('#portal-sidebar')?.classList.remove('open');
    const [path, queryString = ''] = location.hash.slice(1).split('?');
    const [page, id] = path.split('/');
    const recordSectionNavigation =
      page === 'repository' && Boolean(id) && id !== 'new' && new URLSearchParams(queryString).has('tab');
    const clauseWorkingNavigation = page === 'clauses' && new URLSearchParams(queryString).has('clause') && new URLSearchParams(queryString).get('view') !== 'register';
    render();
    if (!recordSectionNavigation && !clauseWorkingNavigation) window.scrollTo(0, 0);
  });
}
