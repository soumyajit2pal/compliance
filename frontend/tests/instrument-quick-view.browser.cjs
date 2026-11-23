// Real read-only detail requests on the rollback-only fixture; only the large
// register page and deliberate slow/error responses are controlled snapshots.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const out=path.join(root,'outputs/instrument-quick-view-2026-10-31/browser');
const report={checks:[],screenshots:[],browser_errors:[],prohibited_writes:[],environment:'UAT rollback-only fixture'};
let browser;
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const fixture=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8'));
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:850},timezoneId:'Asia/Kolkata',reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.browser_errors.push(error.message));
 let mockRows=null,registerGets=0;
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){
   report.prohibited_writes.push({method:req.method(),path:p});return route.abort('blockedbyclient');
  }
  if(mockRows&&p==='/api/instruments'&&url.searchParams.has('page')){
   registerGets++;
   const size=Number(url.searchParams.get('page_size')||25),current=Number(url.searchParams.get('page')||1),total=mockRows.length;
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:mockRows.slice((current-1)*size,current*size),
    pagination:{page:current,page_size:size,total,total_pages:Math.ceil(total/size),start:(current-1)*size+1,end:Math.min(current*size,total)}})});
  }
  return route.continue();
 });
 const get=async suffix=>{const response=await context.request.get(base+'/api'+suffix);assert(response.ok(),await response.text());return response.json();};
 const panel=()=>page.getByRole('dialog',{name:/TEST ONLY|Instrument quick view/});
 const row=id=>page.locator('a[data-instrument-preview="'+id+'"]');
 const ready=async id=>{try{await page.waitForFunction(id=>{const pane=document.querySelector('.instrument-quick-view');return pane?.getAttribute('data-instrument-id')===id&&Boolean(pane.querySelector('[data-summary-field]'));},id);}catch(error){report.preview_failure=await page.evaluate(()=>({hash:location.hash,scrollY,clicks:window.quickViewClicks,panel:document.querySelector('.instrument-quick-view')?.textContent,busy:document.querySelector('#root')?.getAttribute('aria-busy')}));throw error;}};
 const select=async id=>{await row(id).click();await ready(id);};
 const close=async()=>{
  const id=await page.locator('.instrument-quick-view').getAttribute('data-instrument-id');
  await page.getByRole('button',{name:'Close quick view',exact:true}).click();
  await page.locator('.instrument-quick-view').waitFor({state:'hidden'});
  await page.waitForFunction(id=>document.activeElement?.getAttribute('data-instrument-preview')===id,id);
 };
 const metadata=locator=>locator.locator('.record-summary-row').evaluateAll(rows=>Object.fromEntries(rows.map(row=>[row.dataset.summaryField,row.querySelector('dd').textContent.replace(/\s+/g,' ').trim()])));
 const shot=async name=>{
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Document overflow: '+name);
  await page.screenshot({path:path.join(out,name+'.png'),fullPage:false});report.screenshots.push(name+'.png');
 };
 try{
  await page.goto(base);await page.locator('#login').waitFor();await page.locator('#login-username').fill(fixture.credentials.author.username);
  await page.locator('#login-password').fill(fixture.credentials.author.password);await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});
  const records=await get('/instruments'),before=await get('/instruments/'+fixture.record.id);
  const draftBefore=await get('/instruments/'+fixture.editions.draft_only.id);
  const seed=records.find(item=>item.id===fixture.record.id),draft=records.find(item=>item.id===fixture.editions.draft_only.id);
  mockRows=Array.from({length:30},(_,i)=>({...seed,id:'quick-view-placeholder-'+i,title:'TEST ONLY placeholder '+i,code:'QA-PREVIEW-'+i}));
  mockRows[25]=seed;mockRows[26]=draft;
  const query=new URLSearchParams({q:'TEST ONLY',domain_id:seed.primary_domain_id,'page.instruments':'3','size.instruments':'10'});
  const listPath='repository?'+query;
  await page.goto(base+'/#'+listPath);await row(seed.id).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[data-pagination-key=instruments]').getAttribute('data-pagination-page'),'3');
  const listUrl=page.url(),getsBefore=registerGets;
  await page.locator('#filters [name=q]').fill('Unsaved search input');
  await row(seed.id).evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
  const scroll=await page.evaluate(()=>scrollY);
  await select(seed.id);
  assert.equal(page.url(),listUrl);assert.equal(registerGets,getsBefore);
  assert.equal(await page.locator('#filters [name=q]').inputValue(),'Unsaved search input');
  assert.equal(await page.evaluate(()=>scrollY),scroll);
  assert.equal(await row(seed.id).getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('.instrument-quick-view [data-action^=edit]').count(),0);
  assert.equal(await page.locator('.instrument-quick-view [data-action*=decision]').count(),0);
  assert.match(await page.locator('.instrument-quick-view-edition').innerText(),/Version 1\.0/);
  const previewFields=await metadata(page.locator('.instrument-quick-view'));
  await shot('quick-view-desktop');
  await close();assert.equal(page.url(),listUrl);assert.equal(await page.evaluate(()=>scrollY),scroll);
  assert(await row(seed.id).evaluate(element=>document.activeElement===element));
  assert.equal(await page.locator('#filters [name=q]').inputValue(),'Unsaved search input');
  report.checks.push('Read-only quick view preserves URL, applied filters, unsaved input, page/size, scroll and trigger focus without refetching the register.');

  await select(seed.id);
  await page.locator('.instrument-quick-view .source-document-link').click();
  await page.locator('#dialog[open] .source-preview-frame').waitFor();
  await page.locator('#dialog').press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});
  assert(await panel().isVisible());
  await page.keyboard.press('Escape');await page.locator('.instrument-quick-view').waitFor({state:'hidden'});
  report.checks.push('Source preview uses the existing read-only document dialog; Escape closes that dialog before quick view.');

  await page.locator('#filters [name=q]').fill('TEST ONLY');
  await select(seed.id);const savedScroll=await page.evaluate(()=>scrollY);
  const full=page.locator('.instrument-quick-view-footer a');
  assert(new URLSearchParams((await full.getAttribute('href')).split('?')[1]).get('version')===fixture.editions.approved);
  await full.click();await page.locator('.record-detail-header').waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.instrument-quick-view').count(),0);
  assert.deepEqual(await metadata(page.locator('#root')),previewFields);
  await page.reload();await page.locator('.record-detail-header').waitFor();await page.waitForLoadState('networkidle');
  const back=page.locator('.record-breadcrumb a');assert.equal(await back.getAttribute('href'),'#'+listPath);
  await page.goBack();await row(seed.id).waitFor();await page.waitForLoadState('networkidle');
  await page.waitForFunction(y=>Math.abs(scrollY-y)<=2,savedScroll);
  assert.equal(page.url(),listUrl);
  assert.equal(await page.locator('[data-pagination-key=instruments]').getAttribute('data-pagination-page'),'3');
  await select(seed.id);await page.locator('.instrument-quick-view-footer a').click();await page.locator('.record-breadcrumb a').click();
  await row(seed.id).waitFor();assert.equal(page.url(),listUrl);
  report.checks.push('Open instrument pins the displayed approved edition; the shared summary matches the full page. Browser Back and the library breadcrumb restore list context and scroll, including after a detail-page refresh.');

  let release;const gate=new Promise(resolve=>release=resolve);
  const slow=async route=>{const response=await route.fetch();await gate;await route.fulfill({response});};
  await page.route('**/api/instruments/'+seed.id,slow);
  await row(seed.id).click();await page.locator('.instrument-quick-view [aria-busy=true]').waitFor();
  await shot('loading-state');
  await select(draft.id);assert(await page.locator('.instrument-quick-view-reference-note').isVisible());
  assert.match(await page.locator('.instrument-quick-view-edition').innerText(),/Draft/);
  release();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.instrument-quick-view').getAttribute('data-instrument-id'),draft.id);
  assert(!await page.locator('.instrument-quick-view').innerText().then(text=>text.includes('TEST ONLY — Browser regulatory lifecycle')));
  await page.unroute('**/api/instruments/'+seed.id,slow);await close();
  report.checks.push('Loading is explicit; rapid selection ignores stale responses and a Draft-only source is never labelled current approved.');

  let finishSlow;const pending=new Promise(resolve=>finishSlow=resolve);
  const delayed=async route=>{const response=await route.fetch();await pending;await route.fulfill({response});};
  await page.route('**/api/instruments/'+seed.id,delayed);
  await row(seed.id).click();await page.locator('.instrument-quick-view [aria-busy=true]').waitFor();await close();
  finishSlow();await page.waitForLoadState('networkidle');assert.equal(await page.locator('.instrument-quick-view').count(),0);
  await page.unroute('**/api/instruments/'+seed.id,delayed);
  report.checks.push('Closing a loading preview cancels its UI result; a late response does not reopen it.');

  const denied=route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'TEST ONLY preview unavailable in current scope.'})});
  await page.route('**/api/instruments/'+seed.id,denied);
  await row(seed.id).click();await page.locator('.instrument-quick-view [role=alert]').waitFor();
  assert.equal(await page.locator('.instrument-quick-view [data-summary-field]').count(),0);await shot('permission-error');
  await page.unroute('**/api/instruments/'+seed.id,denied);
  await page.getByRole('button',{name:'Retry',exact:true}).click();await ready(seed.id);
  await page.keyboard.press('Escape');await page.locator('.instrument-quick-view').waitFor({state:'hidden'});
  report.checks.push('A failed or denied request shows a safe error without old metadata, and Retry reloads through the same authorised GET.');

  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   await select(seed.id);
   assert.equal(await panel().getAttribute('aria-modal'),'true');assert(await page.locator('#root').evaluate(element=>element.inert));
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
   const bounds=await panel().boundingBox();assert(bounds.x>=-1&&bounds.width<=width+1);
   await page.locator('.instrument-quick-view-footer a').focus();await page.keyboard.press('Tab');
   assert(await page.getByRole('button',{name:'Close quick view'}).evaluate(element=>document.activeElement===element));
   await shot('quick-view-mobile-'+width);await close();
   assert(!await page.locator('#root').evaluate(element=>element.inert));assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
   assert(await row(seed.id).evaluate(element=>document.activeElement===element));
  }
  report.checks.push('At 390px and 320px the panel fills the screen, traps focus, leaves the footer accessible and restores background interaction and focus on close.');

  await page.setViewportSize({width:1440,height:850});await select(seed.id);
  const popupWait=context.waitForEvent('page');
  await page.locator('.instrument-quick-view-footer a').click({modifiers:[process.platform==='darwin'?'Meta':'Control']});
  const popup=await popupWait;await popup.waitForLoadState('networkidle');assert(popup.url().includes('/#repository/'+seed.id));await popup.close();
  assert.equal(page.url(),listUrl);assert(await panel().isVisible());await close();
  report.checks.push('Modified Open instrument clicks retain the current preview and open the full details in another tab.');

  await page.evaluate(()=>{window.quickViewClicks=[];document.addEventListener('click',event=>{const anchor=event.target.closest('a');window.quickViewClicks.push({id:anchor?.dataset.instrumentPreview,href:anchor?.getAttribute('href'),hash:location.hash});},true);});
  await select(seed.id);await page.goto(base+'/#home');await page.locator('.instrument-quick-view').waitFor({state:'hidden'});await page.locator('#filters').waitFor({state:'hidden'});
  await page.goto(base+'/#'+listPath);await row(seed.id).waitFor();await page.waitForLoadState('networkidle');await select(seed.id);
  const expired=route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({detail:'TEST ONLY expired session.'})});
  await close();await page.route('**/api/instruments/'+seed.id,expired);await row(seed.id).click();await page.locator('#login').waitFor();
  assert.equal(await page.locator('.instrument-quick-view').count(),0);await page.unroute('**/api/instruments/'+seed.id,expired);
  report.checks.push('Navigation and session expiry remove quick view and its metadata.');
  assert.deepEqual(await get('/instruments/'+seed.id),before);
  assert.deepEqual(await get('/instruments/'+draft.id),draftBefore);
  assert.deepEqual(report.prohibited_writes,[]);assert.deepEqual(report.browser_errors,[]);
  report.checks.push('Browsing sends no business writes and preserves complete instrument, source, clause and approval responses.');
  report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;await page.screenshot({path:path.join(out,'failure.png'),fullPage:false}).catch(()=>{});process.exitCode=1;}
 finally{await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({status:report.status,checks:report.checks.length,failure:report.failure},null,2));}
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
