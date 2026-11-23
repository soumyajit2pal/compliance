// Home composition over the production bundle. Read-only synthetic API only.
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'frontend/dist'),out=path.resolve(root,process.env.CBD_HOME_OUTPUT||'outputs/home-redesign-2026-11-13/browser');
const preview=process.argv.includes('--preview'),scenarios=new Map();
const report={scope:'Production bundle; synthetic accounts, sources and tasks. No Oracle, real LDAP or live records.',checks:[],browser_errors:[],writes:[],unexpected_requests:[],viewports:[]};
function day(offset=0){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date()),d=new Date(today+'T12:00:00+05:30');d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(d);}
const roles=['ADMIN','AUTHOR','REVIEWER','APPROVER','BUSINESS_OWNER','CONTROL_OWNER','EVIDENCE_OWNER','CCO','ZONE_VIEWER'];
const units=[{id:'compliance',name:'Compliance Department',code:'COMPLIANCE'},{id:'retail',name:'Retail Banking',code:'RETAIL'}];
const domains=[{id:'kyc',name:'KYC, AML and CFT',code:'REG-KYC',active_flag:0},{id:'fraud',name:'Fraud Risk Management',code:'REG-FRAUD',active_flag:1}];
const sources=[{id:'customer',title:'Customer identification requirements',code:'EXAMPLE-CUSTOMER',regulatory_status:'CURRENT',regulatory_owner_unit_id:'compliance'},
 {id:'payments',title:'Digital payments — Operational controls',code:'EXAMPLE-PAYMENTS',regulatory_status:'CURRENT',regulatory_owner_unit_id:'compliance'},
 {id:'older',title:'Earlier customer guidance',code:'EXAMPLE-EARLIER',regulatory_status:'SUPERSEDED',regulatory_owner_unit_id:'compliance'}];
const drafts=[{id:'draft-customer',kind:'DRAFT',instrument_id:'customer',version_id:'customer-v2',title:'Complete version 2.0',due_at:null},
 {id:'draft-payments',kind:'DRAFT',instrument_id:'payments',version_id:'payments-v1',title:'Complete version 1.0',due_at:null}];
const mixed=[
 {id:'change',kind:'DECISION',workflow_kind:'OWNERSHIP_CHANGE',obligation_id:'obligation-1',ownership_change_id:'change-1',title:'Confirm the proposed business owner',code:'EXAMPLE-OBL',instrument_id:'customer',due_at:day(-2)+'T12:00:00'},
 {id:'review',kind:'DECISION',stage:'COMPLIANCE_REVIEW',instrument_id:'customer',version_id:'customer-v2',title:'Review source edition',due_at:day(1)+'T12:00:00'},
 {id:'family',kind:'DECISION',workflow_kind:'FAMILY',instrument_id:'payments',proposal_id:'proposal-1',title:'Review family proposal',due_at:day(7)+'T12:00:00'},
 {id:'owner',kind:'DECISION',workflow_kind:'OBLIGATION',obligation_id:'obligation-2',instrument_id:'customer',title:'Accept the named control responsibility',code:'EXAMPLE-OBL2',due_at:day(8)+'T12:00:00'},
 {id:'correction',kind:'DECISION',workflow_kind:'METADATA_CORRECTION',instrument_id:'customer',correction_id:'correction-1',title:'Review correction',due_at:day(12)+'T12:00:00'},drafts[0]];
const users=[{id:'one',full_name:'Example Administrator',username:'example.admin',active_flag:1,login_type:'STANDARD'},
 {id:'two',full_name:'Example Directory User',username:'example.directory',active_flag:1,login_type:'LDAP'},
 {id:'three',full_name:'Example Retired Account',username:'example.retired',active_flag:0,login_type:'STANDARD'}];
const common=['home','tasks','approvals','help','applications','approval-workflow-log'];
const library=['repository','notification-families','clauses','clause-relationships','obligations','applicability','accountability','controls','control-mappings','evidence','delegations'];
sources.forEach((r,i)=>r.regulator_id=i===1?'sebi':'rbi');
const auditEntry={id:'audit-newest',when:'2026-11-19T05:05:00Z',actor:'Compliance Reviewer',represented:'Named Colleague',
 record_type:'Evidence',record_code:'EVD-TEST-001',record_id:'evidence-entry',record_title:'Periodic proof',
 event:'Evidence accepted for the submission',department:'Retail Banking',stage:'Evidence review',next_stage:'Accepted',
 decision:'Accepted',changes:[{field:'Decision',from:'Submitted',to:'Accepted'}]};
const olderAuditEntry={...auditEntry,id:'audit-older',actor:'Final Approver',record_type:'Work item',record_code:'ACT-TEST-001',
 event:'Internal target extended',changes:[{field:'Current internal target',from:'2026-11-01',to:'2026-11-10'}]};
const adminAuditEntry={...auditEntry,id:'audit-access-change',actor:'System Administrator',represented:null,
 record_type:'User account',record_code:'example.user',record_id:'synthetic',record_title:'Example User',
 event:'Access updated',group:'Access change',changes:[]};
const requestAuditEntry={...adminAuditEntry,id:'request-audit-fixture',record_type:'Portal request',record_code:null,record_title:null,
 actor:'Regulatory Author',actor_username:'example.author',group:'Access',event:'API read',outcome:'Failed',
 request_method:'GET',request_route:'/api/instruments',http_status:403,client_ip:'192.0.2.33'};
const auditReason='Reviewed the original evidence <img src=x onerror=alert(1)>.';
function scenario(name,extra={}){const s={roles:['AUTHOR'],name:'Regulatory Author',tasks:structuredClone(drafts),sources:structuredClone(sources),users:structuredClone(users),summary:{action_required:2,profile_pending:1},requests:[],...extra};scenarios.set(name,s);return s;}
scenario('preview');
function identity(s){const admin=s.roles.every(r=>r==='ADMIN'),menu=s.menu||[...common,...(admin?['users','masters','ldap']:[...library,'migration','actions','team','library']),...(s.roles.includes('ADMIN')?['audit-trail']:[])];
 return {user:{id:'synthetic',full_name:s.name,username:'example.user',org_unit_id:s.scoped?'retail':'compliance',email:'example@bank.invalid',login_type:'STANDARD',must_change_password_flag:0,needs_email_confirmation_flag:0,needs_department_selection_flag:0,...s.user},csrf_token:'synthetic',environment:'uat',roles:s.roles,
 grants:s.roles.map(role=>({role_code:role,global_scope_flag:s.scoped?0:1,scope_org_unit_id:s.scoped?'retail':null})),menu:menu.map(id=>({id,label:id})),acting_for:s.actingFor,actual_user:s.actualUser};}
