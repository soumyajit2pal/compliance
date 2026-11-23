// Writes only synthetic imports on the rollback-only fixture (never port 8010).
const {chromium}=require(process.argv[2]||'playwright');
const {chooseOption}=require('./helpers/searchable-select.cjs');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const output=path.resolve(process.env.CBD_COMBINED_IMPORT_QA_OUTPUT||path.join(root,'outputs/combined-import-2026-10-31/browser'));
const report={status:'running',environment:'Local rollback-only Oracle fixture on 8011',checks:[],screenshots:[],browser_errors:[],prohibited_writes:[]};
const ownBatches=new Set();
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const fixture=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'}),page=await context.newPage();
 page.on('pageerror',e=>report.browser_errors.push(e.message));
 await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){
   const ownAction=[...ownBatches].some(id=>new RegExp('^/api/migration/'+id+'/(validate|load|reprofile)$').test(url.pathname));
   if(!['/api/auth/login','/api/auth/logout','/api/migration'].includes(url.pathname)&&!ownAction){report.prohibited_writes.push({method:request.method(),path:url.pathname});return route.abort('blockedbyclient');}
  }
  return route.continue();
 });
 async function get(url){const r=await context.request.get(base+'/api'+url);assert(r.ok(),await r.text());return r.json();}
 async function login(role){await context.clearCookies();await page.goto(base);await page.locator('#login').waitFor();await page.locator('#login-username').fill(fixture.credentials[role].username);await page.locator('#login-password').fill(fixture.credentials[role].password);await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});}
 async function batch(id){assert(ownBatches.has(id));await page.goto(base+'/#migration/'+id);await page.locator('.import-preview').waitFor();}
 async function shot(name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Document overflow at '+name);report.screenshots.push(name+'.png');}
 async function submit(action,id){assert(ownBatches.has(id));await page.locator('[data-action="'+action+'-batch"]').click();const form=page.locator('#dialog form');if(action==='validate')await form.getByRole('checkbox').check();const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/migration/'+id+'/'+action&&r.request().method()==='POST');await form.locator('button[type=submit]').click();const result=await response;assert.equal(result.status(),200,await result.text());await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('.import-preview').waitFor();return result.json();}
 try{
  await login('author');
  const me=await get('/auth/me'),masters=await get('/masters');
  const unit=masters.organisational_unit.find(u=>u.id===me.user.org_unit_id);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const suffix=Date.now().toString(36).toUpperCase();
  const header=ref=>({title:'TEST ONLY combined '+ref+' '+suffix+' <img src=x onerror="window.qaInjection=1">',
   official_reference_number:'TEST-COMBINED-'+ref+'-'+suffix,regulator_code:'RBI',domain_code:'REG-KYC',instrument_type_code:'MD',
   materiality:'HIGH',confidentiality_code:'INTERNAL',department_code:unit.code,owner_username:me.user.username,
   issue_date:date,effective_date:date,import_reference:ref,source_edition:'1.0',source_file_name:'qa-source.txt'});
  const provision=(ref,number,parent='',group='QA_GOOD')=>({import_reference:group,clause_import_reference:ref,parent_import_reference:parent,
   source_clause_reference:number,heading:'TEST ONLY heading '+ref,source_page_reference:'Page 5',
   clause_text:'TEST ONLY original '+ref+' <script>window.qaInjection=1</script>',internal_interpretation:'TEST ONLY separate bank interpretation '+ref});
  const source=Buffer.from('TEST ONLY authoritative browser source. Not a bank notification.');
  const workbook=execFileSync(path.join(root,'.venv/bin/python'),['-c',
   'import sys,json; from backend.tests.test_combined_import import workbook; data=json.load(sys.stdin); sys.stdout.buffer.write(workbook(data["records"],data["clauses"]))'],
   {cwd:root,input:JSON.stringify({records:[header('QA_GOOD'),header('QA_BAD')],clauses:[provision('C3','5.1.1','C2'),provision('C1','5'),provision('C4','5.10','C1'),provision('C2','5.1','C1'),provision('BAD','9.1','MISSING','QA_BAD')]}),maxBuffer:10*1024*1024});
  await page.goto(base+'/#migration');await page.locator('[data-action=stage]').waitFor();
  const downloadWait=page.waitForEvent('download');await page.locator('a[href="/api/migration-template?format=xlsx"]').click();
  assert.equal((await downloadWait).suggestedFilename(),'regulatory-records-and-clauses-template.xlsx');
  await page.locator('[data-action=stage]').click();await page.locator('#stage [name=source_system]').fill('TEST ONLY browser combined import');
  await page.locator('#stage [name=file]').setInputFiles({name:'TEST-ONLY-combined.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook});
  await page.locator('#stage [name=source_files]').setInputFiles({name:'qa-source.txt',mimeType:'text/plain',buffer:source});
  await shot('upload-with-files-1440');
  const staged=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/migration'&&r.request().method()==='POST');
  await page.locator('#stage button[type=submit]').click();const response=await staged;assert.equal(response.status(),200,await response.text());
  const id=(await response.json()).id;ownBatches.add(id);await page.locator('.import-preview').waitFor();
  let data=await get('/migration/'+id);assert.deepEqual(data.populations,{CONTENT_VALIDATION_PENDING:5,CORRECTION_REQUIRED:2});
  report.checks.push('The shared upload dialog sends a combined workbook and source file in one request; no target records are created before validation.');
  const good=()=>page.locator('details.import-group').filter({hasText:'QA_GOOD'});
  await good().locator('summary').first().click();
  assert.deepEqual(await good().locator('.import-source-number').allTextContents(),['5','5.1','5.1.1','5.10']);
  const depths=await good().locator('.import-clause-preview > li').evaluateAll(rows=>rows.map(r=>r.style.getPropertyValue('--clause-depth')));
  assert.deepEqual(depths,['0','1','2','1']);
  await good().locator('.import-wording summary').first().click();assert((await good().innerText()).includes('TEST ONLY separate bank interpretation C1'));
  assert.equal(await page.evaluate(()=>window.qaInjection),undefined);
  report.checks.push('Preview uses parent-first hierarchy even when children precede parents in Excel; numeric sibling ordering preserves 5.10, and original/interpretation text stays separate and escaped.');
  const bad=page.locator('details.import-group').filter({hasText:'QA_BAD'});await bad.locator('summary').first().click();
  assert((await bad.innerText()).includes('outside this record and edition'));
  assert.equal(await page.locator('[data-action=load-batch]').count(),0);
  report.checks.push('Missing parents keep the complete affected group correction-required and prevent early Draft loading.');
  await page.locator('.import-preview').scrollIntoViewIfNeeded();await shot('validation-preview-1440');
  await chooseOption(page.locator('select[name=entity]'),'clause','Clauses');
  await page.locator('#view-filter button[type=submit]').click();await page.waitForURL(/entity=clause/);await page.locator('.import-preview').waitFor();
  assert.equal(await page.locator('select[name=entity]').inputValue(),'clause');assert.equal(await page.locator('details.import-group').count(),2);
  await batch(id);
  report.checks.push('Record-type filtering uses the shared searchable select and retains whole hierarchy groups for context.');
  await login('reviewer');await batch(id);
  const sourceResponse=await context.request.get(base+'/api/migration/'+id+'/sources/'+data.sources[0].id);assert.equal(sourceResponse.status(),200);assert.deepEqual(await sourceResponse.body(),source);
  assert.equal((await submit('validate',id)).validated,5);
  assert.equal(await page.locator('[data-action=load-batch]').count(),0);
  report.checks.push('A different Reviewer can download the hash-checked source and independently validate the complete eligible group; the invalid group remains pending.');
  await login('author');await batch(id);assert.equal((await submit('load',id)).loaded,5);
  data=await get('/migration/'+id);assert.equal(data.batch.loaded_count,5);assert.equal(data.batch.pending_count,2);assert(data.reconciled);
  const record=data.rows.find(r=>r.profile.group_reference==='QA_GOOD'&&r.target_entity_type==='instrument');
  const detail=await get('/instruments/'+record.target_entity_id);assert.equal(detail.instrument.approval_status,'DRAFT');
  const clauses=Object.fromEntries(detail.clauses.map(r=>[r.source_clause_reference,r]));
  assert.equal(clauses['5.1'].parent_clause_id,clauses['5'].id);assert.equal(clauses['5.1.1'].parent_clause_id,clauses['5.1'].id);
  assert.equal(clauses['5.10'].parent_clause_id,clauses['5'].id);assert(detail.clauses.every(r=>r.instrument_version_id===detail.versions[0].id&&r.approval_status==='DRAFT'));
  assert.equal(detail.versions[0].current_version_flag,0);
  report.checks.push('Loading creates only Draft targets, resolves permanent same-edition parents and retains loaded/pending row reconciliation.');
  await good().locator('summary').first().click();
  const clauseLink=good().locator('a[href*="clause='+clauses['5.1.1'].id+'"]').first();await clauseLink.click();
  await page.waitForURL(url=>url.hash.includes('clause='+clauses['5.1.1'].id));
  await page.locator('#working-clause-heading').waitFor();assert((await page.locator('#working-clause-heading').innerText()).includes('C3'));
  report.checks.push('Loaded clause links open the actual Clause workspace and preserve the imported hierarchy.');
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});await batch(id);await good().locator('summary').first().click();
   await page.locator('.import-preview').scrollIntoViewIfNeeded();await shot('preview-'+width);
   await good().locator('.import-clause-preview').scrollIntoViewIfNeeded();await shot('hierarchy-'+width);
   await page.goto(base+'/#migration');await page.locator('[data-action=stage]').waitFor();await page.locator('[data-action=stage]').click();await shot('upload-'+width);
   await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  }
  report.checks.push('Upload dialogs, validation previews and hierarchy rows fit desktop, tablet and 390/320px phone layouts.');
  await login('admin');await page.goto(base+'/#migration');await page.locator('.access-boundary').waitFor();
  assert.equal((await context.request.get(base+'/api/migration/'+id)).status(),403);
  report.checks.push('Admin alone does not acquire regulatory import or source-content authority.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png'),fullPage:false}).catch(()=>{});throw error;}
 finally{report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
