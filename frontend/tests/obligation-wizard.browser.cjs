// Focused wizard actions against the explicit rollback-only Week 4 fixture.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011',out=path.resolve(root,process.env.CBD_WIZARD_QA_OUTPUT||'outputs/obligation-wizard-2026-11-01');
(async()=>{await fs.mkdir(out,{recursive:true});let browser,credentials={};const report={checks:[],errors:[],blocked_writes:[],external_requests:[]};try{
 const secret=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8')),fixture=secret.obligations;credentials=secret.credentials;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.origin!==base){report.external_requests.push(u.origin);return route.abort();}
  if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['/api/auth/login','/api/auth/logout','/api/obligations/'+fixture.draft,'/api/obligations/'+fixture.draft+'/submit'].includes(u.pathname)){report.blocked_writes.push(u.pathname);return route.abort();}return route.continue();});
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(base);await page.locator('#login-username').fill(secret.credentials.author.username);await page.locator('#login-password').fill(secret.credentials.author.password);await page.locator('#login button[type=submit]').click();await page.locator('.app-shell').waitFor();
 await page.goto(base+'/?wizardqa=1#repository/new');const instrument=page.locator('#instrument');await instrument.waitFor();await instrument.locator('[data-action=wizard-next]').click();assert.equal(await instrument.getAttribute('data-wizard'),'0');
 await instrument.locator('[name=title]').fill('TEST ONLY shared wizard validation');await instrument.locator('[data-action=wizard-next]').click();assert.equal(await instrument.getAttribute('data-wizard'),'1');await instrument.locator('[data-action=wizard-back]').click();assert.equal(await instrument.locator('[name=title]').inputValue(),'TEST ONLY shared wizard validation');
 report.checks.push('Existing instrument wizard shares validation/navigation and retains required-field blocking, Back and entered values. No instrument was created.');
 await page.goto(base+'/?wizardqa=2#obligations/'+fixture.draft+'?edit=1');const form=page.locator('#obligation-editor');await form.waitFor();
 await form.locator('[name=wizard_instrument_id]').selectOption('',{force:true});assert.equal(await form.locator('[name=primary_clause_id]').inputValue(),'');
 await form.getByRole('button',{name:'Continue',exact:true}).click();assert.equal(await form.getAttribute('data-wizard'),'0');
 await form.locator('[name=wizard_instrument_id]').selectOption(secret.record.id,{force:true});await form.locator('[name=primary_clause_id]').selectOption(fixture.clause_id,{force:true});
 await form.locator('[name=compliance_reviewer_user_id] option[value="'+fixture.users.reviewer+'"]').waitFor({state:'attached'});await form.locator('[name=compliance_reviewer_user_id]').selectOption(fixture.users.reviewer,{force:true});
 report.checks.push('Changing the approved instrument clears the primary clause and stale reviewer; source selection reloads eligible recipients and prevents advancing without a source.');
 await page.locator('[data-action=obl-wizard-go][data-step-target="6"]').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#obligation-editor').dataset.wizard==='6');
 assert.equal(await page.locator('[data-step-label="6"]').getAttribute('aria-current'),'step');
 await form.locator('[name=wizard_final_approver] option[value="'+fixture.users.approver+'"]').waitFor({state:'attached'});await form.locator('[name=wizard_final_approver]').selectOption(fixture.users.approver,{force:true});await form.getByRole('button',{name:'Send for review',exact:true}).click();await page.locator('.obligation-detail').waitFor();
 const detail=await(await context.request.get(base+'/api/obligations/'+fixture.draft)).json();assert.equal(detail.obligation.approval_status,'IN_REVIEW');
 report.checks.push('Keyboard step navigation reaches the shared review summary. Send for review saves the same Draft and submits the selected independent Approver through the existing governed endpoint, without a second wizard or dialog.');
 for(const width of [1440,900,768,390,320]){await page.setViewportSize({width,height:900});await page.goto(base+'/?wizardlayout='+width+'#obligations/new?clause='+fixture.clause_id);await page.locator('#obligation-editor').waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await page.locator('.obligation-wizard [data-step-label]:visible').count(),7);
  if(width===1440||width===320)await page.screenshot({path:path.join(out,'source-step-'+width+'.png')});
 }
 report.checks.push('Seven labelled native step controls and the source form remain usable without document overflow at 1440, 900, 768, 390 and 320px.');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked_writes,[]);assert.deepEqual(report.external_requests,[]);report.status='passed';
 }catch(e){report.status='failed';report.error=Object.values(credentials).reduce((value,item)=>value.split(item.password).join('[redacted]'),String(e.stack));process.exitCode=1;}finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'wizard-actions.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}})();
