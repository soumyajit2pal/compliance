import { useEffect, useState } from 'react';
import { bindReactRoot, initialMarkup } from '../core/dom.ts';
import { escapeMarkup, HtmlFragment } from './html-fragment';

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
    void import('../app.ts').catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : 'The portal could not start.';
      renderMarkup(`<div class="notice error" role="alert">${escapeMarkup(detail)}</div>`);
    });
    return () => bindReactRoot(() => undefined);
  }, []);

  useEffect(() => {
    const [path, queryString = ''] = location.hash.slice(1).split('?');
    const [page, id] = path.split('/');
    const query = new URLSearchParams(queryString);
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
    if (!query.has('tab')) return;

    requestAnimationFrame(() => {
      const target = document.getElementById('record-sections');
      if (!target) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }, [view.revision]);

  return (
    <div id="root">
      {/* Legacy root.innerHTML replaced the whole page on every render. Keep that reset behavior
          so native disclosures and uncontrolled fields do not leak state between routes. */}
      <HtmlFragment key={view.revision} markup={view.markup} />
    </div>
  );
}
