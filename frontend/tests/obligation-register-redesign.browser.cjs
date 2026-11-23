// Production register layout and filters over a read-only synthetic local API.
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'frontend/dist'),out=path.resolve(root,process.env.CBD_REGISTER_OUTPUT||'outputs/obligation-register-redesign-2026-11-13/browser');
const preview=process.argv.includes('--preview'),cases=new Map();
const report={scope:'Synthetic register/account/detail API only. No database, credentials or business writes.',checks:[],errors:[],writes:[],unexpected_requests:[],queries:[],viewports:[]};
const user={id:'actor',full_name:'Retail Business Owner',org_unit_id:'retail'};
const masters={user:[user,{id:'owner',full_name:'Example Business Owner'},{id:'reviewer',full_name:'Example Compliance Reviewer'}],organisational_unit:[{id:'retail',name:'Retail Banking'},{id:'compliance',name:'Compliance Department'}],regulatory_domain:[{id:'kyc',name:'Customer identification',active_flag:0},{id:'digital',name:'Digital banking',active_flag:0}],obligation_category:[{id:'customer',name:'Customer identification'}],frequency:[{id:'event',name:'At onboarding'}]};
function record(i){const stage=['ACTIVE','DRAFT','COMPLIANCE_REVIEW'][i%3];return {id:'obligation-'+i,code:'EXAMPLE-KYC-C'+String(i+1).padStart(3,'0')+'-OBL-001',title:'Customer identification checkpoint '+(i+1),version_number:1,created_by:'maker',record_status:stage==='ACTIVE'?'ACTIVE':'DRAFT',approval_status:stage==='ACTIVE'?'APPROVED':stage==='DRAFT'?'DRAFT':'IN_REVIEW',stage,regulatory_owner_unit_id:'compliance',business_owner_unit_id:i%2===0?'retail':'compliance',primary_domain_id:i%2===0?'kyc':'digital',owner_user_id:i%2===0?'owner':'reviewer',criticality:['HIGH','MEDIUM','CRITICAL','LOW'][i%4],instrument_id:'source',instrument_code:'EXAMPLE-KYC-2026-001',source_version:'1.0',source_clause_reference:'3.1',clause_code:'C003',category_id:'customer',frequency_id:'event',obligation_nature:'MANDATORY',effective_from:'2026-11-01',next_review_date:'2027-11-01',issues:i%3===0?[]:['CONTENT_VALIDATION_PENDING'],statement:'Verify identity before opening the customer account.',internal_interpretation:'The accountable department performs the check and retains its result.',evidence_standard:'A dated verification record.'};}
const many=Array.from({length:32},(_,i)=>record(i));
const examples=[{...record(0),title:'Verify customer identity before onboarding',business_owner_unit_id:'retail'},
 {...record(2),title:'Review exceptions to document verification',business_owner_unit_id:'retail',issues:['CONTENT_VALIDATION_PENDING','UNAPPROVED_NON_APPLICABILITY','HIGH_CRITICAL']},
 {...record(1),title:'Assess the account-opening scope',business_owner_unit_id:'retail',issues:['PARTIAL_APPLICABILITY']}];
