// Live UAT check using existing records. Business writes are blocked.
const {chromium}=require(process.argv[2]||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const output=path.resolve(process.env.CBD_REPOSITORY_FILTER_QA_OUTPUT||path.join(__dirname,'../../outputs/repository-filters-2026-10-29'));
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const report={checks:[],browser_errors:[],api_failures:[],prohibited_writes:[]};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({...uatContextOptions,viewport:{width:1440,height:1100},timezoneId:'Asia/Kolkata',locale:'en-IN',reducedMotion:'reduce'});
 let signedIn=false;
 page.on('pageerror',e=>report.browser_errors.push(e.message));
 page.on('response',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/')&&r.status()>=400&&p!=='/api/auth/me')report.api_failures.push({path:p,status:r.status()});});
 await page.route('**/api/**',async route=>{
   const request=route.request(),p=new URL(request.url()).pathname;
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){
     report.prohibited_writes.push({path:p,method:request.method()});return route.abort('blockedbyclient');
   }
   await route.continue();
 });
 async function get(url){const r=await page.request.get(base+'/api'+url);assert(r.ok(),url+' '+r.status());return r.json();}
 const details=()=>page.locator('#filters .filter-more');
 const summary=()=>details().locator('summary');
 const panel=()=>page.getByRole('region',{name:'More filters',exact:true});
 async function painted(){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
 async function isOpen(expected){await page.waitForFunction(value=>document.querySelector('#filters .filter-more')?.open===value,expected);}
 async function open(){await summary().click();await isOpen(true);await painted();}
 async function closed(focus=true){await isOpen(false);if(focus)assert(await summary().evaluate(el=>document.activeElement===el));}
 async function go(){await page.goto(base+'/#repository');await page.reload();await page.locator('#filters').waitFor();await painted();}
 async function recordIds(){return page.locator('.data-table a[href^="#repository/"]').evaluateAll(links=>links.map(link=>link.getAttribute('href').slice('#repository/'.length)).sort());}
 async function apply(){const form=await page.locator('#filters').elementHandle();await panel().getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(old=>!old.isConnected,form);await page.locator('#filters').waitFor();await painted();}
 try{
   assert.equal((await get('/health')).environment,'uat');
   await page.goto(base);await page.locator('#demo-user').waitFor();
   const users=await get('/auth/demo-users');assert(users.users.some(u=>u.username==='reviewer'&&u.password_autofill_available&&!u.must_change_password),'Eligible existing public demo Reviewer required.');
   await page.locator('#demo-user').selectOption('reviewer');await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});signedIn=true;
   await go();
   const records=await get('/instruments');report.existing_records=records.length;
   assert.deepEqual(await recordIds(),records.map(r=>r.id).sort());
   const originalUrl=page.url();
   await summary().focus();await page.keyboard.press('Enter');await isOpen(true);
   assert.equal(await summary().getAttribute('aria-controls'),'repository-more-filters');
   await panel().getByLabel('Approval status',{exact:true}).selectOption('DRAFT');
   await panel().getByRole('button',{name:'Close filters',exact:true}).click();await closed();
   assert.equal(page.url(),originalUrl);assert.deepEqual(await recordIds(),records.map(r=>r.id).sort());
   report.checks.push('Keyboard opens the native disclosure; header Close returns focus without applying filters.');
   await open();assert.equal(await panel().getByLabel('Approval status',{exact:true}).inputValue(),'DRAFT');
   await panel().getByRole('button',{name:'Close',exact:true}).click();await closed();
   await open();assert.equal(await panel().getByLabel('Approval status',{exact:true}).inputValue(),'DRAFT');
   report.checks.push('Footer Close preserves unapplied selections when reopened.');
   await panel().getByLabel('Issued from',{exact:true}).fill('2000-01-01');await page.keyboard.press('Escape');await closed();
   await open();assert.equal(await panel().getByLabel('Issued from',{exact:true}).inputValue(),'2000-01-01');
   report.checks.push('Escape closes the panel, restores trigger focus and preserves selected values.');
   await page.getByRole('heading',{name:'Regulatory repository',exact:true}).click();await closed(false);
   await open();await page.getByLabel('Search regulatory repository',{exact:true}).focus();await closed(false);
   assert(await page.getByLabel('Search regulatory repository',{exact:true}).evaluate(el=>document.activeElement===el));
   report.checks.push('Outside click and keyboard focus leaving the panel dismiss it without stealing the outside control focus.');
   await open();await summary().focus();await page.keyboard.press('Space');await closed();
   report.checks.push('More filters retains native keyboard toggle support.');
   if(records.length){
     const chosen=records[0];
     await page.getByLabel('Search regulatory repository',{exact:true}).fill(chosen.title);
     await open();await panel().getByLabel('Approval status',{exact:true}).selectOption('');await panel().getByLabel('Issued from',{exact:true}).fill('');
     await panel().getByLabel('Regulator',{exact:true}).selectOption(chosen.regulator_id);
     await apply();await closed(false);
     const q=new URLSearchParams(page.url().split('?')[1]);assert.equal(q.get('q'),chosen.title);assert.equal(q.get('regulator_id'),chosen.regulator_id);
     const filtered=await get('/instruments?'+q);assert.deepEqual(await recordIds(),filtered.map(r=>r.id).sort());
     assert(await summary().getByLabel('1 active additional filters',{exact:true}).count());
     report.checks.push('Apply filters closes the panel, preserves main search, shows the active-filter count and matches authorised API results.');
     await open();assert.equal(await panel().getByLabel('Regulator',{exact:true}).inputValue(),chosen.regulator_id);
     await panel().getByRole('button',{name:'Apply filters',exact:true}).click();await closed();
     assert.equal(new URLSearchParams(page.url().split('?')[1]).get('regulator_id'),chosen.regulator_id);
     report.checks.push('Applying unchanged filters still closes the panel.');
     await open();const old=await page.locator('#filters').elementHandle();await panel().getByRole('button',{name:'Clear filters',exact:true}).click();await page.waitForFunction(form=>!form.isConnected,old);await closed(false);
     assert.equal(await page.getByLabel('Search regulatory repository',{exact:true}).inputValue(),'');assert.deepEqual(await recordIds(),records.map(r=>r.id).sort());
     await open();for(const name of ['Regulator','Approval status','Issued from'])assert.equal(await panel().getByLabel(name,{exact:true}).inputValue(),'');
     report.checks.push('Clear filters resets both main and additional filters and restores the existing authorised records.');
     await panel().getByLabel('Approval status',{exact:true}).selectOption('DRAFT');
     const unapplied=await page.locator('#filters').elementHandle();await panel().getByRole('button',{name:'Clear filters',exact:true}).click();await page.waitForFunction(form=>!form.isConnected,unapplied);await closed(false);
     await open();assert.equal(await panel().getByLabel('Approval status',{exact:true}).inputValue(),'');await panel().getByRole('button',{name:'Close',exact:true}).click();await closed();
     report.checks.push('Clear filters also resets unapplied selections on an already unfiltered URL.');
   }
   for(const [width,height] of [[1440,1100],[1024,1000],[768,1000],[390,844],[320,568]]){
     await page.setViewportSize({width,height});await go();await open();
     const p=await panel().boundingBox(),s=await summary().boundingBox();assert(p&&s&&p.y>=s.y+s.height);
     const footer=await page.locator('.filter-more-footer').boundingBox();assert(footer&&footer.y>=p.y&&footer.y+footer.height<=height+1,'footer must be in viewport at '+width);
     const table=await page.locator('.data-table').boundingBox();assert(table&&table.y>=p.y+p.height,'panel covers results at '+width);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow at '+width);
     for(const name of ['Close','Close filters','Apply filters']){const b=await panel().getByRole('button',{name,exact:true}).boundingBox();assert(b&&b.width>=44&&b.height>=44&&b.y>=0&&b.y+b.height<=height+1,'close/apply target at '+width);}
     await page.locator('.filter-more-fields').evaluate(el=>el.scrollTop=el.scrollHeight);await panel().getByLabel('Issued to',{exact:true}).scrollIntoViewIfNeeded();
     if(width<600)await page.screenshot({path:path.join(output,width+'-scrolled.png'),animations:'disabled'});
     await page.locator('.filter-more-fields').evaluate(el=>el.scrollTop=0);
     await page.screenshot({path:path.join(output,width+'-open.png'),animations:'disabled'});
     await panel().getByRole('button',{name:'Close',exact:true}).click();await closed();
     report.checks.push(width+'px: inline panel precedes results, fields scroll, close/apply controls stay visible, and page has no horizontal overflow.');
   }
   assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.api_failures,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png'),animations:'disabled'}).catch(()=>{});throw error;}
 finally{
   if(signedIn){const me=await get('/auth/me');const r=await page.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data:{}});report.sign_out_status=r.status();}
   report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 }
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,existing_records:report.existing_records}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
