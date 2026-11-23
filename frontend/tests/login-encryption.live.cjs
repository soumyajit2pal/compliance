// Existing-record UAT login verification. Only login/logout may write.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const output=path.resolve(process.env.CBD_LOGIN_QA_OUTPUT||path.join(__dirname,'../../outputs/login-encryption-2026-10-29'));
const report={checks:[],browser_errors:[],prohibited_writes:[]};
const contexts=[];const packets=[];
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 async function context(width=1440){
   const c=await browser.newContext({...uatContextOptions,viewport:{width,height:1000},timezoneId:'Asia/Kolkata'});contexts.push(c);
   await c.route('**/api/**',async route=>{
     const r=route.request(),p=new URL(r.url()).pathname;
     if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){
       report.prohibited_writes.push({method:r.method(),path:p});return route.abort('blockedbyclient');
     }
     await route.continue();
   });
   c.on('page',p=>{
     p.on('pageerror',e=>report.browser_errors.push(e.message));
     p.on('request',r=>{if(new URL(r.url()).pathname==='/api/auth/login')packets.push(r.postDataJSON());});
   });return c;
 }
 async function open(c){const p=await c.newPage();await p.goto(base);await p.locator('#login').waitFor();return p;}
 async function fill(p,account){await p.locator('#login [name=username]').fill(account.username);await p.locator('#login [name=password]').fill(account.password);}
 async function submit(p){const r=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login');await p.locator('#login button[type=submit]').click();return r;}
 async function logout(c){const me=await c.request.get(base+'/api/auth/me');if(me.status()===401)return;assert(me.ok());const data=await me.json();assert.equal((await c.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':data.csrf_token},data:{}})).status(),200);}
 function encrypted(packet,account){assert.deepEqual(Object.keys(packet).sort(),['challenge','ciphertext','iv','key_id','wrapped_key'].sort());const raw=JSON.stringify(packet);assert(!raw.includes(account.password)&&!raw.includes('"username"')&&!raw.includes('"password"'));assert.equal(Buffer.from(packet.iv,'base64').length,12);assert.equal(Buffer.from(packet.wrapped_key,'base64').length,384);}
 try{
   const c=await context();const health=await c.request.get(base+'/api/health');assert.equal((await health.json()).environment,'uat');
   const demo=await (await c.request.get(base+'/api/auth/demo-users')).json();
   const account=demo.users.find(u=>u.username==='reviewer'&&u.password_autofill_available&&!u.must_change_password);
   assert(account,'An eligible existing public demo Reviewer is required; no account is changed.');
   const keyResponse=await c.request.get(base+'/api/auth/login-key');assert(keyResponse.ok());assert.equal(keyResponse.headers()['cache-control'],'no-store');
   const publicKey=await keyResponse.json();assert.equal(publicKey.algorithm,'RSA-OAEP-256+A256GCM');assert.equal(publicKey.expires_in,120);assert(!JSON.stringify(publicKey).includes('PRIVATE'));
   report.checks.push('Public bootstrap exposes only public key material and a fresh two-minute challenge, with no-store caching.');
   const p=await open(c);await fill(p,account);assert.equal((await submit(p)).status(),200);await p.locator('#login').waitFor({state:'hidden'});
   assert.equal((await (await c.request.get(base+'/api/auth/me')).json()).user.username,account.username);
   encrypted(packets.at(-1),account);const captured=packets.at(-1);
   report.checks.push('Actual browser Web Crypto login sends only ciphertext and wrapped key material; existing Standard identity and roles resolve normally.');
   assert.equal((await c.request.post(base+'/api/auth/login',{headers:{Origin:base},data:captured})).status(),400);
   const plain=await c.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{username:account.username,password:account.password}});
   assert.equal(plain.status(),400);assert(!(await plain.text()).includes(account.password));await logout(c);
   report.checks.push('Captured login replay and plaintext JSON are rejected without returning credentials.');
   const broken=await context(390);await broken.addInitScript(()=>Object.defineProperty(window.crypto,'subtle',{value:undefined}));
   const disabled=await open(broken);await fill(disabled,account);const before=packets.length;await disabled.locator('#login button[type=submit]').click();
   await disabled.getByText('Secure sign-in requires HTTPS and a supported browser.',{exact:true}).waitFor();assert.equal(packets.length,before);assert(await disabled.locator('#login button[type=submit]').isEnabled());
   await disabled.screenshot({path:path.join(output,'unavailable-crypto-mobile.png'),animations:'disabled'});
   report.checks.push('Missing Web Crypto shows a recoverable inline error and makes no login POST or plaintext fallback.');
   const unavailable=await context();await unavailable.route('**/api/auth/login-key',route=>route.fulfill({status:503,json:{detail:'Secure login is temporarily unavailable. Please try again.'}}));
   const fail=await open(unavailable);await fill(fail,account);const previous=packets.length;await fail.locator('#login button[type=submit]').click();await fail.getByText('Secure login is temporarily unavailable. Please try again.',{exact:true}).waitFor();assert.equal(packets.length,previous);assert(await fail.locator('#login button[type=submit]').isEnabled());
   report.checks.push('Unavailable key bootstrap stays in the login form and never submits credentials without encryption.');
   const retry=await context();let tamper=true;await retry.route('**/api/auth/login-key',async route=>{const r=await route.fetch(),data=await r.json();if(tamper)data.challenge='intentionally-invalid-browser-challenge';await route.fulfill({response:r,json:data});});
   const retryPage=await open(retry);await fill(retryPage,account);assert.equal((await submit(retryPage)).status(),400);await retryPage.getByText('Invalid or expired encrypted login. Please try signing in again.',{exact:true}).waitFor();
   assert.equal(await retryPage.locator('#login [name=password]').inputValue(),account.password);tamper=false;assert.equal((await submit(retryPage)).status(),200);await retryPage.locator('#login').waitFor({state:'hidden'});await logout(retry);
   report.checks.push('Invalid challenge produces a generic inline error; retry fetches a new challenge and signs in without losing form values.');
   const race=await context();let fresh;await race.route('**/api/auth/login',async route=>{fresh=route.request().postDataJSON();await route.abort('blockedbyclient');});
   const racePage=await open(race);await fill(racePage,account);await racePage.locator('#login button[type=submit]').click();await racePage.locator('#login-error').filter({hasText:/Failed to fetch|fetch/i}).waitFor();encrypted(fresh,account);
   const peers=[await context(),await context()];const responses=await Promise.all(peers.map(peer=>peer.request.post(base+'/api/auth/login',{headers:{Origin:base},data:fresh})));
   assert.deepEqual(responses.map(r=>r.status()).sort(),[200,400]);
   for(let i=0;i<peers.length;i++){assert.equal((await peers[i].request.get(base+'/api/auth/me')).status(),responses[i].status()===200?200:401);await logout(peers[i]);}
   report.checks.push('Two concurrent requests sharing one fresh encrypted envelope yield exactly one 200 and one 400; the losing client receives no session.');
   const mobile=await context(390);const phone=await open(mobile);await fill(phone,account);await phone.screenshot({path:path.join(output,'login-mobile.png'),animations:'disabled'});assert.equal((await submit(phone)).status(),200);await phone.locator('#login').waitFor({state:'hidden'});await logout(mobile);
   for(const packet of packets)encrypted(packet,account);
   report.checks.push('Phone login succeeds using the same encrypted protocol; captured UI login requests contain no plaintext credential fields.');
   assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';report.encrypted_browser_requests=packets.length;
 }catch(e){report.status='failed';report.error=e.message;throw e;}
 finally{
   for(const c of contexts){await logout(c).catch(()=>{});await c.close();}
   report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 }
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,encrypted_browser_requests:report.encrypted_browser_requests}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
