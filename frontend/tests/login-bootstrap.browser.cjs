// Observe page requests without logging credentials. Only the last group uses
// existing UAT login/logout; other groups supply controlled authentication APIs.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const output=path.resolve(process.env.CBD_BOOTSTRAP_QA_OUTPUT||'outputs/login-bootstrap-2026-10-30');
const observe=process.argv.includes('--observe');
const report={checks:[],browser_errors:[],prohibited_writes:[],controlled_api_groups:0,live_uat_groups:0};
const contexts=[];
const demo={users:[{username:'example.demo',full_name:'Example Demo',roles:['REVIEWER'],
  password_autofill_available:false,must_change_password:false}]};
const identity={user:{id:'example-person',username:'example.person',full_name:'Example Person',
  login_type:'STANDARD',must_change_password_flag:0},roles:['REVIEWER'],grants:[],
  menu:[{id:'home',label:'Home'}],csrf_token:'synthetic-csrf',environment:'uat'};

(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 async function open(handler){
  const context=await browser.newContext({...uatContextOptions,viewport:{width:1280,height:900}});
  contexts.push(context);
  await context.addInitScript(()=>{
   window.__expiryEvents=0;
   window.addEventListener('portal:session-expired',()=>window.__expiryEvents++);
  });
  await context.route('**/api/**',async route=>{
   const request=route.request(),pathname=new URL(request.url()).pathname;
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!['/api/auth/login','/api/auth/logout'].includes(pathname)){
    report.prohibited_writes.push(pathname);return route.abort('blockedbyclient');
   }
   if(handler)return handler(route,pathname);
   return route.continue();
  });
  const page=await context.newPage();const requests=[],responses=[];
  page.on('pageerror',error=>report.browser_errors.push(error.message));
  page.on('response',response=>responses.push(response));
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(new URL(request.url()).pathname);});
  await page.goto(base);
  return {context,page,requests,responses,count:()=>requests.filter(p=>p==='/api/auth/demo-users').length};
 }
 async function settled(page){await page.waitForLoadState('networkidle');}
 async function anonymous(demoStatus=200,meStatus=401){
  return open((route,pathname)=>{
   if(pathname==='/api/auth/me')return route.fulfill({status:meStatus,json:{detail:'Authentication required.'}});
   if(pathname==='/api/auth/demo-users')return route.fulfill({status:demoStatus,json:demoStatus===200?demo:{detail:'Demo sign-in is unavailable.'}});
   throw new Error('Unexpected controlled API: '+pathname);
  });
 }
 try{
  if(observe){
   const run=await open();await run.page.locator('#demo-user').waitFor({state:'attached'});await settled(run.page);
   report.observed_demo_requests=run.count();report.observed_me_requests=run.requests.filter(p=>p==='/api/auth/me').length;
   report.checks.push('Observed anonymous login startup against the existing compiled UAT bundle.');
  }else{
   const initial=await anonymous();await initial.page.locator('#demo-user').waitFor({state:'attached'});await settled(initial.page);
   assert.equal(initial.count(),1);assert.equal(await initial.page.evaluate(()=>window.__expiryEvents),0);
   assert.equal(await initial.page.locator('#login').count(),1);
   report.checks.push('Initial anonymous /auth/me 401 renders one login form and makes exactly one demo-users request, without an expiry event.');report.controlled_api_groups++;
   await initial.page.locator('#login-username').fill('typed.person');
   await initial.page.evaluate(async()=>{
    for(const value of ['#repository','#clauses','#home']){
     location.hash=value;await new Promise(resolve=>requestAnimationFrame(resolve));
    }
   });
   await settled(initial.page);assert.equal(initial.count(),1);
   assert.equal(await initial.page.locator('#login-username').inputValue(),'typed.person');
   report.checks.push('Anonymous hash navigation preserves typed credentials and the existing picker without another demo request.');report.controlled_api_groups++;
   for(const status of [404,503]){
    const run=await anonymous(status);await run.page.locator('#login').waitFor();await settled(run.page);
    assert.equal(run.count(),1);
    if(status===404)assert(await run.page.locator('#demo-sign-in').isHidden());
    else await run.page.locator('[data-action=retry-demo-users]').waitFor();
    assert(await run.page.locator('#login button[type=submit]').isEnabled());
    report.checks.push('Demo endpoint '+status+' leaves manual sign-in available without automatic retries.');report.controlled_api_groups++;
   }
   const unavailable=await anonymous(200,503);await unavailable.page.locator('#demo-user').waitFor({state:'attached'});await settled(unavailable.page);
   assert.equal(unavailable.count(),1);assert.equal(await unavailable.page.evaluate(()=>window.__expiryEvents),0);
   report.checks.push('A failed identity bootstrap uses the same single login fallback and keeps demo selection available.');report.controlled_api_groups++;
   const expired=new Set();let release;const both=new Promise(resolve=>release=resolve);
   const race=await open(async(route,pathname)=>{
    if(pathname==='/api/auth/me')return route.fulfill({json:identity});
    if(pathname==='/api/masters')return route.fulfill({json:{}});
    if(pathname==='/api/tasks'||pathname==='/api/notifications'){
     expired.add(pathname);if(expired.size===2)release();await both;
     return route.fulfill({status:401,json:{detail:'Session expired.'}});
    }
    if(pathname==='/api/auth/demo-users')return route.fulfill({json:demo});
    throw new Error('Unexpected expiry API: '+pathname);
   });
   await race.page.locator('#demo-user').waitFor({state:'attached'});await settled(race.page);
   assert.equal(race.count(),1);assert.equal(await race.page.evaluate(()=>window.__expiryEvents),1);
   report.checks.push('Concurrent protected 401 responses expire the existing identity once and fetch one fresh demo list.');report.controlled_api_groups++;

   const live=await open();const {page}=live;
   const response=live.responses.find(r=>new URL(r.url()).pathname==='/api/auth/demo-users')||
    await page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/demo-users');
   const available=await response.json();const account=available.users.find(u=>u.username==='reviewer'&&u.password_autofill_available&&!u.must_change_password);
   assert(account,'Existing eligible public UAT Reviewer required.');
   await page.locator('#demo-user').waitFor({state:'attached'});await settled(page);assert.equal(live.count(),1);
   await page.locator('#demo-user').selectOption(account.username,{force:true});
   assert.equal(await page.locator('#login-username').inputValue(),account.username);
   const signedIn=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
   await page.locator('#login button[type=submit]').click();assert.equal((await signedIn).status(),200);
   await page.locator('#login').waitFor({state:'hidden'});await page.locator('[data-action=logout]').first().waitFor();
   const returned=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/demo-users');
   await page.locator('[data-action=logout]').first().click();assert.equal((await returned).status(),200);
   await page.locator('#demo-user').waitFor({state:'attached'});await settled(page);
   assert.equal(live.count(),2);assert.equal(await page.locator('#login-username').inputValue(),'');
   report.checks.push('Existing-account HTTPS startup makes one demo request; successful encrypted login/logout makes exactly one fresh request for the next login view.');report.live_uat_groups++;
  }
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.stack||error);throw error;}
 finally{
  for(const context of contexts){
   try{const me=await context.request.get(base+'/api/auth/me');if(me.ok()){
    const data=await me.json();await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':data.csrf_token},data:{}});
   }}catch{}
  }
  await browser.close();report.checked_at=new Date().toISOString();
  await fs.writeFile(path.join(output,observe?'before.json':'browser-validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.length,observed_demo_requests:report.observed_demo_requests,error:report.error||null}));
 }
})().catch(()=>{process.exitCode=1;});
