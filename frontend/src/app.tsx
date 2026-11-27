import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {captureNavigation,restoreNavigation,type NavigationSnapshot} from '../core/navigation-state.ts';
import { bindReactRoot, bindDialogCollections, initialMarkup } from '../core/dom.ts';
import { escapeMarkup, HtmlFragment, mountImperativeCollections } from './html-fragment';
import { initializeWizardSteps } from '../ui/wizard.ts';
import { InstrumentQuickView } from './components/instrument-quick-view';
import { ObligationQuickView } from './components/obligation-quick-view';
import { restoreLibraryLocation, retainLibraryLocation } from '../core/library-navigation.ts';
import { restoreObligationLocation, retainObligationLocation } from '../core/obligation-navigation.ts';
import { mountClauseExplorer } from '../features/clause-explorer.ts';

export function App() {
  const navigation = useRef<NavigationSnapshot | null>(null);
  const [view, setView] = useState({
    markup: initialMarkup,
    revision: 0,
  });

  useEffect(() => {
    const renderMarkup = (markup: string) => {
      navigation.current = captureNavigation();
      setView((current) => ({ markup, revision: current.revision + 1 }));
    };
    bindReactRoot(renderMarkup);
    bindDialogCollections(mountImperativeCollections);
    void import('../app.ts').catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'The portal could not start.';
      renderMarkup(`<div class="notice error" role="alert">${escapeMarkup(detail)}</div>`);
    });
    return () => bindReactRoot(() => undefined);
  }, []);

  useLayoutEffect(() => {
    restoreNavigation(navigation.current);
    initializeWizardSteps(document);
    if(document.querySelector('#obligation-editor'))document.dispatchEvent(new Event('portal:obligation-setup-mounted'));
    const clauseLayout = document.querySelector<HTMLElement>('[data-clause-explorer-layout]');
    if (clauseLayout) return mountClauseExplorer(clauseLayout);
  }, [view.revision]);

  useEffect(() => {
    const [path, queryString = ''] = location.hash.slice(1).split('?');
    const [page, id] = path.split('/');
    const query = new URLSearchParams(queryString);
    if (page === 'team' && query.has('metric')) {
      document.getElementById('dashboard-records')?.focus();
    }
    if (page === 'notification-families' && id) {
      const obligations = document.getElementById('family-obligations');
      if (obligations && query.get('show') === 'obligations') {
        query.delete('show');
        history.replaceState(history.state, '', '#' + path + (query.size ? '?' + query : ''));
        obligations.click();
        return;
      }
      if (query.has('proposal')) {
        const proposal = Array.from(document.querySelectorAll<HTMLElement>('[data-family-proposal]'))
          .find(element => element.dataset.familyProposal === query.get('proposal'));
        if (proposal) {
          proposal.focus({ preventScroll: true });
          proposal.scrollIntoView({ block: 'start' });
          return;
        }
      }
      if (query.has('notification')) {
        const selected = document.getElementById('family-selected-notification');
        selected?.focus({ preventScroll: true });
        selected?.scrollIntoView({ block: 'start' });
      }
    }
    if (page === 'actions' && query.has('extension')) {
      const request = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-action="delivery-extension-review"]'))
        .find(element => element.dataset.id === query.get('extension'));
      request?.focus({ preventScroll: true });
      request?.scrollIntoView({ block: 'center' });
    }
    if (['obligations','accountability','applicability'].includes(page) && !id) restoreObligationLocation();
    if (page === 'obligations' && id && !['new','imports'].includes(id)) retainObligationLocation(id);
    if (page === 'repository' && !id) { restoreLibraryLocation(); return; }
    const clauseWorkspace = (page === 'clauses' && query.get('view') !== 'register') ||
      (page === 'repository' && query.get('tab') === 'clauses');
    if (clauseWorkspace && query.has('clause')) {
      requestAnimationFrame(() => {
        const heading = document.getElementById('child-clause-heading') || document.getElementById('working-clause-heading');
        heading?.focus({ preventScroll: true });
        document.querySelector('.clause-tree-node[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
        const target = heading?.closest('.clause-child-editor') || document.getElementById('clause-working-view');
        target?.scrollIntoView({ block: 'start' });
      });
      return;
    }
    if (page !== 'repository' || !id || id === 'new') return;
    retainLibraryLocation(id);
    if (!query.has('tab')) return;

    requestAnimationFrame(() => {
      const correction = query.get('tab') === 'workflow' && query.has('correction')
        ? document.getElementById('metadata-correction-panel')
        : null;
      if (correction) {
        correction.focus({ preventScroll: true });
        correction.scrollIntoView({ block: 'start' });
        return;
      }
      const nextStep = query.get('tab') === 'workflow' && !query.has('correction')
        ? document.getElementById('edition-next-step-heading')
        : null;
      if (nextStep) {
        nextStep.focus({ preventScroll: true });
        nextStep.closest('.edition-next-step')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      const target = document.getElementById('record-sections');
      if (!target) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }, [view.revision]);

  return (
    <><div id="root">
      {/* Legacy root.innerHTML replaced the whole page on every render. Keep that reset behavior
          for record disclosures and uncontrolled fields. Navigation alone restores its own UI state. */}
      <HtmlFragment key={view.revision} markup={view.markup} />
    </div><InstrumentQuickView viewRevision={view.revision}/><ObligationQuickView viewRevision={view.revision}/></>
  );
}
