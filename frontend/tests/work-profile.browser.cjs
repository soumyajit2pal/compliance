// Local production-bundle checks. API responses and submissions are synthetic.
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'frontend/dist');
const output=path.resolve(process.env.CBD_WORK_PROFILE_OUTPUT||path.join(root,'outputs/work-profile-redesign-2026-11-11/browser'));
const preview=process.argv.includes('--preview');
const report={scope:'Production bundle; synthetic LDAP/profile API; no Oracle or real LDAP connection.',checks:[],browser_errors:[],unexpected_requests:[],submissions:[]};
const units=[{id:'compliance',name:'Compliance Department',code:'COMPLIANCE'},
  {id:'operations',name:'Operations Department',code:'OPERATIONS'},
  {id:'long',name:'Example Department with a long organisation name for narrow screen verification',code:'LONG'}];
const scenarios=new Map();
function scenario(key,extra={}){
  const state={confirmed:false,verified:false,roles:[],email:'',org_unit_id:null,...extra};
  scenarios.set(key,state);return state;
}
scenario('preview');
function identity(state){return {csrf_token:'synthetic',environment:'uat',roles:state.roles,grants:[],menu:[],user:{id:'synthetic',
  username:'example.user',full_name:state.name||'Example Directory User',login_type:'LDAP',email:state.email,org_unit_id:state.org_unit_id,
  department_code:state.verified?'EXAMPLE-001':null,ldap_last_seen_department_code:'EXAMPLE-001',
  ldap_division:state.verified?'HEAD OFFICE':null,ldap_last_seen_division:state.division||'HEAD OFFICE',
  ldap_info:state.verified?'09999':null,ldap_last_seen_info:state.info||'09999',
  needs_email_confirmation_flag:state.confirmed?0:1,needs_department_selection_flag:state.confirmed?0:1,
  ldap_department_status:state.verified?'VERIFIED':'UNVERIFIED'}};}
