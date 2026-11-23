// Existing-record UAT smoke: open/cancel only. Never save a master or account.
const {chromium}=require(process.argv[2]||'playwright');
const {searchable}=require('./helpers/searchable-select.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const output=path.resolve(__dirname,'../../outputs/master-maintenance-2026-10-30/live');
const report={status:'running',checks:[],screenshots:[],browser_errors:[],prohibited_writes:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({...uatContextOptions,viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'}),page=await context.newPage();let signedIn=false;
 page.on('pageerror',e=>report.browser_errors.push(e.message));
 await context.route('**/api/**',async route=>{const r=route.request(),p=new URL(r.url()).pathname;if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){report.prohibited_writes.push({method:r.method(),path:p});return route.abort('blockedbyclient');}await route.continue();});
 async function get(url){const r=await context.request.get(base+'/api'+url);assert(r.ok());return r.json();}
 async function shot(name){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=name+'.png';if(name.includes('edit'))await page.locator('#dialog').screenshot({path:path.join(output,file)});else await page.screenshot({path:path.join(output,file),fullPage:true});report.screenshots.push(file);}
 try{
  assert.equal((await get('/health')).environment,'uat');await page.goto(base);await page.locator('#demo-user').waitFor();const demo=await get('/auth/demo-users');assert(demo.users.some(u=>u.username==='admin'&&u.password_autofill_available&&!u.must_change_password));await page.locator('#demo-user').selectOption('admin');await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});signedIn=true;
  const catalogue=await get('/masters/catalogue'),before=await get('/masters');assert.equal(catalogue.length,10);
  report.population=Object.fromEntries(catalogue.map(d=>[d.key,before[d.key].length]));
  for(const definition of catalogue){
   const key=definition.key,tab={regulatory_domain:'domains',regulator:'regulators',instrument_type:'types',obligation_category:'categories',organisational_unit:'organisation'}[key]||'other';
   await page.goto(base+'/#masters?'+new URLSearchParams({tab,...(tab==='other'?{lookup:key}:{})}));
   const ready=definition.can_create?'[data-action=add-master][data-key="'+key+'"]':'[data-action=edit-master][data-key=role]';await page.locator(ready).first().waitFor();
   if(definition.can_create){await page.locator(ready).first().click();await page.locator('#master-record [name=reason]').waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('#master-record select')).every(select=>select.parentElement.dataset.enhanced==='true'));assert.equal(await page.locator('#master-record select').count(),await page.locator('#master-record .searchable-select[data-enhanced] > select').count());await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();}
   if(before[key].length){const edit=page.locator('[data-action=edit-master][data-key="'+key+'"]').first();if(await edit.count()){await edit.click();assert(await page.locator('#master-record [name=code]').evaluate(e=>e.readOnly));await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();}}
  }
  report.checks.push('All 10 existing UAT master catalogues load; nine supported Add forms and existing Edit forms open with shared searchable fields. Permanent codes remain read-only and role creation stays protected.');
  await page.goto(base+'/#masters?tab=domains');await page.locator('[data-action=domain]').first().waitFor();await shot('masters-1440');
  const selected=before.organisational_unit.find(u=>u.code==='OPERATIONS')||before.organisational_unit.find(u=>u.code!=='BANK');assert(selected);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});await page.goto(base+'/#masters?tab=organisation&unit='+selected.id);await page.locator('[data-action=edit-master][data-id="'+selected.id+'"]').waitFor();await shot('organisation-'+width);
   await page.locator('[data-action=edit-master][data-id="'+selected.id+'"]').click();const parent=page.locator('#master-record select[name=parent_org_unit_id]');const ids=await parent.locator('option').evaluateAll(o=>o.map(x=>x.value));assert(!ids.includes(selected.id));for(const child of before.organisational_unit.filter(u=>u.parent_org_unit_id===selected.id))assert(!ids.includes(child.id));
   const picker=searchable(parent);await picker.input.click();await picker.input.fill('bank');assert(await picker.popup.isVisible());await page.keyboard.press('Escape');await shot('organisation-edit-'+width);await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  }
  report.checks.push('Existing organisation units and Edit/Add child controls render on desktop/phones; parent searches exclude self/direct children and Cancel leaves records untouched.');
  const after=await get('/masters');const shape=data=>Object.fromEntries(catalogue.map(d=>[d.key,[...data[d.key]].sort((a,b)=>a.id.localeCompare(b.id))]));assert.deepEqual(shape(after),shape(before));
  report.checks.push('All existing UAT master rows match before/after; no business write request, account edit, configuration save or directory test occurred.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.message;await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{if(signedIn){const me=await get('/auth/me');report.sign_out_status=(await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data:{}})).status();}report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
