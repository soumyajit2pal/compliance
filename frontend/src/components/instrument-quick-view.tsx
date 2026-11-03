import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, SessionExpired } from '../../core/api.ts';
import { state } from '../../core/state.ts';
import { selectSourceEdition, sourceEditionStatus } from '../../core/source-editions.ts';
import { instrumentWorkspacePath } from '../../core/source-navigation.ts';
import { rememberLibraryLocation } from '../../core/library-navigation.ts';
import { renderInstrumentSummary, renderInstrumentMateriality } from '../../features/repository/summary.ts';
import { badge, localDate, versionLabel } from '../../ui/components.ts';
import { icon } from '../../ui/icons.ts';
import { loadingMarkup } from '../../ui/loading.ts';
import { HtmlFragment } from '../html-fragment';

type Preview = {id:string; title:string; code:string; data?:any; error?:string; loading:boolean};
const plainClick = (event: {button:number;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean}) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const previewSelector = '[data-instrument-preview]';
const interactiveSelector = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),[data-action],[tabindex]';
function setExpanded(origin: HTMLElement | null, expanded: boolean) {
  const controls = origin?.closest('tr')?.querySelectorAll(previewSelector) || (origin ? [origin] : []);
  controls.forEach(control => control.setAttribute('aria-expanded',String(expanded)));
}

