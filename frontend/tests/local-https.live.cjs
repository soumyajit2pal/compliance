// Real loopback TLS, Oracle authentication and HTTPS Vite proxy. No business writes.
const {chromium}=require(process.argv[2]||'playwright');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const {chooseOption}=require('./helpers/searchable-select.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),https=require('node:https'),http=require('node:http'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'outputs/local-https-2026-10-30');
const report={status:'running',checks:[],screenshots:[],browser_errors:[],prohibited_writes:[]};
(async()=>{
 const certificate=await fs.readFile(path.join(root,'var/tls/localhost.crt'));
 const fingerprint=crypto.createHash('sha256').update(new crypto.X509Certificate(certificate).raw).digest('hex');
 function verified(url,options={}){return new Promise((resolve,reject)=>{const request=https.get(url,{ca:certificate,rejectUnauthorized:true,family:4,agent:false,...options},response=>{const chunks=[];const protocol=response.socket.getProtocol(),peer=response.socket.getPeerCertificate();if(!peer.raw){response.resume();reject(new Error('Fresh TLS peer certificate was unavailable.'));return;}response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,body:Buffer.concat(chunks).toString(),protocol,peer:crypto.createHash('sha256').update(peer.raw).digest('hex')}));});request.setTimeout(5000,()=>request.destroy(new Error('TLS request timeout')));request.on('error',reject);});}
 const browser=await chromium.launch({headless:true,channel:'chrome'});const contexts=[];
 async function session(){const context=await browser.newContext({...uatContextOptions,viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'});contexts.push(context);await context.route('**/api/**',async route=>{const request=route.request(),pathname=new URL(request.url()).pathname;if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!['/api/auth/login','/api/auth/logout'].includes(pathname)){report.prohibited_writes.push({method:request.method(),path:pathname});return route.abort('blockedbyclient');}await route.continue();});const page=await context.newPage();page.on('pageerror',error=>report.browser_errors.push(error.message));return {context,page};}
 async function get(context,origin,url){const response=await context.request.get(origin+'/api'+url);assert(response.ok());return response.json();}
 async function signInAndOut(origin){
  const {context,page}=await session();const packets=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/login')packets.push(request.postDataJSON());});
  await page.goto(origin);await page.locator('#demo-user').waitFor();assert(await page.evaluate(()=>window.isSecureContext&&Boolean(crypto.subtle)));assert.equal(await page.locator('.auth-help,#demo-ldap-help').count(),0);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.auth-bank-logo')).some(image=>image.complete&&image.naturalWidth>0));
  const guide=await context.request.get(await page.getByRole('link',{name:'User guide',exact:true}).getAttribute('href').then(href=>new URL(href,origin).href));assert.equal(guide.status(),200);assert((await guide.text()).includes('Master data'));
  const demo=await get(context,origin,'/auth/demo-users');assert(demo.users.some(u=>u.username==='reviewer'&&u.password_autofill_available&&!u.must_change_password));
  await chooseOption(page.locator('#demo-user'),'reviewer','reviewer');await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});
  assert.equal(packets.length,1);assert.deepEqual(Object.keys(packets[0]).sort(),['challenge','ciphertext','iv','key_id','wrapped_key'].sort());
  const cookie=(await context.cookies()).find(cookie=>cookie.name==='cbd_session');assert(cookie&&cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax');
  const me=await get(context,origin,'/auth/me');assert.equal((await context.request.post(origin+'/api/auth/logout',{headers:{Origin:origin,'X-CSRF-Token':me.csrf_token},data:{}})).status(),200);
  return {context,page};
 }
 try{
  const health=await verified(base+'/api/health');assert.equal(health.status,200);assert.equal(JSON.parse(health.body).environment,'uat');assert.equal(health.peer,fingerprint);assert(['TLSv1.2','TLSv1.3'].includes(health.protocol));
  assert.equal((await verified(base+'/api/health',{maxVersion:'TLSv1.2'})).protocol,'TLSv1.2');
  await assert.rejects(verified(base+'/api/health',{servername:'wrong.example.invalid'}));
  report.checks.push('HTTPS verifies against the project certificate with correct localhost SAN/fingerprint; TLS 1.2 and modern negotiation work and a wrong hostname is rejected.');
  const plain=await new Promise(resolve=>{const request=http.get('http://127.0.0.1:8010/api/auth/login-key',{headers:{'X-Forwarded-Proto':'https'}},response=>{response.resume();resolve(response.statusCode!==200);});request.on('error',()=>resolve(true));request.setTimeout(3000,()=>{request.destroy();resolve(true);});});assert(plain);
  assert.equal((await verified(base+'/api/auth/login-key',{headers:{'X-Forwarded-Proto':'http'}})).status,200);
  report.checks.push('The former HTTP port no longer serves plaintext sign-in; untrusted forwarded-protocol headers cannot change the direct TLS scheme.');
  const direct=await signInAndOut(base);report.checks.push('The built portal is a secure context, encrypted Standard login succeeds, and the session cookie is Secure/HttpOnly/SameSite=Lax; Sign-in help remains absent.');
  for(const width of [1440,390,320]){await direct.page.setViewportSize({width,height:width<500?844:1000});await direct.page.goto(base);await direct.page.locator('#demo-user').waitFor();assert.equal(await direct.page.locator('.auth-help,#demo-ldap-help').count(),0);assert(await direct.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file='login-https-'+width+'.png';await direct.page.screenshot({path:path.join(output,file),fullPage:true});report.screenshots.push(file);}
  const dev='https://localhost:5174';const proxy=await verified(dev+'/api/auth/login-key');assert.equal(proxy.status,200);assert.equal(proxy.peer,fingerprint);await signInAndOut(dev);
  for(const filename of ['var/tls/localhost.key','var/login-private.pem','.env.uat']){const response=await verified(dev+'/@fs'+encodeURI(path.join(root,filename)));assert([403,404].includes(response.status),'Vite must not serve '+filename);}
  report.checks.push('HTTPS Vite/HMR development startup and its certificate-verified HTTPS API proxy support encrypted login; private keys and the environment file are blocked by Vite filesystem rules.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';report.certificate_sha256=fingerprint;report.browser_trust='Self-signed local certificate; test browsers bypass only local certificate errors. Node TLS verifies the exact project certificate; OS/browser trust stores are unchanged.';
 }catch(error){report.status='failed';report.error=error.message;throw error;}
 finally{for(const context of contexts)await context.close();await browser.close();report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
