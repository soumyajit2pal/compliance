import { useEffect, useLayoutEffect, useState } from 'react';
import { bindReactRoot, bindDialogCollections, initialMarkup } from '../core/dom.ts';
import { escapeMarkup, HtmlFragment, mountImperativeCollections } from './html-fragment';
import { initializeWizardSteps } from '../ui/wizard.ts';
import { InstrumentQuickView } from './components/instrument-quick-view';
import { ObligationQuickView } from './components/obligation-quick-view';
import { restoreLibraryLocation, retainLibraryLocation } from '../core/library-navigation.ts';
import { restoreObligationLocation, retainObligationLocation } from '../core/obligation-navigation.ts';

export function App() {
  const [view, setView] = useState({
    markup: initialMarkup,
    revision: 0,
  });

  useEffect(() => {
    const renderMarkup = (markup: string) => {
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
    initializeWizardSteps(document);
    if(document.querySelector('#obligation-editor'))document.dispatchEvent(new Event('portal:obligation-setup-mounted'));
  }, [view.revision]);

  useEffect(() => {
    const [path, queryString = ''] = location.hash.slice(1).split('?');
    const [page, id] = path.split('/');
    const query = new URLSearchParams(queryString);
    if (['obligations','accountability','applicability'].includes(page) && !id) restoreObligationLocation();
    if (page === 'obligations' && id && !['new','imports'].includes(id)) retainObligationLocation(id);
    if (page === 'repository' && !id) { restoreLibraryLocation(); return; }
    const clauseWorkspace = (page === 'clauses' && query.get('view') !== 'register') ||
      (page === 'repository' && query.get('tab') === 'clauses');
    if (clauseWorkspace && query.has('clause')) {
      requestAnimationFrame(() => {
        const heading = document.getElementById('working-clause-heading');
        heading?.focus({ preventScroll: true });
        document.querySelector('.clause-tree-node[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
        const target = document.getElementById('clause-working-view');
        target?.scrollIntoView({ block: 'start' });
      });
      return;
    }
    if (page !== 'repository' || !id || id === 'new') return;
    retainLibraryLocation(id);
    if (!query.has('tab')) return;

    requestAnimationFrame(() => {
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
          so native disclosures and uncontrolled fields do not leak state between routes. */}
      <HtmlFragment key={view.revision} markup={view.markup} />
    </div><InstrumentQuickView viewRevision={view.revision}/><ObligationQuickView viewRevision={view.revision}/></>
  );
}
