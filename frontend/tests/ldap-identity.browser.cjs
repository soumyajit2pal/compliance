// Production bundle with synthetic read-only responses; no database or credentials.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'frontend/dist');
const output=path.resolve(process.env.CBD_LDAP_IDENTITY_OUTPUT||path.join(root,'outputs/ldap-division-info-2026-11-11/browser'));
const report={scope:'Production bundle; synthetic read-only responses. Oracle/LDAP not contacted.',checks:[],browser_errors:[],unexpected_requests:[],writes:[]};
const subject={id:'subject',username:'example.ldap',full_name:'Synthetic Directory User',login_type:'LDAP',active_flag:1,
  org_unit_id:'home',email:'example@example.invalid',department_code:'EXAMPLE-001',ldap_last_seen_department_code:'EXAMPLE-001',
  ldap_division:'HEAD OFFICE',ldap_last_seen_division:'BRANCH',ldap_info:'09999',ldap_last_seen_info:'00007',
  ldap_department_status:'MISMATCH',access_status:'LDAP_DEPARTMENT_CHANGED',access_status_label:'LDAP department changed',admin_action_required:true};
const request={id:'request',user_id:subject.id,username:subject.username,full_name:subject.full_name,status:'PENDING',
  previous_code:'EXAMPLE-001',proposed_code:'EXAMPLE-001',previous_division:'HEAD OFFICE',proposed_division:'BRANCH',
  previous_info:'09999',proposed_info:'00007',home_organisation:'Example Compliance',observed_at:'2026-11-11T10:00:00',
  requested_at:'2026-11-11T10:01:00',request_reason:'Synthetic directory transfer.'};
const summary=Object.fromEntries(['total','standard','ldap','active_accounts','action_required','pending_approval','role_assignment_required',
  'role_review_required','profile_pending','access_ready','password_change_required','inactive','ldap_department_required',
  'ldap_department_changed','ldap_department_unavailable','ldap_department_recheck','department_pending'].map(key=>[key,0]));