function measures(view,query){
  const keys=['instruments','obligations','applicable','high','owners','content','open','overdue','upcoming','evidence','gaps',
    'reviews','regulatory','control_coverage','control_reviews','control_results','approval','work_review','portfolio','due_30'];
  if(query.get('audience')==='cco')keys.push(...Object.keys(ccoMeasures));
  const inScope=row=>!query.get('department')||row.department===query.get('department');
  return Object.fromEntries(keys.map(key=>{
    const value=view.metrics?.[key];
    const records=(value?.records||[]).filter(inScope);
    return [key,{label:value?.label||key,definition:value?.definition||'Synthetic '+key,count:records.length,records,population_hash:'synthetic'}];
  }));
}
const activeObligation={kind:'Obligation',id:'active',title:'Review onboarding instructions',department:'retail',domain:'kyc',criticality:'CRITICAL',active:true,status:'ACTIVE',path:'obligations/active'};
const pendingObligation={kind:'Obligation',id:'pending',title:'Confirm reporting obligations',department:'compliance',domain:'fraud',criticality:'HIGH',active:false,status:'DRAFT',stage:'BUSINESS_VALIDATION',path:'obligations/pending'};
const overdueWork={kind:'Action',id:'open',title:'Review the due evidence',department:'retail',status:'OPEN',code:'TEST-001',date:day(-1),original_due_date:day(-2),overdue:true,path:'actions/open'};
const proofPending={kind:'Evidence',id:'proof',title:'Review the period evidence',department:'retail',status:'SUBMITTED',path:'actions/open?evidence=proof'};
const dashboardMeasures={
  control_reviews:{label:'Check reviews due',records:[]},
  control_results:{label:'Check results needing correction',records:[]},
  obligations:{label:'Active approved obligations',records:[activeObligation]},
  portfolio:{label:'Current obligation records',records:[activeObligation,pendingObligation]},
  owners:{label:'Pending owner validation',records:[pendingObligation]},
  content:{label:'Content validation pending',records:[pendingObligation]},
  evidence:{label:'Evidence awaiting review',records:[proofPending]},
  open:{label:'Open actions',definition:'Shows work that is open, in progress or awaiting review.',records:[overdueWork]},
  overdue:{label:'Overdue actions',records:[overdueWork]},
  due_30:{label:'Actions due in 30 days',records:[
    {...overdueWork,id:'due-soon',path:'actions/due-soon',title:'Review the next action',date:day(12),original_due_date:day(12),overdue:false},
  ]},
};
const ccoMeasures={
  portfolio_high:{label:'Current high or critical obligations',definition:'Current obligations rated high or critical, including drafts and proposals under review.',records:[activeObligation,pendingObligation]},
  high_owner_validation:{label:'High or critical obligations awaiting owner validation',records:[pendingObligation]},
  escalated:{label:'Escalated actions',records:[overdueWork]},
  no_business_owner:{label:'Obligations without a business owner',records:[]},
  no_evidence_definition:{label:'Obligations without an evidence definition',records:[]},
  no_linked_checks:{label:'Active obligations without linked checks',records:[activeObligation]},
  unapproved_non_applicability:{label:'Unapproved non-applicability',records:[]},
  extended_due_date:{label:'Actions with extended due dates',records:[overdueWork]},
};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),s=scenarios.get(req.headers['x-home-case'])||scenarios.get('preview');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(u.pathname.startsWith('/api/')){
  s.requests.push(req.method+' '+u.pathname);
  if(req.method!=='GET'){report.writes.push(req.method+' '+u.pathname);res.writeHead(405).end();return;}
  let body,status=200;
  if(u.pathname==='/api/auth/me')body=identity(s);
  else if(u.pathname==='/api/auth/employee-profile')body=s.employeeProfile;
  else if(u.pathname==='/api/masters')body={organisational_unit:units,regulatory_domain:domains,instrument_type:[],role:roles.map(code=>({id:code,code,name:code,active_flag:1})),user:users,regulator:[{id:'rbi',code:'RBI',name:'Reserve Bank of India'},{id:'sebi',code:'SEBI',name:'Securities and Exchange Board of India'}]};
  else if(u.pathname==='/api/tasks')body=s.tasks;
  else if(u.pathname==='/api/actions')body=[];
  else if(u.pathname==='/api/notifications')body=[];
  else if(['/api/controls','/api/control-mappings','/api/evidence-library','/api/delegations'].includes(u.pathname))body=[];
  else if(u.pathname==='/api/team-overview')body={generated_at:new Date().toISOString(),business_date:day(),timezone:'Asia/Kolkata',
    filters:{},delivery:{scheduler_enabled:false},date_semantics:'Synthetic current authorised population',
    metrics:measures(s,u.searchParams),evidence_status:s.evidenceStatus,scope_counts:s.scopeCounts};
  else if(u.pathname==='/api/audit-trail'){
    const rows=u.searchParams.get('audit_outcome')==='failed'?[requestAuditEntry]:[requestAuditEntry,adminAuditEntry];
    body={items:rows,types:[{id:'administration',name:'Administration'}],older:null,newer:null,
      summary:{total:2,authentication:0,access_changes:1,failed:1},event_types:[{id:'requests',name:'API requests'}]};
  }
  else if(u.pathname==='/api/approval-workflow-log'){
    const requested=u.searchParams.get('q')?.toLowerCase()||'';
    const older=u.searchParams.has('older');
    const noBusinessRoles=s.roles.every(role=>role==='ADMIN');
    const rows=(noBusinessRoles?[]:[older?olderAuditEntry:auditEntry])
      .filter(row=>!requested||JSON.stringify(row).toLowerCase().includes(requested));
    body={items:rows,types:[{id:'evidence',name:'Evidence'},{id:'work',name:'Compliance work'}],
      older:!noBusinessRoles&&!older&&!requested?'first-page':null,newer:older?'second-page':null,
      departments:[{id:'retail',name:'Retail Banking'}],stages:[{id:'EVIDENCE_REVIEW',name:'Evidence review'}],
      decisions:[{id:'ACCEPT',name:'Accepted'}]};
  }
  else if(u.pathname==='/api/approval-workflow-log/audit-newest')body={...auditEntry,reason:auditReason,path:'evidence/evidence-entry'};
  else if(u.pathname==='/api/audit-trail/audit-access-change')body={...adminAuditEntry,reason:null,path:'users?tab=STANDARD&q=example.user'};
  else if(u.pathname==='/api/audit-trail/request-audit-fixture')body={...requestAuditEntry,reason:null,path:null,
    request_id:'correlation-value',user_agent:'Example Browser',actor_roles:['AUTHOR'],duration_ms:24.6};
  else if(u.pathname==='/api/approval-workflow-log/export'){
    s.auditExport=Object.fromEntries(u.searchParams);
    res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="compliance-approval-workflow-log.csv"'}).end('Entry\nEVD-TEST-001\n');
    return;
  }

  else if(u.pathname==='/api/obligations')body={items:[],pagination:{page:1,page_size:25,total:0,total_pages:0,start:0,end:0}};
  else if(u.pathname==='/api/applications')body=[{id:'qa-link',code:'QA',name:'Example application',active_flag:0,configured:false,description:''}];
  else if(['/api/applicability','/api/accountability','/api/obligation-applicability','/api/obligation-accountability'].includes(u.pathname))body={items:[],pagination:{page:1,page_size:25,total:0,total_pages:0,start:0,end:0},summary:{},counts:{obligations:0,records:0,assessments:0,unassessed:0,assignments:0,missing:0}};
  else if(u.pathname==='/api/admin/access-summary')body=s.summary;
  else if(u.pathname==='/api/admin/users')body={users:s.users};
  else if(u.pathname==='/api/instruments'){
    if(s.denied){status=403;body={detail:'The source list is outside your current scope.'};}
    else if(s.libraryDashboard&&u.searchParams.has('page')){
      const rows=s.sources.filter(row=>!u.searchParams.has('library_stage')||u.searchParams.get('library_stage')===(row.regulatory_status==='CURRENT'?'current':'retained'));
      body={items:rows,pagination:{page:1,page_size:25,total:rows.length,total_pages:1,start:1,end:rows.length},library_counts:{current:2,retained:1}};
    }else body=s.sources;
  }
  else{report.unexpected_requests.push(req.method+' '+u.pathname);status=404;body={detail:'Unexpected synthetic endpoint.'};}
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(body));return;
 }
 const file=path.resolve(dist,u.pathname==='/'?'index.html':'.'+u.pathname.replace(/^\/assets/,''));
 if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));
}catch(e){report.unexpected_requests.push(e.message);res.writeHead(500).end('Synthetic preview failure.');}});
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});}
const metrics=page=>page.locator('.home-metrics .portal-stat strong').allTextContents();
(async()=>{
 await fs.mkdir(out,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const base='http://127.0.0.1:'+server.address().port;
 if(preview){console.log('Synthetic Home preview: '+base);return;}
 const {chromium}=require(process.argv[2]||'playwright');let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function open(name,extra={},options={}){
   const s=scenario(name,extra),context=await browser.newContext({viewport:{width:1440,height:1050},timezoneId:'Asia/Kolkata',reducedMotion:'reduce',extraHTTPHeaders:{'X-Home-Case':name},...options});
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.unexpected_requests.push('External request');return route.abort();}return route.continue();});
   const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.browser_errors.push(e.message));await page.goto(base);await page.locator('.home-dashboard').waitFor();return {s,page,context};
  }
  const author=await open('author'),p=author.page;
  assert.equal(await p.locator('.home-metrics .dashboard-info-button').count(),3);
  assert.equal(await p.locator('.home-action-frame .dashboard-info-button').count(),3);
  await p.getByRole('button',{name:'About Due in the next 7 days',exact:true}).hover();
  await p.getByRole('tooltip').getByText('Counts your assignments with a due date from today through seven days from today, inclusive.',{exact:true}).waitFor();
  await p.keyboard.press('Escape');
  assert.equal(await p.getByRole('tooltip').count(),0);
  assert.deepEqual(await p.locator('.portal-primary-nav>.nav-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),['#home']);
  assert.equal(await p.locator('.portal-primary-nav a[href="#team"],.portal-primary-nav a[href="#library"]').count(),0);
  const regulations=p.locator('.portal-nav-group').filter({has:p.locator('summary').filter({hasText:'Regulations'})});
  assert.deepEqual(await regulations.locator('.nav-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),['#repository','#notification-families','#clauses','#clause-relationships','#obligations','#obligations?view=applicability','#obligations?view=accountability']);
  assert.equal(await p.getByRole('link',{name:'Team overview',exact:true}).count(),1);
  report.checks.push('With full Week 5 menu permissions, the default page remains Home and the sidebar follows the supplied grouping, keeps separate applicability/accountability destinations and retains Administration. My tasks contains the existing decision shortcut; reporting links use existing authorised data.');
  assert.deepEqual(await metrics(p),['2','0','0']);assert.equal(await p.getByRole('heading',{level:1}).count(),1);
  assert.equal(await p.locator('.home-primary').getAttribute('href'),'#repository/customer?version=customer-v2&tab=workflow');
  assert.equal(await p.locator('.home-work-item').count(),2);assert.equal(await p.locator('.home-action').count(),3);
  assert.equal(await p.locator('.home-actions a[href="#repository/new"]').count(),1);assert.equal(await p.locator('.home-journey a').count(),3);
  for(const width of [1920,1440,1280,1100,1050,1024,900,768,760,390,375,320]){
   await p.setViewportSize({width,height:1050});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow at '+width);
   assert(await p.locator('.home-dashboard,.home-priority,.home-panel,.home-guidance,.home-metrics').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),'Panel overflow at '+width);
   const primary=await p.locator('.home-primary').boundingBox();assert(primary.height>=44&&primary.width>=44);
   assert.equal(await p.locator('.home-dashboard').count(),1);assert.equal(await p.locator('h1').count(),1);
   if(width===1440)await shot(p,'home-author-desktop');if(width===390){await p.getByRole('button',{name:'Open navigation',exact:true}).click();assert(await p.locator('#portal-sidebar').evaluate(e=>e.classList.contains('open')));await p.locator('.portal-nav-close').click();assert.equal(await p.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false');await shot(p,'home-phone');await p.screenshot({path:path.join(out,'home-phone-viewport.png'),fullPage:false});await p.evaluate(()=>scrollTo(0,1000));await p.screenshot({path:path.join(out,'home-phone-scroll.png'),fullPage:false});await p.evaluate(()=>scrollTo(0,0));}if(width===320)await shot(p,'home-320');
   report.viewports.push(width);
  }
  await p.locator('.home-primary').focus();await p.keyboard.press('Tab');assert(await p.locator('.home-metrics .portal-stat').first().evaluate(e=>e===document.activeElement));
  assert.equal(author.s.requests.filter(x=>x==='GET /api/instruments').length,1);
  report.checks.push('Author uses the existing two source-preparation tasks, truthful 2/0/0 totals, an exact-edition primary link and role-specific quick actions; layouts and controls fit 320–1920px, with working mobile navigation and keyboard traversal.');
  await p.setViewportSize({width:1440,height:1050});
  const workGroup=p.locator('.portal-nav-group').filter({has:p.locator('summary').filter({hasText:'Work and evidence'})});
  if(await workGroup.getAttribute('open')===null)await workGroup.locator('summary').click();
  await workGroup.getByRole('link',{name:'Compliance work tracker',exact:true}).click();
  await p.getByRole('heading',{name:'Compliance work tracker',exact:true}).waitFor();
  assert.equal(await workGroup.getAttribute('open'),'');
  assert.equal(await workGroup.locator('a[aria-current="page"]').getAttribute('href'),'#actions');
  assert.equal(await p.locator('.portal-primary-nav a[aria-current="page"]').count(),0);
  assert.equal(await p.locator('.breadcrumb strong').innerText(),'Compliance work tracker');
  for(const width of [1440,390,320]){
   await p.setViewportSize({width,height:1050});
   if(width<768)await p.getByRole('button',{name:'Open navigation',exact:true}).click();
   assert(await workGroup.getByRole('link',{name:'Compliance work tracker',exact:true}).isVisible());
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Actions navigation overflow '+width);
   await shot(p,'actions-menu-'+width);
   if(width<768)await p.locator('.portal-nav-close').click();
  }
  await p.setViewportSize({width:1440,height:1050});await workGroup.locator('summary').focus();await p.keyboard.press('Enter');
  assert(!(await workGroup.getByRole('link',{name:'Compliance work tracker',exact:true}).isVisible()));await p.keyboard.press('Enter');
  assert(await workGroup.getByRole('link',{name:'Compliance work tracker',exact:true}).isVisible());
  report.checks.push('Work and evidence is a separate collapsible group with the clock-icon Compliance work tracker entry. Opening the register expands the group, highlights only its action entry, preserves the original primary menu and works by keyboard and at desktop/phone widths.');

  for(const [destination,label,active] of [['controls','Checks and procedures','#controls'],['control-mappings','Obligation links','#controls'],['evidence','Evidence library','#evidence'],['delegations','Delegation','#delegations'],['team?audience=operational','Operational dashboard','#team?audience=operational'],['team?audience=department','Department dashboard','#team?audience=department'],['tasks?queue=rbi','RBI notification workflow','#tasks?queue=rbi'],['obligations?view=applicability','Applicability','#obligations?view=applicability'],['obligations?view=accountability','Accountability','#obligations?view=accountability'],['obligations?tab=reports','Obligation exception reports','#obligations?tab=reports']]){
   await p.goto(base+'/#'+destination);await p.getByRole('heading',{name:label,level:1,exact:true}).waitFor();assert.equal(await p.locator('.nav-item[aria-current="page"]').count(),1);assert.equal(await p.locator('.nav-item[aria-current="page"]').getAttribute('href'),active);
   if(destination==='team?audience=operational'){
    await p.getByText('Select a count to see the records you can follow up on.',{exact:false}).waitFor();
    await p.getByRole('heading',{name:'Obligations by department',exact:true}).waitFor();
    await p.getByRole('heading',{name:'Needs your attention',exact:true}).waitFor();
    await p.getByText('No obligations match these filters.',{exact:true}).waitFor();
    await p.getByText('No records need follow-up for these filters.',{exact:true}).waitFor();
   }
   if(destination==='obligations?tab=reports'){
    await p.getByText('Exceptions are obligations that need attention.',{exact:false}).waitFor();
    assert.equal(await p.locator('.obligation-exception-cards .dashboard-info-button').count(),9);
   }
   if(['controls','control-mappings'].includes(destination))assert.equal(await p.title(),label+' · Compliance by Design');
   if(destination==='control-mappings'){assert.equal(await p.locator('nav[aria-label="Checks and obligation links"] a[href="#controls"]').count(),1);assert.equal(await p.locator('nav[aria-label="Checks and obligation links"] a[href="#control-mappings"]').count(),1);}
  }
  await shot(p,'reference-navigation');
  await p.goto(base+'/#tasks?queue=rbi');
  const guide=p.locator('.rbi-workflow');
  await guide.getByRole('heading',{name:'RBI notification workflow',level:1,exact:true}).waitFor();
  assert.deepEqual(await guide.getByRole('heading',{level:2}).allTextContents(),[
   'Register the notification','Capture the edition and clauses','Review and approve the source',
   'Create obligations from approved clauses','Assign ownership and confirm responsibilities',
   'Assess applicability and record the decision','Assign work and review period evidence',
  ]);
  assert.deepEqual(await guide.getByRole('link').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),[
   '#tasks?queue=rbi&view=assignments','#repository/new','#notification-families','#repository?regulator_id=rbi',
   '#approvals?queue=rbi','#obligations/new','#obligations?view=accountability','#obligations?view=applicability','#actions','#evidence',
  ]);
  assert.equal(await p.locator('#main-content .data-table').count(),0);
  for(const width of [1440,768,390,320]){
   await p.setViewportSize({width,height:900});
   assert(await guide.evaluate(node=>node.scrollWidth<=node.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1),'RBI workflow overflow at '+width);
   if(width===1440||width===390)await shot(p,width===1440?'rbi-workflow':'rbi-workflow-mobile');
  }
  await p.setViewportSize({width:1440,height:1050});
  await guide.getByRole('link',{name:'My RBI assignments',exact:true}).click();
  await p.getByRole('heading',{name:'My RBI assignments',level:1,exact:true}).waitFor();
  assert.equal(await p.locator('.nav-item[aria-current="page"]').getAttribute('href'),'#tasks?queue=rbi');
  const assignments=p.locator('#main-content .data-table');
  await assignments.getByText('Customer identification requirements',{exact:true}).waitFor();
  assert.equal(await assignments.getByText('Digital payments — Operational controls',{exact:true}).count(),0);
  await p.getByRole('link',{name:'RBI workflow guide',exact:true}).click();
  await guide.waitFor();
  await p.goto(base+'/#tasks?queue=rbi&tab=draft');
  await p.getByRole('heading',{name:'My RBI assignments',level:1,exact:true}).waitFor();
  await assignments.getByText('Customer identification requirements',{exact:true}).waitFor();
  assert.equal(await p.locator('#main-content form input[name=view]').inputValue(),'assignments');
  const reviewer=await open('rbi-reviewer',{roles:['REVIEWER'],tasks:structuredClone(mixed)});
  const reviewerGuide=reviewer.page.locator('.rbi-workflow');
  await reviewer.page.goto(base+'/#tasks?queue=rbi');
  await reviewerGuide.getByRole('link',{name:'Browse clauses',exact:true}).waitFor();
  assert.equal(await reviewerGuide.locator('a[href="#repository/new"],a[href="#obligations/new"]').count(),0);
  await reviewerGuide.getByRole('link',{name:'My RBI decisions',exact:true}).click();
  await reviewer.page.getByRole('heading',{name:'My RBI decisions',level:1,exact:true}).waitFor();
  assert.equal(await reviewer.page.locator('.nav-item[aria-current="page"]').getAttribute('href'),'#tasks?queue=rbi');
  const decisions=reviewer.page.locator('#main-content .data-table');
  await decisions.getByRole('link',{name:'Open Compliance review',exact:true}).waitFor();
  assert.equal(await decisions.locator('tbody tr').count(),4);
  assert.equal(await decisions.getByText('Digital payments — Operational controls',{exact:true}).count(),0);
  await reviewer.context.close();
  const technicalAdmin=await open('rbi-admin',{roles:['ADMIN'],tasks:[]});
  for(const destination of ['tasks?queue=rbi','approvals?queue=rbi']){
   await technicalAdmin.page.goto(base+'/#'+destination);
   await technicalAdmin.page.locator('.access-boundary').waitFor();
   assert.equal(await technicalAdmin.page.locator('.rbi-workflow').count(),0);
  }
  assert.equal(technicalAdmin.s.requests.filter(request=>request.startsWith('GET /api/instruments')).length,0);
  await technicalAdmin.context.close();
  report.checks.push('RBI workflow shows seven responsive steps and role-appropriate links. Named RBI assignments and decisions match the RBI regulator reference. Old filtered task links still work, and direct routes deny access without the library permission.');
  const stable=await open('stable-navigation'),np=stable.page;
  await np.setViewportSize({width:1280,height:700});
  const reg=np.locator('[data-nav-group=regulations]'),nav=np.locator('#portal-sidebar .nav-scroll');
  await reg.locator('summary').click();assert.equal(await reg.getAttribute('open'),null);
  await np.locator('.nav-item[href="#actions"]').click();await np.getByRole('heading',{name:'Compliance work tracker',level:1,exact:true}).waitFor();
  assert.equal(await reg.getAttribute('open'),null,'A collapsed unrelated group reopened after navigation.');
  await np.locator('.nav-item[href="#team?audience=department"]').evaluate(link=>link.addEventListener('click',()=>{window.navBeforeClick=document.querySelector('#portal-sidebar .nav-scroll').scrollTop;},{once:true}));
  await np.locator('.nav-item[href="#team?audience=department"]').click();await np.getByRole('heading',{name:'Department dashboard',level:1,exact:true}).waitFor();
  assert.equal(await reg.getAttribute('open'),null);
  assert(await nav.evaluate(el=>Math.abs(el.scrollTop-window.navBeforeClick)<=1),'Sidebar scroll position reset during navigation.');
  const refreshed=np.waitForResponse(r=>new URL(r.url()).pathname==='/api/team-overview');await np.locator('.nav-item[href="#team?audience=department"]').click();await refreshed;
  await np.locator('.nav-item[href="#controls"]').click();await np.getByRole('heading',{name:'Checks and procedures',level:1,exact:true}).waitFor();
  await np.locator('#main-content nav.tabs a[href="#control-mappings"]').click();await np.getByRole('heading',{name:'Obligation links',level:1,exact:true}).waitFor();assert.equal(await np.title(),'Obligation links · Compliance by Design');
  await np.goBack();await np.getByRole('heading',{name:'Checks and procedures',level:1,exact:true}).waitFor();
  await np.goForward();await np.getByRole('heading',{name:'Obligation links',level:1,exact:true}).waitFor();
  assert.equal(await np.locator('.nav-item[aria-current="page"]').getAttribute('href'),'#controls');
  report.checks.push('Real sidebar/tab clicks preserve collapsed sections and scroll position, refresh the current destination, keep correct renamed browser titles and restore matching screens through Back/Forward.');
  await np.locator('.nav-item[href="#obligations?tab=reports"]').click();await np.getByRole('heading',{name:'Obligation exception reports',level:1,exact:true}).waitFor();assert.equal(await np.locator('.obligation-workspace-tabs').count(),0);
  await reg.locator('summary').click();
  await np.locator('.nav-item[href="#obligations?view=applicability"]').click();await np.getByRole('heading',{name:'Applicability',level:1,exact:true}).waitFor();
  await np.locator('.obligation-workspace-tabs a[aria-label=Accountability]').click();await np.getByRole('heading',{name:'Accountability',level:1,exact:true}).waitFor();
  assert.equal(await np.locator('.obligation-workspace-tabs a[aria-label=Register]').getAttribute('href'),'#obligations');
  await np.locator('.obligation-workspace-tabs a[aria-label=Register]').click();await np.getByRole('heading',{name:'Obligations',level:1,exact:true}).waitFor();
  assert.equal(await np.locator('.nav-item[aria-current="page"]').getAttribute('href'),'#obligations');
  report.checks.push('Exception reports is a standalone sidebar destination. Register, Applicability and Accountability remain linked from the Regulations workspace.');
  await np.setViewportSize({width:390,height:844});
  await np.getByRole('button',{name:'Open navigation',exact:true}).click();await np.locator('.nav-item[href="#obligations"]').click();
  assert.equal(await np.locator('#portal-sidebar.open').count(),0);assert.equal(await np.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false');
  await np.getByRole('button',{name:'Open navigation',exact:true}).click();await np.locator('.nav-item[href="#evidence"]').click();await np.getByRole('heading',{name:'Evidence library',level:1,exact:true}).waitFor();
  assert.equal(await np.locator('#portal-sidebar.open').count(),0);
  await np.getByRole('button',{name:'Open navigation',exact:true}).click();await np.keyboard.press('Escape');assert.equal(await np.locator('#portal-sidebar.open').count(),0);
  await shot(np,'stable-navigation-phone');await stable.context.close();
  report.checks.push('Mobile navigation closes for both the current link and a different link, updates aria-expanded and remains operable after Escape.');

  const deniedCco=await open('denied-cco');await deniedCco.page.goto(base+'/#team?audience=cco');await deniedCco.page.locator('.access-boundary').waitFor();assert(!deniedCco.s.requests.some(r=>r.endsWith('/api/team-overview')));await deniedCco.context.close();
  const auditCco=await open('audit-cco',{roles:['CCO'],tasks:[]}),auditPage=auditCco.page;
  assert.equal(await auditPage.locator('.nav-item[href="#audit-trail"]').count(),0);
  await auditPage.goto(base+'/#audit-trail');await auditPage.locator('.access-boundary').waitFor();
  assert(!auditCco.s.requests.some(request=>request.endsWith('/api/audit-trail')));
  const auditNav=auditPage.locator('[data-nav-group="reports"] a[href="#approval-workflow-log"]');
  await auditNav.click();
  const auditTrail=auditPage.locator('.audit-trail');
  await auditTrail.getByRole('heading',{name:'Approval Workflow Log',level:1,exact:true}).waitFor();
  assert.equal(await auditNav.getAttribute('aria-current'),'page');
  assert.equal(await auditTrail.getByRole('button',{name:'Export CSV'}).count(),1);
  await auditTrail.getByText('10:35',{exact:false}).first().waitFor();
  const details=auditTrail.getByRole('button',{name:'Details for Evidence accepted for the submission · EVD-TEST-001'});
  await details.click();
  const auditDialog=auditPage.getByRole('dialog');
  await auditDialog.getByText(auditReason,{exact:true}).waitFor();
  await auditDialog.getByText('Named Colleague',{exact:true}).waitFor();
  await auditDialog.getByText('Evidence review',{exact:true}).waitFor();
  assert.equal(await auditDialog.getByText('Client IP',{exact:true}).count(),0);
  assert.equal(await auditDialog.locator('img').count(),0);
  assert.equal(await auditDialog.getByRole('link',{name:'Open record'}).getAttribute('href'),'#evidence/evidence-entry');
  await auditPage.keyboard.press('Escape');
  await auditDialog.waitFor({state:'hidden'});
  assert(await details.evaluate(node=>document.activeElement===node));
  await auditTrail.getByRole('link',{name:'Next page'}).click();
  await auditTrail.getByText('Internal target extended',{exact:true}).waitFor();
  await auditTrail.getByRole('link',{name:'Previous page'}).click();
  await details.waitFor();
  await auditTrail.getByRole('searchbox',{name:'Search',exact:true}).fill('EVD-TEST');
  await auditTrail.getByRole('button',{name:'Apply filters'}).click();
  await auditTrail.locator('[data-action=audit-export][data-url$="q=EVD-TEST"]').waitFor();
  assert.equal(await auditTrail.getByRole('link',{name:'Next page'}).count(),0);
  const download = auditPage.waitForEvent('download');
  await auditTrail.getByRole('button',{name:'Export CSV'}).click();
  assert.equal((await download).suggestedFilename(),'compliance-approval-workflow-log.csv');
  assert.deepEqual(auditCco.s.auditExport,{q:'EVD-TEST'});
  for(const width of [1440,768,390,320]){
   await auditPage.setViewportSize({width,height:940});
   assert(await auditPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Audit trail overflow at '+width);
   if(width===1440||width===390)await shot(auditPage,width===1440?'approval-workflow-log':'approval-workflow-log-phone');
  }
  await auditTrail.getByRole('searchbox',{name:'Search',exact:true}).fill('absent audit row');
  await auditTrail.getByRole('button',{name:'Apply filters'}).click();
  await auditTrail.getByText('No workflow entries match this view.',{exact:true}).waitFor();
  assert.equal(await auditTrail.getByRole('button',{name:'Export CSV'}).count(),0);
  await auditCco.context.close();
  const auditAdmin=await open('audit-admin',{roles:['ADMIN'],tasks:[]});
  await auditAdmin.page.locator('[data-nav-group="reports"] a[href="#audit-trail"]').click();
  const adminTrail=auditAdmin.page.locator('.audit-trail');
  await adminTrail.getByRole('heading',{name:'Audit Log',level:1,exact:true}).waitFor();
  await adminTrail.getByRole('button',{name:'Details for Access updated · example.user'}).click();
  await auditAdmin.page.getByRole('dialog').getByRole('heading',{name:'Audit entry',exact:true}).waitFor();
  assert.equal(await auditAdmin.page.getByRole('link',{name:'Open record'}).getAttribute('href'),'#users?tab=STANDARD&q=example.user');
  assert.equal(await auditAdmin.page.locator('.nav-item[href="#team?audience=cco"]').count(),0);
  await auditAdmin.page.keyboard.press('Escape');
  await adminTrail.getByRole('link',{name:'Failed events 1'}).click();
  await adminTrail.getByText('Showing 1 entry',{exact:true}).waitFor();
  await adminTrail.getByText('192.0.2.33',{exact:true}).waitFor();
  await adminTrail.getByRole('button',{name:'Details for API read'}).click();
  const requestDetail=auditAdmin.page.getByRole('dialog');
  await requestDetail.getByText('correlation-value',{exact:true}).waitFor();
  await requestDetail.getByText('Example Browser',{exact:true}).waitFor();
  await requestDetail.getByText('Failed · 403',{exact:true}).waitFor();
  await auditAdmin.page.keyboard.press('Escape');
  for (const width of [1440,768,390,320]){
    await auditAdmin.page.setViewportSize({width,height:940});
    assert(await auditAdmin.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Admin audit overflow at '+width);
    assert(await adminTrail.locator('.audit-metric').evaluateAll(cards=>cards[0].offsetTop===cards[1].offsetTop),'Audit metric alignment at '+width);
    if(width===1440||width===390)await shot(auditAdmin.page,width===1440?'admin-audit-trail':'admin-audit-trail-phone');
  }
  await auditAdmin.page.goto(base+'/#approval-workflow-log');
  await auditAdmin.page.getByText('No workflow entries match this view.',{exact:true}).waitFor();
  await auditAdmin.page.goto(base+'/#applications');
  const applications=auditAdmin.page.getByRole('heading',{name:'Connected applications',level:1,exact:true});
  await applications.waitFor();
  await auditAdmin.page.getByRole('button',{name:'Add application',exact:true}).click();
  const applicationForm=auditAdmin.page.getByRole('dialog');
  await applicationForm.getByRole('textbox',{name:'Application code',exact:true}).fill('QA-NEW');
  await applicationForm.getByRole('textbox',{name:'Application name',exact:true}).fill('New application');
  await auditAdmin.page.keyboard.press('Escape');
  await auditAdmin.page.getByRole('button',{name:'Manage Example application'}).click();
  assert.equal(await applicationForm.getByRole('textbox',{name:'Application name',exact:true}).inputValue(),'Example application');
  assert.equal(await applicationForm.getByRole('textbox',{name:'Application code',exact:true}).getAttribute('readonly'),'');
  assert.equal(await applicationForm.getByRole('checkbox',{name:'Make link available'}).isChecked(),false);
  await auditAdmin.context.close();
  const auditDenied=await open('audit-denied',{roles:['AUTHOR'],tasks:[]});
  assert.equal(await auditDenied.page.locator('.nav-item[href="#audit-trail"]').count(),0);
  await auditDenied.page.goto(base+'/#audit-trail');await auditDenied.page.locator('.access-boundary').waitFor();
  assert(!auditDenied.s.requests.some(request=>request.endsWith('/api/audit-trail')));
  await auditDenied.page.goto(base+'/#approval-workflow-log');
  await auditDenied.page.getByRole('heading',{name:'Approval Workflow Log',level:1,exact:true}).waitFor();
  await auditDenied.context.close();
  report.checks.push('Audit Log opens for Admin, and CCO and Author are denied on the direct route. Approval Workflow Log opens for all portal roles with separate details and CSV. Both views fit desktop, tablet and phone widths.');
  const operations=await open('operational-dashboard',{metrics:dashboardMeasures}),op=operations.page;
  await op.locator('.nav-item[href="#team?audience=operational"]').click();
  await op.getByRole('heading',{name:'Operational dashboard',exact:true}).waitFor();
  await op.locator('.dashboard-more-measures[open]').waitFor();
  await op.getByRole('link',{name:/Check reviews due/}).waitFor();
  await op.getByRole('link',{name:/Check results needing correction/}).waitFor();
  const opDepartments=op.locator('.dashboard-panel').filter({has:op.getByRole('heading',{name:'Obligations by department',exact:true})});
  const opAttention=op.locator('.dashboard-panel').filter({has:op.getByRole('heading',{name:'Needs your attention',exact:true})});
  assert.equal(await opDepartments.locator('.dashboard-departments li').count(),2);
  assert.deepEqual(await opAttention.locator('li strong').allTextContents(),['Confirm reporting obligations','Review the period evidence']);
  assert.equal(await opAttention.locator('a[href="#actions/open?evidence=proof"]').count(),1);
  assert.equal(await op.getByText('Review the due evidence',{exact:true}).count(),1);
  await shot(op,'operational-overview');
  for(const width of [768,390,320]){
   await op.setViewportSize({width,height:950});
   assert(await opDepartments.isVisible()&&await opAttention.isVisible());
   assert(await op.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Operational dashboard overflow at '+width);
  }
  await opDepartments.getByRole('link',{name:/Compliance Department/}).click();
  await op.waitForURL(url=>url.hash.includes('audience=operational')&&url.hash.includes('metric=portfolio')&&url.hash.includes('department=compliance'));
  await op.locator('#dashboard-records').getByText('Confirm reporting obligations',{exact:true}).waitFor();
  await op.locator('.dashboard-more-measures[open]').waitFor();
  assert.equal(await opDepartments.locator('.dashboard-departments li').count(),1);
  await opAttention.getByText('The records that need follow-up are already shown in the dashboard’s record lists.',{exact:true}).waitFor();
  await operations.context.close();
  report.checks.push('Operational dashboard shows the department chart and attention panel at desktop and phone widths, even with empty data. Department drills retain the Operational dashboard and follow-ups omit records already in the result list.');

  const department=await open('department-dashboard',{metrics:dashboardMeasures,evidenceStatus:
   {SUBMITTED:1,ACCEPTED:2,REJECTED:0,SUPERSEDED:0,EXPIRED:1}}),dp=department.page;
  await dp.locator('.nav-item[href="#team?audience=department"]').click();
  const departmentOverview=dp.locator('.department-overview');
  await departmentOverview.getByRole('heading',{name:'Evidence status',exact:true}).waitFor();
  assert.deepEqual(await departmentOverview.locator('.dashboard-evidence-legend li').allTextContents(),
   ['Submitted 1','Accepted 2','Rejected 0','Superseded 0','Expired 1']);
  assert.equal(await departmentOverview.locator('.dashboard-evidence-track span').count(),3);
  const table=departmentOverview.getByRole('table');
  assert.deepEqual(await table.getByRole('columnheader').allTextContents(),['Criticality','Active','Business validation']);
  assert.equal(await table.getByRole('row').filter({hasText:'High'}).getByRole('cell',{name:'1',exact:true}).count(),1);
  await shot(dp,'department-overview');
  const dueTile=dp.getByRole('link',{name:/Actions due in 30 days/});
  assert.equal(await dueTile.locator('.dashboard-tile-count').innerText(),'1');
  await dueTile.click();
  await dp.locator('#dashboard-records').getByText('Review the next action',{exact:true}).waitFor();
  assert.equal(await dp.locator('#dashboard-records').getByText('Review the due evidence',{exact:true}).count(),0);
  for(const width of [768,390,320]){
   await dp.setViewportSize({width,height:950});
   assert(await departmentOverview.isVisible());
   const dimensions=await dp.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,
    overflowing:[...document.querySelectorAll('#main-content *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1)
     .slice(0,12).map(el=>el.tagName+'.'+el.getAttribute('class'))}));
   assert(dimensions.page<=dimensions.viewport+1,'Department dashboard overflow at '+width+' '+JSON.stringify(dimensions));
  }
  await department.context.close();
  report.checks.push('Department dashboard shows the five evidence statuses and the obligation criticality matrix. The 30-day tile opens the exact due actions, and the layout fits desktop and phone widths.');

  const ccoNav=await open('cco-navigation',{roles:['CCO'],name:'Chief Compliance Officer',tasks:[],
    metrics:{...dashboardMeasures,...ccoMeasures},scopeCounts:{instruments:3,obligations:2,actions:1,evidence:1}}),cp=ccoNav.page;
  await cp.goto(base+'/#team?audience=cco');await cp.getByRole('heading',{name:'CCO dashboard',exact:true}).waitFor();
  assert.deepEqual(await cp.locator('#view-filter select[name=domain] option').evaluateAll(options=>options.map(option=>option.text)),
   ['All domains','KYC, AML and CFT','Fraud Risk Management']);
  assert.equal(await cp.locator('.nav-item[aria-current="page"]').getAttribute('href'),'#team?audience=cco');
  const dashboardCards=cp.locator('.dashboard-tile');
  assert.equal(await dashboardCards.count(),25);
  assert.equal(new Set(await dashboardCards.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')))).size,25);
  assert.equal(await cp.locator('.dashboard-tiles .dashboard-info-button').count(),25);
  const highInfo=cp.getByRole('button',{name:'About Current high or critical obligations',exact:true});
  await highInfo.hover();
  const highTip=cp.getByRole('tooltip');
  assert.equal(await highTip.textContent(),'Current obligations rated high or critical, including drafts and proposals under review.');
  const tipBackground=await highTip.evaluate(el=>getComputedStyle(el).backgroundColor);
  const cardBackground=await dashboardCards.filter({hasText:'Current high or critical obligations'}).evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.notEqual(tipBackground,cardBackground,'The info tooltip has a distinct background from the dashboard card');
  await highTip.hover();
  assert(await highTip.isVisible());
  assert.equal(new URL(cp.url()).hash,'#team?audience=cco');
  await cp.keyboard.press('Escape');
  await highTip.waitFor({state:'hidden'});
  const priorityTile=dashboardCards.filter({hasText:'Current high or critical obligations'});
  await priorityTile.focus();
  await cp.keyboard.press('Tab');
  assert(await highInfo.evaluate(el=>el===document.activeElement));
  await highTip.waitFor();
  await cp.keyboard.press('Escape');
  await highTip.waitFor({state:'hidden'});
  await cp.locator('.dashboard-more-measures[open]').waitFor();
  await cp.getByText('Source records in your scope · 3 instruments · 2 obligations · 1 action · 1 evidence item.',{exact:true}).waitFor();
  const pendency=cp.getByRole('table',{name:'Department-wise pendency',exact:true});
  const domainStatus=cp.getByRole('table',{name:'Domain-wise status',exact:true});
  assert.deepEqual(await domainStatus.getByRole('row').filter({hasText:'REG-FRAUD'}).getByRole('cell').allTextContents(),['1','0','1','0']);
  assert.deepEqual(await pendency.getByRole('row').filter({hasText:'Retail Banking'}).getByRole('cell').allTextContents(),['1','1','0']);
  for(const table of [pendency,domainStatus])assert(await table.evaluate(el=>{
   const panel=el.closest('.dashboard-panel');
   return panel.scrollWidth<=panel.clientWidth+1;
  }));
  await cp.getByText('1 of 2 obligations are active (50%).',{exact:true}).waitFor();
  assert.equal(await cp.locator('.dashboard-departments li').count(),2);
  assert.equal(await cp.locator('.dashboard-followup').getByText('Confirm reporting obligations',{exact:true}).count(),1);
  assert.equal(await cp.getByRole('heading',{name:'Upcoming and overdue work',exact:true}).count(),1);
  await shot(cp,'cco-overview');
  await dashboardCards.filter({hasText:'Current high or critical obligations'}).click();
  await cp.locator('#dashboard-records').getByText('Confirm reporting obligations',{exact:true}).waitFor();
  assert.equal(await cp.getByText('Confirm reporting obligations',{exact:true}).count(),1);
  await pendency.getByRole('row').filter({hasText:'Retail Banking'}).getByRole('cell').first().getByRole('link').click();
  await cp.waitForURL(url=>url.hash.includes('metric=open')&&url.hash.includes('department=retail'));
  await cp.locator('#dashboard-records').getByText('Review the due evidence',{exact:true}).waitFor();
  assert.equal(await cp.getByText('Review the due evidence',{exact:true}).count(),1);
  assert.equal(await cp.getByRole('heading',{name:'Upcoming and overdue work',exact:true}).count(),1);
  assert.equal(await cp.locator('#dashboard-records').getByText('Originally',{exact:false}).count(),1);
  await cp.locator('.dashboard-departments a').filter({hasText:'Retail Banking'}).click();
  await cp.waitForURL(url=>url.hash.includes('metric=portfolio')&&url.hash.includes('department=retail'));
  await cp.locator('#dashboard-records').getByText('Review onboarding instructions',{exact:true}).waitFor();
  for(const width of [768,390,320]){
    await cp.setViewportSize({width,height:950});
    assert(await cp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'CCO dashboard overflow at '+width);
  }
  await ccoNav.context.close();
  report.checks.push('CCO scope totals, priority tiles, departmental action counts and regulatory domain stages render from the scoped populations. The new tiles and pendency links open exact records and layouts fit desktop and phone widths.');

  const lib=await open('library-dashboard',{libraryDashboard:true}),lp=lib.page;
  await lp.goto(base+'/#repository');
  const libraryTiles=lp.getByRole('navigation',{name:'Regulatory library stages'});
  await libraryTiles.waitFor();assert.equal(await libraryTiles.locator('.dashboard-tile').count(),5);
  assert.equal(await libraryTiles.locator('.dashboard-info-button').count(),5);
  await libraryTiles.getByRole('link',{name:/Other instruments/}).click();
  await lp.waitForURL(url=>url.hash.includes('library_stage=retained'));
  await libraryTiles.getByRole('link',{name:/Other instruments/}).and(lp.locator('[aria-current]')).waitFor();
  await lp.locator('.data-table').getByText('Earlier customer guidance',{exact:true}).waitFor();
  assert.equal(await lp.locator('.data-table tbody tr').count(),1);
  await lp.goto(base+'/#library');const destinations=lp.getByRole('navigation',{name:'Library destinations'});
  await destinations.waitFor();
  assert.equal(await destinations.locator('.dashboard-info-button').count(),await destinations.locator('.dashboard-tile').count());
  for(const title of ['Checks and procedures','Evidence library'])assert.equal(await destinations.getByRole('link',{name:new RegExp(title)}).count(),1);
  assert.equal(await lp.locator('a[href^="#baseline"]').count(),0);
  await lp.goto(base+'/#help?tab=release');
  await lp.getByRole('heading',{name:'Help & workflow guide',level:1,exact:true}).waitFor();
  assert(await lp.getByRole('link',{name:'Step-by-step help',exact:true}).isVisible());
  assert(await lp.getByRole('link',{name:/Roles & responsibilities/}).isVisible());
  assert(await lp.getByRole('button',{name:'Print guide',exact:true}).isVisible());
  assert.equal(await lp.getByRole('link',{name:/Release (scope|baseline)/i}).count(),0);
  assert.equal(await lp.locator('.runtime-help a[href*="week-1-3-navigation.html"]').count(),0);
  await lp.goto(base+'/#baseline?tab=metrics');
  await lp.waitForURL(url=>url.hash==='#home');
  await lp.locator('.home-dashboard').waitFor();
  report.checks.push('Help shows Step-by-step help, Roles & responsibilities and the print action, with no Weeks 1–3 reference links or Release scope tab. The Compliance library omits Release baseline and its old bookmarks open Home without calling the retired API.');
  await lib.context.close();
  const touch=await open('touch-dashboard',{metrics:dashboardMeasures},{hasTouch:true,isMobile:true,viewport:{width:320,height:750}});
  await touch.page.goto(base+'/#team?audience=operational');
  const workInfo=touch.page.getByRole('button',{name:'About Open actions',exact:true});
  await workInfo.tap();
  const workTip=touch.page.getByRole('tooltip');
  await workTip.getByText('Shows work that is open, in progress or awaiting review.',{exact:true}).waitFor();
  const popup=await workTip.boundingBox();
  assert(popup&&popup.x>=0&&popup.x+popup.width<=320);
  assert.equal(new URL(touch.page.url()).hash,'#team?audience=operational');
  await touch.page.getByRole('heading',{name:'Operational dashboard',exact:true}).tap();
  await workTip.waitFor({state:'hidden'});
  await touch.context.close();
  report.checks.push('Dashboard, Home, Library and Exception report tiles have separate information buttons. Hover, keyboard focus, Escape, tap and tapping outside work without selecting a tile. Tooltips stay inside the phone viewport.');
  report.checks.push('Dashboard tiles select one record population, follow-ups deduplicate shared records, and the readiness chart and department links use the same obligation population. Library stage counts drill into the register.');
  report.checks.push('Reference navigation opens Checks and procedures, Obligation links, Evidence, Delegation, the RBI workflow guide and scoped dashboard presets. Each route has one selected entry. CCO view requires CCO role and direct non-CCO access makes no dashboard request.');

  const queue=await open('mixed',{tasks:structuredClone(mixed),roles:['REVIEWER'],name:'Compliance Reviewer'}),q=queue.page;
  assert.deepEqual(await metrics(q),['6','5','2']);assert.equal(await q.locator('.home-work-item').count(),4);
  assert.equal(await q.locator('.home-primary').getAttribute('href'),'#obligations/obligation-1?tab=owners&ownership_change=change-1');
  assert.equal(await q.locator('.home-priority h2').innerText(),'Confirm the proposed business owner');assert(await q.locator('.home-priority .is-overdue').isVisible());
  assert.deepEqual(await q.locator('.home-work-item').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),[
   '#obligations/obligation-1?tab=owners&ownership_change=change-1','#repository/customer?version=customer-v2&tab=workflow','#notification-families/payments?proposal=proposal-1','#obligations/obligation-2?tab=owners']);
  assert(await q.getByText('Showing your next 4 assignments, ordered by due date.',{exact:true}).isVisible());
  assert.equal(await q.locator('.home-actions a[href="#repository/new"]').count(),0);await shot(q,'home-reviewer');
  await q.locator('.home-metrics a[href="#tasks?tab=due"]').click();await q.getByRole('heading',{name:'My tasks',exact:true}).waitFor();
  assert.equal(await q.locator('.home-mode,.home-dashboard').count(),0);assert.equal(await q.locator('.data-table tbody tr').count(),2);
  await q.locator('.nav-item[href="#home"]').click();await q.locator('.home-dashboard').waitFor();assert.deepEqual(await metrics(q),['6','5','2']);
  report.checks.push('Mixed workflows retain due-date ordering, four-of-six queue, exact ownership/source/family/obligation destinations and 7-day boundaries; the due filter opens My tasks and Home styling is removed on navigation.');
  const correction=await open('correction',{tasks:[structuredClone(mixed[4])],roles:['REVIEWER']});assert.equal(await correction.page.locator('.home-primary').getAttribute('href'),'#repository/customer?tab=workflow&correction=correction-1');await correction.context.close();
  const admin=await open('admin',{roles:['ADMIN'],name:'System Administrator',tasks:[]}),a=admin.page;
  assert.deepEqual(await metrics(a),['2','2','9']);assert.equal(await a.locator('.home-primary').getAttribute('href'),'#users?tab=ACTION_REQUIRED');assert.equal(await a.locator('.portal-nav-group summary').filter({hasText:'Work and evidence'}).count(),1);
  assert.equal(await a.locator('.home-person-row').count(),3);assert.equal(await a.locator('.home-account-state.is-inactive').count(),1);
  assert.equal(await a.locator('.home-actions a[href="#repository/new"]').count(),0);assert.equal(admin.s.requests.filter(x=>x.endsWith('/api/instruments')).length,0);
  assert(await a.getByText('Account status and effective role assignments are separate access checks.',{exact:true}).isVisible());await shot(a,'home-admin');for(const width of [390,320]){await a.setViewportSize({width,height:1050});assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Admin overflow '+width);}await a.setViewportSize({width:1440,height:1050});
  const adminEmpty=await open('admin-empty',{roles:['ADMIN'],tasks:[],users:[],summary:{action_required:0,profile_pending:0}});
  assert.deepEqual(await metrics(adminEmpty.page),['0','0','9']);assert.equal(await adminEmpty.page.locator('.home-primary').getAttribute('href'),'#users');assert(await adminEmpty.page.getByRole('heading',{name:'No accounts to show',exact:true}).isVisible());await adminEmpty.context.close();
  const combined=await open('combined',{roles:['ADMIN','AUTHOR']});assert.deepEqual(await metrics(combined.page),['2','0','0']);assert.equal(await combined.page.locator('.home-person-row').count(),0);await combined.context.close();
  report.checks.push('Metadata links pin their correction; Admin keeps account/access/role totals, pending-access destination and separate active/inactive labels. Admin phones fit 320/390px; empty Admin and mixed Admin/Author roles retain their existing behavior.');
  const oversight=await open('oversight',{roles:['CCO'],name:'Chief Compliance Office',tasks:[]});assert.deepEqual(await metrics(oversight.page),['3','2','0']);assert.equal(await oversight.page.locator('.home-primary').getAttribute('href'),'#repository');await shot(oversight.page,'home-oversight');await oversight.context.close();
  const scoped=await open('scoped',{roles:['ZONE_VIEWER'],name:'Zone Viewer',tasks:[],sources:sources.slice(0,2),scoped:true});assert.deepEqual(await metrics(scoped.page),['2','2','0']);assert((await scoped.page.locator('.scope-banner').innerText()).includes('Read-only access'));assert.equal(await scoped.page.locator('.home-actions a[href="#repository/new"]').count(),0);await scoped.context.close();
  report.checks.push('CCO and scoped read-only users keep source counts from their authorised response, scoped context and non-creation shortcuts; zero personal work is never presented as a compliance result.');
  const empty=await open('empty',{tasks:[]});assert.deepEqual(await metrics(empty.page),['0','0','0']);assert(await empty.page.getByRole('heading',{name:'Nothing waiting in your queue',exact:true}).isVisible());assert.equal(await empty.page.locator('.home-primary').getAttribute('href'),'#repository');await shot(empty.page,'home-empty');await empty.context.close();
  const limited=await open('limited',{tasks:[],roles:['REVIEWER'],menu:['home','tasks','help']});assert.equal(await limited.page.locator('.home-action').count(),1);assert.equal(await limited.page.locator('.portal-nav-group summary').filter({hasText:'Work and evidence'}).count(),1);assert.equal(await limited.page.locator('.home-journey a').count(),0);assert.equal(await limited.page.locator('.home-primary').getAttribute('href'),'#help');await limited.context.close();
  report.checks.push('Empty personal queues preserve register guidance; menu-restricted users see only permitted quick actions/guidance and a valid guide fallback.');
  const unsafeText='Example <img src=x onerror="alert(1)">',unsafe=await open('escaping',{name:unsafeText,tasks:[{...mixed[0],title:unsafeText}]});
  assert.equal(await unsafe.page.locator('.home-dashboard img,.home-dashboard script').count(),0);assert((await unsafe.page.locator('h1').innerText()).includes(unsafeText));assert.equal(await unsafe.page.locator('.home-priority h2').innerText(),unsafeText);await unsafe.context.close();
  const longTitle='CustomerIdentificationRequirement'.repeat(18),long=await open('long',{name:'Example Directory User with a long but valid display name',sources:[{...sources[0],title:longTitle}],tasks:[drafts[0]]});
  for(const width of [1440,390,320]){await long.page.setViewportSize({width,height:1050});assert(await long.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Long wording overflow '+width);assert.equal(await long.page.locator('.home-priority h2').getAttribute('title'),longTitle);}
  await long.context.close();report.checks.push('Directory names and source/task titles are escaped; long unbroken titles wrap/clamp safely with full title text available at desktop and phone widths.');
  const designation='Assistant General Manager, Regulatory Compliance <Regional Office>';
  const employee=await open('approved-designation',{
    name:'Example Employee',
    user:{login_type:'LDAP',employee_approved:{designation:'  '+designation+'  '},employee_observed:{designation}},
    employeeProfile:{status:'VERIFIED',blocked:false}
  });
  for(const container of ['#portal-sidebar .profile','.topbar .portal-person']){
    const profile=employee.page.locator(container);
    assert.equal(await profile.locator('.profile-name').innerText(),'Example Employee');
    assert.equal(await profile.locator('.shell-profile-designation').innerText(),designation);
    assert.equal(await profile.locator('small').innerText(),'Author');
  }
  const sidebarBackground=node=>{
    const style=getComputedStyle(node);
    return [style.backgroundColor,style.backgroundImage];
  };
  assert.deepEqual(await employee.page.locator('#portal-sidebar').evaluate(sidebarBackground),['rgb(62, 48, 75)','none']);
  const libraryLink=employee.page.locator('#portal-sidebar .nav-item[href="#repository"]');
  const backgroundColor=node=>getComputedStyle(node).backgroundColor;
  await libraryLink.hover();
  assert.equal(await libraryLink.evaluate(backgroundColor),'rgb(77, 60, 92)');
  await employee.page.mouse.down();
  assert.equal(await libraryLink.evaluate(backgroundColor),'rgb(90, 70, 106)');
  await employee.page.mouse.up();
  const selectedLibrary=libraryLink.and(employee.page.locator('[aria-current="page"]'));
  await selectedLibrary.waitFor();
  assert.equal(await selectedLibrary.evaluate(backgroundColor),'rgb(233, 220, 244)');
  await employee.page.locator('#portal-sidebar').screenshot({path:path.join(out,'sidebar-approved-designation.png'),animations:'disabled'});
  await selectedLibrary.focus();
  await employee.page.keyboard.press('Tab');
  await employee.page.keyboard.press('Shift+Tab');
  assert(await selectedLibrary.evaluate(node=>node.matches(':focus-visible')&&getComputedStyle(node).outlineColor==='rgb(238, 214, 255)'));
  for(const width of [768,390,320]){
    await employee.page.setViewportSize({width,height:850});
    await employee.page.getByRole('button',{name:'Open navigation',exact:true}).click();
    const sidebar=employee.page.locator('#portal-sidebar');
    assert.deepEqual(await sidebar.evaluate(sidebarBackground),['rgb(62, 48, 75)','none']);
    assert.equal(await selectedLibrary.evaluate(backgroundColor),'rgb(233, 220, 244)');
    assert(await sidebar.locator('.shell-profile-designation').isVisible());
    assert(await sidebar.locator('.profile').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'Mobile profile overflow '+width);
    assert(await employee.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Employee workspace overflow '+width);
    await employee.page.locator('.portal-nav-close').click();
  }
  await employee.context.close();
  assert.equal(await p.locator('.shell-profile-designation').count(),0);
  const cover=await open('leave-cover-designation',{
    name:'Represented Author',
    actingFor:{id:'cover',actual_user_name:'Covering Employee',principal_name:'Represented Author',role_code:'AUTHOR',scope_unit_id:'compliance',ends_on:day(1)},
    actualUser:{id:'covering',employee_approved:{designation:'Covering Manager'}}
  });
  assert.equal(await cover.page.locator('#portal-sidebar .profile-name').innerText(),'Represented Author');
  assert.equal(await cover.page.locator('.shell-profile-designation').count(),0);
  await cover.context.close();
  const pending=await browser.newContext({extraHTTPHeaders:{'X-Home-Case':'pending-designation'}});
  scenario('pending-designation',{
    user:{login_type:'LDAP',employee_approved:{designation:'   '},employee_observed:{designation:'Pending Manager'}},
    employeeProfile:{status:'PENDING',blocked:true,approved:{},current:{designation:'Pending Manager'},requests:[]}
  });
  const pendingPage=await pending.newPage();
  pendingPage.on('pageerror',error=>report.browser_errors.push(error.message));
  await pendingPage.goto(base);
  await pendingPage.locator('.ldap-department-gate').waitFor();
  assert.equal(await pendingPage.locator('.shell-profile-designation').count(),0);
  await pending.close();
  report.checks.push('The plum sidebar uses distinct hover, pressed, selected and keyboard-focus states. The lilac selection and approved API designation display at 320–1440px. Standard accounts and pending designations omit the label; leave cover does not attach the covering employee’s designation to the represented user.');
  const deniedContext=await browser.newContext({extraHTTPHeaders:{'X-Home-Case':'denied'}});scenario('denied',{denied:true});const denied=await deniedContext.newPage();denied.on('pageerror',e=>report.browser_errors.push(e.message));await denied.goto(base);await denied.getByText('The source list is outside your current scope.',{exact:true}).first().waitFor();assert.equal(await denied.locator('.home-dashboard').count(),0);await deniedContext.close();
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.unexpected_requests,[]);
  report.checks.push('A denied source read renders the existing error boundary with no dashboard data; no browser errors, external requests, credentials or business writes occurred.');
  report.passed=true;await author.context.close();await queue.context.close();await admin.context.close();
 }catch(e){report.passed=false;report.failure=e.stack;throw e;}
 finally{await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
