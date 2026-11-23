// Explicit synthetic Oracle fixture only. Page writes are limited to owner changes on cloned records.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const out=path.resolve(root,process.env.CBD_OWNER_POPUP_QA_OUTPUT||'outputs/owner-assignment-popup-2026-11-02/browser');
const report={checks:[],errors:[],external_requests:[],blocked_writes:[],screenshots:[]};
const allowed=new Set(),ownerRequests=new Set();let browser,secrets,nav=0,writes=0;
(async()=>{await fs.mkdir(out,{recursive:true});try{
 const secret=path.join(root,'var/browser-fixture-secrets.json');assert.equal((await fs.stat(secret)).mode&0o077,0);
 secrets=JSON.parse(await fs.readFile(secret,'utf8'));const f=secrets.obligations;assert(f?.users.business2,'Enable CBD_OWNER_POPUP_BROWSER_QA=1.');
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>report.errors.push(e.message));
 await context.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.origin!==base){report.external_requests.push(url.origin);return route.abort();}
  if(!['GET','HEAD','OPTIONS'].includes(r.method())){
   const owner=/^\/api\/obligations\/([^/]+)\/owners$/.exec(url.pathname),decision=/^\/api\/obligations\/([^/]+)\/owner-changes\/([^/]+)\/decision$/.exec(url.pathname);
   if(!['/api/auth/login','/api/auth/logout'].includes(url.pathname)&&!(owner&&allowed.has(owner[1])&&r.method()==='PUT')&&!(decision&&allowed.has(decision[1])&&ownerRequests.has(decision[2])&&r.method()==='POST')){report.blocked_writes.push(url.pathname);return route.abort();}
   if(owner)writes++;
  }
  return route.continue();
 });
 const login=async name=>{
  await page.goto(base);await page.waitForSelector('#login, .app-shell');const logout=page.getByRole('button',{name:'Sign out',exact:true});if(await logout.isVisible())await logout.click();
  await page.locator('#login-username').fill(secrets.credentials[name].username);await page.locator('#login-password').fill(secrets.credentials[name].password);await page.locator('#login button[type=submit]').click();await page.locator('.app-shell').waitFor();
 };
 const detail=async id=>{const r=await context.request.get(base+'/api/obligations/'+id);assert.equal(r.status(),200);return r.json();};
 const api=async(method,url,data)=>{
  assert(url==='/obligations'||[...allowed].some(id=>['/obligations/'+id+'/owners','/obligations/'+id+'/submit','/obligations/'+id+'/decision'].includes(url)));
  if(url==='/obligations')assert.equal(data.primary_clause_id,f.clause_id);
  const me=await (await context.request.get(base+'/api/auth/me')).json();const r=await context.request.fetch(base+'/api'+url,{method,headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data});
  assert.equal(r.status(),200,await r.text());const result=await r.json();if(url==='/obligations'||result.created_revision)allowed.add(result.id);return result;
 };
 const open=async id=>{await page.goto(base+'/?popupqa='+(++nav)+'#obligations/'+id+'?tab=owners');await page.locator('.obligation-owner-panel').waitFor();};
 const popup=page.locator('#obl-owner-form'),primary=popup.locator('[data-primary-business-owner]'),person=primary.locator('[data-obl-field=user_id]');
 const launch=async()=>{await page.locator('.obligation-owner-panel [data-action=obl-assign-owner]').click();await popup.waitFor({state:'visible'});};
 const close=async()=>page.getByRole('button',{name:'Close',exact:true}).click();
 const select=async(control,value)=>control.selectOption(String(value),{force:true});
 const snap=async name=>{await page.screenshot({path:path.join(out,name),fullPage:false});report.screenshots.push(name);};
 const requestBody=d=>({expected_revision:d.obligation.edit_revision,business_owner_unit_id:d.input.business_owner_unit_id,compliance_reviewer_user_id:d.input.compliance_reviewer_user_id,owners:d.input.owners.filter(o=>o.owner_role!=='COMPLIANCE_REVIEWER'),reason:'TEST ONLY competing owner edit from another session.'});
 const save=async(id,reason)=>{
  await popup.locator('[name=reason]').fill(reason);const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/obligations/'+id+'/owners'&&r.request().method()==='PUT');
  await popup.locator('button[type=submit]').click();const r=await response;assert.equal(r.status(),200,await r.text());const result=await r.json();if(result.created_revision)allowed.add(result.id);
  await page.waitForURL(url=>url.hash.split('?')[0]==='#obligations/'+result.id&&new URLSearchParams(url.hash.split('?')[1]).get('tab')==='owners');await popup.waitFor({state:'hidden'});await page.locator('.obligation-owner-panel').waitFor();if(result.submitted_for_review)await page.getByRole('heading',{name:'Ownership change request',exact:true}).waitFor();return result;
 };
 const add=async(role,user)=>{
  await popup.getByRole('button',{name:'Add additional owner',exact:true}).click();const row=popup.locator('[data-obl-list=owners] [data-obl-row=owners]').last();
  await select(row.locator('[data-obl-field=org_unit_id]'),f.unit);if(role!=='BUSINESS')await select(row.locator('[data-obl-field=owner_role]'),role);
  await row.locator('[data-obl-field=user_id] option[value="'+user+'"]').waitFor({state:'attached'});await page.waitForFunction(control=>!control.disabled,await row.locator('[data-obl-field=user_id]').elementHandle());await select(row.locator('[data-obl-field=user_id]'),user);return row;
 };
 await login('author');const created=await api('POST','/obligations',{...f.payload,title:'TEST ONLY owner popup '+Date.now()}),id=created.id;
 report.fixture_record_ids=[id];const before=await detail(id);await open(id);const originalUrl=page.url();await launch();
 assert.equal(page.url(),originalUrl);assert.equal(await page.locator('#obligation-editor').count(),0);assert.equal(await person.inputValue(),f.users.business);
 assert.equal(await popup.locator('[data-obl-list=owners] .obligation-owner-edit').count(),2);assert.equal(await primary.locator('[data-obl-field=primary_owner_flag]').isVisible(),false);
 assert(await popup.locator('[name=compliance_reviewer_user_id]').isVisible());assert.equal(await popup.locator('.obligation-owner-edit[open]').count(),0);
 await snap('owner-popup-desktop.png');await close();assert.equal(writes,0);assert.deepEqual((await detail(id)).owners,before.owners);
 report.checks.push('The focused popup stays on Owners with a linked primary Business owner, separate collapsed additional assignment cards and Compliance reviewer. Opening and cancelling make no writes and never mount the wizard.');

 await launch();await select(person,f.users.business2);assert.deepEqual((await detail(id)).owners,before.owners);const saved=await save(id,'TEST ONLY replace the primary Business owner in the popup.');assert(!saved.created_revision&&saved.changed);
 let current=await detail(id);assert.equal(current.obligation.approval_status,'DRAFT');assert.equal(current.owners.find(o=>o.owner_role==='BUSINESS').user_id,f.users.business2);assert.deepEqual(current.applicability,before.applicability);assert.deepEqual(current.processes,before.processes);assert.deepEqual(current.citations,before.citations);
 assert(current.ownership_history.some(o=>o.user_id===f.users.business&&o.approval_status==='WITHDRAWN'));assert(current.audit.some(a=>a.action==='OWNERS_UPDATED'));assert.equal(await page.locator('#obligation-editor').count(),0);
 report.checks.push('Saving a new primary person updates only Draft owners, keeps applicability/process/source row IDs and values intact, and retains the former assignment in history. The Owners screen refreshes in place.');

 await launch();const unchanged=await save(id,'TEST ONLY unchanged assignments should not create new rows.');assert.equal(unchanged.changed,false);assert.equal(unchanged.edit_revision,current.obligation.edit_revision);assert.deepEqual((await detail(id)).ownership_history,current.ownership_history);
 report.checks.push('An unchanged save is a no-op: no new assignments, edit revision or obligation revision.');

 await launch();const otherUnit=await popup.locator('[name=business_owner_unit_id] option').evaluateAll((options,unit)=>options.map(o=>o.value).find(v=>v&&v!==unit),f.unit);assert(otherUnit);
 let fail=true;const failing=async route=>{const url=new URL(route.request().url());if(fail&&url.searchParams.get('role')==='BUSINESS_OWNER'&&url.searchParams.get('unit_id')===otherUnit){fail=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'TEST ONLY temporary lookup failure.'})});}return route.continue();};
 await page.route('**/api/obligations/assignees?**',failing);await select(popup.locator('[name=business_owner_unit_id]'),otherUnit);await primary.locator('[data-primary-business-retry]').waitFor({state:'visible'});const failedWrites=writes;await popup.locator('[name=reason]').fill('TEST ONLY verify lookup failures block saving.');await popup.locator('button[type=submit]').click();assert.equal(writes,failedWrites);await primary.locator('[data-primary-business-retry]').click();await page.waitForFunction(()=>document.querySelector('#obl-owner-form [data-primary-business-owner]').dataset.lookupState==='ready');
 await select(popup.locator('[name=business_owner_unit_id]'),f.unit);await person.locator('option[value="'+f.users.business2+'"]').waitFor({state:'attached'});await select(person,f.users.business2);await page.unroute('**/api/obligations/assignees?**',failing);
 const duplicate=await add('BUSINESS',f.users.business2);assert.equal(await duplicate.locator('[data-obl-field=user_id]').evaluate(n=>n.validity.valid),false);const duplicateWrites=writes;await popup.locator('button[type=submit]').click();assert.equal(writes,duplicateWrites);
 await select(person,'');await select(person,f.users.business2);assert.equal(await popup.locator('.obligation-owner-edit').count(),2);assert.equal(await popup.locator('[data-additional-owner-count]').innerText(),'2');
 await add('DATA',f.users.business);await save(id,'TEST ONLY add a separate Data owner through the popup.');current=await detail(id);assert(current.owners.some(o=>o.owner_role==='DATA'&&o.user_id===f.users.business));assert.deepEqual(current.applicability,before.applicability);
 report.checks.push('Lookup failure exposes Retry and blocks save. Duplicate primary/additional Business assignments are rejected before a write; explicit promotion removes the whole additional card, and adding a distinct Data assignment saves without changing assessments.');

 await launch();const competing=requestBody(current);competing.owners=competing.owners.map(o=>o.owner_role==='BUSINESS'?{...o,user_id:f.users.business}:o);await api('PUT','/obligations/'+id+'/owners',competing);
 await popup.locator('[name=reason]').fill('TEST ONLY stale popup must preserve the more recent change.');let response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/obligations/'+id+'/owners'&&r.request().method()==='PUT');await popup.locator('button[type=submit]').click();assert.equal((await response).status(),409);await popup.locator('#form-error').filter({hasText:'Close the popup and reopen'}).waitFor();assert.equal(await person.inputValue(),f.users.business2);await close();
 await open(id);await launch();const staleWrites=writes;await page.evaluate(hash=>location.hash=hash,'obligations/'+f.draft+'?tab=owners');await page.getByRole('heading',{name:f.payload.title,exact:true}).waitFor();await popup.locator('[name=reason]').fill('TEST ONLY an abandoned record cannot save through a stale popup.');await popup.locator('button[type=submit]').click();await popup.locator('#form-error').filter({hasText:'The open obligation changed'}).waitFor();assert.equal(writes,staleWrites);await close();
 report.checks.push('A competing edit produces 409 and retains popup selections for review. Navigating to another obligation rejects the stale popup before any API write.');

 await open(id);let arrived,release;const started=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);const held=async route=>{const fetched=await route.fetch();arrived();await gate;return route.fulfill({response:fetched});};await page.route(base+'/api/obligations/'+id,held);await page.locator('.obligation-owner-panel [data-action=obl-assign-owner]').click();await started;
 await page.evaluate(hash=>location.hash=hash,'obligations/'+f.draft+'?tab=owners');await page.getByRole('heading',{name:f.payload.title,exact:true}).waitFor();release();await page.waitForLoadState('networkidle');assert.equal(await page.locator('dialog[open] #obl-owner-form').count(),0);await page.unroute(base+'/api/obligations/'+id,held);
 report.checks.push('A delayed popup lookup cannot reopen an owner editor after the user has selected another obligation.');

 const approved=await api('POST','/obligations',{...f.payload,title:'TEST ONLY approved popup '+Date.now()});report.fixture_record_ids.push(approved.id);
 await api('POST','/obligations/'+approved.id+'/submit',{approver_id:f.users.approver,comments:'TEST ONLY review before popup reassignment.',expected_revision:1});
 for(const [name,decision] of [['reviewer','REVIEW'],['business','ACCEPT'],['control','ACCEPT'],['approver','APPROVE']]){await login(name);await api('POST','/obligations/'+approved.id+'/decision',{decision,comments:'TEST ONLY independent approval workflow.'});}
 await login('business');await open(approved.id);assert.equal(await page.locator('[data-action=obl-assign-owner]').count(),0);
 await login('author');const original=await detail(approved.id);assert.equal(original.obligation.record_status,'ACTIVE');await open(approved.id);await launch();assert(await popup.getByRole('button',{name:'Submit ownership change',exact:true}).isVisible());assert(await person.getAttribute('required')!==null);await select(person,'');assert.equal(await person.evaluate(node=>node.validity.valid),false);assert((await primary.locator('[data-primary-business-status]').innerText()).includes('before submitting this ownership request'));await select(person,f.users.business2);await select(popup.locator('[name=approver_id]'),f.users.approver);await snap('approved-owner-popup-desktop.png');const request=await save(approved.id,'TEST ONLY same-revision reassignment of an approved owner.');assert(!request.created_revision&&request.submitted_for_review&&request.id===approved.id);ownerRequests.add(request.change_id);let retained=await detail(approved.id);assert.deepEqual(retained.obligation,original.obligation);assert.deepEqual(retained.owners,original.owners);assert.equal(retained.versions.length,1);assert.equal(await page.locator('[data-action=obl-assign-owner]').count(),0);assert.equal(await page.getByRole('button',{name:'Create revision',exact:true}).count(),0);await snap('ownership-request-pending.png');
 const decideRequest=async(name,label)=>{
  await login(name);await open(approved.id);const panel=page.locator('.obligation-ownership-request').first();await panel.getByRole('button',{name:label,exact:true}).click();await page.locator('#obl-ownership-decision-form [name=comments]').fill('TEST ONLY independent same-revision ownership response.');const decision=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/obligations/'+approved.id+'/owner-changes/'+request.change_id+'/decision'&&r.request().method()==='POST');await page.locator('#obl-ownership-decision-form button[type=submit]').click();assert.equal((await decision).status(),200);await page.locator('#obl-ownership-decision-form').waitFor({state:'hidden'});
 };
 await login('reviewer');await page.goto(base+'/#tasks');const work=page.locator('tr').filter({hasText:original.obligation.code});await work.getByRole('link',{name:'Open assigned work',exact:true}).click();await page.waitForURL(url=>url.hash.includes('ownership_change='+request.change_id));await page.getByRole('heading',{name:'Ownership change request',exact:true}).waitFor();
 await decideRequest('reviewer','Complete Compliance review');await login('business2');await open(approved.id);await snap('ownership-acceptance.png');assert.deepEqual((await detail(approved.id)).owners,original.owners);await decideRequest('business2','Accept ownership change');assert.deepEqual((await detail(approved.id)).owners,original.owners);await decideRequest('approver','Approve ownership change');await login('author');await open(approved.id);
 const replacement=await detail(approved.id);assert.equal(replacement.obligation.record_status,'ACTIVE');assert.equal(replacement.obligation.version_number,original.obligation.version_number);assert.equal(replacement.versions.length,1);assert.equal(replacement.owners.find(o=>o.owner_role==='BUSINESS').user_id,f.users.business2);assert(replacement.owners.every(o=>o.approval_status==='APPROVED'));assert(original.owners.filter(o=>o.owner_role!=='BUSINESS').every(o=>replacement.owners.some(h=>h.id===o.id)));const outgoing=replacement.ownership_history.find(o=>o.owner_role==='BUSINESS'&&o.user_id===f.users.business);assert.equal(outgoing.approval_status,'APPROVED');assert.equal(outgoing.ended_by_change_id,request.change_id);assert.equal(outgoing.validation_decision,'ACCEPT');assert.equal(await page.locator('#obligation-editor').count(),0);await snap('ownership-change-applied.png');
 report.checks.push('An approved popup creates an independent request with a selected Approver and leaves current owners/revision unchanged. Named work links open the request; real UI Compliance review, replacement-owner acceptance and final approval apply it on the same Active obligation ID/revision. Unchanged assignments and the former approved/accepted owner remain in history.');
 const revised={id:approved.id};
 for(const width of [320,375,768,1440]){
  await page.setViewportSize({width,height:950});await open(revised.id);await launch();await popup.locator('.obligation-owner-edit summary').first().click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('dialog[open]').scrollWidth<=innerWidth),'Popup overflow at '+width);
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('dialog[open]').contains(document.activeElement)),'Focus escaped the native dialog');await snap('owner-popup-'+width+'.png');await close();
 }
 report.checks.push('The popup and expanded additional cards fit 320, 375, 768 and 1440px. Native dialog focus stays inside; Save and Cancel remain available without opening the wizard.');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.external_requests,[]);assert.deepEqual(report.blocked_writes,[]);report.status='passed';
}catch(error){report.status='failed';report.error=Object.values(secrets?.credentials||{}).reduce((value,item)=>value.split(item.password).join('[redacted]'),String(error.stack));process.exitCode=1;}finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}})();
