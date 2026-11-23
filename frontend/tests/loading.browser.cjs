// Shared loading UI, with gated responses. No business mutation reaches UAT.
const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const output=path.resolve(process.env.CBD_LOADING_QA_OUTPUT||'outputs/shared-loading-2026-10-30');
const contexts=[];
const report={checks:[],browser_errors:[],prohibited_writes:[],synthetic_writes:[],real_bank_ldap_tested:false};
const demo={users:[{username:'example.demo',full_name:'Example Demo',roles:['REVIEWER'],password_autofill_available:false,must_change_password:false}]};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const fulfill=async(route,json,status=200)=>{await route.fulfill({status,json});return true;};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 async function open(handler,width=1280){
  const context=await browser.newContext({...uatContextOptions,viewport:{width,height:900}});contexts.push(context);
  await context.route('**/api/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname;
   if(handler&&await handler(route,pathname))return;
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!['/api/auth/login','/api/auth/logout'].includes(pathname)){
    report.prohibited_writes.push(pathname);return route.abort('blockedbyclient');
   }
   return route.continue();
  });
  const page=await context.newPage(),responses=[];
  page.on('response',response=>responses.push(response));
  page.on('pageerror',error=>report.browser_errors.push(error.message));
  await page.goto(base);return {context,page,responses};
 }
 const hud=page=>page.locator('#app-loading');
 async function busy(page){await page.locator('#app-loading:not([hidden]) .activity-track').waitFor();}
 async function idle(page){await page.locator('#app-loading[hidden]').waitFor({state:'attached'});}
 async function liveLogin(username='reviewer'){
  const run=await open(),{page}=run;
  const response=run.responses.find(r=>new URL(r.url()).pathname==='/api/auth/demo-users')||await page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/demo-users');
  const account=(await response.json()).users.find(user=>user.username===username&&user.password_autofill_available&&!user.must_change_password);
  assert(account,'Existing eligible public UAT account required.');
  await page.locator('#demo-user').waitFor({state:'attached'});await page.locator('#demo-user').selectOption(username,{force:true});
  const done=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login');
  await page.locator('#login button[type=submit]').click();assert.equal((await done).status(),200);
  await page.locator('#login').waitFor({state:'hidden'});await page.locator('a.nav-item').first().waitFor();await idle(page);return run;
 }
 try{
  const startup=gate();let entryHeld=false;
  const initial=await browser.newContext(uatContextOptions);contexts.push(initial);
  await initial.route('**/*.js',async route=>{if(!entryHeld&&new URL(route.request().url()).pathname.includes('/index-')){entryHeld=true;await startup.promise;}await route.continue();});
  await initial.route('**/api/**',route=>fulfill(route,new URL(route.request().url()).pathname==='/api/auth/me'?{detail:'Not signed in.'}:demo,new URL(route.request().url()).pathname==='/api/auth/me'?401:200));
  const opening=await initial.newPage();opening.on('pageerror',error=>report.browser_errors.push(error.message));
  await opening.goto(base,{waitUntil:'commit'});await opening.locator('#app > .loading').waitFor();
  assert((await opening.locator('#app').innerText()).includes('Opening Compliance by Design'));
  startup.resolve();await opening.locator('#demo-user').waitFor({state:'attached'});
  report.checks.push('The server-rendered opening status remains visible while the JavaScript entry is delayed, then hands over to the shared application loader.');
  const delayed=gate();let demoCalls=0;
  const slow=await open(async(route,p)=>{
   if(p==='/api/auth/me')return fulfill(route,{detail:'Not signed in.'},401);
   if(p==='/api/auth/demo-users'){demoCalls++;await delayed.promise;return fulfill(route,demo);}
   return false;
  });
  await slow.page.locator('#demo-sign-in[aria-busy=true]').waitFor();await busy(slow.page);
  assert(await slow.page.locator('#login-username').isEnabled());assert(await slow.page.locator('#login button[type=submit]').isEnabled());
  await slow.page.locator('#login-username').fill('typed.person');
  await slow.page.screenshot({path:path.join(output,'demo-loading-desktop.png'),fullPage:true});
  await slow.page.setViewportSize({width:390,height:900});
  await slow.page.screenshot({path:path.join(output,'demo-loading-phone.png'),fullPage:true});
  assert(await slow.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  report.checks.push('Delayed demo list shows its own loading placeholder and global progress; manual sign-in remains usable on desktop and phone.');
  await slow.page.locator('#app-loading [data-loading-label]').filter({hasText:'Still working'}).waitFor({timeout:15000});
  report.checks.push('A request lasting ten seconds announces Still working without a false percentage or automatic retry.');
  delayed.resolve();await slow.page.locator('#demo-user').waitFor({state:'attached'});await idle(slow.page);
  assert.equal(await slow.page.locator('#login-username').inputValue(),'typed.person');assert.equal(demoCalls,1);
  assert.equal(await slow.page.locator('#demo-sign-in').getAttribute('aria-busy'),'false');
  report.checks.push('Successful demo response removes all loading state, preserves typed credentials and makes no duplicate request.');

  let attempts=0;const retryGate=gate();
  const retry=await open(async(route,p)=>{
   if(p==='/api/auth/me')return fulfill(route,{detail:'Not signed in.'},401);
   if(p==='/api/auth/demo-users'){attempts++;if(attempts===1)return fulfill(route,{detail:'Unavailable.'},503);await retryGate.promise;return fulfill(route,demo);}
   return false;
  });
  await retry.page.locator('[data-action=retry-demo-users]').waitFor();await idle(retry.page);assert.equal(attempts,1);
  await retry.page.locator('[data-action=retry-demo-users]').click();await busy(retry.page);
  assert(await retry.page.locator('#login button[type=submit]').isEnabled());
  retryGate.resolve();await retry.page.locator('#demo-user').waitFor({state:'attached'});await idle(retry.page);assert.equal(attempts,2);
  report.checks.push('Demo failure stops the spinner; only explicit Retry loads again, while manual sign-in stays enabled.');
  const unavailable=await open((route,p)=>p==='/api/auth/me'?fulfill(route,{detail:'Not signed in.'},401):p==='/api/auth/demo-users'?fulfill(route,{detail:'Disabled.'},404):false);
  await unavailable.page.locator('#login').waitFor();await idle(unavailable.page);
  assert(await unavailable.page.locator('#demo-sign-in').isHidden());
  report.checks.push('Disabled demo 404 hides the optional picker and clears loading without changing manual sign-in.');

  const authGate=gate();let keys=0;
  const signIn=await open(async(route,p)=>{
   if(p==='/api/auth/me')return fulfill(route,{detail:'Not signed in.'},401);
   if(p==='/api/auth/demo-users')return fulfill(route,{detail:'Disabled.'},404);
   if(p==='/api/auth/login-key'){keys++;await authGate.promise;return fulfill(route,{detail:'Controlled login service unavailable.'},503);}
   return false;
  });
  await signIn.page.locator('#login-username').fill('example.person');await signIn.page.locator('#login-password').fill('Synthetic-Test-Only@2026');
  await signIn.page.locator('#login button[type=submit]').click();await signIn.page.locator('#login button.is-loading').waitFor();
  assert.equal(await signIn.page.locator('#login').getAttribute('aria-busy'),'true');
  await signIn.page.locator('#login').evaluate(form=>form.requestSubmit());assert.equal(keys,1);
  authGate.resolve();await signIn.page.locator('#login-error').filter({hasText:'Controlled login service unavailable.'}).waitFor();await idle(signIn.page);
  assert(await signIn.page.locator('#login button[type=submit]').isEnabled());assert.equal(await signIn.page.locator('#login').getAttribute('aria-busy'),null);
  report.checks.push('Submitting a slow sign-in spins/disables only its submit control; duplicate submissions are ignored and errors restore the form.');

  const live=await liveLogin(),{page}=live;
  const tasks=gate(),notifications=gate();let heldTasks=false,heldNotes=false;
  await live.context.route('**/api/tasks',async route=>{if(!heldTasks){heldTasks=true;await tasks.promise;}await route.continue();});
  await live.context.route('**/api/notifications',async route=>{if(!heldNotes){heldNotes=true;await notifications.promise;}await route.continue();});
  await page.locator('.portal-nav-group > summary').filter({hasText:'Regulations'}).click();
  await page.locator('a.nav-item[href="#repository"]').click();await busy(page);
  assert.equal(await page.locator('#root').getAttribute('aria-busy'),'true');
  const first=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/tasks');tasks.resolve();
  await first;assert.equal(await hud(page).getAttribute('hidden'),null);
  notifications.resolve();await page.getByRole('heading',{name:'Regulatory repository',exact:true}).waitFor();await idle(page);
  assert.equal(await page.locator('#root').getAttribute('aria-busy'),null);
  report.checks.push('Navigation and parallel API reads share one indicator; finishing one request cannot hide another pending request.');

  const documentGate=gate();
  await live.context.route('**/api/documents/LOADING-TEST**',async route=>{await documentGate.promise;await route.fulfill({contentType:'text/plain',body:'Synthetic preview, no bank source content.'});});
  await page.evaluate(()=>{const button=document.createElement('button');button.textContent='Test preview';button.dataset.action='source-document-preview';button.dataset.id='LOADING-TEST';button.dataset.name='test-preview.txt';button.id='loading-test-preview';document.getElementById('main-content').append(button);});
  await page.locator('#loading-test-preview').click();await page.locator('#dialog [data-loading-dialog]').waitFor();
  await page.screenshot({path:path.join(output,'preview-loading.png'),fullPage:true});
  await page.locator('#dialog [data-action=close]').first().click();await idle(page);documentGate.resolve();
  report.checks.push('Document preview shows loading in the native dialog top layer; closing a pending preview clears its activity.');

  const choices=gate();
  await live.context.route('**/api/assignees?**',async route=>{await choices.promise;await route.fulfill({json:[{id:'synthetic-author',full_name:'Example author',username:'example.author'}]});});
  await page.evaluate(()=>{
   const dialog=document.getElementById('dialog');dialog.innerHTML='<div class="modal-header"><div><h2 id="dialog-title">Test dependent options</h2></div></div><form id="metadata-correction"><div class="modal-body"><label>Source department<select name="regulatory_owner_unit_id"><option value="">Select</option><option value="synthetic-unit">Example</option></select></label><label>Owner<select name="interpretation_owner_user_id"><option value="">Select</option></select></label></div><div class="modal-footer"><button type="submit">Save</button></div></form>';dialog.showModal();
  });
  const select=page.locator('#dialog [name=regulatory_owner_unit_id]');await select.selectOption('synthetic-unit',{force:true});
  await page.locator('#dialog [data-loading-dialog]').waitFor();assert(await select.isDisabled());assert(await page.locator('#dialog button[type=submit]').isDisabled());
  choices.resolve();await page.locator('#dialog [name=interpretation_owner_user_id] option[value=synthetic-author]').waitFor({state:'attached'});await idle(page);
  assert(await select.isEnabled());assert(await page.locator('#dialog button[type=submit]').isEnabled());
  await page.evaluate(()=>document.getElementById('dialog').close());
  report.checks.push('Dependent options show local picker/form busy states, block stale resubmission and restore controls after loading.');

  const admin=await liveLogin('admin');await admin.page.goto(base+'/#users');await admin.page.locator('[data-action=user]:not([data-id])').waitFor();
  await admin.page.locator('[data-action=user]:not([data-id])').click();
  const form=admin.page.locator('#dialog form');await form.locator('[name=username]').fill('loading.example');await form.locator('[name=full_name]').fill('Synthetic loading test');await form.locator('[name=password]').fill('Synthetic-Test-Only@2026');
  await form.locator('[data-action=add-role]').click();
  const role=form.locator('[name=role_id]').first();const roleId=await role.locator('option').evaluateAll(options=>options.find(option=>option.value)?.value);await role.selectOption(roleId,{force:true});await form.locator('[name=global_scope_flag]').first().check();
  const saveGate=gate();let writes=0;
  await admin.context.route('**/api/admin/users',async route=>{assert.equal(route.request().method(),'POST');writes++;report.synthetic_writes.push('/api/admin/users');await saveGate.promise;await route.fulfill({status:422,json:{detail:'Controlled test failure. No account was created.'}});});
  await form.locator('button[type=submit]').click();await admin.page.locator('#dialog [data-loading-dialog]').waitFor();
  assert(await admin.page.locator('#app-loading .activity-status').isHidden());await form.evaluate(node=>node.requestSubmit());assert.equal(writes,1);
  await admin.page.screenshot({path:path.join(output,'modal-saving.png'),fullPage:true});
  saveGate.resolve();await form.locator('#form-error').filter({hasText:'Controlled test failure.'}).waitFor();await idle(admin.page);
  assert(await form.locator('button[type=submit]').isEnabled());assert.equal(await form.getAttribute('aria-busy'),null);
  await admin.page.locator('#dialog [data-action=close]').first().click();
  report.checks.push('Modal saves announce progress above the native dialog, prevent duplicates and restore controls with the inline error after failure.');
  await slow.page.emulateMedia({reducedMotion:'reduce'});
  const animation=await slow.page.locator('.loading-spinner').first().evaluate(node=>getComputedStyle(node).animationName);assert.equal(animation,'none');
  report.checks.push('Reduced-motion styles keep text/status feedback while disabling spinner animation.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
 finally{
  for(const context of contexts){try{const response=await context.request.get(base+'/api/auth/me');if(response.ok()){const data=await response.json();await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':data.csrf_token},data:{}});}}catch{}}
  await browser.close();report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error||null}));
 }
})().catch(()=>{process.exitCode=1;});
