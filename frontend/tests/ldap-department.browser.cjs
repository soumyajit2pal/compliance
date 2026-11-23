// Real UI/API flow on the explicitly opted-in rollback preview, never port 8010.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const output=path.resolve(process.env.CBD_LDAP_QA_OUTPUT||path.join(root,'outputs/ldap-division-info-2026-11-11/browser'));
const base='http://127.0.0.1:8011';
const report={checks:[],browser_errors:[],source:'Explicit Oracle rollback-only browser fixture, synthetic LDAP observations',real_bank_ldap_tested:false};
const contexts=[];
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const fixture=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8'));
 assert(fixture.credentials.ldap,'Start browser_fixture.py with CBD_DEPARTMENT_BROWSER_QA=1');
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const profile=path.join(root,'var/browser-ldap-department.json');
 async function observation(code,description){await fs.writeFile(profile,JSON.stringify({department_code:code,attributes:{description:[description]}}),{mode:0o600});}
 async function context(){const c=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'});contexts.push(c);return c;}
 async function open(c){const p=await c.newPage();p.on('pageerror',e=>report.browser_errors.push(e.message));await p.goto(base);return p;}
 async function login(p,account){
   await p.locator('#login').waitFor();
   await p.locator('#login [name=username]').fill(account.username);
   await p.locator('#login [name=password]').fill(account.password);
   const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
   await p.locator('#login button[type=submit]').click();const result=await response;assert.equal(result.status(),200);
   const payload=await result.json();
   if(payload.ldap_user){
     assert('department_code' in payload.ldap_user);
     assert(!('ldap_department_name' in payload.ldap_user));
     assert(!('department' in payload.ldap_user));
     assert.deepEqual(Object.keys(payload.ldap_department.approved),['code','division','info']);
     assert.deepEqual(Object.keys(payload.ldap_department.current),['code','division','info']);
   }
   await p.locator('#login').waitFor({state:'hidden'});
 }
 async function identity(c){const r=await c.request.get(base+'/api/auth/me');assert(r.ok());return r.json();}
 async function write(c,url,data){const me=await identity(c);return c.request.post(base+url,{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data});}
 async function logout(c){const r=await c.request.get(base+'/api/auth/me');if(r.status()===401)return;const me=await r.json();assert.equal((await c.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data:{}})).status(),200);}
 async function relogin(c,p){await logout(c);await p.goto(base);await login(p,fixture.credentials.ldap);}
 async function ready(p){await p.locator('a.nav-item[href="#home"]').waitFor({state:'attached'});}
 async function gate(p,title){await p.locator('h1').filter({hasText:title}).waitFor();await p.locator('.ldap-department-gate').waitFor();}
 async function request(p){
   await p.locator('#ldap-department-request [name=reason]').fill('TEST ONLY — verify synthetic department transfer.');
   const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/department/request'&&r.request().method()==='POST');
   await p.locator('#ldap-department-request button[type=submit]').click();const r=await response;assert.equal(r.status(),200);const data=await r.json();
   await p.getByText('Your request is pending administrator approval.',{exact:false}).waitFor();return data.id;
 }
 async function decide(p,decision){
   await p.goto(base+'/#users?tab=LDAP_DEPARTMENTS');
   await p.locator('[data-action=refresh-users]').waitFor();
   await p.locator('[data-action=refresh-users]').click();
   const ownRequest=p.locator('tbody tr').filter({hasText:fixture.credentials.ldap.username}).locator('[data-action=department-review]');
   await ownRequest.waitFor();await ownRequest.click();
   const dialog=p.locator('#dialog');await dialog.waitFor({state:'visible'});
   assert((await dialog.innerText()).includes(fixture.credentials.ldap.username),'Only the temporary LDAP account may receive fixture decisions.');
   assert((await dialog.innerText()).includes('Home organisation'));
   assert((await dialog.innerText()).includes('Current department details returned by LDAP'));
   await dialog.locator('[name=decision]').selectOption(decision,{force:true});
   await dialog.locator('[name=reason]').fill(decision==='APPROVE'?'TEST ONLY — verified synthetic directory transfer.':'TEST ONLY — verification declined.');
   const response=p.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/decision')&&r.request().method()==='POST');
   await dialog.locator('button[type=submit]').click();assert.equal((await response).status(),200);
   await dialog.waitFor({state:'hidden'});
 }
 try{
   const user=await context(),admin=await context();const p=await open(user),a=await open(admin);
   await login(p,fixture.credentials.ldap);await ready(p);
   const original=await identity(user);assert.equal(original.user.department_code,'OLD-001');
   assert.deepEqual(original.roles,['BUSINESS_OWNER']);
   report.checks.push('Matching LDAP baseline opens the actual workspace with its existing Home organisation and scoped role.');
   await login(a,fixture.credentials.admin);await ready(a);
   await observation('NEW-002','TEST ONLY New LDAP department');await relogin(user,p);
   await gate(p,'Your LDAP department details have changed');
   assert((await p.locator('.ldap-department-gate').innerText()).includes('OLD-001'));
   assert((await p.locator('.ldap-department-gate').innerText()).includes('NEW-002'));
   assert.equal((await user.request.get(base+'/api/instruments')).status(),403);
   assert(!(await p.locator('.ldap-department-gate').innerText()).includes('Department name'));
   assert.equal((await user.request.get(base+'/api/masters')).status(),403);
   report.checks.push('Mismatch shows both codes without a department name and blocks actual workspace APIs.');
   const requestId=await request(p);
   const duplicate=await write(user,'/api/auth/department/request',{reason:'TEST ONLY duplicate click'});
   assert.equal((await duplicate.json()).id,requestId);
   report.checks.push('User submits a server-derived update; duplicate submission returns the same pending request.');
   for(const width of [1440,1024,768,390,320]){
     await p.setViewportSize({width,height:1000});
     assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Department gate overflows at '+width);
     if(width===1440||width===390)await p.screenshot({path:path.join(output,'department-pending-'+width+'.png'),fullPage:true});
   }
   report.checks.push('Pending review screen fits 1440, 1024, 768, 390 and 320px with visible request status/sign-out controls.');
   await p.setViewportSize({width:1440,height:1000});
   await decide(a,'APPROVE');
   assert.equal((await user.request.get(base+'/api/auth/me')).status(),401);
   await p.locator('[data-action=reload]').click();await p.locator('#login').waitFor();
   await login(p,fixture.credentials.ldap);await ready(p);
   const approved=await identity(user);
   assert.equal(approved.user.department_code,'NEW-002');assert.equal(approved.user.org_unit_id,original.user.org_unit_id);
   assert.deepEqual(approved.roles,original.roles);assert.equal(approved.user.ldap_department_status,'VERIFIED');
   report.checks.push('Administrator approves with reason; old session is revoked and fresh LDAP sign-in restores access without changing Home organisation or roles.');
   await observation('NEW-002','TEST ONLY Renamed LDAP department');await relogin(user,p);await ready(p);
   assert.equal((await identity(user)).user.department_code,'NEW-002');
   assert(!('ldap_department_name' in (await identity(user)).user));
   report.checks.push('Unrelated directory attributes preserve code approval and are not stored as a department name.');
   await observation('NEXT-003 <img src=x onerror="window.departmentXss=true">','TEST ONLY safe text');await relogin(user,p);
   await gate(p,'Your LDAP department details have changed');
   assert.equal(await p.locator('.ldap-department-gate img').count(),0);
   assert.equal(await p.evaluate(()=>Boolean(window.departmentXss)),false);
   await request(p);await decide(a,'REJECT');
   await p.goto(base);await login(p,fixture.credentials.ldap);await gate(p,'Your LDAP department details have changed');
   await p.getByText('TEST ONLY — verification declined.',{exact:false}).waitFor();
   assert.equal(await p.locator('#ldap-department-request [name=reason][required]').count(),1);
   assert.equal((await write(user,'/api/auth/department/request',{})).status(),409);
   await p.screenshot({path:path.join(output,'department-rejected.png'),fullPage:true});
   report.checks.push('LDAP details are escaped; rejection retains its reason and requires a new explanation for reconsideration.');
   await observation('NEW-002','TEST ONLY Renamed LDAP department');await relogin(user,p);await ready(p);
   report.checks.push('Returning to the approved code permits fresh login without changing the approved code.');
   await observation(null,'TEST ONLY Name without code');await relogin(user,p);
   await gate(p,'Your LDAP department details could not be verified');
   assert.equal(await p.locator('#ldap-department-request').count(),0);
   assert.equal((await identity(user)).user.department_code,'NEW-002');
   assert.equal((await user.request.get(base+'/api/instruments')).status(),403);
   report.checks.push('Missing code blocks access and replacement requests while retaining the approved baseline.');
   await a.goto(base+'/#users?tab=LDAP');await a.locator('[data-action=department-history]').first().waitFor();
   assert((await a.locator('.ldap-directory').innerText()).includes('LDAP department'));
   await a.locator('[data-action=department-history][data-id="'+original.user.id+'"]').click();
   await a.locator('#dialog').waitFor({state:'visible'});
   await a.locator('#dialog').getByText('Approved',{exact:true}).waitFor();
   const history=await a.locator('#dialog').innerText();assert(history.includes('Approved')&&history.includes('Rejected'));
   await a.locator('#dialog [data-action=close]').click();
   await a.goto(base+'/#ldap');await a.locator('[name=attr_department_code]').waitFor();
   assert(await a.locator('[name=attr_department_code]').inputValue());
   assert.equal(await a.locator('[name=attr_division]').inputValue(),'division');
   assert.equal(await a.locator('[name=attr_info]').inputValue(),'info');
   assert.equal(await a.locator('[name=attr_department_name]').count(),0);
   assert.equal(await a.getByText('Department name attribute',{exact:true}).count(),0);
   report.checks.push('Admin catalogue/history show department details, and LDAP settings expose code, division and info attribute mappings.');
   assert.deepEqual(report.browser_errors,[]);report.status='passed';
 }catch(error){
   report.status='failed';let message=String(error.stack||error);
   for(const account of Object.values(fixture.credentials))message=message.split(account.password).join('[redacted]');
   report.error=message;throw error;
 }finally{
   for(const c of contexts){try{await logout(c);}catch{}}
   await browser.close();report.checked_at=new Date().toISOString();
   await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');
   console.log(JSON.stringify({status:report.status,checks:report.checks.length,browser_errors:report.browser_errors,error:report.error||null}));
 }
})().catch(()=>{process.exitCode=1;});
