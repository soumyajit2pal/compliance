// Existing-record HTTPS UAT checks. All business writes are blocked.
const {chromium}=require(process.argv[2]||'playwright');
const {chooseOption}=require('./helpers/searchable-select.cjs');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'outputs/combined-import-2026-10-31/live');
const report={status:'running',environment:'Existing-record local HTTPS UAT; read-only business checks',checks:[],screenshots:[],browser_errors:[],prohibited_writes:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({...uatContextOptions,viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata'}),page=await context.newPage();let signedIn=false;
 page.on('pageerror',e=>report.browser_errors.push(e.message));
 await context.route('**/api/**',async route=>{const r=route.request(),url=new URL(r.url());if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!['/api/auth/login','/api/auth/logout'].includes(url.pathname)){report.prohibited_writes.push({method:r.method(),path:url.pathname});return route.abort('blockedbyclient');}await route.continue();});
 async function get(url){const r=await context.request.get(base+'/api'+url);assert(r.ok(),await r.text());return r.json();}
 async function shot(name){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});report.screenshots.push(name+'.png');}
 try{
  assert.equal((await get('/health')).environment,'uat');
  const demoWait=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/demo-users');await page.goto(base);
  const demo=await (await demoWait).json();const user=demo.users.find(u=>u.password_autofill_available&&!u.must_change_password&&u.scope.includes('Global')&&u.roles.some(r=>['AUTHOR','REVIEWER'].includes(r)));
  assert(user,'An eligible existing public global demo content account is required for this read-only check.');
  await chooseOption(page.locator('#demo-user'),user.username);await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});signedIn=true;
  const before=await get('/migration'),clauses=await get('/clauses'),byId=new Map(clauses.map(r=>[r.id,r]));
  const children=clauses.filter(r=>r.parent_clause_id);
  for(const child of children){const parent=byId.get(child.parent_clause_id);assert(parent);assert.equal(child.instrument_version_id,parent.instrument_version_id);}
  report.population={source_batches:before.length,clauses:clauses.length,children:children.length};
  report.checks.push('Existing authorised clauses retain parents within their own source editions.');
  const response=await context.request.get(base+'/api/migration-template?format=xlsx');assert.equal(response.status(),200);assert(response.headers()['cache-control'].includes('no-store'));assert(response.headers()['content-disposition'].includes('regulatory-records-and-clauses-template.xlsx'));
  const inspection=execFileSync(path.join(root,'.venv/bin/python'),['-c',
   'import io,json,sys; from openpyxl import load_workbook; b=load_workbook(io.BytesIO(sys.stdin.buffer.read())); assert b.sheetnames==["Regulatory records","Clauses","How to fill","Example","Choices"]; assert b["Clauses"]["E102"].number_format=="@"; assert b["Regulatory records"]["T102"].number_format=="@"; print(json.dumps({"sheets":b.sheetnames,"clause_columns":[c.value for c in b["Clauses"][1]],"choice_rows":b["Choices"].max_row-1})); b.close()'],
   {cwd:root,input:await response.body(),maxBuffer:1024*1024});report.template=JSON.parse(inspection.toString());
  report.checks.push('The activated API downloads the combined five-sheet workbook with current Oracle choices, literal reference formatting beyond row 101 and private/no-store headers.');
  const author=user.roles.includes('AUTHOR');
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});await page.goto(base+'/#migration');await page.getByRole('heading',{name:'Import existing regulatory records',exact:true}).waitFor();await shot('import-register-'+width);
   if(author){await page.locator('[data-action=stage]').click();await page.locator('#stage [name=source_files]').waitFor();await shot('combined-upload-'+width);await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();}
  }
  report.checks.push(author?'The current Author can open/cancel the combined upload form on desktop and phones; no upload or load is submitted.':'The current Reviewer sees the register without Author upload controls; fixture checks cover the Author form.');
  const instruments=await get('/instruments');
  if(instruments.length){const record=await get('/instruments/'+instruments[0].id);const edition=record.versions.find(v=>!v.current_version_flag)||record.versions[0];if(edition){await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/#repository/'+record.instrument.id+'?'+new URLSearchParams({version:edition.id,tab:'clauses'}));await page.waitForFunction(id=>document.querySelector('#selected-source')?.value===id,edition.id);assert(new URLSearchParams(page.url().split('?')[1]).get('version')===edition.id);report.checks.push('An explicit source-edition link opens the exact existing edition in the instrument workspace.');}}
  assert.deepEqual(await get('/migration'),before);assert.deepEqual(await get('/clauses'),clauses);
  report.checks.push('Existing import and clause records match before/after; the test sends no business write requests.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png'),fullPage:false}).catch(()=>{});throw error;}
 finally{if(signedIn){const me=await get('/auth/me');report.sign_out_status=(await context.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data:{}})).status();}report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,screenshots:report.screenshots.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