function scenario(key,extra={}){const s={records:structuredClone(examples),roles:['BUSINESS_OWNER'],...extra};cases.set(key,s);return s;}scenario('preview');
function identity(s){return {user:{...user,full_name:s.roles.includes('AUTHOR')?'Example Regulatory Author':user.full_name,login_type:'STANDARD',must_change_password_flag:0,needs_email_confirmation_flag:0,needs_department_selection_flag:0},roles:s.roles,csrf_token:'synthetic',environment:'uat',grants:s.roles.map(role=>({role_code:role,global_scope_flag:role==='BUSINESS_OWNER'?0:1,scope_org_unit_id:role==='BUSINESS_OWNER'?'retail':null})),menu:[{id:'home',label:'Home'},{id:'tasks',label:'My tasks'},{id:'approvals',label:'My decisions'},{id:'obligations',label:'Obligations'},{id:'applicability',label:'Applicability'},{id:'accountability',label:'Accountability'},{id:'repository',label:'Regulatory library'},{id:'help',label:'Help'}]};}
function detail(o){return {obligation:o,versions:[o],owners:[{id:'assignment',user_id:'owner',org_unit_id:'retail',owner_role:'BUSINESS',primary_owner_flag:1,approval_status:'APPROVED'}],ownership_history:[],owner_changes:[],applicability:[],applicability_history:[],processes:[],tasks:[],citations:[],issues:o.issues,audit:[],history:[],instrument:{id:'source',title:'Example customer identification source',code:o.instrument_code},clause:{id:'clause',heading:'Identification',code:o.clause_code,source_clause_reference:o.source_clause_reference},edition:{id:'edition',version_number:'1.0'}};}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),s=cases.get(req.headers['x-register-case'])||cases.get('preview');
 if(u.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(u.pathname.startsWith('/api/')){
  if(req.method!=='GET'){report.writes.push(req.method+' '+u.pathname);res.writeHead(405).end();return;}
  let body,status=200;const p=u.pathname.slice(4);
  if(p==='/auth/me')body=identity(s);else if(p==='/masters')body=masters;else if(p==='/tasks'||p==='/notifications')body=[];
  else if(p==='/obligations'){
   report.queries.push(Object.fromEntries(u.searchParams));let rows=s.records;const q=u.searchParams;
   if(s.denied){status=403;body={detail:'This obligation view is outside your current scope.'};}
   else{
    if(q.get('q'))rows=rows.filter(r=>(r.title+' '+r.code+' '+r.instrument_code).toLowerCase().includes(q.get('q').toLowerCase()));
    for(const [key,field]of [['department','business_owner_unit_id'],['domain','primary_domain_id'],['status','stage'],['criticality','criticality'],['owner','owner_user_id']])if(q.get(key))rows=rows.filter(r=>r[field]===q.get(key));
    const findingCounts=q.get('tab')==='reports'
      ? rows.flatMap(row=>row.issues).reduce((counts,issue)=>({...counts,[issue]:(counts[issue]||0)+1}),{})
      : null;
    if(q.get('exception'))rows=rows.filter(r=>r.issues.includes(q.get('exception')));if(q.get('tab')==='reports')rows=rows.filter(r=>r.issues.length);
    const size=Number(q.get('page_size')||25),total=rows.length,page=Math.min(Number(q.get('page')||1),Math.max(1,Math.ceil(total/size)));
    body={items:rows.slice((page-1)*size,page*size),pagination:{page,page_size:size,total,total_pages:Math.ceil(total/size),start:total?(page-1)*size+1:0,end:Math.min(page*size,total)}};
    if(findingCounts)body.finding_counts=findingCounts;
   }
  }else if(p==='/applicability'||p==='/accountability')body={items:[],pagination:{page:1,page_size:25,total:0,total_pages:0,start:0,end:0},summary:{},counts:{obligations:0,records:0,assessments:0,unassessed:0,assignments:0,missing:0}};
  else if(p.startsWith('/obligations/'))body=detail(s.records.find(r=>r.id===p.split('/')[2]));
  else{report.unexpected_requests.push(req.method+' '+p);status=404;body={detail:'Unexpected synthetic endpoint.'};}
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(body));return;
 }
 const file=path.resolve(dist,u.pathname==='/'?'index.html':'.'+u.pathname.replace(/^\/assets/,''));if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(await fs.readFile(file));
}catch(e){report.unexpected_requests.push(e.message);res.writeHead(500).end('Synthetic preview failure.');}});
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});}
async function total(page,value){await page.waitForFunction(value=>document.querySelector('.obligation-register-total')?.textContent===String(value),value);}
async function choose(page,label,text){const control=page.getByRole('combobox',{name:'Search '+label,exact:true});await control.fill(text);await control.press('ArrowDown');await control.press('Enter');}
(async()=>{
 await fs.mkdir(out,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port;
 if(preview){console.log('Synthetic Obligations preview: '+base+'/#obligations');return;}
 const {chromium}=require(process.argv[2]||'playwright');let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function open(key,extra={},hash='obligations'){
   const s=scenario(key,extra),context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce',extraHTTPHeaders:{'X-Register-Case':key}});
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.unexpected_requests.push('External request');return route.abort();}return route.continue();});
   const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.errors.push(e.message));await page.goto(base+'/#'+hash);await page.locator('.obligation-register-results').waitFor();return {s,page,context};
  }
  const main=await open('business'),p=main.page;
  assert.equal(await p.getByRole('heading',{name:'Obligations',exact:true}).count(),1);assert.equal(await p.locator('.obligation-register-total').innerText(),'3');
  assert.equal(await p.locator('.obligation-register .data-table tbody tr').count(),3);assert.equal(await p.locator('.obligation-workspace-tabs [aria-current=page]').count(),1);
  assert.equal(await p.getByRole('button',{name:'Export',exact:true}).count(),0);assert.equal(await p.getByRole('link',{name:'Add obligation',exact:true}).count(),0);
  assert.equal(await p.locator('.obligation-register-more').getAttribute('open'),null);assert.equal(await p.locator('.obligation-criticality.is-critical').innerText(),'Critical');
  assert((await p.locator('.obligation-register-filters .field > label').allTextContents()).every(label=>!label.includes('*')),'All register filters are optional');
  assert.equal(await p.locator('.obligation-register-cell').first().locator('.record-title').innerText(),examples[0].title);assert(await p.getByText('None reported',{exact:true}).isVisible());
  for(const width of [1920,1440,1280,1100,1024,1000,901,900,768,760,390,375,320]){
   await p.setViewportSize({width,height:1050});
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow '+width);
   assert(await p.locator('.obligation-register-filters,.obligation-register-results,.obligation-workspace-tabs').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),'Panel overflow '+width);
   if(width===1440)await shot(p,'register-desktop');if(width===390)await shot(p,'register-phone');if(width===320)await shot(p,'register-320');report.viewports.push(width);
  }
  report.checks.push('Scoped Business Owner sees three authorised records, title-first references/revisions, separate stage/criticality/findings and no creation/export actions; table/card layouts fit 320–1920px.');
  await p.setViewportSize({width:1440,height:1050});await p.locator('.obligation-quick-view-trigger').first().click();await p.locator('#obligation-quick-view .obligation-definition-list').waitFor();
  await p.getByRole('searchbox',{name:'Search obligations',exact:true}).fill('identity');await p.locator('#obligation-quick-view').waitFor({state:'hidden'});
  assert(await p.getByRole('searchbox',{name:'Search obligations',exact:true}).evaluate(e=>e===document.activeElement));await p.getByRole('button',{name:'Apply filters',exact:true}).click();await p.waitForURL(u=>u.hash.includes('q=identity'));await total(p,1);assert.equal(await p.locator('.obligation-register-total').innerText(),'1');
  report.checks.push('Desktop Quick view closes when register filters are edited, preserving input/focus and exposing Apply; the applied search returns the expected record.');
  const filters=await open('filters',{roles:['AUTHOR'],records:structuredClone(many)},'obligations?page.obligations=2&size.obligations=10'),f=filters.page;
  assert.equal(await f.getByRole('link',{name:'Add obligation',exact:true}).count(),1);assert.equal(await f.getByRole('link',{name:'Import obligations',exact:true}).count(),1);assert.equal(await f.getByRole('button',{name:'Export',exact:true}).count(),1);
  await f.locator('.obligation-register-more > summary').focus();await f.keyboard.press('Enter');
  await f.getByRole('searchbox',{name:'Search obligations',exact:true}).fill('customer');
  for(const [label,text]of [['Accountable department','Retail Banking'],['Stage','Draft'],['Regulatory domain','Customer identification'],['Criticality','High'],['Named owner','Example Business Owner'],['Finding','Content validation pending']])await choose(f,label,text);
  await f.getByRole('button',{name:'Apply filters',exact:true}).click();await f.waitForURL(u=>u.hash.includes('exception=CONTENT_VALIDATION_PENDING'));await f.locator('.obligation-filter-chip').first().waitFor();await total(f,3);
  assert.equal(await f.locator('.obligation-register-total').innerText(),'3');assert.equal(await f.locator('.obligation-filter-chip').count(),7);assert.equal(await f.locator('.obligation-register-more').getAttribute('open'),'');
  await f.getByRole('link',{name:'Remove Domain: Customer identification',exact:true}).waitFor();
  const applied=report.queries.at(-1);for(const [key,value]of Object.entries({q:'customer',department:'retail',status:'DRAFT',domain:'kyc',criticality:'HIGH',owner:'owner',exception:'CONTENT_VALIDATION_PENDING',page:'1',page_size:'25'}))assert.equal(applied[key],value);
  await shot(f,'register-filtered');await f.getByRole('link',{name:'Remove Criticality: High',exact:true}).click();await f.waitForURL(u=>!u.hash.includes('criticality='));await total(f,5);assert.equal(await f.locator('.obligation-filter-chip').count(),6);assert.equal(await f.locator('.obligation-register-total').innerText(),'5');
  await f.getByRole('link',{name:'Clear',exact:true}).click();await f.waitForURL(u=>u.hash==='#obligations');await total(f,32);assert.equal(await f.locator('.obligation-register-total').innerText(),'32');assert.equal(await f.locator('.obligation-filter-chip').count(),0);
  report.checks.push('Keyboard-searchable primary/advanced filters retain the API keys, reset paging and show applied chips; advanced selections reopen, removing one chip preserves the others, and Clear resets the view.');
  await f.locator('.pagination-size select').selectOption('10',{force:true});await f.waitForURL(u=>u.hash.includes('size.obligations=10'));await f.waitForFunction(()=>document.querySelectorAll('.data-table tbody tr').length===10);await f.getByRole('link',{name:'Next page',exact:true}).click();await f.waitForURL(u=>u.hash.includes('page.obligations=2'));await f.waitForFunction(text=>document.querySelector('.record-title')?.textContent===text,many[10].title);assert.equal(await f.locator('.data-table tbody tr').count(),10);assert.equal(await f.locator('.record-title').first().innerText(),many[10].title);
  await f.locator('.obligation-workspace-tabs').getByRole('link',{name:'Applicability',exact:true}).click();await f.locator('.obligation-focused-workspace').waitFor();assert.equal(await f.locator('.obligation-register-results').count(),0);assert.equal(await f.locator('.obligation-workspace-heading').count(),1);
  await f.locator('.obligation-workspace-tabs').getByRole('link',{name:'Register',exact:true}).click();await f.locator('.obligation-register-results').waitFor();assert(new URL(f.url()).hash.includes('page.obligations=2'));assert.equal(await f.locator('.record-title').first().innerText(),many[10].title);
  await f.getByRole('button',{name:'Export',exact:true}).click();await f.locator('#dialog').getByRole('heading',{name:'Export obligations',exact:true}).waitFor();await f.keyboard.press('Escape');
  report.checks.push('Server pagination keeps totals/pages, workspace tab return restores the saved register URL/page, and the existing Export dialog remains available to eligible roles.');
  const empty=await open('empty',{roles:['AUTHOR'],records:[]}),e=empty.page;
  assert.equal(await e.locator('.obligation-register-total').innerText(),'0');
  await e.getByRole('heading',{name:'No obligations match this view.',exact:true}).waitFor();
  await e.setViewportSize({width:320,height:1000});
  await e.locator('.obligation-register-more > summary').click();
  const domainOptions=e.locator('select[name=domain] option');
  assert.deepEqual(await domainOptions.evaluateAll(options=>options.map(option=>option.text)),['All domains','Customer identification','Digital banking']);
  await choose(e,'Regulatory domain','Digital banking');
  await e.getByRole('button',{name:'Apply filters',exact:true}).click();
  await e.getByRole('link',{name:'Remove Domain: Digital banking',exact:true}).waitFor();
  await total(e,0);
  assert(await e.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await empty.context.close();
  report.checks.push('Draft-only domains appear in the register and applied labels, including for an Author with an empty register at 320px.');
  const pendingRecords=Array.from({length:10},(_,index)=>({...record(100+index),issues:['CONTENT_VALIDATION_PENDING']}));
  const reports=await open('reports',{records:[...pendingRecords,...examples]},'obligations?tab=reports&size.obligations=10'),rp=reports.page;
  assert(await rp.getByRole('heading',{name:'Obligation exception reports',exact:true}).isVisible());
  assert.equal(await rp.getByRole('navigation',{name:'Obligation views',exact:true}).count(),0);
  assert.equal(await rp.locator('select[name=tab]').count(),0);
  const cards=rp.locator('.obligation-exception-card');
  await rp.getByRole('button',{name:'About Active obligations without linked checks',exact:true}).hover();
  const findingHelp=rp.getByRole('tooltip');
  assert((await findingHelp.textContent()).includes('no current approved obligation link'));
  assert(!new URL(rp.url()).hash.includes('exception='));
  await rp.keyboard.press('Escape');
  await findingHelp.waitFor({state:'hidden'});
  assert.equal(await cards.count(),9);
  assert.equal(await rp.locator('.obligation-register-total').innerText(),'12');
  assert.equal(await rp.locator('.data-table tbody tr').count(),10);
  const partial=cards.filter({hasText:'Partially applicable obligations'});
  assert.equal(await partial.locator('strong').innerText(),'1');
  await partial.click();await total(rp,1);
  assert.equal(await partial.getAttribute('aria-current'),'true');
  assert.equal(await cards.filter({hasText:'Content validation pending'}).locator('strong').innerText(),'11');
  await partial.click();await total(rp,12);
  await cards.filter({hasText:'Active obligations without linked checks'}).click();
  await rp.getByRole('heading',{name:'No exceptions match this view.',exact:true}).waitFor();
  assert.equal((await rp.locator('#view-filter select[name=exception] option:checked').textContent()).trim(),'Active obligations without linked checks');
  await rp.getByRole('link',{name:'Clear',exact:true}).click();await total(rp,12);
  await rp.getByRole('searchbox',{name:'Search obligations',exact:true}).fill('account-opening');
  await rp.getByRole('button',{name:'Apply filters',exact:true}).click();await total(rp,1);
  assert.equal(report.queries.at(-1).tab,'reports');
  assert.equal(report.queries.at(-1).q,'account-opening');
  await rp.getByRole('link',{name:'Clear',exact:true}).click();await total(rp,12);
  for(const width of [1440,768,390,320]){
    await rp.setViewportSize({width,height:1100});
    assert(await rp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(width===1440 || width===390)await shot(rp,'exception-cards-'+width);
  }
  report.checks.push('The standalone exception report has no obligation tabs or register switcher. Cards and search filter the results, Clear stays in the report, and all nine cards fit desktop and phone layouts.');
  await reports.context.close();
  const unsafe='Example <img src=x onerror="alert(1)">',long='LongRegulatoryReference'.repeat(12),stress=await open('stress',{records:[{...record(0),title:unsafe,code:long,instrument_code:long}]});
  assert.equal(await stress.page.locator('.record-title').innerText(),unsafe);assert.equal(await stress.page.locator('.obligation-register img,.obligation-register script').count(),0);
  for(const width of [1440,901,390,320]){await stress.page.setViewportSize({width,height:1050});assert(await stress.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Long reference overflow '+width);}await stress.context.close();
  report.checks.push('Empty and Exceptions views retain truthful totals; unsafe wording is text and long references fit desktop/mobile layouts without hiding the original codes.');
  const denied=await browser.newContext({extraHTTPHeaders:{'X-Register-Case':'denied'}});scenario('denied',{denied:true});const d=await denied.newPage();d.on('pageerror',x=>report.errors.push(x.message));await d.goto(base+'/#obligations');await d.getByText('This obligation view is outside your current scope.',{exact:true}).first().waitFor();assert.equal(await d.locator('.obligation-register-results').count(),0);await denied.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.unexpected_requests,[]);report.checks.push('A denied register read shows the existing error boundary; no external requests, browser errors, credentials or business writes occurred.');report.passed=true;
  await main.context.close();await filters.context.close();
 }catch(e){report.passed=false;report.failure=e.stack;throw e;}finally{await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
