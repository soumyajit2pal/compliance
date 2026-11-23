// Real Week 4 UI/API flow on the explicit rollback-only browser fixture.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const out=path.resolve(process.env.CBD_OBLIGATION_QA_OUTPUT||path.join(root,'outputs/week-4-2026-11-01/browser'));
const report={checks:[],browser_errors:[],blocked_writes:[],external_requests:[],screenshots:[]};
let browser,page,secrets;
const allowed=new Set(),created=[];
const redact=value=>Object.values(secrets?.credentials||{}).reduce((text,item)=>text.split(item.password).join('[redacted]'),String(value));
(async()=>{await fs.mkdir(out,{recursive:true});try{
 const secretPath=path.join(root,'var/browser-fixture-secrets.json');assert.equal((await fs.stat(secretPath)).mode&0o077,0);
 secrets=JSON.parse(await fs.readFile(secretPath,'utf8'));const fixture=secrets.obligations;assert(fixture?.draft,'Start CBD_OBLIGATION_BROWSER_QA=1 fixture.');allowed.add(fixture.draft);
 browser=await chromium.launch({headless:true,channel:'chrome'});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base){report.external_requests.push(url.origin);return route.abort();}
  if(!['GET','HEAD','OPTIONS'].includes(request.method())){
   let valid=['/api/auth/login','/api/auth/logout','/api/obligation-imports'].includes(url.pathname);
   if(url.pathname==='/api/obligations'&&request.method()==='POST'){const body=request.postDataJSON();valid=body.primary_clause_id===fixture.clause_id&&body.regulatory_owner_unit_id===fixture.unit;}
   const obligation=/^\/api\/obligations\/([^/]+)(?:\/(submit|decision|revisions|activate))?$/.exec(url.pathname);
   if(obligation)valid=allowed.has(obligation[1]);
   if(/^\/api\/obligation-imports\/[^/]+\/(validate|load)$/.test(url.pathname))valid=true;
   if(!valid){report.blocked_writes.push(url.pathname);return route.abort();}
  }
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',error=>report.browser_errors.push(redact(error.message)));
 page.on('response',async response=>{if(response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/obligations'&&response.ok()){const value=await response.json();allowed.add(value.id);created.push(value.id);}});
 const login=async name=>{
  await page.goto(base+'/');await page.waitForSelector('#login, .app-shell');const signOut=page.getByRole('button',{name:'Sign out',exact:true});
  if(await signOut.isVisible())await signOut.click();
  await page.locator('#login-username').fill(secrets.credentials[name].username);await page.locator('#login-password').fill(secrets.credentials[name].password);
  await page.locator('#login button[type=submit]').click();await page.locator('.app-shell').waitFor();
 };
 let navigation=0;
 const open=async hash=>{await page.goto(base+'/?browserqa='+(++navigation)+'#'+hash);await page.locator('#main-content h1').waitFor();};
 const select=async(locator,value)=>{await locator.selectOption(String(value),{force:true});};
 const rowSelect=async(row,key,value)=>select(row.locator('[data-obl-field='+key+']'),value);
 const add=async kind=>{if(kind==='owners'){const details=page.locator('#obligation-editor details').filter({has:page.locator('[data-other-owner-list]')}).first();if(await details.count()&&(await details.getAttribute('open'))===null)await details.locator(':scope>summary').click();}await page.locator('[data-action=obl-add-row][data-kind='+kind+']:not([data-role])').click();return page.locator('[data-obl-row='+kind+']').last();};
 const decision=async(name,choice,label)=>{
  await login(name);await open('obligations/'+identifier+'?tab=workflow');
  await page.locator('[data-action=obl-decision][data-decision='+choice+']').first().click();await page.locator('#obl-decision-form [name=comments]').fill('TEST ONLY browser independent '+choice.toLowerCase()+' decision.');
  await page.locator('#obl-decision-form button[type=submit]').click();await page.locator('#obl-decision-form').waitFor({state:'hidden'});
 };
 await login('author');await open('clauses?clause='+fixture.clause_id);
 await page.getByRole('link',{name:'Create obligation from this clause',exact:true}).click();await page.locator('#obligation-editor').waitFor();
 assert.equal(await page.locator('[name=primary_clause_id]').inputValue(),fixture.clause_id);
 assert.equal(await page.locator('.obligation-wizard [data-step-label]').count(),7);
 assert.equal(await page.locator('[name=wizard_instrument_id]').inputValue(),secrets.record.id);
 const editor=page.locator('#obligation-editor');
 const continueStep=async expected=>{await editor.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForFunction(index=>document.querySelector('#obligation-editor').dataset.wizard===String(index),expected);};
 await page.screenshot({path:path.join(out,'source-step-desktop.png')});report.screenshots.push('source-step-desktop.png');
 let earlyWrites=0;const watch=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/obligations')earlyWrites++;};page.on('request',watch);
 await editor.getByRole('button',{name:'Save draft',exact:true}).click();assert.equal(await editor.getAttribute('data-wizard'),'1');assert.equal(earlyWrites,0);page.off('request',watch);
 report.checks.push('Seven-question white/plum source-pinned wizard uses an instrument/edition-filtered searchable primary clause; early Save reveals missing fields without an API write.');
 const title='TEST ONLY browser owned obligation '+Date.now();const payload=fixture.payload;
 for(const key of ['statement','internal_interpretation','breach_consequence'])await editor.locator('[name='+key+']').fill(payload[key]);
 await editor.locator('[name=title]').fill(title);await select(editor.locator('[name=category_id]'),payload.category_id);
 await editor.locator('[data-action=obl-wizard-back]').click();assert.equal(await editor.getAttribute('data-wizard'),'0');await continueStep(1);assert.equal(await editor.locator('[name=title]').inputValue(),title);
 await continueStep(2);
 const scope=await add('applicability');await rowSelect(scope,'legal_entity_id',fixture.legal_entity);await rowSelect(scope,'org_unit_id',fixture.unit);
 await rowSelect(scope,'applicability_status','PARTIALLY_APPLICABLE');await scope.locator('[data-obl-field=basis]').fill('TEST ONLY assessed basis for the retail scope.');
 await editor.getByRole('button',{name:'Continue',exact:true}).click();assert.equal(await editor.getAttribute('data-wizard'),'2');
 await scope.locator('[data-obl-field=conditions]').fill('Only the specified retail onboarding channel is applicable.');
 await continueStep(3);const process=await add('processes');await rowSelect(process,'process_id',fixture.process);await rowSelect(process,'relevance_type','PRIMARY');await continueStep(4);
 await select(editor.locator('[name=business_owner_unit_id]'),payload.business_owner_unit_id);
 const primaryBusiness=payload.owners.find(owner=>owner.owner_role==='BUSINESS'&&owner.primary_owner_flag);await editor.locator('[data-primary-business-owner] [data-obl-field=user_id] option[value="'+primaryBusiness.user_id+'"]').waitFor({state:'attached'});await select(editor.locator('[data-primary-business-owner] [data-obl-field=user_id]'),primaryBusiness.user_id);
 for(const owner of payload.owners.filter(owner=>!(owner.owner_role==='BUSINESS'&&owner.primary_owner_flag))){if(owner.owner_role==='REGULATORY'&&await editor.locator('[data-setup-source-owner]').count())continue;const row=await add('owners');await rowSelect(row,'owner_role',owner.owner_role);await rowSelect(row,'org_unit_id',owner.org_unit_id);
  await row.locator('[data-obl-field=user_id] option[value="'+owner.user_id+'"]').waitFor({state:'attached'});await rowSelect(row,'user_id',owner.user_id);
  if(owner.primary_owner_flag)await row.locator('[data-obl-field=primary_owner_flag]').check();
 }
 await continueStep(5);await editor.locator('[name=evidence_standard]').fill(payload.evidence_standard);
 await select(editor.locator('[name=frequency_id]'),payload.frequency_id);
 await continueStep(6);await select(editor.locator('[name=compliance_reviewer_user_id]'),payload.compliance_reviewer_user_id);await page.locator('[data-obl-review]').getByText(title,{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'review-step-desktop.png')});report.screenshots.push('review-step-desktop.png');
 report.checks.push('Back/Continue retain all entries; Partial applicability validates its limitations in the correct step and the final shared summary includes metadata, owners, assessments and processes.');
 const save=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/obligations'&&response.request().method()==='POST');
 await page.locator('#obligation-editor').getByRole('button',{name:'Save draft',exact:true}).click();const saved=await save;assert.equal(saved.status(),200);const identifier=(await saved.json()).id;allowed.add(identifier);
 await page.waitForURL(url=>url.hash==='#obligations/'+identifier);await page.getByRole('heading',{name:title,exact:true}).waitFor();
 report.checks.push('Native shared searchable controls capture metadata, primary owners, partial applicability and process mapping into a real Draft.');
 await page.getByRole('link',{name:'Edit Draft',exact:true}).click();await page.locator('#obligation-editor').waitFor();
 assert.equal(await page.locator('[name=title]').inputValue(),title);assert.equal(await page.locator('[data-obl-row=owners]').count(),payload.owners.length);
 await page.locator('[data-action=obl-wizard-go][data-step-target="1"]').click();
 await page.getByText('Classification details',{exact:true}).click();await page.locator('[name=change_reason]').fill('TEST ONLY saved Draft wording verification.');await page.locator('#obligation-editor').getByRole('button',{name:'Save draft',exact:true}).click();await page.waitForURL(url=>url.hash==='#obligations/'+identifier);
 await page.locator('[data-action=obl-submit]').click();await select(page.locator('#obl-submit-form [name=approver_id]'),fixture.users.approver);
 await page.locator('#obl-submit-form [name=comments]').fill('TEST ONLY browser complete obligation submission.');await page.locator('#obl-submit-form button[type=submit]').click();await page.locator('#obl-submit-form').waitFor({state:'hidden'});
 report.checks.push('Draft edit retains identity/arrays and submits to an eligible independent approver.');
 await decision('reviewer','REVIEW');await decision('business','OBJECT');
 await login('author');await open('obligations/'+identifier);assert(await page.getByRole('link',{name:'Edit Draft',exact:true}).isVisible());
 await page.getByRole('link',{name:'History & decisions',exact:true}).click();await page.getByText('Changes requested by owner',{exact:true}).first().waitFor();
 await page.locator('[data-action=obl-submit]').click();await select(page.locator('#obl-submit-form [name=approver_id]'),fixture.users.approver);await page.locator('#obl-submit-form [name=comments]').fill('TEST ONLY revised submission after owner objection.');await page.locator('#obl-submit-form button[type=submit]').click();await page.locator('#obl-submit-form').waitFor({state:'hidden'});
 await decision('reviewer','REVIEW');await decision('business','ACCEPT');
 await login('approver');await open('obligations/'+identifier+'?tab=workflow');assert.equal(await page.locator('[data-action=obl-decision][data-decision=APPROVE]').count(),0);
 await decision('control','ACCEPT');if(payload.owners.some(owner=>owner.owner_role==='EVIDENCE'))await decision('evidence','ACCEPT');await decision('approver','APPROVE');
 const active=await (await context.request.get(base+'/api/obligations/'+identifier)).json();assert.equal(active.obligation.record_status,'ACTIVE');assert.equal(active.applicability[0].approval_status,'APPROVED');
 report.checks.push('Real UI review → owner objection → resubmission → owner/control acceptance → approval activates the obligation and applicability; the early approver has no decision button.');
 await login('author');await open('obligations/'+identifier+'?tab=owners');assert.equal(await page.getByRole('link',{name:'Edit Draft',exact:true}).count(),0);
 await page.screenshot({path:path.join(out,'ownership-desktop.png')});report.screenshots.push('ownership-desktop.png');
 await page.getByRole('button',{name:'Create revision',exact:true}).click();await page.locator('#obl-revision-form [name=reason]').fill('TEST ONLY approved ownership revision without overwriting the active record.');
 const revisionResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/obligations/'+identifier+'/revisions');await page.locator('#obl-revision-form button[type=submit]').click();const revised=await (await revisionResponse).json();allowed.add(revised.id);
 await page.waitForURL(url=>url.hash==='#obligations/'+revised.id+'?edit=1');assert.equal((await (await context.request.get(base+'/api/obligations/'+identifier)).json()).obligation.record_status,'ACTIVE');
 report.checks.push('Approved content is read-only; Create revision creates an editable next version while the old one remains Active.');
 await open('notification-families/'+secrets.record.id+'?tab=obligations');assert(await page.getByRole('link',{name:new RegExp(active.obligation.code)}).first().isVisible());
 report.checks.push('Notification families opens the real approved linked obligation without exposing later action/control transaction panels.');

 // Native download/upload, independent import review, and Draft-only loading.
 const workbook=await context.request.get(base+'/api/obligation-import-template');assert.equal(workbook.status(),200);
 const templatePath=path.join(root,'var/browser-obligation-template.xlsx'),filledPath=path.join(root,'var/browser-obligation-filled.xlsx');await fs.writeFile(templatePath,await workbook.body(),{mode:0o600});
 const importTitle='TEST ONLY distinct browser imported requirement '+Date.now();
 const fill=spawnSync(path.join(root,'.venv/bin/python'),['-c',`import io,json,sys\nfrom pathlib import Path\nfrom openpyxl import load_workbook\nfrom backend.app.obligation_import_template import canonical_header\nroot=Path(sys.argv[1]);s=json.loads((root/'var/browser-fixture-secrets.json').read_text());p=s['obligations']['payload'];b=load_workbook(root/'var/browser-obligation-template.xlsx');b.remove(b['References']);p={**p,'title':sys.argv[2],'import_reference':'BROWSER-OBL-IMPORT','legacy_reference':'TEST-OLD-01'}\nfor name,values in [('Obligations',[p]),('Owners',p['owners']),('Applicability',p['applicability']),('Processes',p['processes'])]:\n h=[canonical_header(name,c.value) for c in b[name][1]]\n for row,v in enumerate(values,2):\n  for column,k in enumerate(h,1):b[name].cell(row,column,p['import_reference'] if k=='import_reference' else v.get(k))\nb.save(root/'var/browser-obligation-filled.xlsx');bad=b['Owners'];bad.cell(2,[canonical_header('Owners',c.value) for c in bad[1]].index('user_id')+1,'missing-browser-owner');b.save(root/'var/browser-obligation-bad.xlsx')`,root,importTitle],{cwd:root,encoding:'utf8'});assert.equal(fill.status,0,fill.stderr);
 await open('obligations/imports');await page.locator('[data-action=obl-import-new]').click();await page.locator('#obl-import-upload [name=source_system]').fill('TEST ONLY browser import '+Date.now());await page.locator('#obl-import-upload [name=file]').setInputFiles(path.join(root,'var/browser-obligation-bad.xlsx'));
 await page.locator('#obl-import-upload button[type=submit]').click();await page.waitForURL(url=>url.hash.startsWith('#obligations/imports?batch='));const badBatchId=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('batch');
 assert.equal(await page.locator('[data-action=obl-import-confirm]').count(),0);
 await page.getByText('Named owner: choose one listed name or enter an exact reference or username.',{exact:false}).first().waitFor();
 const badRow=page.locator('tr').filter({hasText:'Owners · 2'});await badRow.getByText('Original row values',{exact:true}).click();await badRow.getByText('missing-browser-owner',{exact:true}).waitFor();
 await page.locator('[data-action=obl-import-correct]').click();
 assert.equal(await page.locator('#obl-import-upload [name=replaces_batch_id]').inputValue(),badBatchId);
 await page.locator('#obl-import-upload [name=file]').setInputFiles(filledPath);
 await page.locator('#obl-import-upload button[type=submit]').click();
 await page.waitForURL(url=>url.hash.startsWith('#obligations/imports?batch=')&&!url.hash.includes(badBatchId));
 const batchId=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('batch');
 await page.getByText('the retained earlier workbook',{exact:true}).waitFor();
 await page.locator('details summary').filter({hasText:'Review requirement, source'}).first().click();
 await page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Mapped obligation · BROWSER-OBL-IMPORT',exact:true})}).getByText(importTitle,{exact:true}).waitFor();
 report.checks.push('Invalid owner findings remain visible; a linked corrected workbook preserves the rejected original and exposes mapped values using the shared read-only summary.');
 await login('reviewer');await open('obligations/imports?batch='+batchId);await page.locator('[data-action=obl-import-validate]').click();await page.locator('[data-action=obl-import-validate]').waitFor({state:'detached'});
 await login('author');await open('obligations/imports?batch='+batchId);await page.locator('[data-action=obl-import-confirm]').click();await page.locator('#obl-import-load button[type=submit]').click();await page.locator('#obl-import-load').waitFor({state:'hidden'});
 await page.getByRole('link',{name:'Open Draft obligation',exact:true}).first().waitFor();const imported=await (await context.request.get(base+'/api/obligation-imports/'+batchId)).json();const importedId=imported.rows[0].target_entity_id;allowed.add(importedId);
 assert.equal((await (await context.request.get(base+'/api/obligations/'+importedId)).json()).obligation.approval_status,'DRAFT');
 const original=await context.request.get(base+'/api/obligation-imports/'+batchId+'/source');assert.deepEqual(await original.body(),await fs.readFile(filledPath));
 report.checks.push('Actual Excel preview retains lineage; only the independent Reviewer can validate, and the uploader loads complete Draft groups with byte-identical original download.');
 await fs.unlink(templatePath);await fs.unlink(filledPath);

 const identity=await (await context.request.get(base+'/api/auth/me')).json();const marker='TEST ONLY pagination '+Date.now();
 for(let i=0;i<27;i++){
  const result=await context.request.post(base+'/api/obligations',{headers:{Origin:base,'X-CSRF-Token':identity.csrf_token},data:{...payload,title:marker+' '+i}});assert.equal(result.status(),200);allowed.add((await result.json()).id);
 }
 await open('obligations?q='+encodeURIComponent(marker));const paging=page.locator('[data-pagination-key=obligations]');await paging.getByText('Showing 1–25 of 27 records',{exact:false}).waitFor();
 await paging.getByRole('link',{name:'Next page',exact:true}).click();await page.waitForURL(url=>url.hash.includes('page.obligations=2'));await paging.getByText('Showing 26–27 of 27 records',{exact:false}).waitFor();
 await page.reload();await paging.getByText('Showing 26–27 of 27 records',{exact:false}).waitFor();
 report.checks.push('Shared server-response pagination defaults to 25, returns the next page and retains filters/page after reload.');
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await open('obligations/'+identifier+'?tab=applicability');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await open('obligations/'+revised.id+'?edit=1');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 await page.screenshot({path:path.join(out,'obligation-editor-mobile.png')});report.screenshots.push('obligation-editor-mobile.png');
 report.checks.push('320px/390px editor and applicability layouts avoid document overflow and retain searchable dropdowns and existing loading feedback.');
 await page.setViewportSize({width:1440,height:1000});await login('admin');await page.goto(base+'/#obligations');await page.getByText('This area is outside your role scope',{exact:true}).waitFor();
 assert.equal((await context.request.get(base+'/api/obligations/'+identifier)).status(),404);
 assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.external_requests,[]);assert.deepEqual(report.blocked_writes,[]);
 report.checks.push('Technical Admin cannot open obligation content or approve it. No external request, bank LDAP call, non-fixture business write or JavaScript error occurred.');
 report.status='passed';
 }catch(error){report.status='failed';report.error=redact(error.stack);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;
 }finally{if(browser)await browser.close();for(const filename of ['browser-obligation-template.xlsx','browser-obligation-filled.xlsx','browser-obligation-bad.xlsx'])await fs.unlink(path.join(root,'var',filename)).catch(()=>{});await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}
})();
