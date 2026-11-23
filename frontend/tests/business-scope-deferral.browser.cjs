// Browsing-only checks against the disposable Oracle fixture on 8011.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const output=path.resolve(process.env.CBD_SCOPE_DEFERRAL_QA_OUTPUT||path.join(root,'outputs/family-empty-states-2026-10-31/browser'));
const report={environment:'UAT rollback-only fixture',checks:[],browser_errors:[],business_writes:[],layouts:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const fixture=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>report.browser_errors.push(e.message));
 await page.route('**/api/**',route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()!=='GET'&&!url.pathname.startsWith('/api/auth/')){
   report.business_writes.push({method:request.method(),path:url.pathname});return route.abort();
  }
  return route.continue();
 });
 const get=async route=>{const r=await page.request.get(base+'/api'+route);assert(r.ok(),route);return r.json();};
 const selected=data=>data.members.find(row=>row.id===fixture.record.id);
 async function go(route,heading){
  await page.goto(base+'/#'+route,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:heading,exact:true}).waitFor();
 }
 async function noRegistration(){
  assert.equal(await page.locator('[data-action=family-scope]').count(),0);
  assert.equal(await page.getByRole('button',{name:/Add participating department|Register business scope|Register pending scope/}).count(),0);
  assert.equal(await page.locator('#participating-owner-status').count(),0);
 }
 try{
  await page.goto(base);await page.locator('#login').waitFor();
  await page.locator('#login [name=username]').fill(fixture.credentials.author.username);
  await page.locator('#login [name=password]').fill(fixture.credentials.author.password);
  await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});
  const before=await get('/notification-families/'+fixture.record.id);
  await page.goto(base+'/#repository/'+fixture.record.id,{waitUntil:'networkidle'});
  await page.locator('.record-detail-header').waitFor();
  assert.equal(await page.getByRole('link',{name:'View departments',exact:true}).count(),0);
  await page.getByText('Lead regulatory department',{exact:true}).waitFor();await noRegistration();
  report.checks.push('The record retains one lead regulatory department and has no separate participating-department registration shortcut.');
  await page.goto(base+'/#repository/new',{waitUntil:'networkidle'});await page.locator('#instrument').waitFor();
  assert.equal(await page.getByText('Choose the department responsible for maintaining this source.',{exact:true}).count(),1);
  assert.equal(await page.getByText(/Add participating departments after saving/).count(),0);
  report.checks.push('Source registration no longer directs users to perform a second department-registration step.');
  await go('notification-families/'+fixture.record.id,'Source editions');await noRegistration();
  for(const tab of ['obligations','unavailable-tab']){
   await go('notification-families/'+fixture.record.id+'?notification='+fixture.families.child.id+'&tab='+tab,'Source editions');
   await page.locator('.family-node.selected[href*="notification='+fixture.families.child.id+'"]').waitFor();
   await noRegistration();assert.equal(await page.locator('a[href*="tab=obligations"]').count(),0);
  }
  report.checks.push('Family details default to Source editions; obsolete obligation and invalid tabs safely select Sources while retaining the notification.');
  await go('notification-families/'+fixture.record.id+'?tab=implementation','Business implementation');
  assert.equal(await page.getByText('New department registration is deferred. Obligation ownership is assigned separately.',{exact:true}).count(),0);
  await page.getByRole('heading',{name:'Review and approval history',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Independent proposals and decisions',exact:true}).count(),0);
  assert.equal(await page.locator('.family-scope').count(),selected(before).scopes.length);await noRegistration();
  report.checks.push('An existing implementation URL preserves retained department records and decisions without new-registration controls.');
  await page.evaluate(id=>{
   const form=document.createElement('form');form.id='family-proposal';form.dataset.route='/notification-families/'+id+'/scopes';
   document.body.append(form);form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  },fixture.record.id);
  await page.getByText('Manual business-scope registration is deferred.',{exact:true}).waitFor();
  await page.locator('form#family-proposal').evaluate(form=>form.remove());
  assert.deepEqual(report.business_writes,[]);
  report.checks.push('A stale registration form is rejected before any business API request is sent.');
  await go('notification-families/'+fixture.record.id+'?notification='+fixture.families.upcoming.id+'&tab=implementation','Source editions');
  await page.locator('.family-node.selected[href*="notification='+fixture.families.upcoming.id+'"]').waitFor();
  const inherited=before.members.find(row=>row.id===fixture.families.upcoming.id).scopes;
  assert(inherited.length&&inherited.every(scope=>!scope.id));
  assert.equal(await page.getByRole('link',{name:/^Business implementation/}).count(),0);
  report.checks.push('Inherited pending placeholders do not expose an empty implementation tab or registration instructions.');
  const empty=fixture.editions.draft_only.id;
  await go('notification-families/'+empty+'?tab=implementation','Source editions');
  await page.locator('.family-node.selected[href*="notification='+empty+'"]').waitFor();
  assert.equal(await page.getByRole('link',{name:/^Business implementation/}).count(),0);
  assert.equal(await page.getByRole('heading',{name:'Business implementation',exact:true}).count(),0);
  assert.equal(await page.getByRole('heading',{name:'Review and approval history',exact:true}).count(),0);
  assert.equal(await page.getByRole('columnheader',{name:'Implementation',exact:true}).count(),0);
  assert.equal(await page.locator('.family-summary').count(),0);await noRegistration();
  report.checks.push('An empty family hides implementation tabs/panels/totals, deferral notices and empty approval history; an old implementation URL opens Sources.');
  const after=await get('/notification-families/'+fixture.record.id);
  assert.deepEqual(after,before);
  report.checks.push('Browsing preserves the complete existing family, scope, assessment and source response.');
  await page.getByText('Manual business-scope registration is deferred.',{exact:true}).waitFor({state:'hidden'});
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});
   for(const [name,tab,heading] of [['sources','sources','Source editions'],['retained','implementation','Business implementation']]){
    await go('notification-families/'+fixture.record.id+'?notification='+fixture.record.id+'&tab='+tab,heading);
    await page.locator('.family-node.selected[href*="notification='+fixture.record.id+'"]').waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.getByRole('heading',{name:heading,exact:true}).evaluate(node=>node.scrollIntoView({behavior:'instant',block:'start'}));
    const file=name+'-'+width+'.png';await page.screenshot({path:path.join(output,file),animations:'disabled'});report.layouts.push(file);
   }
   await go('notification-families/'+empty+'?tab=implementation','Source editions');
   await page.locator('.family-node.selected[href*="notification='+empty+'"]').waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const emptyFile='empty-family-'+width+'.png';await page.screenshot({path:path.join(output,emptyFile),fullPage:true,animations:'disabled'});report.layouts.push(emptyFile);
  }
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.business_writes,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.stack;await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
 finally{await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,layouts:report.layouts.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