Object.assign(summary,{total:1,ldap:1,active_accounts:1,action_required:1,department_pending:1});
const masters={organisational_unit:[{id:'home',name:'Example Compliance'}],role:[{id:'reviewer',name:'Reviewer',active_flag:1}],user:[subject]};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(dist,url.pathname==='/'?'index.html':'.'+url.pathname.replace(/^\/assets/,''));
  if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
}catch{res.writeHead(404).end();}});
let browser,base;
async function setup(context,admin){await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==base){report.unexpected_requests.push(url.origin);return route.abort();}
  if(req.method()!=='GET'){report.writes.push(url.pathname);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname.slice(4);let body;
  if(p==='/auth/me')body={user:admin?{id:'admin',full_name:'Synthetic Administrator',login_type:'STANDARD'}:subject,
    csrf_token:'synthetic',environment:'uat',roles:admin?['ADMIN']:['REVIEWER'],grants:[{role_code:admin?'ADMIN':'REVIEWER',global_scope_flag:1}],
    menu:admin?[{id:'users',label:'Users & access'},{id:'ldap',label:'LDAP settings'}]:[]};
  else if(p==='/auth/department')body={status:'MISMATCH',blocked:true,message:'Your LDAP department code, division or info has changed.',
    approved:{code:subject.department_code,division:subject.ldap_division,info:subject.ldap_info},
    current:{code:subject.ldap_last_seen_department_code,division:subject.ldap_last_seen_division,info:subject.ldap_last_seen_info},
    home_organisation:'Example Compliance',can_request:true,requests:[]};
  else if(p==='/masters')body=masters;
  else if(p==='/tasks'||p==='/notifications')body=[];
  else if(p==='/admin/access-summary')body=summary;
  else if(p==='/admin/users')body={users:[subject],assignments:[{id:'grant',user_id:'subject',role_id:'reviewer',global_scope_flag:1,effective_flag:true}],summary};
  else if(p==='/admin/ldap-department-requests')body=[request];
  else if(p==='/admin/ldap')body={source:'database',enabled:false,server_uri:'',use_ssl:true,start_tls:false,
    ca_certificate_source:'system_trust',attr_full_name:'displayName',attr_email:'mail',attr_department_code:'department',
    attr_division:'division',attr_info:'info',demo:{enabled:false}};
  else {report.unexpected_requests.push(p);return route.fulfill({status:404,json:{detail:'Unexpected synthetic endpoint'}});}
  await route.fulfill({json:body});
});}
function watch(page){page.on('pageerror',e=>report.browser_errors.push(e.message));page.setDefaultTimeout(10000);}
async function fits(page,label){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label);}
(async()=>{
  await fs.mkdir(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const userContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await setup(userContext,false);
    const user=await userContext.newPage();watch(user);await user.goto(base);
    const gate=user.locator('.ldap-department-gate');await gate.waitFor();
    for(const value of ['HEAD OFFICE','BRANCH','09999','00007'])assert((await gate.innerText()).includes(value));
    assert.equal(await gate.locator('input[name=division],input[name=info],input[name=department_code]').count(),0);
    assert(await gate.getByRole('button',{name:'Request department update',exact:true}).isVisible());
    report.checks.push('User gate shows approved/current code, division and info, preserves leading zeroes and keeps directory evidence read-only.');
    for(const width of [1440,768,390,320]){await user.setViewportSize({width,height:1000});await fits(user,'Gate overflows at '+width);}
    await user.evaluate(()=>document.fonts.ready);
    await user.screenshot({path:path.join(output,'gate-320.png'),fullPage:true,animations:'disabled'});
    subject.ldap_last_seen_info='0'.repeat(2000);subject.ldap_last_seen_division='<img src=x onerror="window.ldapXss=true">';
    await user.reload();await gate.waitFor();assert.equal(await gate.locator('img').count(),0);
    assert.equal(await user.evaluate(()=>Boolean(window.ldapXss)),false);await fits(user,'Long info overflows');
    report.checks.push('User comparison fits 320–1440px, escapes LDAP markup and wraps a 2,000-character info value.');
    subject.ldap_last_seen_info='00007';subject.ldap_last_seen_division='BRANCH';
    const adminContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});await setup(adminContext,true);
    const admin=await adminContext.newPage();watch(admin);await admin.goto(base+'/#users?tab=LDAP');
    const card=admin.locator('.ldap-account-card');await card.waitFor();
    for(const value of ['HEAD OFFICE','BRANCH','09999','00007'])assert((await card.innerText()).includes(value));
    assert((await card.innerText()).includes('Application access blocked'));
    await card.getByRole('button',{name:'Review department request',exact:true}).click();
    const dialog=admin.locator('#dialog');await dialog.waitFor({state:'visible'});
    for(const value of ['HEAD OFFICE','BRANCH','09999','00007'])assert((await dialog.innerText()).includes(value));
    assert.equal(await dialog.locator('[name=reason][required]').count(),1);
    assert.equal(await dialog.locator('[name=division],[name=info],[name=department_code]').count(),0);
    await admin.setViewportSize({width:320,height:1000});await fits(admin,'Review dialog overflows');
    await admin.screenshot({path:path.join(output,'review-320.png'),animations:'disabled'});
    await dialog.locator('[data-action=close]').first().click();await dialog.waitFor({state:'hidden'});
    await fits(admin,'Account card overflows');
    await card.getByRole('button',{name:'Department history',exact:true}).click();await dialog.waitFor({state:'visible'});
    for(const value of ['HEAD OFFICE','BRANCH','09999','00007'])assert((await dialog.innerText()).includes(value));
    await dialog.locator('[data-action=close]').first().click();
    report.checks.push('Admin account, review and immutable-history displays include all three fields; review remains independent with a required reason and fits 320px.');
    await admin.goto(base+'/#users?tab=LDAP&q=00007');await card.waitFor();assert.equal(await card.count(),1);
    await admin.goto(base+'/#users?tab=LDAP&q=no-match');await card.waitFor({state:'detached'});
    await admin.goto(base+'/#ldap');
    for(const [field,value] of [['attr_department_code','department'],['attr_division','division'],['attr_info','info']]){
      const input=admin.locator('[name='+field+']');await input.waitFor();assert.equal(await input.inputValue(),value);
    }
    await fits(admin,'Settings overflow');report.checks.push('Admin search matches info values, and LDAP settings expose all three default attribute mappings.');
    assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.unexpected_requests,[]);assert.deepEqual(report.writes,[]);
    report.status='passed';
  }catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
  finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
    await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}
})();
