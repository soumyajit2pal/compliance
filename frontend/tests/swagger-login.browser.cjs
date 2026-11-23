// Real encrypted sign-in on scripts/browser_fixture.py's rollback-only server.
// No business writes, credential output, traces, payload files or real LDAP calls.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const out=path.join(root,'outputs/swagger-login-2026-11-01/browser');
const report={checks:[],browser_errors:[],external_requests:[],blocked_writes:[],screenshots:[]};
let browser,page,secrets,originalProfile;
const envelopes=[];
const profilePath=path.join(root,'var/browser-ldap-department.json');
const redact=value=>Object.values(secrets?.credentials||{}).reduce((text,item)=>text.split(item.password).join('[redacted]'),String(value));
(async()=>{await fs.mkdir(out,{recursive:true});try{
 const secretPath=path.join(root,'var/browser-fixture-secrets.json');
 assert.equal((await fs.stat(secretPath)).mode&0o077,0,'Fixture credentials must be owner-only.');
 secrets=JSON.parse(await fs.readFile(secretPath,'utf8'));assert(secrets.credentials.ldap,'Start with CBD_DEPARTMENT_BROWSER_QA=1.');
 originalProfile=await fs.readFile(profilePath,'utf8');
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.origin!==base){report.external_requests.push(url.origin);return route.abort();}
  if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!['/api/auth/login','/api/auth/logout'].includes(url.pathname)){report.blocked_writes.push(url.pathname);return route.abort();}
  if(url.pathname==='/api/auth/login'&&req.method()==='POST')envelopes.push(req.postDataJSON());
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',error=>report.browser_errors.push(redact(error.message)));
 await page.addInitScript(()=>{window.docsCsp=[];document.addEventListener('securitypolicyviolation',event=>window.docsCsp.push(event.effectiveDirective));});
 const idle=()=>page.locator('#docs-session[aria-busy="false"]').waitFor();
 const account=state=>page.waitForFunction(expected=>document.querySelector('#docs-session')?.dataset.access===expected,state);
 const login=async(user,password=user.password)=>{await idle();await page.locator('#docs-username').fill(user.username);await page.locator('#docs-password').fill(password);await page.locator('#docs-sign-in').click();await idle();};
 const logout=async()=>{await page.locator('#docs-sign-out').click();await idle();await account('signed-out');};
 await page.goto(base+'/docs');await idle();await account('signed-out');
 assert.equal(await page.locator('#docs-username').getAttribute('name'),null);
 assert.equal(await page.locator('#docs-password').getAttribute('name'),null);
 report.checks.push('Anonymous Swagger displays the labelled, fail-closed direct sign-in form.');

 await login(secrets.credentials.author,'invalid-'+secrets.credentials.author.password);
 assert(await page.locator('#docs-auth-error').isVisible());assert.equal(await page.locator('#docs-password').inputValue(),'');await account('signed-out');
 report.checks.push('Real invalid Standard password is rejected and cleared, with recoverable guidance.');

 let releaseKey,keyStarted;
 const keyReady=new Promise(resolve=>keyStarted=resolve),keyGate=new Promise(resolve=>releaseKey=resolve);
 await page.route('**/api/auth/login-key',async route=>{keyStarted();await keyGate;await route.continue();},{times:1});
 await page.locator('#docs-username').fill(secrets.credentials.author.username);await page.locator('#docs-password').fill(secrets.credentials.author.password);
 const priorCount=envelopes.length;await page.locator('#docs-sign-in').click();await keyReady;
 assert(await page.locator('#docs-sign-in').isDisabled());assert.equal(await page.locator('#docs-password').inputValue(),'');
 await page.locator('#docs-login').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(envelopes.length,priorCount);releaseKey();await idle();await account('ready');assert.equal(envelopes.length,priorCount+1);
 assert((await page.locator('#docs-account-name').innerText()).includes(secrets.credentials.author.username));
 report.checks.push('Real encrypted Standard sign-in succeeds; key loading disables the form and prevents duplicate submissions.');

 const operation=page.locator('.opblock.opblock-get').filter({has:page.locator('.opblock-summary-path[data-path="/api/instruments/{identifier}"]')});
 await operation.locator('.opblock-summary-path').click();await operation.getByRole('button',{name:'Try it out',exact:true}).click();
 await operation.locator('input[placeholder="identifier"]').fill(secrets.record.id);
 const protectedRead=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/instruments/'+secrets.record.id);
 await operation.getByRole('button',{name:'Execute',exact:true}).click();assert.equal((await protectedRead).status(),200);
 report.checks.push('Swagger Try it out reads the actual protected fixture instrument using its HttpOnly session cookie.');
 const sessionCookie=(await context.cookies()).find(cookie=>cookie.name==='cbd_browser_fixture');assert(sessionCookie?.httpOnly);
 await page.reload();await idle();await account('ready');
 assert.deepEqual(await page.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})),{local:[],session:[]});
 assert.equal(await page.locator('#docs-password').inputValue(),'');
 report.checks.push('Reload resumes the cookie session; neither credentials nor authorisation are persisted in web storage.');

 const realIdentity=await (await context.request.get(base+'/api/auth/me')).json();
 for(const [patch,expected] of [[{user:{must_change_password_flag:1}},'Change your temporary password'],[{user:{needs_email_confirmation_flag:1}},'Confirm your work email and Home organisation'],[{roles:[]},'Administrator-approved roles and scope']]){
  await page.route('**/api/auth/me',route=>route.fulfill({json:{...realIdentity,...patch,user:{...realIdentity.user,...patch.user}}}));
  await page.locator('#docs-session-refresh').click();await idle();await account('restricted');assert((await page.locator('#docs-auth-status').innerText()).includes(expected));assert(await page.locator('#docs-setup-link').isVisible());await page.unroute('**/api/auth/me');
 }
 await page.locator('#docs-session-refresh').click();await idle();await account('ready');
 report.checks.push('Synthetic identity flags clearly show password, profile and role restrictions and link to the existing portal workflow.');

 const replay=await context.request.post(base+'/api/auth/login',{data:envelopes.at(-1),headers:{Origin:base}});assert.equal(replay.status(),400);
 assert.equal((await context.request.get(base+'/api/auth/me')).status(),200);
 report.checks.push('Replaying the real encrypted envelope is rejected by the server’s one-use challenge rule.');
 await logout();assert.equal((await context.request.get(base+'/api/auth/me')).status(),401);
 report.checks.push('Sign out succeeds through the existing fresh-CSRF preflight and revokes protected access.');

 const beforeFailure=envelopes.length;
 await page.route('**/api/auth/login-key',route=>route.fulfill({json:{algorithm:'unsupported'}}),{times:1});
 await login(secrets.credentials.author);assert(await page.locator('#docs-auth-error').isVisible());assert.equal(envelopes.length,beforeFailure);assert.equal(await page.locator('#docs-password').inputValue(),'');
 await login(secrets.credentials.author);await account('ready');
 report.checks.push('Unsupported encryption fails without any login POST or plaintext fallback; a fresh attempt succeeds.');
 await page.evaluate(()=>window.ui.getConfigs().responseInterceptor({status:401}));await account('signed-out');
 await page.locator('#docs-session-refresh').click();await idle();await account('ready');await logout();
 report.checks.push('Swagger’s API-401 response handler clears displayed identity; Refresh session uses current cookie state.');

 await fs.writeFile(profilePath,JSON.stringify({department_code:'NEW-002'}));
 await login(secrets.credentials.ldap);await account('restricted');
 const departmentText=await page.locator('#docs-auth-status').innerText();
 for(const expected of ['approval required','OLD-001','NEW-002'])assert(departmentText.includes(expected));
 const blocked=await context.request.get(base+'/api/instruments/'+secrets.record.id);assert.equal(blocked.status(),403);assert((await blocked.text()).includes('LDAP_DEPARTMENT_REVIEW_REQUIRED'));
 await page.screenshot({path:path.join(out,'swagger-ldap-restricted.png')});report.screenshots.push('swagger-ldap-restricted.png');
 await logout();
 report.checks.push('Real fixture LDAP code mismatch displays approved/current codes and the backend still blocks protected access with 403; no approval is bypassed.');

 await page.goto(base+'/');await page.locator('#login-username').fill(secrets.credentials.reviewer.username);await page.locator('#login-password').fill(secrets.credentials.reviewer.password);
 const portalLogin=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login'&&response.request().method()==='POST');
 await page.locator('#login button[type=submit]').click();assert.equal((await portalLogin).status(),200);await page.locator('#login').waitFor({state:'detached'});
 await page.goto(base+'/docs');await idle();await account('ready');assert((await page.locator('#docs-account-name').innerText()).includes(secrets.credentials.reviewer.username));await logout();
 report.checks.push('The portal still signs in using the shared helper, and Swagger recognises that same browser session.');

 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert(await page.locator('#docs-sign-in').evaluate(button=>button.getBoundingClientRect().height>=44));}
 await page.locator('#docs-username').focus();assert(await page.locator('#docs-username').evaluate(input=>document.activeElement===input));
 await page.screenshot({path:path.join(out,'swagger-mobile.png')});report.screenshots.push('swagger-mobile.png');
 report.checks.push('320px/390px layouts have no document overflow and retain labelled inputs, keyboard focus and 44px controls.');

 const expectedKeys=['challenge','ciphertext','iv','key_id','wrapped_key'];
 for(const envelope of envelopes){assert.deepEqual(Object.keys(envelope).sort(),expectedKeys);for(const item of Object.values(secrets.credentials)){assert(!JSON.stringify(envelope).includes(item.password));assert(!JSON.stringify(envelope).includes(item.username));}}
 const uniqueChallenges=new Set(envelopes.map(envelope=>envelope.challenge));assert.equal(uniqueChallenges.size,envelopes.length);
 assert.deepEqual(await page.evaluate(()=>window.docsCsp),[]);assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.external_requests,[]);assert.deepEqual(report.blocked_writes,[]);
 report.login_attempts=envelopes.length;report.checks.push('Every form/portal attempt sent only the encrypted envelope with a fresh challenge; no external request, CSP/JavaScript error or business write occurred.');report.status='passed';
 }catch(error){report.status='failed';report.error=redact(error.stack);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;
 }finally{if(originalProfile)await fs.writeFile(profilePath,originalProfile);if(browser)await browser.close();await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}
})();