function department(state){return {status:state.verified?'VERIFIED':'UNVERIFIED',blocked:!state.verified,
  message:'Your LDAP department needs initial administrator verification.',
  approved:{code:state.verified?'EXAMPLE-001':null,division:state.verified?'HEAD OFFICE':null,info:state.verified?'09999':null},
  current:{code:'EXAMPLE-001',division:state.division||'HEAD OFFICE',info:state.info||'09999'},
  can_request:true,home_organisation:state.org_unit_id?units.find(u=>u.id===state.org_unit_id)?.name:null,
  requests:state.confirmed?[{id:'synthetic-request',status:'PENDING',proposed_code:'EXAMPLE-001',proposed_division:'HEAD OFFICE',proposed_info:'09999'}]:[]};}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  if(url.pathname.startsWith('/api/')){
   const state=scenarios.get(req.headers['x-profile-scenario'])||scenarios.get('preview');
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');let body;
   if(req.method==='GET'&&url.pathname==='/api/auth/me')body=identity(state);
   else if(req.method==='GET'&&url.pathname==='/api/auth/department')body=department(state);
   else if(req.method==='GET'&&url.pathname==='/api/auth/departments')body=units;
   else if(req.method==='GET'&&url.pathname==='/api/auth/demo-users')body={users:[],ldap_demo:{enabled:false}};
   else if(req.method==='POST'&&url.pathname==='/api/auth/onboarding'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const values=JSON.parse(raw);report.submissions.push(values);
    if(state.hold)await state.hold;
    if(state.fail){state.fail=false;res.statusCode=422;body={detail:'Choose an active Home organisation and try again.'};}
    else{Object.assign(state,values,{confirmed:true});body={ok:true,message:'Synthetic profile confirmation.'};}
   }else{report.unexpected_requests.push(req.method+' '+url.pathname);res.statusCode=404;body={detail:'Unexpected synthetic endpoint'};}
   res.end(JSON.stringify(body));return;
  }
  const file=path.resolve(dist,url.pathname==='/'?'index.html':'.'+url.pathname.replace(/^\/assets/,''));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch(error){res.writeHead(500).end('Synthetic preview error');report.unexpected_requests.push(String(error));}
});
async function listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return 'http://127.0.0.1:'+server.address().port;}
const form=page=>page.locator('#onboard');
const submit=page=>form(page).locator('button[type=submit]');
async function choose(page,text='Compliance Department'){
 const picker=form(page).getByRole('combobox',{name:'Home organisation'});await picker.fill(text);await picker.press('ArrowDown');await picker.press('Enter');
}
async function fits(page,label){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label);}
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true,animations:'disabled'});}
(async()=>{
 await fs.mkdir(output,{recursive:true});const base=await listen();
 if(preview){console.log('Synthetic profile preview: '+base);return;}
 const {chromium}=require(process.argv[2]||'playwright');let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const state=scenario('form');
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce',extraHTTPHeaders:{'X-Profile-Scenario':'form'}});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.browser_errors.push(e.message));
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.unexpected_requests.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(base);await form(page).waitFor();
  assert.equal(await page.title(),'Confirm your work profile · Compliance by Design');
  assert.equal(await page.getByRole('heading',{level:1}).innerText(),'Confirm your work profile');
  assert.equal(await page.locator('[aria-current=step]').count(),1);
  assert.equal(await page.getByText('Previously approved LDAP department details',{exact:true}).count(),0);
  for(const text of ['EXAMPLE-001','HEAD OFFICE','09999','Awaiting verification'])assert((await page.locator('.profile-directory-card').innerText()).includes(text));
  assert.equal(await form(page).locator('[name=division],[name=info],[name=department_code]').count(),0);
  await shot(page,'profile-desktop');
  for(const width of [1920,1440,1024,800,768,390,375,320]){
   await page.setViewportSize({width,height:1050});await fits(page,'Profile overflow at '+width);
   const button=await submit(page).boundingBox();assert(button.width>=44&&button.height>=44);
   const card=await page.locator('.profile-form-card').boundingBox(),directory=await page.locator('.profile-directory-card').boundingBox();
   if(width<=800)assert(directory.y>=card.y+card.height-1);
   if(width===375)await shot(page,'profile-phone');
  }
  report.checks.push('Initial onboarding shows one focused form, three read-only directory values, a current setup step and truthful pending approval; layouts fit 320–1920px.');
  await submit(page).click();assert.equal(report.submissions.length,0);
  await form(page).getByRole('textbox',{name:'Work email'}).fill('invalid');await submit(page).click();assert.equal(report.submissions.length,0);
  await form(page).getByRole('textbox',{name:'Work email'}).fill('example@bank.invalid');await submit(page).click();assert.equal(report.submissions.length,0);
  await choose(page);assert.equal(await form(page).locator('select[name=org_unit_id]').inputValue(),'compliance');
  report.checks.push('Required fields and invalid email prevent submission, and keyboard search selects the Home organisation through the existing picker.');
  state.fail=true;await submit(page).click();const error=form(page).locator('#form-error');await error.getByText('Choose an active Home organisation and try again.',{exact:true}).waitFor();
  assert.equal(await error.evaluate(e=>e===document.activeElement),true);
  assert.equal(await form(page).getByRole('textbox',{name:'Work email'}).inputValue(),'example@bank.invalid');
  assert.equal(await form(page).locator('select[name=org_unit_id]').inputValue(),'compliance');assert(await submit(page).isEnabled());
  report.checks.push('A failed confirmation focuses its inline error, retains entered email and department, and permits retry.');
  let release;state.hold=new Promise(resolve=>release=resolve);const before=report.submissions.length;
  await submit(page).click();await page.waitForFunction(()=>document.querySelector('#onboard')?.getAttribute('aria-busy')==='true');
  assert(await submit(page).isDisabled());release();await page.locator('.ldap-department-gate').waitFor();
  assert.equal(report.submissions.length,before+1);
  assert((await page.locator('.ldap-department-gate').innerText()).includes('Your request is pending administrator approval.'));
  assert.deepEqual(report.submissions,[{email:'example@bank.invalid',org_unit_id:'compliance'},{email:'example@bank.invalid',org_unit_id:'compliance'}]);
  report.checks.push('Retry sends only email and Home organisation, locks the pending form and reaches the existing administrator-verification gate.');
  const verified=scenario('verified',{verified:true,email:'existing@bank.invalid',org_unit_id:'operations'});
  const returning=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce',extraHTTPHeaders:{'X-Profile-Scenario':'verified'}});
  const other=await returning.newPage();other.on('pageerror',e=>report.browser_errors.push(e.message));await other.goto(base);await form(other).waitFor();
  assert.equal(await form(other).getByRole('textbox',{name:'Work email'}).inputValue(),'existing@bank.invalid');
  assert.equal(await form(other).locator('select[name=org_unit_id]').inputValue(),'operations');
  assert.equal(await submit(other).innerText(),'Confirm work profile');
  assert((await other.locator('.profile-directory-status').innerText()).includes('Directory details verified'));
  verified.roles=['REVIEWER'];await other.reload();await form(other).waitFor();
  assert((await other.locator('.profile-next-step').innerText()).includes('Ready after confirmation'));
  report.checks.push('Returning verified profiles retain their values and distinguish outstanding role approval from access checks already complete.');
  verified.name='<img src=x onerror="window.profileXss=true">';verified.info='0'.repeat(2000);verified.division='Long directory division '.repeat(10);
  await other.setViewportSize({width:320,height:1050});await other.reload();await form(other).waitFor();await fits(other,'Long values overflow');
  assert.equal(await other.locator('.profile-setup img').count(),0);assert.equal(await other.evaluate(()=>Boolean(window.profileXss)),false);
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.unexpected_requests,[]);
  report.checks.push('Long directory values wrap, user-supplied markup is escaped, and no browser errors, external requests or real business writes occur.');
  report.status='passed';
 }catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,groups:report.checks.length,error:report.error}));}
})();
