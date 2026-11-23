// Existing-record UAT smoke checks plus isolated DOM fixtures for the shared control.
// No API response is substituted and only authentication may write to the server.
const {chromium}=require(process.argv[2]||'playwright');
const {searchable,chooseOption}=require('./helpers/searchable-select.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const output=path.resolve(process.env.CBD_SEARCHABLE_QA_OUTPUT||path.join(__dirname,'../../outputs/searchable-selects-2026-10-30'));
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const report={status:'running',checks:[],layouts:[],browser_errors:[],prohibited_writes:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({...uatContextOptions,viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata',reducedMotion:'reduce'});
 const page=await context.newPage();let signedIn=false;
 page.on('pageerror',error=>report.browser_errors.push(error.message));
 await context.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){
   report.prohibited_writes.push({method:r.method(),path:p});return route.abort('blockedbyclient');
  }
  await route.continue();
 });
 async function get(url){const response=await context.request.get(base+'/api'+url);assert(response.ok());return response.json();}
 async function painted(){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
 async function layout(name,width){
  await painted();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow');
  const screenshot=name+'-'+width+'.png';await page.screenshot({path:path.join(output,screenshot),fullPage:true,animations:'disabled'});
  report.layouts.push({name,width,screenshot});
 }
 async function visit(route,ready){await page.goto(base+'/#'+route);await page.locator(ready).waitFor();if(await page.locator('#app select').count())await page.locator('#app select').first().evaluate(select=>new Promise(resolve=>{if(select.parentElement.dataset.enhanced)resolve();else{const observer=new MutationObserver(()=>{if(select.parentElement.dataset.enhanced){observer.disconnect();resolve();}});observer.observe(select.parentElement,{attributes:true,subtree:true});}}));}
 try{
  assert.equal((await get('/health')).environment,'uat');
  const demo=await get('/auth/demo-users');const reviewer=demo.users.find(u=>u.username==='reviewer'&&u.password_autofill_available&&!u.must_change_password);assert(reviewer);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});await page.goto(base);await page.locator('#demo-user').waitFor();
   await searchable(page.locator('#demo-user')).input.waitFor();
   assert.equal(await page.locator('.auth-password-help').count(),0);
   assert.equal(await page.locator('.auth-help,#demo-ldap-help').count(),0);
   const bounds=await page.locator('.auth-shell').boundingBox();assert(bounds.height<650,'Compact sign-in height at '+width);
   const submit=await page.locator('#login button[type=submit]').boundingBox();if(width<500)assert(submit.y+submit.height<844);
   await layout('login',width);
   const control=searchable(page.locator('#demo-user'));await control.input.click();await control.input.fill('reviewer');
   const popup=await control.popup.boundingBox();assert(popup.x>=0&&popup.x+popup.width<=width+1&&popup.y>=0&&popup.y+popup.height<=(width<500?844:1000)+1);
   assert.equal(await control.popup.getByRole('option').count(),1);
   await layout('login-search',width);await page.keyboard.press('Escape');
  }
  report.checks.push('Compact sign-in and searchable UAT users fit 1440, 390 and 320px; Sign-in help and the demo LDAP hint are absent, mobile Sign in stays in view, and dropdowns remain inside the viewport.');
  const demoControl=await chooseOption(page.locator('#demo-user'),'reviewer','reviewer');
  assert.equal(await page.locator('#login-username').inputValue(),'reviewer');
  assert.equal(await page.locator('#login-password').inputValue(),reviewer.password);
  await page.locator('#login-username').fill('manual-check');
  assert.equal(await page.locator('#demo-user').inputValue(),'');
  await page.waitForFunction(()=>document.querySelector('#demo-user').parentElement.querySelector('[role=combobox]').value==='Choose a demo user…');
  assert.equal(await demoControl.input.inputValue(),'Choose a demo user…');
  report.checks.push('Visible demo-user search fills existing credentials; manual username entry clears both the native selection and its searchable display.');
  await chooseOption(page.locator('#demo-user'),'reviewer','reviewer');
  await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});signedIn=true;
  await page.setViewportSize({width:1440,height:1000});await visit('repository','#filters');
  assert.equal(await page.locator('.role-context').count(),0);
  const selectCount=await page.locator('#filters select').count();assert.equal(await page.locator('#filters select[aria-hidden=true]').count(),selectCount);
  const department=page.locator('#filters select[name=regulatory_owner_unit_id]');
  const bank=await department.locator('option').evaluateAll(options=>options.find(option=>option.label==='Bank of Maharashtra')?.value);assert(bank);
  await chooseOption(department,bank,'maharashtra');
  const formValue=await page.locator('#filters').evaluate(form=>new FormData(form).getAll('regulatory_owner_unit_id'));
  assert.deepEqual(formValue,[bank]);
  report.checks.push('The shared widget enhances every repository dropdown and preserves exactly one authoritative native FormData value.');
  await page.locator('#filters .filter-more summary').click();
  const approval=page.locator('#filters select[name=approval_status]');await chooseOption(approval,'DRAFT','draft');
  assert.equal(await page.locator('#filters .filter-more').getAttribute('open'),'');
  const input=searchable(approval).input;await input.click();await input.fill('no-such-status');
  assert(await searchable(approval).popup.getByText('No matching options',{exact:true}).isVisible());
  await page.keyboard.press('Escape');assert.equal(await approval.inputValue(),'DRAFT');
  assert.equal(await input.inputValue(),'Draft');
  assert.equal(await page.locator('#filters .filter-more').getAttribute('open'),'');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#filters .filter-more').getAttribute('open'),null);
  report.checks.push('Searchable lists inside More filters preserve focus ownership; Escape first closes the list, then the filters, and unmatched text never replaces a selected value.');

  // These DOM-only fields exercise native validation/dynamic lists; they never call a business API.
  await page.evaluate(()=>{
   const dialog=document.querySelector('#dialog');dialog.className='modal wide runtime-dialog';
   dialog.innerHTML='<div class="modal-header"><h2>Shared control verification</h2></div><form id="select-dom-fixture"><div class="modal-body"><fieldset id="fixture-fieldset"><div class="field"><label for="fixture-select">Department</label><select id="fixture-select" name="department" required><option value="">Choose department</option><optgroup label="Available"><option value="cafe" data-search="CF-01">Café services</option><option value="disabled" disabled>Disabled department</option><option value="bank">Bank operations</option><option value="hidden" hidden>Hidden department</option></optgroup><optgroup label="Disabled group" disabled><option value="blocked">Blocked department</option></optgroup></select></div></fieldset></div><div class="modal-footer"><button type="submit" class="btn primary">Verify form</button><button type="reset" class="btn">Reset</button></div></form>';
   const form=dialog.querySelector('form');window.__selectFixture={submissions:0,values:[]};
   form.addEventListener('submit',event=>{event.preventDefault();window.__selectFixture.submissions++;window.__selectFixture.values=Array.from(new FormData(form));});
   dialog.showModal();
  });
  const fixture=page.locator('#fixture-select');const control=searchable(fixture);await control.input.waitFor();
  await page.getByRole('button',{name:'Verify form',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__selectFixture.submissions),0);assert.equal(await control.input.getAttribute('aria-invalid'),'true');
  assert(await control.wrapper.locator('.searchable-select-error').isVisible());
  await control.input.fill('CF-01');assert.equal(await control.popup.getByRole('option').count(),1);
  await page.keyboard.press('Enter');assert.equal(await fixture.inputValue(),'cafe');
  await page.getByRole('button',{name:'Verify form',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__selectFixture.values),[['department','cafe']]);
  await page.locator('#select-dom-fixture .modal-body').evaluate(body=>body.insertAdjacentHTML('beforeend','<label>Inline choice<select id="fixture-inline"><option value="a">Alpha</option><option value="b">Beta</option></select></label>'));
  await chooseOption(page.locator('#fixture-inline'),'b','beta');await painted();
  assert.equal(await searchable(page.locator('#fixture-inline')).input.getAttribute('aria-label'),'Search Inline choice');
  report.checks.push('DOM fixture: required validation focuses the visible combobox and blocks submission; code search selects the original option and submits no proxy/query field.');
  await control.input.click();await control.input.fill('cafe');assert.equal(await control.popup.getByRole('option').count(),1);
  await page.keyboard.press('Escape');
  await control.input.press('ArrowDown');await control.input.press('ArrowDown');await control.input.press('Enter');
  assert.equal(await fixture.inputValue(),'bank');
  await control.input.click();assert.equal(await control.popup.getByRole('option',{name:'Hidden department',exact:true}).count(),0);
  assert.equal(await control.popup.getByRole('option',{name:'Blocked department',exact:true}).getAttribute('aria-disabled'),'true');
  await page.keyboard.press('Escape');
  report.checks.push('DOM fixture: accent-insensitive text/code search works; keyboard navigation skips disabled options/groups and hidden options stay absent.');
  await fixture.evaluate(select=>{select.disabled=true;});await page.waitForFunction(()=>document.querySelector('#fixture-select').parentElement.querySelector('[role=combobox]').disabled);
  await fixture.evaluate(select=>{select.disabled=false;select.innerHTML='<option value="">Choose department</option><option value="new">Newly loaded department</option>';select.value='new';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector('#fixture-select').parentElement.querySelector('[role=combobox]').value==='Newly loaded department');
  await page.locator('#fixture-fieldset').evaluate(fieldset=>{fieldset.disabled=true;});assert(await control.input.isDisabled());
  await page.locator('#fixture-fieldset').evaluate(fieldset=>{fieldset.disabled=false;});await control.input.waitFor();
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#fixture-select').value==='');
  assert.equal(await control.input.getAttribute('aria-invalid'),'false');
  await control.input.click();await control.input.fill('newly');await page.keyboard.press('Enter');assert.equal(await fixture.inputValue(),'new');
  await fixture.evaluate(select=>{const option=document.createElement('option');option.value='literal';option.label='<img src=x onerror=window.__optionInjected=true>';select.add(option);});
  await control.input.click();await control.input.fill('<img');
  assert.equal(await control.popup.locator('img').count(),0);assert.equal(await control.popup.getByRole('option').count(),1);
  assert.equal(await page.evaluate(()=>Boolean(window.__optionInjected)),false);await page.keyboard.press('Escape');
  await fixture.evaluate(select=>{select.multiple=true;});await control.input.waitFor({state:'detached'});
  await fixture.evaluate(select=>{select.multiple=false;});await searchable(fixture).input.waitFor();
  assert.equal(await control.wrapper.locator('.searchable-select').count(),0);
  await control.input.click();await page.keyboard.press('Escape');assert(await page.locator('#dialog').isVisible());
  await page.keyboard.press('Escape');assert(await page.locator('#dialog').isHidden());
  report.checks.push('DOM fixture: async options, programmatic change events, field/fieldset disabled states and form reset stay synchronised; Escape respects the surrounding modal.');
  for(const route of ['clauses','notification-families','repository','clauses','repository']){
   const ready=route==='clauses'?'#clause-source-edition':route==='notification-families'?'#family-filters':'#filters';
   await visit(route,ready);
   assert.equal(await page.locator('.searchable-select .searchable-select').count(),0);
   assert.equal(await page.locator('.searchable-select-popup:popover-open').count(),0);
   assert.equal(await page.locator('#app select').count(),await page.locator('#app .searchable-select[data-enhanced] > select').count());
  }
  report.checks.push('Repeated React route replacement has no nested wrappers or orphaned popovers; clauses, editions and notification filters automatically reuse the component.');
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});await visit('repository','#filters');
   const searchField=await page.locator('#filters .filters > .search-field').boundingBox();assert(searchField.width>=Math.min(240,width-40),'Readable search width at '+width);
   await layout('repository',width);
   await page.locator('#filters .filter-more summary').click();
   const regulator=page.locator('#filters select[name=regulator_id]');await searchable(regulator).input.click();await searchable(regulator).input.fill('bank');
   const popup=await searchable(regulator).popup.boundingBox();assert(popup.x>=0&&popup.x+popup.width<=width+1&&popup.y>=0&&popup.y+popup.height<=(width<500?844:1000)+1);
   await layout('filter-search',width);await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Close filters',exact:true}).click();
  }
  report.checks.push('1440, 768, 390 and 320px repository/filter-search layouts fit the page and the popover escapes scrolling panels without clipping.');
  const fallback=await browser.newContext({...uatContextOptions,viewport:{width:390,height:844}});
  await fallback.addInitScript(()=>Object.defineProperty(HTMLElement.prototype,'showPopover',{value:undefined,configurable:true}));
  const fallbackPage=await fallback.newPage();await fallbackPage.goto(base);await fallbackPage.locator('#demo-user').waitFor();
  assert(await fallbackPage.locator('#demo-user').isVisible());assert.equal(await fallbackPage.locator('.searchable-select[data-enhanced]').count(),0);
  await fallbackPage.locator('#demo-user').selectOption('reviewer');assert.equal(await fallbackPage.locator('#login-username').inputValue(),'reviewer');
  await fallback.close();report.checks.push('Without native Popover support, original dropdowns remain visible and usable; no partial hidden control is left behind.');
  await page.setViewportSize({width:1440,height:1000});await page.locator('.topbar [data-action=logout]').click();signedIn=false;
  await page.locator('#demo-user').waitFor();const admin=demo.users.find(u=>u.username==='admin'&&u.password_autofill_available&&!u.must_change_password);assert(admin);
  await chooseOption(page.locator('#demo-user'),'admin','admin');await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});signedIn=true;
  await visit('users','.user-access-page');await page.locator('[data-action=user][data-id]').first().click();
  const userDialog=page.locator('#dialog');await userDialog.getByRole('heading',{name:'Edit user access',exact:true}).waitFor();
  assert(await searchable(userDialog.locator('select[name=login_type]')).input.isDisabled());
  await chooseOption(userDialog.locator('select[name=org_unit_id]'),bank,'maharashtra');
  const roleRow=userDialog.locator('.role-line').first();await roleRow.locator('input[name=global_scope_flag]').uncheck();
  const scope=roleRow.locator('select[name=scope_org_unit_id]');await chooseOption(scope,bank,'maharashtra');
  assert.equal(await searchable(scope).input.getAttribute('aria-required'),'true');
  await userDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await visit('ldap','#ldap');const ssl=page.locator('#ldap select[name=use_ssl]');await chooseOption(ssl,'true','true');
  await chooseOption(page.locator('#ldap select[name=ca_certificate_action]'),'keep','keep');
  await visit('users','.user-access-page');
  report.checks.push('Existing Admin access: real user-dialog home/scope dropdowns, disabled login type, dynamic global-scope requirements and LDAP settings reuse the shared control; all changes are cancelled, with no settings, account or directory write.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
 finally{
  if(signedIn){const me=await get('/auth/me');await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data:{}});}
  report.checked_on='2026-10-30';report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 }
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,layouts:report.layouts.length,prohibited_writes:report.prohibited_writes.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
