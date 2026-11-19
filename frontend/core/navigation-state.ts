/** Preserve only navigation UI state; record forms still remount between views. */
export interface NavigationSnapshot {
 owner: string;
 scrollTop: number;
 activeHref: string;
 groups: Record<string, boolean>;
 focused: {href?: string; group?: string; opener?: boolean} | null;
}

export function captureNavigation(): NavigationSnapshot | null {
 const nav=document.querySelector<HTMLElement>('#portal-sidebar .nav-scroll[data-nav-owner]');
 if(!nav)return null;
 const groups=Object.fromEntries([...nav.querySelectorAll<HTMLDetailsElement>('[data-nav-group]')].map(g=>[g.dataset.navGroup,g.open]));
 const focused=document.activeElement as HTMLElement;
 const anchor=focused?.closest<HTMLAnchorElement>('.nav-item[href]');
 const summary=focused?.matches('summary')?focused.closest<HTMLDetailsElement>('[data-nav-group]'):null;
 return {owner:nav.dataset.navOwner,scrollTop:nav.scrollTop,activeHref:nav.querySelector('a[aria-current="page"]')?.getAttribute('href')||'',groups,
  focused:anchor&&nav.contains(anchor)?{href:anchor.getAttribute('href')}:summary&&nav.contains(summary)?{group:summary.dataset.navGroup}:focused?.matches('.topbar .mobile-menu')?{opener:true}:null};
}

export function restoreNavigation(saved: NavigationSnapshot | null) {
 const nav=document.querySelector<HTMLElement>('#portal-sidebar .nav-scroll[data-nav-owner]');
 if(!nav||!saved||saved.owner!==nav.dataset.navOwner)return;
 const groups=[...nav.querySelectorAll<HTMLDetailsElement>('[data-nav-group]')];
 for(const group of groups)if(Object.hasOwn(saved.groups,group.dataset.navGroup))group.open=saved.groups[group.dataset.navGroup];
 const active=nav.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
 const changed=active?.getAttribute('href')!==saved.activeHref;
 if(changed&&active)active.closest<HTMLDetailsElement>('[data-nav-group]')?.setAttribute('open','');
 nav.scrollTop=saved.scrollTop;
 if(changed&&active){
  const bounds=nav.getBoundingClientRect(),item=active.getBoundingClientRect();
  if(item.top<bounds.top)nav.scrollTop-=bounds.top-item.top;
  else if(item.bottom>bounds.bottom)nav.scrollTop+=item.bottom-bounds.bottom;
 }
 const mobile=window.matchMedia('(max-width: 900px)').matches;
 let focus:HTMLElement;
 if(saved.focused?.opener)focus=document.querySelector<HTMLElement>('.topbar .mobile-menu');
 else if(!mobile||document.querySelector('#portal-sidebar.open')){
  if(saved.focused?.href)focus=[...nav.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a=>a.getAttribute('href')===saved.focused.href);
  else if(saved.focused?.group)focus=groups.find(g=>g.dataset.navGroup===saved.focused.group)?.querySelector('summary');
 }
 focus?.focus({preventScroll:true});
}

export function closeNavigation() {
 const sidebar=document.querySelector('#portal-sidebar');
 const focusInside=sidebar?.classList.contains('open')&&sidebar.contains(document.activeElement);
 sidebar?.classList.remove('open');
 const opener=document.querySelector<HTMLElement>('.topbar .mobile-menu');
 opener?.setAttribute('aria-expanded','false');
 if(focusInside)opener?.focus({preventScroll:true});
}

export function toggleNavigation() {
 const sidebar=document.querySelector('#portal-sidebar');
 if(sidebar?.classList.contains('open'))closeNavigation();
 else {sidebar?.classList.add('open');document.querySelector('.topbar .mobile-menu')?.setAttribute('aria-expanded','true');}
}

/** Reopening the current destination refreshes it, even when the hash is unchanged. */
export function activateNavigation(event: MouseEvent, refresh: () => void) {
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 const anchor=(event.target as Element)?.closest<HTMLAnchorElement>('#portal-sidebar a[href],.tabs a[href],.obligation-workspace-tabs a[href],.at-tabs a[href]');
 if(!anchor||anchor.target&&anchor.target!=='_self'||anchor.hasAttribute('download'))return;
 const url=new URL(anchor.href,location.href);
 if(url.origin!==location.origin||url.pathname!==location.pathname||url.search!==location.search||!url.hash)return;
 if(anchor.closest('#portal-sidebar'))closeNavigation();
 // Repeating a record tab must not reset an editor's uncontrolled draft fields.
 if(url.hash===location.hash&&!url.hash.split('?')[0].includes('/')){event.preventDefault();refresh();window.scrollTo(0,0);}
}
