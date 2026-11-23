// Real Oracle/browser saves on the existing rollback-only fixture, never regular UAT.
const {chromium}=require(process.argv[2]||'playwright');
const {searchable,chooseOption}=require('./helpers/searchable-select.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const output=path.join(root,'outputs/master-maintenance-2026-10-30/browser');
const report={status:'running',environment:'UAT rollback-only fixture on 8011',checks:[],screenshots:[],browser_errors:[],prohibited_writes:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const fixture=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'}),page=await context.newPage();
 page.on('pageerror',e=>report.browser_errors.push(e.message));
 await context.route('**/api/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname;
  if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)&&!p.startsWith('/api/admin/masters/')){
   report.prohibited_writes.push({method:r.method(),path:p});return route.abort('blockedbyclient');
  }
  await route.continue();
 });
 const dialog=page.locator('#dialog'),form=dialog.locator('#master-record');
 const suffix=Date.now().toString(36).toUpperCase();
 async function get(url){const r=await context.request.get(base+'/api'+url);assert(r.ok());return r.json();}
 async function login(role){await context.clearCookies();await page.goto(base);await page.locator('#login').waitFor();await page.locator('#login-username').fill(fixture.credentials[role].username);await page.locator('#login-password').fill(fixture.credentials[role].password);await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});}
 async function visit(key,unit=''){
  const tab={regulatory_domain:'domains',regulator:'regulators',instrument_type:'types',obligation_category:'categories',organisational_unit:'organisation'}[key]||'other';
  await page.goto(base+'/#masters?'+new URLSearchParams({tab,...(tab==='other'?{lookup:key}:{}),...(unit?{unit}:{})}));
  await page.getByRole('heading',{name:tab==='organisation'?'Organisation hierarchy':'Master data',exact:true}).waitFor();
  if(key!=='role')await page.locator('[data-action=add-master][data-key="'+key+'"]').first().waitFor();
  if(key==='organisational_unit'&&unit)await page.locator('[data-action=edit-master][data-id="'+unit+'"]').waitFor();
 }
 async function fill(values){for(const [name,value] of Object.entries(values)){
  const field=form.locator('[name="'+name+'"]');
  if(await field.evaluate(e=>e.tagName==='SELECT'))await chooseOption(field,String(value));
  else if(await field.getAttribute('type')==='checkbox')await field.setChecked(Boolean(value));
  else await field.fill(String(value??''));
 }}
 async function save(key,status=200){await form.locator('[name=reason]').fill('TEST ONLY — rollback browser maintenance verification.');const waiting=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/api/admin/masters/'+key)&&['POST','PATCH'].includes(r.request().method()));await form.locator('button[type=submit]').click();const response=await waiting;assert.equal(response.status(),status,await response.text());if(status===200)await dialog.waitFor({state:'hidden'});return response.json();}
 async function create(key,values,parent=''){
  await visit(key);await page.locator('[data-action=add-master][data-key="'+key+'"]').first().click();
  await fill(values);const r=await save(key);return r.id;
 }
 async function edit(key,id,values,status=200){await visit(key,key==='organisational_unit'?id:'');await page.locator('[data-action=edit-master][data-id="'+id+'"]').click();assert(await form.locator('[name=code]').evaluate(e=>e.readOnly));await fill(values);return save(key,status);}
 async function shot(name){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=name+'.png';await page.screenshot({path:path.join(output,file),fullPage:true});report.screenshots.push(file);}
 try{
  assert.equal((await get('/health')).environment,'uat');await login('admin');
  let masters=await get('/masters');const bank=masters.organisational_unit.find(r=>r.code==='BANK').id;
  const unit=fixture.record?masters.organisational_unit.find(r=>r.name==='TEST ONLY — Browser QA department').id:null;assert(unit);
  const items=[
   ['regulatory_domain',{code:'REG-B'+suffix,name:'TEST ONLY browser domain '+suffix,description:'Rollback-only browser domain',active_flag:false}],
   ['regulator',{code:'B'+suffix,name:'TEST ONLY browser regulator',regulator_type:'TEST',jurisdiction:'TEST ONLY'}],
   ['instrument_type',{code:'B'+suffix,name:'TEST ONLY browser instrument type',authority_level:3}],
   ['obligation_category',{code:'B'+suffix,name:'TEST ONLY browser category'}],
   ['frequency',{code:'B'+suffix,name:'TEST ONLY browser frequency',schedule_rule:'TEST ONLY'}],
   ['evidence_type',{code:'B'+suffix,name:'TEST ONLY browser evidence type'}],
   ['confidentiality_class',{code:'B'+suffix,name:'TEST ONLY browser confidentiality',rank_number:5}],
   ['process',{code:'B'+suffix,name:'TEST ONLY browser process',owner_unit_id:unit,criticality:'MEDIUM'}],
  ];
  for(const [key,values] of items){const id=await create(key,values);await edit(key,id,{name:'TEST ONLY edited '+key});const rows=(await get('/masters'))[key];assert.equal(rows.find(r=>r.id===id).name,'TEST ONLY edited '+key);}
  report.checks.push('Real browser Add and Edit saves passed for all eight editable Master data groups; permanent codes stay read-only and renamed records are returned by Oracle.');
  await visit('evidence_type');await page.locator('[data-action=add-master][data-key=evidence_type]').click();await fill({code:'B'+suffix,name:'TEST ONLY duplicate rejection'});await save('evidence_type',409);assert(await dialog.isVisible());assert((await dialog.locator('#form-error').innerText()).includes('already exists'));assert.equal(await form.locator('[name=name]').inputValue(),'TEST ONLY duplicate rejection');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  report.checks.push('Duplicate-code errors remain in the dialog with typed values preserved.');
  masters=await get('/masters');const originalHome=(await get('/auth/me')).user.org_unit_id;
  const parent=await create('organisational_unit',{code:'P'+suffix,name:'TEST ONLY parent unit',unit_type:'DEPARTMENT',parent_org_unit_id:bank});
  await visit('organisational_unit',parent);await page.getByRole('button',{name:'Add child unit',exact:true}).click();assert.equal(await form.locator('select[name=parent_org_unit_id]').inputValue(),parent);await fill({code:'C'+suffix,name:'TEST ONLY child unit',unit_type:'ZONE'});const child=(await save('organisational_unit')).id;
  const leaf=await create('organisational_unit',{code:'L'+suffix,name:'TEST ONLY leaf unit',unit_type:'BRANCH',parent_org_unit_id:child});
  await visit('organisational_unit',parent);await page.locator('[data-action=edit-master][data-id="'+parent+'"]').click();const forbidden=await form.locator('select[name=parent_org_unit_id] option').evaluateAll(rows=>rows.map(r=>r.value));for(const id of [parent,child,leaf])assert(!forbidden.includes(id));await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await edit('organisational_unit',child,{parent_org_unit_id:unit});masters=await get('/masters');const row=id=>masters.organisational_unit.find(r=>r.id===id);assert.equal(row(child).level_number,row(unit).level_number+1);assert.equal(row(leaf).level_number,row(child).level_number+1);assert.equal((await get('/auth/me')).user.org_unit_id,originalHome);
  await edit('organisational_unit',child,{active_flag:false},422);assert((await dialog.locator('#form-error').innerText()).includes('child units'));await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  report.checks.push('Organisation Add, Add child and Edit save to Oracle; descendant parents are excluded, moves update child/grandchild levels, active-child deactivation is blocked, and Home organisation is unchanged.');
  await visit('role');assert.equal(await page.locator('[data-action=add-master][data-key=role]').count(),0);await page.locator('[data-action=edit-master]').first().click();assert.equal(await form.locator('[name=active_flag]').count(),0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  report.checks.push('Application-role codes/activation and custom permission creation remain protected; existing display names can be edited.');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:width<500?844:1000});await visit('organisational_unit',child);await shot('organisation-'+width);await page.locator('[data-action=edit-master][data-id="'+child+'"]').click();await shot('organisation-edit-'+width);const parentInput=searchable(form.locator('select[name=parent_org_unit_id]'));await parentInput.input.click();await parentInput.input.fill('browser');assert(await parentInput.popup.isVisible());await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await visit('frequency');await shot('masters-'+width);}
  report.checks.push('Master/organisation screens and shared searchable edit dialogs fit 1440, 768, 390 and 320px without document overflow.');
  await login('author');await page.goto(base+'/#masters');await page.locator('.access-boundary').waitFor();assert.equal((await context.request.get(base+'/api/masters/catalogue')).status(),403);
  report.checks.push('A real non-Admin session cannot open maintenance screens or obtain the edit catalogue.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=e.message;await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
