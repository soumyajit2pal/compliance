// Read-only live UAT UI check. Only normal login/logout may write.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const output=path.join(root,'outputs/notification-family-filters-2026-10-29');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const report={checks:[],browser_errors:[],api_failures:[],prohibited_writes:[]};
const counted=(n,one,many=one+'s')=>n+' '+(n===1?one:many);
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 const page=await browser.newPage({...uatContextOptions,viewport:{width:1440,height:1100},timezoneId:'Asia/Kolkata',locale:'en-IN'});
 let signedIn=false;
 page.on('pageerror',error=>report.browser_errors.push(error.message));
 page.on('response',response=>{const p=new URL(response.url()).pathname;if(p.startsWith('/api/')&&response.status()>=400&&p!=='/api/auth/me')report.api_failures.push({path:p,status:response.status()});});
 await page.route('**/api/**',async route=>{
   const request=route.request();const p=new URL(request.url()).pathname;
   if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){
     report.prohibited_writes.push({path:p,method:request.method()});return route.abort('blockedbyclient');
   }
   await route.continue();
 });
 async function get(url){const response=await page.request.get(base+'/api'+url);assert(response.ok(),url+' '+response.status());return response.json();}
 async function painted(){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});}
 async function go(hash){
   await page.goto(base+'/#'+hash);
   const [route,query='']=hash.split('?');const params=new URLSearchParams(query);
   const when=params.get('as_of')||new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
   await page.waitForFunction(({route,when,q})=>{
     const form=document.querySelector('#family-filters');
     return form?.dataset.route===route&&form.querySelector('[name=as_of]')?.value===when&&(!form.querySelector('[name=q]')||form.querySelector('[name=q]').value===q);
   },{route,when,q:params.get('q')||''});
   await painted();
 }
 async function apply(){
   const form=await page.locator('#family-filters').elementHandle();
   await page.getByRole('button',{name:'Apply filters',exact:true}).click();
   await page.waitForFunction(previous=>!previous.isConnected,form);await painted();
 }
 async function layout(name,search){
   await page.locator('#family-filters').scrollIntoViewIfNeeded();await painted();
   assert.equal(await page.locator('.app-shell').count(),1,name+' duplicated page shell');
   const date=page.getByLabel('As of date',{exact:true});const button=page.getByRole('button',{name:'Apply filters',exact:true});
   const d=await date.boundingBox(),b=await button.boundingBox();assert(d&&b&&d.height>=44&&b.height>=44);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow');
   if(search){
     const input=page.getByLabel('Search notifications',{exact:true});const s=await input.boundingBox();assert(s&&s.height>=44);
     const fits=await input.evaluate(el=>{const style=getComputedStyle(el),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=style.font;return ctx.measureText(el.placeholder).width<=el.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);});
     assert(fits,name+' clipped search placeholder');
     if(name==='desktop-register'){assert(Math.abs(d.y+d.height-b.y-b.height)<=1);assert(Math.abs(s.y+s.height-b.y-b.height)<=1);}
   }
   assert.equal(await page.getByRole('button',{name:'Show position',exact:true}).count(),0);
   report.checks.push(name+': clear labels, '+(search?'full search placeholder, ':'')+'touch-sized controls and no page overflow.');
   await page.screenshot({path:path.join(output,name+'.png'),animations:'disabled'});
 }
 try{
   assert.equal((await get('/health')).environment,'uat');
   await page.goto(base);
   await page.locator('#demo-user').waitFor();
   const demo=await get('/auth/demo-users');
   const account=demo.users.find(row=>row.username==='reviewer'&&row.password_autofill_available&&!row.must_change_password);
   assert(account,'An eligible existing public demo reviewer is required; no account is modified.');
   await page.locator('#demo-user').selectOption(account.username);
   await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});signedIn=true;
   await go('notification-families');
   const data=await get('/notification-families');report.population={families:data.families.length,library_records:data.authorised_instruments};
   const normal=counted(data.families.length,'authorised family','authorised families')+' · '+counted(data.authorised_instruments,'library record');
   assert(await page.getByText(normal,{exact:false}).count());
   await layout('desktop-register',true);
   const date=page.getByLabel('As of date',{exact:true});const today=await date.inputValue();
   const token='NO-MATCH-UI-'+Date.now();
   await page.getByLabel('Search notifications',{exact:true}).fill(token);
   await apply();
   await page.getByRole('heading',{name:'No matching notification families',exact:true}).waitFor();
   assert.equal(new URLSearchParams(page.url().split('?')[1]).get('q'),token);
   assert(await page.getByText('0 matching families · '+counted(data.authorised_instruments,'authorised library record'),{exact:false}).count());
   await page.getByLabel('Search notifications',{exact:true}).fill('');await apply();
   await page.getByText(normal,{exact:false}).waitFor();
   report.checks.push('Apply filters submits search, distinguishes matching families from authorised totals, and clear search restores results.');
   const future=new Date(today+'T12:00:00+05:30');future.setDate(future.getDate()+14);const position=future.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
   await page.getByLabel('As of date',{exact:true}).fill(position);await apply();
   await page.waitForURL(url=>new URLSearchParams(url.hash.split('?')[1]).get('as_of')===position);
   const projected=await get('/notification-families?as_of='+position);assert.equal(projected.as_of,position);
   assert.equal(await page.getByLabel('As of date',{exact:true}).inputValue(),position);
   report.checks.push('The selected date is applied through as_of and retained in the register.');
   for(const width of [1024,768,390]){await page.setViewportSize({width,height:1000});await go('notification-families');await layout(width+'-register',true);}
   if(data.families.length){
     const id=data.families[0].root.id;
     await page.setViewportSize({width:1440,height:1100});await go('notification-families/'+id);await layout('desktop-detail',false);
     await page.getByLabel('As of date',{exact:true}).fill(position);await apply();
     await page.getByText(/Source and regulatory deadline histories follow the selected date/).waitFor();
     assert.equal(await page.getByRole('button',{name:'Link existing notification',exact:true}).count(),0);
     report.checks.push('Detail Apply filters opens the selected date and preserves the read-only historical/future position.');
     await page.setViewportSize({width:390,height:1000});await go('notification-families/'+id);await layout('390-detail',false);
   }
   assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.api_failures,[]);assert.deepEqual(report.prohibited_writes,[]);
   report.status='passed';
 }catch(error){report.status='failed';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
 finally{
   if(signedIn){const me=await get('/auth/me');const response=await page.request.post(base+'/api/auth/logout',{headers:{Origin:base,'X-CSRF-Token':me.csrf_token},data:{}});report.sign_out_status=response.status();}
   report.checked_at=new Date().toISOString();await fs.writeFile(path.join(output,'browser-validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 }
 process.stdout.write(JSON.stringify({status:report.status,checks:report.checks.length,population:report.population})+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
