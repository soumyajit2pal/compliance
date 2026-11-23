// Read-only live UAT check; every non-GET request is blocked before reaching the API.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {base,uatContextOptions}=require('./helpers/uat.cjs');
const out=path.resolve(process.env.CBD_SWAGGER_QA_OUTPUT||path.join(__dirname,'../../outputs/swagger-uat-2026-11-01/browser'));
const report={checks:[],requests:[],external_requests:[],blocked_writes:[],browser_errors:[],csp_violations:[],screenshots:[]};
let browser,page;
(async()=>{await fs.mkdir(out,{recursive:true});try{
 browser=await chromium.launch({headless:true,channel:'chrome'});
 const context=await browser.newContext({...uatContextOptions,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base){report.external_requests.push(url.origin);return route.abort();}if(!['GET','HEAD','OPTIONS'].includes(req.method())){report.blocked_writes.push(url.pathname);return route.abort();}report.requests.push(url.pathname);return route.continue();});
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.browser_errors.push(e.message));
 await page.addInitScript(()=>{window.docsCsp=[];document.addEventListener('securitypolicyviolation',e=>window.docsCsp.push({directive:e.effectiveDirective,blocked:e.blockedURI}));});
 const response=await page.goto(base+'/docs');assert.equal(response.status(),200);
 const healthPath=page.locator('.opblock-summary-path[data-path="/api/health"]');await healthPath.waitFor();await page.waitForLoadState('networkidle');
 assert((await page.locator('.swagger-ui .info .title').innerText()).includes('Compliance by Design'));
 const settings=await page.evaluate(()=>{const c=window.ui.getConfigs();return {schema:c.url,validator:c.validatorUrl,persist:c.persistAuthorization,query:c.queryConfigEnabled,withCredentials:c.withCredentials,mutatedCurl:c.showMutatedRequest};});
 assert.equal(settings.schema,'/openapi.json');assert.equal(settings.validator,null);assert.equal(settings.persist,false);assert.equal(settings.query,false);assert.equal(settings.withCredentials,true);assert.equal(settings.mutatedCurl,false);
 for(const name of ['swagger-ui-bundle.js','swagger-ui.css','swagger-init.js','portal-docs.css'])assert(report.requests.includes('/docs/assets/'+name));
 report.checks.push('Live UAT docs and OpenAPI schema load with local assets, no remote validator/configuration, and no persisted authorisation.');

 const operation=page.locator('.opblock').filter({has:healthPath});await healthPath.click();await operation.getByRole('button',{name:'Try it out',exact:true}).click();
 const health=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health'&&r.request().method()==='GET');await operation.getByRole('button',{name:'Execute',exact:true}).click();assert.equal((await health).status(),200);await operation.locator('.responses-wrapper').getByText('"uat"',{exact:false}).first().waitFor();
 report.checks.push('Swagger Try it out executes the real read-only HTTPS health endpoint successfully.');
 await page.screenshot({path:path.join(out,'swagger-desktop.png'),fullPage:false});report.screenshots.push('swagger-desktop.png');

 // Exercise the actual loaded interceptor with a synthetic CSRF read, without issuing a write.
 await page.route('**/api/auth/me',route=>route.fulfill({json:{csrf_token:'fixture-only-swagger-csrf'}}));
 const prepared=await page.evaluate(async()=>{const r=await window.ui.getConfigs().requestInterceptor({url:location.origin+'/api/example',method:'POST',headers:{},body:'unchanged'});return {csrf:r.headers['X-CSRF-Token']==='fixture-only-swagger-csrf',credentials:r.credentials,body:r.body};});
 assert.deepEqual(prepared,{csrf:true,credentials:'same-origin',body:'unchanged'});await page.unroute('**/api/auth/me');
 const denied=await page.evaluate(async()=>{try{await window.ui.getConfigs().requestInterceptor({url:'https://outside.invalid/api/example',method:'POST'});return false;}catch{return true;}});assert(denied);
 report.checks.push('The actual browser interceptor adds current-session CSRF to a prepared write and rejects external targets; no mutation is sent.');

 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'swagger-mobile.png'),fullPage:false});report.screenshots.push('swagger-mobile.png');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 report.csp_violations=await page.evaluate(()=>window.docsCsp);assert.deepEqual(report.csp_violations,[]);assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.external_requests,[]);assert.deepEqual(report.blocked_writes,[]);
 report.checks.push('390px layout has no document overflow, JavaScript errors or CSP violations. All browser requests remain local and no business writes are attempted.');report.status='passed';
}catch(error){report.status='failed';report.error=error.stack;if(page){report.csp_violations=await page.evaluate(()=>window.docsCsp||[]).catch(()=>[]);report.page_text=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}process.exitCode=1;}finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error}));}})();
