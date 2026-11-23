// Explicit UAT rollback fixture only. Real app HTTP/Oracle; simulated employee API.
const {chromium}=require(process.argv[2]||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'outputs/employee-profile-2026-11-19/browser');
const report={scope:'Actual application and rollback-only Oracle fixture; synthetic directory and employee HTTP transport. No bank API or live employee record.',checks:[],layouts:[],browser_errors:[],external_requests:[]};
let browser;
(async()=>{await fs.mkdir(out,{recursive:true});const creds=JSON.parse(await fs.readFile(path.join(root,'var/employee-browser-secrets.json'),'utf8'));
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function open(name){const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});await context.route('**/*',route=>{if(new URL(route.request().url()).origin!=='http://127.0.0.1:8011'){report.external_requests.push('External request blocked');return route.abort();}return route.continue();});const page=await context.newPage();page.on('pageerror',e=>report.browser_errors.push(e.message));page.setDefaultTimeout(15000);await page.goto('http://127.0.0.1:8011');await page.locator('#login-username').fill(creds[name].username);await page.locator('#login-password').fill(creds[name].password);await page.locator('#login button[type=submit]').click();await page.locator('.app-shell').waitFor();return {page,context};}
  const {page:employee}=await open('employee');await employee.locator('[aria-label="Employee profile refresh"]').waitFor();
  assert((await employee.locator('#main-content').innerText()).includes('Welcome'));await employee.locator('.portal-person').click();
  const dialog=employee.locator('#dialog');await dialog.waitFor({state:'visible'});assert((await dialog.innerText()).includes('NA'));assert((await dialog.innerText()).includes('Signed-in employee details'));
  await employee.screenshot({path:path.join(out,'first-failure-desktop.png'),fullPage:true});await employee.keyboard.press('Escape');
  report.checks.push('Actual LDAP login succeeds during HTTP 503; existing verified role and workspace remain available; API-only fields show NA.');
  for(const width of [1440,768,390,320]){await employee.setViewportSize({width,height:1050});assert(await employee.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));report.layouts.push({page:'employee warning',width});}
  await employee.screenshot({path:path.join(out,'warning-phone.png'),fullPage:true});
  const {page:admin}=await open('admin');await admin.goto('http://127.0.0.1:8011/#employee-api');await admin.locator('#employee-api-settings').waitFor();
  const settings=admin.locator('#employee-api-settings');await settings.locator('[name=timeout_seconds]').fill('2');await settings.locator('button[type=submit]').click();await settings.locator('[name=timeout_seconds][value="2"]').waitFor();assert.equal(await settings.locator('[name=timeout_seconds]').inputValue(),'2');
  await settings.locator('[name=test_pf_no]').fill(creds.employee.username.slice(2));await settings.locator('[data-action=employee-api-test]').click();await admin.waitForFunction(()=>document.querySelector('#employee-api-test-result')?.textContent.includes('HTTP_503'));
  report.checks.push('Admin API navigation, saved timeout and safe non-blocking connection-test failure work through the real API.');
  for(const width of [1440,768,390,320]){await admin.setViewportSize({width,height:1050});assert(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));report.layouts.push({page:'admin settings',width});}
  await admin.setViewportSize({width:1440,height:1050});await admin.evaluate(()=>window.scrollTo(0,0));await admin.evaluate(()=>new Promise(requestAnimationFrame));await admin.screenshot({path:path.join(out,'admin-settings-desktop.png'),fullPage:true});
  await fs.writeFile(path.join(root,'var/employee-browser-api.json'),JSON.stringify({mode:'success'}));
  await admin.locator('[data-action=employee-api-retry]').click();
  for(let i=0;i<10;i++){await admin.locator('[data-action=reload]').click();await admin.locator('#employee-api-settings').waitFor();if((await admin.locator('#main-content').innerText()).includes('Successful: 1'))break;await new Promise(resolve=>setTimeout(resolve,500));}
  assert((await admin.locator('#main-content').innerText()).includes('Successful: 1'));
  if(!await employee.locator('[data-action=profile]:visible').count())await employee.getByRole('button',{name:'Open navigation',exact:true}).click();
  await employee.locator('[data-action=profile]:visible').first().click();await dialog.waitFor({state:'visible'});assert((await dialog.innerText()).includes('Synthetic Manager'));assert((await dialog.innerText()).includes('Registered branch'));assert((await dialog.innerText()).includes('0002'));
  report.checks.push('Database retry worker recovers without employee re-login; profile reads show designation and distinct registered/current branch values.');
  await employee.keyboard.press('Escape');await employee.reload();assert.equal(await employee.locator('[aria-label="Employee profile refresh"]').count(),0);
  await employee.goto('http://127.0.0.1:8011/#employee-api');await employee.locator('.access-boundary').waitFor();
  report.checks.push('Successful refresh clears the warning on identity reload; non-admin navigation remains denied.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.external_requests,[]);
 }finally{if(browser)await browser.close();await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1;});
