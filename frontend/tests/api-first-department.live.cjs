// Actual application/Oracle outer rollback fixture; synthetic LDAP/API only.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.env.CBD_EMPLOYEE_BROWSER_OUTPUT||path.join(root,'outputs/employee-profile-review-2026-11-19/browser'));
const report={scope:'Actual encrypted application HTTP/Oracle in an outer rollback; synthetic directory and employee HTTP transport. No bank API acceptance or live employee seed.',checks:[],layouts:[],browser_errors:[],external_requests:[]};
let browser;
(async()=>{await fs.mkdir(out,{recursive:true});const credentials=JSON.parse(await fs.readFile(path.join(root,'var/employee-browser-secrets.json'),'utf8'));const control=path.join(root,'var/employee-browser-api.json');
 const set=async values=>fs.writeFile(control,JSON.stringify(values));
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function open(who){const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await context.route('**/*',route=>{if(new URL(route.request().url()).origin!=='http://127.0.0.1:8011'){report.external_requests.push('External request blocked');return route.abort();}return route.continue();});const page=await context.newPage();page.on('pageerror',error=>report.browser_errors.push(error.message));page.setDefaultTimeout(15000);await page.goto('http://127.0.0.1:8011');await page.locator('#login-username').fill(credentials[who].username);await page.locator('#login-password').fill(credentials[who].password);const reads=[];page.on('request',r=>{const path=new URL(r.url()).pathname;if(['/api/auth/login','/api/auth/me','/api/auth/employee-profile'].includes(path))reads.push(path);});await page.locator('#login button[type=submit]').click();await page.locator('.app-shell').waitFor();assert.deepEqual(reads,['/api/auth/login','/api/auth/me']);return page;}
  async function layouts(page,name){for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));report.layouts.push({page:name,width});}}
  let staff=await open('employee');await staff.locator('#onboard').waitFor();
  assert.equal(await staff.locator('#onboard [name=email]').inputValue(),'directory.prefill@example.invalid');
  await staff.reload();await staff.locator('#onboard').waitFor();
  assert.equal(await staff.locator('#onboard [name=email]').inputValue(),'directory.prefill@example.invalid');
  assert((await staff.locator('.profile-directory-card').innerText()).includes('LDAP-054'));
  assert((await staff.locator('[aria-label="Employee profile refresh"]').innerText()).includes('administrator approval'));
  await layouts(staff,'first-login setup');await staff.screenshot({path:path.join(out,'first-login-phone.png'),fullPage:false});
  const units=await staff.evaluate(()=>fetch('/api/auth/departments').then(r=>r.json()));assert(units.length>0);
  await staff.locator('#onboard [name=email]').fill('fixture.employee@example.invalid');await staff.locator('#onboard select[name=org_unit_id]').selectOption(units[0].id,{force:true});await staff.locator('#onboard button[type=submit]').click();await staff.locator('.ldap-department-gate').waitFor();
  report.checks.push('During a first-login API outage, the LDAP work email prefills the editable confirmation field across reloads. The user confirms the email and chooses Home organisation while employee approval remains pending.');
  const admin=await open('admin');await admin.goto('http://127.0.0.1:8011/#employee-api');await admin.locator('#employee-api-settings').waitFor();
  await admin.locator('[name=test_pf_no]').fill(credentials.employee.username.slice(2));await admin.locator('[data-action=employee-api-test]').click();await admin.waitForFunction(()=>document.querySelector('#employee-api-test-result')?.textContent.includes('HTTP_503'));
  await set({mode:'success',ldap_email:'changed.directory@example.invalid'});await admin.locator('[data-action=employee-api-retry]').click();
  for(let i=0;i<15;i++){await admin.locator('[data-action=reload]').click();await admin.locator('#employee-api-settings').waitFor();if((await admin.locator('#main-content').innerText()).includes('Successful: 1'))break;await new Promise(r=>setTimeout(r,300));}
  assert((await admin.locator('#main-content').innerText()).includes('Successful: 1'));
  staff=await open('employee');await staff.locator('.ldap-department-gate').waitFor();await staff.getByRole('heading',{name:'Waiting for administrator approval'}).waitFor();await layouts(staff,'employee waiting for approval');await staff.screenshot({path:path.join(out,'employee-pending-phone.png')});await staff.locator('.review-record > summary').click();const pending=await staff.locator('.ldap-department-gate').innerText();assert(pending.includes('LDAP-054')&&pending.includes('0054-QA')&&pending.includes('Synthetic Manager'));
  report.checks.push('Durable retry recovery automatically queues the complete employee snapshot; different LDAP and API codes stay visible under their own labels.');
  await admin.goto('http://127.0.0.1:8011/#users?tab=ACTION_REQUIRED');
  const account=admin.locator('.access-account-table tbody tr').filter({hasText:credentials.employee.username});
  await account.getByRole('button',{name:'Review profile',exact:true}).waitFor();
  await layouts(admin,'accounts requiring action');await admin.setViewportSize({width:1440,height:1000});
  await account.getByRole('button',{name:'Employee profile history'}).click();
  const history=admin.locator('#dialog');await history.getByRole('heading',{name:'Pending profile review'}).waitFor();
  await history.screenshot({path:path.join(out,'profile-history.png')});await history.getByRole('button',{name:'Review request'}).click();
  await history.getByRole('heading',{name:'Your decision'}).waitFor();await admin.keyboard.press('Escape');
  await account.getByRole('button',{name:'Review profile',exact:true}).click();
  await history.getByRole('heading',{name:'Your decision'}).waitFor();await admin.keyboard.press('Escape');
  report.checks.push('Employee sign-in uses login and me. Accounts requiring action and profile history both open the correct pending decision.');
  async function review(choice='APPROVE'){
   await admin.goto('http://127.0.0.1:8011/#users?tab=LDAP_DEPARTMENTS');await admin.getByRole('heading',{name:'Employee profile changes',exact:true}).waitFor();
   await admin.locator('[data-action=refresh-users]').click();
   const row=admin.locator('#main-content table tbody tr').filter({hasText:credentials.employee.username});await row.waitFor();assert.equal(await row.count(),1);await row.getByRole('button',{name:'Review request',exact:true}).click();
   const dialog=admin.locator('#dialog');await dialog.waitFor({state:'visible'});assert(await dialog.getByRole('heading',{name:'Your decision'}).isVisible());assert.equal(await dialog.locator('select[name=decision]').inputValue(),'');
   await layouts(admin,'independent review');await admin.setViewportSize({width:1440,height:1000});await dialog.screenshot({path:path.join(out,'admin-review-desktop.png'),animations:'disabled'});
   await dialog.locator('select[name=decision]').selectOption(choice,{force:true});await dialog.locator('textarea[name=reason]').fill('TEST ONLY independent employee-profile and existing access-scope review.');await dialog.locator('button[type=submit]').click();await dialog.waitFor({state:'hidden'});
  }
  await review();const approved=await open('employee');await approved.locator('.home-mode').waitFor();
  let identity=await approved.evaluate(()=>fetch('/api/auth/me').then(r=>r.json()));assert.equal(identity.user.org_unit_id,units[0].id);assert.equal(identity.employee_profile.designation,'Synthetic Manager');
  assert.equal(identity.user.email,'fixture.employee@example.invalid');
  report.checks.push('Independent Admin approval plus fresh encrypted login restores existing role scope and keeps the confirmed email and Home organisation after a different LDAP email is returned.');
  await set({mode:'failure'});const cache=await open('employee');await cache.locator('.home-mode').waitFor();assert((await cache.locator('[aria-label="Employee profile refresh"]').innerText()).includes('approved employee data'));
  await layouts(cache,'approved outage workspace');await cache.screenshot({path:path.join(out,'approved-outage-phone.png'),fullPage:false});
  identity=await cache.evaluate(()=>fetch('/api/auth/me').then(r=>r.json()));assert.equal(identity.employee_profile.designation,'Synthetic Manager');assert.equal(identity.employee_profile.branch_name,'Registered branch');assert.equal(identity.employee_profile.current_branch_code,'0002');
  report.checks.push('An API outage retains approved employee fields and scoped access with a warning; registered and current branch values remain separate.');
  await set({mode:'failure',ldap_department:'LDAP-099'});const ldapChange=await open('employee');await ldapChange.locator('.ldap-department-gate').waitFor();await ldapChange.locator('.review-record > summary').click();assert((await ldapChange.locator('#main-content').innerText()).includes('LDAP-099'));
  await layouts(ldapChange,'LDAP change during API outage');await review();
  const ldapApproved=await open('employee');await ldapApproved.locator('.home-mode').waitFor();identity=await ldapApproved.evaluate(()=>fetch('/api/auth/me').then(r=>r.json()));assert.equal(identity.employee_profile.ldap_department_code,'LDAP-099');assert.equal(identity.employee_profile.department_code,'0054-QA');
  report.checks.push('LDAP changes restrict access even during API outage; Admin reviews the changed LDAP baseline and explicitly retained API values before a fresh login.');
  await set({mode:'success',ldap_department:'LDAP-099',designation:'Synthetic Senior Manager'});const apiChange=await open('employee');await apiChange.locator('.ldap-department-gate').waitFor();
  identity=await apiChange.evaluate(()=>fetch('/api/auth/me').then(r=>r.json()));assert.equal(identity.employee_profile.designation,'Synthetic Manager');assert.equal(identity.user.employee_profile_status,'PENDING');
  await review('REJECT');await set({mode:'failure',ldap_department:'LDAP-099'});const rejected=await open('employee');await rejected.locator('#employee-profile-request').waitFor();
  assert((await rejected.locator('#main-content').innerText()).includes('rejected'));
  await rejected.locator('#employee-profile-request [name=reason]').fill('TEST ONLY additional source clarification for reconsideration.');await rejected.locator('#employee-profile-request button[type=submit]').click();await rejected.locator('#employee-profile-request').waitFor({state:'hidden'});await review();
  await set({mode:'success',ldap_department:'LDAP-099',designation:'Synthetic Senior Manager'});const final=await open('employee');await final.locator('.home-mode').waitFor();identity=await final.evaluate(()=>fetch('/api/auth/me').then(r=>r.json()));assert.equal(identity.employee_profile.designation,'Synthetic Senior Manager');assert.equal(await final.locator('[aria-label="Employee profile refresh"]').count(),0);
  report.checks.push('A non-department API change requires review; rejection stays restricted during an outage, reconsideration needs a new explanation, and new approval/fresh login restores the updated snapshot.');
  await admin.goto('http://127.0.0.1:8011/#ldap');await admin.locator('#ldap').waitFor();assert.equal(await admin.locator('#ldap [name=attr_department_code]').inputValue(),'department');assert.equal(await admin.locator('#ldap [name=attr_email]').inputValue(),'mail');for(const key of ['attr_full_name','attr_division','attr_info'])assert.equal(await admin.locator(`[name=${key}]`).count(),0);
  await final.goto('http://127.0.0.1:8011/#employee-api');await final.locator('.access-boundary').waitFor();
  report.checks.push('Admin settings expose the LDAP department and work email mappings. Non-admin API-settings navigation remains denied.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.external_requests,[]);
 }finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
