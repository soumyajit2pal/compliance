// Production React bundle on the rollback-only fixture. Large read snapshots are
// synthetic browser responses; no fabricated record is sent to a write API.
const {chromium}=require(process.argv[2]||'playwright');
const {chooseOption}=require('./helpers/searchable-select.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base='http://127.0.0.1:8011';
const output=path.resolve(process.env.CBD_PAGINATION_QA_OUTPUT||path.join(root,'outputs/shared-pagination-2026-10-31/browser'));
const report={environment:'Rollback-only UAT fixture; synthetic large GET snapshots',checks:[],screenshots:[],browser_errors:[],prohibited_writes:[]};
const numbered=(n)=>String(n).padStart(3,'0');
const many=(n,fn)=>Array.from({length:n},(_,i)=>fn(i+1));
const pageResult=(rows,url)=>{
 const size=Number(url.searchParams.get('page_size')||25),total=rows.length,pages=Math.ceil(total/size),page=Math.min(Number(url.searchParams.get('page')||1),Math.max(1,pages));
 return {items:rows.slice((page-1)*size,page*size),pagination:{page,page_size:size,total,total_pages:pages,start:total?(page-1)*size+1:0,end:Math.min(page*size,total)}};
};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const fixture=JSON.parse(await fs.readFile(path.join(root,'var/browser-fixture-secrets.json'),'utf8'));
 const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({viewport:{width:1440,height:1050},timezoneId:'Asia/Kolkata'}),page=await context.newPage();
 page.setDefaultTimeout(15000);page.on('pageerror',error=>report.browser_errors.push(error.message));
 let mocks=false,domains=[],master,users,records=[],editions=[],clauses=[],details,notifications=[],families,batches=[],importDetail;
 let reads=0,registerRequests=[];
 const json=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;reads++;
  if(!['GET','HEAD','OPTIONS'].includes(req.method())&&!['/api/auth/login','/api/auth/logout'].includes(p)){
   report.prohibited_writes.push(p);return route.abort('blockedbyclient');
  }
  if(!mocks)return route.continue();
  if(p==='/api/masters')return json(route,{...master,regulatory_domain:domains});
  if(p==='/api/admin/users')return json(route,users);
  if(p==='/api/admin/employee-profile-reviews')return json(route,url.searchParams.has('user_id')?many(57,n=>({id:'history-'+n,user_id:url.searchParams.get('user_id'),approved:{department_code:'OLD-'+n},current:{department_code:'NEW-'+n},changes:[{field:'department_code'}],status:'APPROVED',decision_reason:'QA decision '+n})):[]);
  if(p.startsWith('/api/admin/employee-profile-archive/'))return json(route,[]);
  if(p==='/api/notifications')return json(route,notifications);
  if(p==='/api/instruments'){
   if(!url.searchParams.has('page'))return json(route,records);
   registerRequests.push(url.searchParams.toString());
   return json(route,pageResult(records.filter(row=>JSON.stringify(row).toLowerCase().includes((url.searchParams.get('q')||'').toLowerCase())),url));
  }
  if(p==='/api/source-editions')return json(route,editions);
  if(p==='/api/clauses')return json(route,clauses);
  if(p.startsWith('/api/instruments/page-instrument-')){
   const id=p.split('/').pop();return json(route,{...details,instrument:records.find(row=>row.id===id),versions:editions.filter(row=>row.instrument_id===id),clauses:clauses.filter(row=>row.instrument_id===id)});
  }
  if(p==='/api/notification-families'){
   const data=pageResult(families.families.filter(row=>row.root.title.includes(url.searchParams.get('q')||'')),url);
   return json(route,{...families,families:data.items,pagination:data.pagination});
  }
  if(p==='/api/migration'){
   const rows=batches.filter(row=>JSON.stringify(row).includes(url.searchParams.get('q')||''));
   return json(route,url.searchParams.has('page')?{...pageResult(rows,url),summary:{batches:57,source_count:399,loaded_count:114,pending_count:285}}:rows);
  }
  if(p==='/api/migration/page-import'&&importDetail)return json(route,importDetail);
  return route.continue();
 });
 const get=async suffix=>{const response=await context.request.get(base+'/api'+suffix);assert(response.ok(),await response.text());return response.json();};
 async function login(role){await context.clearCookies();await page.goto(base);await page.locator('#login').waitFor();await page.locator('#login-username').fill(fixture.credentials[role].username);await page.locator('#login-password').fill(fixture.credentials[role].password);await page.locator('#login button[type=submit]').click();await page.locator('#login').waitFor({state:'hidden'});}
 const collection=key=>page.locator('[data-pagination-key="'+key+'"]');
 const range=key=>collection(key).locator('.pagination-range');
 const waitRange=async(key,text)=>page.waitForFunction(({key,text})=>document.querySelector('[data-pagination-key="'+key+'"] .pagination-range')?.textContent===text,{key,text});
 async function visit(route){await page.goto(base+'/#'+route);await page.waitForLoadState('networkidle');}
 async function next(key){await collection(key).getByRole('link',{name:'Next page',exact:true}).click();}
 async function size(key,value){await chooseOption(collection(key).locator('select').last(),String(value));}
 async function shot(name){await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Document overflow: '+name);await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});report.screenshots.push(name+'.png');}
 try{
  await login('admin');[master,users]=await Promise.all(['/masters','/admin/users'].map(get));
  await login('author');[records,editions,clauses,notifications,families]=await Promise.all(['/instruments','/source-editions','/clauses','/notifications','/notification-families'].map(get));
  details=await get('/instruments/'+fixture.record.id);
  domains=many(127,n=>({...master.regulatory_domain[0],id:'page-domain-'+numbered(n),code:'PAGE-'+numbered(n),name:'QA pagination domain '+numbered(n),active_flag:1}));
  const bank=master.organisational_unit.find(row=>row.code==='BANK');
  master.organisational_unit=[bank,...many(57,n=>({id:'page-unit-'+n,code:'PAGE-UNIT-'+n,name:'QA organisation '+numbered(n),unit_type:'DEPARTMENT',parent_org_unit_id:bank.id,active_flag:1,effective_from:'2020-01-01',level_number:1})),...many(57,n=>({id:'page-child-'+n,code:'PAGE-CHILD-'+n,name:'QA child '+numbered(n),unit_type:'BRANCH',parent_org_unit_id:'page-unit-'+n,active_flag:1,effective_from:'2020-01-01',level_number:2}))];
  const seed=records.find(row=>row.id===fixture.record.id)||records[0],seedEdition=editions[0],seedClause=clauses[0];
  records=many(57,n=>({...seed,id:'page-instrument-'+numbered(n),code:'PAGE-INS-'+numbered(n),title:'QA instrument '+numbered(n),short_title:'QA instrument '+numbered(n),official_reference_number:'PAGE-REF-'+numbered(n),current_version_id:'page-instrument-'+numbered(n)+'-v1'}));
  editions=records.flatMap(record=>[1,2].map(version=>({...seedEdition,id:record.id+'-v'+version,instrument_id:record.id,version_number:version+'.0',approval_status:version===1?'APPROVED':'DRAFT',effective_from:'2020-01-01',effective_to:null,current_version_flag:version===1?1:0,cancelled_draft:0})));
  clauses=editions.flatMap(edition=>['5','5.1','5.1.1'].map((number,i)=>({...seedClause,id:edition.id+'-'+number,instrument_id:edition.instrument_id,instrument_version_id:edition.id,parent_clause_id:i?edition.id+'-'+['5','5.1'][i-1]:null,heading:'QA clause '+number,code:edition.id+'-'+number,source_clause_reference:number,approval_status:edition.approval_status,version_approval_status:edition.approval_status,version_number:edition.version_number,instrument_title:records.find(row=>row.id===edition.instrument_id).title,instrument_short_title:records.find(row=>row.id===edition.instrument_id).short_title,instrument_code:records.find(row=>row.id===edition.instrument_id).code})));
  users={...users,users:[...users.users.filter(row=>row.login_type!=='LDAP'),...many(57,n=>({...users.users[0],id:'page-ldap-'+n,username:'qa.ldap.'+numbered(n),full_name:'QA LDAP '+numbered(n),email:'qa.'+n+'@example.invalid',login_type:'LDAP',department_code:null,ldap_last_seen_department_code:'QA-'+n,org_unit_id:bank.id,active_flag:1}))],summary:{...users.summary,ldap:57}};
  notifications=many(57,n=>({id:'page-notification-'+n,notification_type:'SOURCE_APPROVED',source_title:'QA notification '+numbered(n),triggered_at:'2026-10-31T01:00:00',read_at:'2026-10-31T01:00:00'}));
  families={...families,authorised_instruments:57,families:records.map(record=>({...families.families[0],root:{...families.families[0].root,id:record.id,title:record.title,code:record.code},amendments:0}))};
  batches=many(57,n=>({id:'page-batch-'+n,code:'PAGE-BATCH-'+numbered(n),source_file:'QA pagination '+numbered(n)+'.xlsx',source_count:7,loaded_count:2,pending_count:5}));
  // Use a genuine rollback-only combined-import result when the import regression
  // has run first; replicate complete groups without changing any persisted row.
  const existing=await get('/migration'),batch=existing.find(row=>row.source_file==='TEST-ONLY-combined.xlsx');
  assert(batch,'Run the combined-import browser regression on the fixture first.');
  if(batch){
   const original=await get('/migration/'+batch.id),template=original.groups.find(group=>group.row_ids.length>=4),sourceRows=new Map(original.rows.map(row=>[row.id,row]));
   importDetail={...original,batch:{...original.batch,id:'page-import',code:'PAGE-IMPORT'},groups:[],rows:[]};
   for(let n=1;n<=27;n++){
    const rows=template.row_ids.map(id=>({...sourceRows.get(id),id:id+'-copy-'+n}));
    importDetail.rows.push(...rows);importDetail.groups.push({...template,reference:'PAGE-GROUP-'+numbered(n),title:'QA complete group '+numbered(n),row_ids:rows.map(row=>row.id)});
   }
  }
  mocks=true;await login('admin');
  await visit('masters?tab=domains');const domainKey=await page.locator('[data-pagination-key]').first().getAttribute('data-pagination-key');
  await waitRange(domainKey,'Showing 1–25 of 127 records');assert.equal(await collection(domainKey).locator('tbody tr').count(),25);const before=reads;
  await collection(domainKey).getByRole('link',{name:'Next page',exact:true}).focus();await page.keyboard.press('Enter');await waitRange(domainKey,'Showing 26–50 of 127 records');assert.equal(reads,before,'Local paging must not refetch');
  await collection(domainKey).locator('[data-action=edit-master]').first().click();assert.equal(await page.locator('#master-record [name=name]').inputValue(),'QA pagination domain 026');await page.locator('#dialog').press('Escape');
  await size(domainKey,10);await waitRange(domainKey,'Showing 1–10 of 127 records');
  await size(domainKey,50);await waitRange(domainKey,'Showing 1–50 of 127 records');
  await size(domainKey,100);await waitRange(domainKey,'Showing 1–100 of 127 records');
  await page.goBack();await page.waitForLoadState('networkidle');await waitRange(domainKey,'Showing 1–50 of 127 records');assert.equal(await collection(domainKey).locator('select').last().inputValue(),'50');
  await shot('master-searchable-size-desktop');report.checks.push('Tables mount only the current page; 10/25/50/100, edit identity, Back and no-refetch local navigation work.');
  await collection(domainKey).getByRole('link',{name:'Last page',exact:true}).click();await waitRange(domainKey,'Showing 101–127 of 127 records');
  await page.locator('#view-filter [name=q]').fill('127');await page.locator('#view-filter button[type=submit]').click();await waitRange(domainKey,'Showing 1–1 of 1 records');assert(!new URLSearchParams(page.url().split('?')[1]).has('page.'+domainKey));
  await page.locator('#view-filter [name=q]').fill('absent');await page.locator('#view-filter button[type=submit]').click();await waitRange(domainKey,'0 records');assert.equal(await collection(domainKey).getByRole('link',{name:'Next page',exact:true}).count(),0);
  await visit('masters?tab=domains&page.'+domainKey+'=6');await waitRange(domainKey,'Showing 126–127 of 127 records');domains=domains.slice(0,125);await page.reload();await waitRange(domainKey,'Showing 101–125 of 125 records');
  report.checks.push('Search resets pages, empty results have no active navigation, and a shrinking final page clamps safely.');
  await visit('masters?tab=organisation');await next('org-tree');await next('org-children');await waitRange('org-tree','Showing 26–50 of 57 organisation branches');await waitRange('org-children','Showing 26–50 of 57 records');
  await page.reload();await waitRange('org-tree','Showing 26–50 of 57 organisation branches');await waitRange('org-children','Showing 26–50 of 57 records');
  await visit('masters?tab=organisation&unit=page-child-57');assert.equal(await page.locator('.tree-node.active').textContent(),'QA child 057');assert(await collection('org-tree').getByText('QA organisation 057',{exact:true}).count());await shot('organisation-deep-link');
  report.checks.push('Independent organisation-tree and child-table pages survive refresh; descendant deep links reveal their whole parent branch.');
  await login('author');await visit('repository');await waitRange('instruments','Showing 1–25 of 57 records');await next('instruments');await waitRange('instruments','Showing 26–50 of 57 records');assert(registerRequests.some(q=>new URLSearchParams(q).get('page')==='2'));
  await page.locator('#filters [name=q]').fill('057');await page.locator('#filters').getByRole('button',{name:'Search',exact:true}).click();await waitRange('instruments','Showing 1–1 of 1 records');await shot('register-filter-result');
  report.checks.push('Main register requests bounded API pages and resets to page one on search.');
  await login('admin');await visit('users?tab=LDAP');await waitRange('ldap-accounts','Showing 1–25 of 57 LDAP accounts');await next('ldap-accounts');await waitRange('ldap-accounts','Showing 26–50 of 57 LDAP accounts');assert.equal(await page.locator('[data-action=ldap-account-details]').count(),25);await shot('ldap-directory-page-two');
  report.checks.push('LDAP directory pages show one summary row per account.');
  const parentUrl=page.url();await page.locator('[data-action=ldap-account-details]').first().click();await page.locator('#dialog [data-action=department-history]').click();
  const history=page.locator('#dialog [data-pagination-total="57"]');await history.getByRole('link',{name:'Next page',exact:true}).click();
  await history.getByText('Showing 26–50 of 57 records',{exact:true}).waitFor();
  assert.equal(page.url(),parentUrl);assert.equal(await history.locator('tbody').first().locator(':scope > tr').count(),25);await shot('dialog-history-page-two');await page.locator('#dialog').press('Escape');
  report.checks.push('Dialog paging changes only its own rows and preserves the workspace URL and parent page.');
  await login('author');await visit('notifications');await next('notifications');await waitRange('notifications','Showing 26–50 of 57 notifications');assert.equal(await page.locator('.notification-item').count(),25);
  await visit('notification-families');await next('families');await waitRange('families','Showing 26–50 of 57 families');assert.equal(await page.locator('.family-card').count(),25);await shot('family-cards-page-two');
  await visit('migration');await next('batches');await waitRange('batches','Showing 26–50 of 57 records');assert.equal(await page.locator('.kpi-number').first().textContent(),'399');
  report.checks.push('Notifications, whole family cards and import registers page consistently; import totals remain for the full population.');
  await visit('clauses?clause=page-instrument-057-v2-5.1.1');await waitRange('clause-tree','Showing 51–57 of 57 instruments');
  assert.equal(await page.locator('.clause-instrument-group').count(),7);
  for(const row of await page.locator('.clause-tree-node').evaluateAll(nodes=>nodes.filter(node=>node.querySelector('.clause-source-number')?.textContent==='5.1.1').map(node=>({edition:node.dataset.edition,parent:node.closest('ul').parentElement.querySelector(':scope > summary .clause-tree-node')?.dataset.edition}))))assert.equal(row.parent,row.edition);
  await shot('clauses-deep-link-edition-hierarchy');report.checks.push('Clause deep links reveal the selected instrument; complete 5 → 5.1 → 5.1.1 branches stay within each edition.');
  if(importDetail){await visit('migration/page-import');await next('import-groups');await waitRange('import-groups','Showing 26–27 of 27 regulatory record groups');assert.equal(await page.locator('.import-group').count(),2);assert(await page.locator('.import-preview').textContent().then(text=>text.includes('Draft loading apply to the complete batch')));await shot('complete-import-groups');report.checks.push('Combined import previews page whole regulatory-record groups and retain all clauses; batch actions remain explicitly whole-batch.');}
  await login('admin');await page.setViewportSize({width:320,height:850});await visit('masters?tab=domains');await collection(domainKey).scrollIntoViewIfNeeded();await page.locator('.shared-pagination').scrollIntoViewIfNeeded();await shot('pagination-mobile-320');
  await page.setViewportSize({width:390,height:844});await visit('users?tab=LDAP');await next('ldap-accounts');await range('ldap-accounts').scrollIntoViewIfNeeded();await shot('ldap-pagination-mobile-390');
  report.checks.push('Shared controls fit 320px and 390px layouts without document overflow.');
  assert.deepEqual(report.browser_errors,[]);assert.deepEqual(report.prohibited_writes,[]);report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;await page.screenshot({path:path.join(output,'failure.png'),fullPage:false}).catch(()=>{});process.exitCode=1;}
 finally{await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report,null,2));}
})();
