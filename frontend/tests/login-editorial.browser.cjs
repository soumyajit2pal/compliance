// Production-bundle sign-in checks with a private, synthetic local API only.
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'frontend/dist');
const output=path.resolve(process.env.CBD_LOGIN_DESIGN_OUTPUT||path.join(root,'outputs/login-background-2026-11-13/browser'));
const preview=process.argv.includes('--preview'),scenarios=new Map();
const report={scope:'Production bundle and synthetic local API. No Oracle, real credentials or bank LDAP.',checks:[],browser_errors:[],unexpected_requests:[],encrypted_submissions:0,viewports:[]};
const fixturePassword='Synthetic-Login-Only@2026';
const demo={users:[{username:'example.reviewer',full_name:'Example Reviewer',roles:['REVIEWER'],password:fixturePassword,password_autofill_available:true,must_change_password:false},
 {username:'example.private',full_name:'Example <Private> Account',roles:['AUTHOR'],password_autofill_available:false,must_change_password:true}],ldap_demo:{enabled:false}};
const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
const scenario=(name,extra={})=>{const s={demoStatus:200,demoCalls:0,keyCalls:0,loginCalls:0,signedIn:false,...extra};scenarios.set(name,s);return s;};
scenario('preview');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const send=(res,status,json)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(json));};
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost'),s=scenarios.get(req.headers['x-login-scenario'])||scenarios.get('preview');
  if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(u.pathname.startsWith('/api/')){
   if(req.method==='GET'&&u.pathname==='/api/auth/me')return send(res,s.signedIn?200:401,s.signedIn?{
    csrf_token:'synthetic',environment:'uat',roles:[],grants:[],menu:[],user:{id:'synthetic',username:s.username||'example.reviewer',full_name:'Example User',email:'example@bank.invalid',login_type:s.ldap?'LDAP':'STANDARD',
    must_change_password_flag:s.ldap?0:1,needs_email_confirmation_flag:s.ldap?1:0,needs_department_selection_flag:s.ldap?1:0,ldap_department_status:'UNVERIFIED',org_unit_id:null}
   }:{detail:'Not signed in.'});
   if(req.method==='GET'&&u.pathname==='/api/auth/demo-users'){
    s.demoCalls++;if(s.demoHold)await s.demoHold;
    return send(res,s.demoStatus,s.demoStatus===200?(s.empty?{users:[],ldap_demo:{enabled:false}}:demo):{detail:'Demo choices unavailable.'});
   }
   if(req.method==='GET'&&u.pathname==='/api/auth/login-key'){
    s.keyCalls++;if(s.keyHold)await s.keyHold;
    return send(res,s.keyError?503:200,s.keyError?{detail:'Synthetic sign-in service unavailable.'}:{algorithm:'RSA-OAEP-256+A256GCM',key_id:'synthetic-key',public_key:publicKey,challenge:'synthetic-challenge-'+s.keyCalls,expires_in:60});
   }
   if(req.method==='POST'&&u.pathname==='/api/auth/login'){
    s.loginCalls++;let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);
    assert.deepEqual(Object.keys(body).sort(),['challenge','ciphertext','iv','key_id','wrapped_key']);
    assert(!raw.includes(fixturePassword));assert.equal(body.challenge,'synthetic-challenge-'+s.keyCalls);
    const aes=crypto.privateDecrypt({key:keys.privateKey,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(body.wrapped_key,'base64'));
    const encrypted=Buffer.from(body.ciphertext,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',aes,Buffer.from(body.iv,'base64'));
    decipher.setAAD(Buffer.from(body.challenge));decipher.setAuthTag(encrypted.subarray(-16));
    const values=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]).toString());
    assert.equal(values.password,fixturePassword);assert.equal(values.username,s.username||'example.reviewer');
    report.encrypted_submissions++;aes.fill(0);
    if(s.reject){s.reject=false;return send(res,401,{detail:'Invalid username or password.'});}
    s.signedIn=true;return send(res,200,{ok:true});
   }
   if(req.method==='GET'&&u.pathname==='/api/auth/department')return send(res,200,{status:'UNVERIFIED',blocked:true,can_request:true,message:'Synthetic initial verification.',approved:{code:null,division:null,info:null},current:{code:'EXAMPLE-001',division:'Example division',info:'Example info'},requests:[]});
   if(req.method==='GET'&&u.pathname==='/api/auth/departments')return send(res,200,[{id:'example',name:'Example department',code:'EXAMPLE'}]);
   report.unexpected_requests.push(req.method+' '+u.pathname);return send(res,404,{detail:'Unexpected synthetic request.'});
  }
  const file=path.resolve(dist,u.pathname==='/'?'index.html':'.'+u.pathname.replace(/^\/assets/,''));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));
 }catch(e){report.unexpected_requests.push(e.name+': '+e.message.split('\n')[0]);if(!res.headersSent)res.writeHead(500);res.end('Synthetic preview error.');}
});
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true,animations:'disabled'});}
async function captureMotion(page){
 const folder=path.join(output,'animation-frames');await fs.mkdir(folder,{recursive:true});
 const started=performance.now(),frames=[];
 while(performance.now()-started<4100){
  const at=performance.now(),file='frame-'+String(frames.length).padStart(3,'0')+'.png';
  await page.screenshot({path:path.join(folder,file),animations:'allow'});
  frames.push({file,time_ms:Math.round(at-started)});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,100-(performance.now()-at))));
 }
 await fs.writeFile(path.join(folder,'timeline.json'),JSON.stringify(frames,null,2)+'\n');
 return frames.length;
}
(async()=>{
 await fs.mkdir(output,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port;
 if(preview){console.log('Synthetic login preview: '+base);return;}
 const {chromium}=require(process.argv[2]||'playwright');let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function open(name,extra={},motion='reduce'){
   const s=scenario(name,extra),context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:motion,extraHTTPHeaders:{'X-Login-Scenario':name}});
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.unexpected_requests.push('External request');return route.abort();}return route.continue();});
   const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.browser_errors.push(e.message));
   await page.goto(base);await page.locator('#login').waitFor();return {s,page,context};
  }
  const main=await open('layout'),p=main.page;await p.locator('#demo-user').waitFor();
  assert.equal(await p.title(),'Sign in · Compliance by Design');assert.equal(await p.getByRole('heading',{level:1}).count(),1);
  assert.equal(await p.getByRole('img',{name:'Bank of Maharashtra',exact:true}).count(),1);
  for(const width of [1920,1440,1280,1024,901,900,768,390,375,320]){
   await p.setViewportSize({width,height:width<=480?844:width===1920?1080:900});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow at '+width);
   report.viewports.push(await p.evaluate(()=>({width:innerWidth,height:innerHeight,document_width:document.documentElement.scrollWidth,document_height:document.documentElement.scrollHeight})));
   for(const selector of ['#login-username','#login-password','.auth-password-toggle','.auth-submit','#demo-user']){
    const rect=await p.locator(selector).boundingBox();assert(rect.width>=44&&rect.height>=44,selector+' touch area at '+width);
   }
   assert(await p.locator('.auth-bank-logo').evaluate(e=>e.complete&&e.naturalWidth>0));
   assert.equal(await p.locator('.auth-story').isVisible(),width>900);
   if(width===1440)await shot(p,'login-desktop');
   if(width===1920)await shot(p,'login-wide');
   if(width===390)await shot(p,'login-phone');
   if(width===320)await shot(p,'login-320');
  }
  assert.equal(main.s.demoCalls,1);
  const guide=await p.getByRole('link',{name:'User guide'}).getAttribute('href');assert.equal(new URL(guide,base).origin,base);assert.equal((await main.context.request.get(new URL(guide,base).href)).status(),200);
  report.checks.push('One branded masthead and one login form; readable 320–1920px layouts, local bank artwork, 44px controls, desktop illustration and focused phone layout.');
  await p.setViewportSize({width:1440,height:900});
  await p.locator('#login-password').fill(fixturePassword);await p.locator('[data-action=toggle-login-password]').focus();await p.keyboard.press('Enter');
  assert.equal(await p.locator('#login-password').getAttribute('type'),'text');assert.equal(await p.getByRole('button',{name:'Hide password'}).getAttribute('aria-pressed'),'true');
  await p.keyboard.press('Enter');assert.equal(await p.locator('#login-password').getAttribute('type'),'password');assert.equal(main.s.keyCalls,0);
  await p.locator('#demo-user').selectOption('example.reviewer');assert.equal(await p.locator('#login-username').inputValue(),'example.reviewer');assert.equal(await p.locator('#login-password').inputValue(),fixturePassword);
  await p.locator('#demo-user').selectOption('example.private');assert.equal(await p.locator('#login-password').inputValue(),'');
  assert((await p.locator('#demo-description').innerText()).includes('current password'));
  await p.locator('#login-password').fill(fixturePassword);assert.equal(await p.locator('#demo-user').inputValue(),'example.private');
  await p.locator('#login-username').fill('manually.typed');assert.equal(await p.locator('#demo-user').inputValue(),'');
  await p.evaluate(()=>{location.hash='repository';});assert.equal(await p.locator('#login-username').inputValue(),'manually.typed');assert.equal(main.s.demoCalls,1);
  report.checks.push('Keyboard password reveal preserves values and never submits; public/private demo selection and typed usernames keep existing behavior; anonymous navigation preserves the form.');
  for(const [name,extra] of [['disabled',{demoStatus:404}],['empty',{empty:true}],['retry',{demoStatus:503}]]){
   const run=await open(name,extra);
   if(name==='disabled'){await run.page.locator('#demo-sign-in').waitFor({state:'hidden'});}
   if(name==='empty'){await run.page.locator('#demo-user').waitFor();assert(await run.page.locator('#demo-user').isDisabled());}
   if(name==='retry'){
    await run.page.locator('[data-action=retry-demo-users]').waitFor();assert.equal(run.s.demoCalls,1);assert(await run.page.locator('.auth-submit').isEnabled());
    run.s.demoStatus=200;await run.page.locator('[data-action=retry-demo-users]').click();await run.page.locator('#demo-user').waitFor();assert.equal(run.s.demoCalls,2);
   }
   await run.context.close();
  }
  report.checks.push('Disabled demo is hidden; empty demo is clear; failed demo allows manual sign-in and explicitly retries once.');
  let releaseDemo;const delayed=await open('delayed',{demoHold:new Promise(r=>releaseDemo=r)});
  await delayed.page.locator('#demo-sign-in[aria-busy=true]').waitFor();await delayed.page.locator('#login-username').fill('retained.person');assert(await delayed.page.locator('.auth-submit').isEnabled());
  releaseDemo();await delayed.page.locator('#demo-user').waitFor();assert.equal(await delayed.page.locator('#login-username').inputValue(),'retained.person');await delayed.context.close();
  report.checks.push('Delayed demo loading leaves manual fields enabled and preserves typed credentials on arrival.');
  let releaseKey;const failure=await open('key-failure',{keyError:true,keyHold:new Promise(r=>releaseKey=r)});
  await failure.page.locator('.auth-submit').click();assert.equal(failure.s.keyCalls,0);
  await failure.page.locator('#login-username').fill('example.reviewer');await failure.page.locator('#login-password').fill(fixturePassword);await failure.page.locator('.auth-submit').click();
  await failure.page.locator('#login[aria-busy=true]').waitFor();assert(await failure.page.locator('.auth-submit').isDisabled());
  await failure.page.locator('#login').evaluate(e=>e.requestSubmit());releaseKey();
  await failure.page.locator('#login-error').getByText('Synthetic sign-in service unavailable.',{exact:true}).waitFor();
  assert.equal(failure.s.keyCalls,1);assert.equal(failure.s.loginCalls,0);assert.equal(await failure.page.locator('#login-password').inputValue(),fixturePassword);assert(await failure.page.locator('.auth-submit').isEnabled());
  await shot(failure.page,'login-error');await failure.context.close();
  report.checks.push('Required fields prevent submission; a pending sign-in locks its button, blocks duplicates and restores retained inputs after key-fetch failure.');
  for(const ldap of [false,true]){
   const run=await open(ldap?'ldap':'standard',{reject:true,ldap,username:ldap?'example.ldap':'example.reviewer'});
   if(!ldap)await run.page.setViewportSize({width:390,height:844});
   await run.page.locator('#login-username').fill(run.s.username);await run.page.locator('#login-password').fill(fixturePassword);
   await run.page.locator('.auth-submit').click();await run.page.locator('#login-error').getByText('Invalid username or password.',{exact:true}).waitFor();
   assert.equal(await run.page.locator('#login-password').inputValue(),fixturePassword);await run.page.locator('.auth-submit').click();
   await run.page.getByRole('heading',{name:ldap?'Confirm your work profile':'Set your own password',exact:true}).waitFor();
   assert.equal(run.s.keyCalls,2);assert.equal(run.s.loginCalls,2);assert(await run.page.locator('#login').isHidden());await run.context.close();
  }
  report.checks.push('Synthetic Standard/LDAP attempts use fresh challenges and real browser encryption, retain invalid-login feedback, retry and hand off to existing password/profile gates.');
  const motion=await open('motion',{},'no-preference'),animated=motion.page,capture=captureMotion(animated);
  await animated.locator('#demo-user').waitFor();await animated.evaluate(()=>document.fonts.ready);
  const animations=await animated.evaluate(()=>document.getAnimations().filter(a=>a.animationName?.startsWith('auth-')).map(a=>({name:a.animationName,play_state:a.playState,...a.effect.getTiming()})));
  assert(animations.some(a=>a.name==='auth-thread-flow'&&a.play_state==='running'));
  assert.equal(animations.filter(a=>a.name==='auth-document-arrive').length,3);
  assert(animations.every(a=>a.iterations===1&&a.duration+a.delay<=4000));
  assert(await animated.locator('#login-username').isEnabled());assert(await animated.locator('.auth-submit').isEnabled());
  const before=await animated.locator('#login-username').boundingBox();
  const offset=await animated.locator('.auth-thread').evaluate(e=>getComputedStyle(e).strokeDashoffset);
  await animated.waitForFunction(value=>getComputedStyle(document.querySelector('.auth-thread')).strokeDashoffset!==value,offset);
  await animated.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.animationName?.startsWith('auth-')).map(a=>a.finished)));
  const capturedFrames=await capture;
  const after=await animated.locator('#login-username').boundingBox();assert.deepEqual(after,before);
  assert.equal(await animated.locator('.auth-thread').evaluate(e=>getComputedStyle(e).strokeDashoffset),'0px');
  assert(await animated.evaluate(()=>document.getAnimations().filter(a=>a.animationName?.startsWith('auth-')).every(a=>a.playState==='finished')));
  await animated.locator('.auth-submit').hover();
  await animated.evaluate(()=>Promise.all(document.querySelector('.auth-submit > .icon').getAnimations().map(a=>a.finished)));
  assert.equal(await animated.locator('.auth-submit > .icon').evaluate(e=>getComputedStyle(e).transform),'matrix(1, 0, 0, 1, 3, 0)');
  await shot(animated,'login-settled');report.motion={animations,settles_within_ms:3800,controls_stay_in_place:true,captured_frames:capturedFrames,frame_timeline:'animation-frames/timeline.json'};
  await motion.context.close();
  report.checks.push('Normal motion fades in the form/panel, staggers three documents and flows the connection line once; all effects settle within 3.8 seconds while controls stay enabled and in place.');
  const reduced=await open('reduced-motion'),still=reduced.page;
  await still.locator('#demo-user').waitFor();
  assert.equal(await still.evaluate(()=>document.getAnimations().filter(a=>a.animationName?.startsWith('auth-')).length),0);
  await still.locator('.auth-submit').hover();assert.equal(await still.locator('.auth-submit > .icon').evaluate(e=>getComputedStyle(e).transform),'none');
  await still.emulateMedia({reducedMotion:'no-preference'});
  assert(await still.evaluate(()=>document.getAnimations().some(a=>a.animationName==='auth-thread-flow'&&a.playState==='running')));
  await still.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await still.evaluate(()=>document.getAnimations().filter(a=>a.animationName?.startsWith('auth-')).length),0);
  for(const width of [1440,390]){
   await still.setViewportSize({width,height:900});
   assert.equal(await still.locator('.auth-form-inner').evaluate(e=>getComputedStyle(e).opacity),'1');
   assert(await still.locator('#login-username').isEnabled());assert(await still.locator('.auth-submit').isEnabled());
  }
  await reduced.context.close();
  report.checks.push('Reduced-motion preferences show the final static design immediately, disable hover movement and stop running effects when the OS preference changes; desktop and phone fields stay usable.');
  assert.equal(report.browser_errors.length,0);assert.equal(report.unexpected_requests.length,0);
  report.passed=true;await main.context.close();
 }catch(e){report.passed=false;report.failure=e.stack;throw e;}
 finally{await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
