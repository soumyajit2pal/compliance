import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, SessionExpired } from '../../core/api.ts';
import { state } from '../../core/state.ts';
import { obligationReturnPath, statusLabel } from '../../core/obligation-detail.ts';
import { rememberObligationLocation } from '../../core/obligation-navigation.ts';
import { renderObligationOverview } from '../../features/obligation-detail.ts';
import { badge, localDate, statusTag } from '../../ui/components.ts';
import { icon } from '../../ui/icons.ts';
import { loadingMarkup } from '../../ui/loading.ts';
import { HtmlFragment } from '../html-fragment';

type Preview = {id:string; title:string; code:string; returnPath:string; data?:any; error?:string; loading:boolean};
const selector = '[data-obligation-preview]';
const interactive = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"]),[data-action],[tabindex]';
const plainClick = (event:{button:number;metaKey:boolean;ctrlKey:boolean;shiftKey:boolean;altKey:boolean}) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
function setExpanded(origin:HTMLElement | null, expanded:boolean) {
  const controls = origin?.closest('tr,.coverage-card-head')?.querySelectorAll(selector) || (origin ? [origin] : []);
  controls.forEach(control => control.setAttribute('aria-expanded',String(expanded)));
}

/** Read the shared Overview while keeping the obligation register mounted. */
export function ObligationQuickView({viewRevision}:{viewRevision:number}) {
  const [preview,setPreview] = useState<Preview | null>(null);
  const [mobile,setMobile] = useState(() => matchMedia('(max-width: 900px)').matches);
  const token = useRef(0), trigger = useRef<HTMLElement | null>(null);
  const pane = useRef<HTMLElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus = true) => {
    token.current++;
    const anchor = trigger.current;
    setExpanded(anchor,false); trigger.current = null; setPreview(null);
    if (restoreFocus) requestAnimationFrame(() => {
      if (anchor?.isConnected) anchor.focus({preventScroll:true});
      else document.querySelector<HTMLInputElement>('#view-filter [name=q]')?.focus({preventScroll:true});
    });
  },[]);
  const open = useCallback(async (anchor:HTMLElement) => {
    const id = anchor.dataset.obligationPreview, returnPath = obligationReturnPath(location.hash.slice(1));
    if (!id || !returnPath || !state.ready || !state.identity) return;
    const owner = state.identity.user.id, request = ++token.current;
    setExpanded(trigger.current,false); trigger.current = anchor; setExpanded(anchor,true);
    const context = anchor.closest('tr,.coverage-card-head') || anchor;
    const initial = {id,returnPath,title:context.querySelector('.record-title,h3')?.textContent || 'Obligation overview',
      code:context.querySelector('.record-code')?.textContent || '',loading:true};
    setPreview(initial);
    pane.current?.querySelector('.instrument-quick-view-body')?.scrollTo(0,0);
    requestAnimationFrame(() => closeButton.current?.focus({preventScroll:true}));
    try {
      const data = await api('/obligations/'+encodeURIComponent(id));
      if (request !== token.current || state.identity?.user.id !== owner) return;
      setPreview({...initial,title:data.obligation.title,code:data.obligation.code+' · Revision '+data.obligation.version_number,data,loading:false});
    } catch (error) {
      if (request !== token.current || error instanceof SessionExpired || state.identity?.user.id !== owner) return;
      setPreview({...initial,loading:false,error:error.message || 'Unable to load this obligation.'});
    }
  },[]);
  useEffect(() => {
    const click = (event:MouseEvent) => {
      if (!(event.target instanceof Element) || event.defaultPrevented || !plainClick(event)) return;
      const target = event.target, direct = target.closest<HTMLElement>(selector);
      if (!direct && target.closest(interactive)) return;
      const selection = window.getSelection();
      if (!direct && selection && !selection.isCollapsed) return;
      const origin = direct || target.closest('tr')?.querySelector<HTMLElement>('button'+selector);
      if (!origin) return;
      event.preventDefault(); void open(origin);
    };
    const navigating = () => close(false), media = matchMedia('(max-width: 900px)');
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
  },[open,close]);
  useEffect(() => {close(false);},[viewRevision,close]);
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
  },[isOpen,mobile,close]);
  useLayoutEffect(() => {
    if (!isOpen || !mobile) return;
    const app = document.getElementById('root'), wasInert = app.inert, overflow = document.body.style.overflow;
    app.inert = true; document.body.style.overflow = 'hidden';
    return () => {app.inert = wasInert; document.body.style.overflow = overflow;};
  },[isOpen,mobile]);
  if (!preview) return null;
  const d = preview.data, status = d && statusLabel(d.obligation,d.tasks?.find(t=>t.entity_id===d.obligation.id&&t.workflow_status==='OPEN')?.current_stage || d.obligation.approval_status,localDate());
  return createPortal(<div className="instrument-quick-view-layer">
    {mobile && <div className="instrument-quick-view-backdrop" aria-hidden="true" onClick={() => close()}/>}
    <aside id="obligation-quick-view" ref={pane} className="instrument-quick-view obligation-quick-view" role="dialog" aria-modal={mobile ? 'true' : 'false'} aria-labelledby="obligation-quick-view-title" data-obligation-id={preview.id}>
      <header className="instrument-quick-view-header"><div><p className="instrument-quick-view-kicker">Quick view · Overview</p>
        <h2 id="obligation-quick-view-title">{preview.title}</h2><span className="record-code">{preview.code}</span></div>
        <button ref={closeButton} type="button" className="icon-button" aria-label="Close quick view" onClick={() => close()}><HtmlFragment markup={icon('x')}/></button>
      </header>
      <div className="instrument-quick-view-body" aria-busy={preview.loading || undefined}>
        {preview.loading ? <div className="instrument-quick-view-loading"><HtmlFragment markup={loadingMarkup('Loading obligation…')}/>
          <div className="instrument-quick-view-skeleton" aria-hidden="true">{Array.from({length:6},(_,i)=><span key={i}/>)}</div></div> :
          preview.error ? <div className="notice error" role="alert"><p>{preview.error}</p><button type="button" className="btn small" onClick={() => trigger.current && open(trigger.current)}>Retry</button></div> : <>
            <div className="instrument-quick-view-badges"><HtmlFragment markup={statusTag(status.label,status.tone)+badge(d.obligation.criticality)}/></div>
            <HtmlFragment markup={renderObligationOverview(d)}/>
          </>}
      </div>
      <footer className="instrument-quick-view-footer"><span>Read-only overview</span>
        <a className="btn primary" href={'#obligations/'+encodeURIComponent(preview.id)+'?'+new URLSearchParams({tab:'overview',return_to:preview.returnPath})} onClick={event => {
          if (plainClick(event)) {rememberObligationLocation(preview.id);close(false);}
        }}>Open obligation <HtmlFragment markup={icon('arrow')}/></a>
      </footer>
    </aside>
  </div>,document.body);
}