/** The portal leaves the register DOM, filter input and paging state mounted. */
export function InstrumentQuickView({viewRevision}: {viewRevision:number}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 900px)').matches);
  const token = useRef(0), trigger = useRef<HTMLElement | null>(null);
  const pane = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus = true) => {
    token.current++;
    const anchor = trigger.current;
    setExpanded(anchor,false);
    trigger.current = null;
    setPreview(null);
    if (restoreFocus) requestAnimationFrame(() => {
      if (anchor?.isConnected) anchor.focus({preventScroll:true});
      else document.querySelector<HTMLInputElement>('#filters [name=q]')?.focus({preventScroll:true});
    });
  }, []);
  const open = useCallback(async (anchor:HTMLElement) => {
    const id = anchor.dataset.instrumentPreview;
    if (!id || !state.ready || !state.identity || location.hash.split('?')[0] !== '#repository') return;
    const owner = state.identity.user.id, request = ++token.current;
    setExpanded(trigger.current,false);
    trigger.current = anchor;setExpanded(anchor,true);
    const context = anchor.closest('tr') || anchor;
    const initial = {id, title:context.querySelector('.record-title')?.textContent || 'Instrument quick view',
      code:context.querySelector('.record-code')?.textContent || '', loading:true};
    setPreview(initial);
    pane.current?.querySelector('.instrument-quick-view-body')?.scrollTo(0,0);
    requestAnimationFrame(() => closeButton.current?.focus({preventScroll:true}));
    try {
      const data = await api('/instruments/'+encodeURIComponent(id));
      if (request !== token.current || state.identity?.user.id !== owner) return;
      setPreview({...initial, title:data.instrument.short_title || data.instrument.title, code:data.instrument.code, data, loading:false});
    } catch (error) {
      if (request !== token.current || error instanceof SessionExpired || state.identity?.user.id !== owner) return;
      setPreview({...initial, loading:false, error:error.message || 'Unable to load this instrument.'});
    }
  }, []);
  useEffect(() => {
    const click = (event:MouseEvent) => {
      if (!(event.target instanceof Element) || event.defaultPrevented || !plainClick(event)) return;
      const target = event.target, direct = target.closest<HTMLElement>(previewSelector);
      if (!direct && target.closest(interactiveSelector)) return;
      // Dragging across a reference or other cell must remain text selection.
      const selection = window.getSelection();
      if (!direct && selection && !selection.isCollapsed) return;
      const origin = direct || target.closest('tr')?.querySelector<HTMLElement>('button'+previewSelector);
      if (!origin) return;
      event.preventDefault();void open(origin);
    };
    const navigating = () => close(false);
    const media = matchMedia('(max-width: 900px)');
    const resize = () => setMobile(media.matches);
    document.addEventListener('click',click);
    window.addEventListener('hashchange',navigating);
    window.addEventListener('popstate',navigating);
    window.addEventListener('portal:session-expired',navigating);
    media.addEventListener('change',resize);
    return () => {
      token.current++;
      document.removeEventListener('click',click);
      window.removeEventListener('hashchange',navigating);
      window.removeEventListener('popstate',navigating);
      window.removeEventListener('portal:session-expired',navigating);
      media.removeEventListener('change',resize);
    };
  }, [open,close]);
  useEffect(() => { close(false); }, [viewRevision,close]);
  const isOpen = Boolean(preview);
  useEffect(() => {
    if (!isOpen) return;
    const keydown = (event:KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.defaultPrevented) return;
      if (event.key === 'Escape') {event.preventDefault();close();return;}
      if (event.key !== 'Tab' || !mobile) return;
      const controls = [...pane.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {event.preventDefault();last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);
    return () => document.removeEventListener('keydown',keydown);
  }, [isOpen,mobile,close]);
  useLayoutEffect(() => {
    if (!isOpen || !mobile) return;
    const app = document.getElementById('root'), wasInert = app.inert, overflow = document.body.style.overflow;
    app.inert = true;document.body.style.overflow = 'hidden';
    return () => {app.inert = wasInert;document.body.style.overflow = overflow;};
  }, [isOpen,mobile]);
  if (!preview) return null;
  const data = preview.data;
  const selection = data && selectSourceEdition(data.versions, data.instrument.current_version_id, null, localDate());
  const edition = selection?.selected;
  const fullPath = instrumentWorkspacePath(preview.id, edition?.id || '');
  return createPortal(<div className="instrument-quick-view-layer">
    {mobile && <div className="instrument-quick-view-backdrop" aria-hidden="true" onClick={() => close()} />}
    <aside id="instrument-quick-view" ref={pane} className="instrument-quick-view" role="dialog" aria-modal={mobile ? 'true' : 'false'}
      aria-labelledby="instrument-quick-view-title" data-instrument-id={preview.id}>
      <header className="instrument-quick-view-header">
        <div><p className="instrument-quick-view-kicker">Quick view</p>
          <h2 id="instrument-quick-view-title">{preview.title}</h2><span className="record-code">{preview.code}</span></div>
        <button ref={closeButton} type="button" className="icon-button" aria-label="Close quick view" onClick={() => close()}><HtmlFragment markup={icon('x')} /></button>
      </header>
      <div className="instrument-quick-view-body" aria-busy={preview.loading || undefined}>
        {preview.loading ? <div className="instrument-quick-view-loading"><HtmlFragment markup={loadingMarkup('Loading instrument…')} />
          <div className="instrument-quick-view-skeleton" aria-hidden="true">{Array.from({length:6},(_,i)=><span key={i}/>)}</div></div> :
          preview.error ? <div className="notice error" role="alert"><p>{preview.error}</p><button type="button" className="btn small" onClick={() => trigger.current && open(trigger.current)}>Retry</button></div> : <>
            <div className="instrument-quick-view-badges"><HtmlFragment markup={badge(data.instrument.regulatory_status)} />
              {edition && <span className="instrument-quick-view-edition">Version {versionLabel(edition.version_number)} <HtmlFragment markup={badge(sourceEditionStatus(edition))} /></span>}
              <HtmlFragment markup={renderInstrumentMateriality(data.instrument.materiality)} />
            </div>
            {!selection?.approvedEffective && <p className="instrument-quick-view-reference-note">No current approved source edition. {edition ? 'The edition shown is for reference.' : 'No source edition is available.'}</p>}
            <HtmlFragment markup={renderInstrumentSummary(data,edition)} />
          </>}
      </div>
      <footer className="instrument-quick-view-footer"><span>Read-only summary</span>
        <a className="btn primary" href={'#'+fullPath} onClick={event => {
          if (plainClick(event)) {rememberLibraryLocation(preview.id);close(false);}
        }}>Open instrument <HtmlFragment markup={icon('arrow')} /></a>
      </footer>
    </aside>
  </div>, document.body);
}
