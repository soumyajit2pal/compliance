// Application-wide production-bundle checks against an isolated synthetic API.
const fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),dist=path.join(root,'frontend/dist');
const focusedOrganisationImport=process.argv.includes('--organisation-import');
const out=path.resolve(root,process.env.CBD_APPLICATION_OUTPUT||'outputs/application-redesign-2026-11-14/browser');
const preview=process.argv.includes('--preview');
const report={scope:'Local production bundle and synthetic records only; no database, credentials or business writes.',checks:[],screens:[],screenshots:[],errors:[],writes:[],unexpected_requests:[],responsive:[]};
const menu=['home','tasks','approvals','repository','notification-families','clauses','clause-relationships','obligations','applicability','accountability','users','masters','ldap','migration','applications','notifications','help'];
const roles=['ADMIN','AUTHOR','REVIEWER'];
const actor={id:'actor',full_name:'Example Workspace Manager',username:'example.manager',email:'manager@example.invalid',org_unit_id:'compliance',login_type:'STANDARD',active_flag:1,must_change_password_flag:0,needs_email_confirmation_flag:0,needs_department_selection_flag:0};
const lookup=(id,name,extra={})=>({id,code:id.toUpperCase(),name,active_flag:1,...extra});
const units=[lookup('bank','Example Bank',{unit_type:'BANK',parent_org_unit_id:null}),lookup('compliance','Compliance Department',{unit_type:'DEPARTMENT',parent_org_unit_id:'bank'}),lookup('retail','Retail Banking',{unit_type:'DEPARTMENT',parent_org_unit_id:'bank'})];
const people=[actor,{...actor,id:'owner',full_name:'Example Business Owner',username:'example.owner',org_unit_id:'retail',access_status:'ACCESS_READY',access_status_label:'Access assigned',access_message:'Assigned work is available in the workspace.'},{...actor,id:'directory',full_name:'Example Directory Colleague',username:'example.directory',login_type:'LDAP',department_code:'0012',ldap_last_seen_department_code:'0012',ldap_division:'Retail',ldap_last_seen_division:'Retail',ldap_info:'Customer operations',ldap_last_seen_info:'Customer operations',ldap_department_approved_flag:1,access_status:'ACCESS_READY',access_status_label:'Access assigned',access_message:'Assigned work is available in the workspace.'}];
const masters={organisational_unit:units,user:people,role:['ADMIN','AUTHOR','REVIEWER','APPROVER','BUSINESS_OWNER','CONTROL_OWNER'].map(id=>lookup(id,id.replaceAll('_',' '))),regulator:[lookup('rbi','Reserve Bank of India',{approval_status:'APPROVED'})],regulatory_domain:[lookup('kyc','Customer identification',{domain_owner_unit_id:'compliance',submissions_enabled:1})],instrument_type:[lookup('direction','Master Direction')],obligation_category:[lookup('customer','Customer identification')],confidentiality_class:[lookup('internal','Internal')],legal_entity:[lookup('entity','Example Bank')],frequency:[lookup('event','At onboarding')],evidence_type:[lookup('record','Verification record')],process:[lookup('onboarding','Customer onboarding')],product:[],channel:[],customer_segment:[],geography:[],taxonomy_scheme:[lookup('regulatory','Regulatory')]};
const summary={active_accounts:3,standard:2,ldap:1,pending_approval:0,role_assignment_required:0,role_review_required:0,profile_pending:0,action_required:0,department_pending:0};
const users={users:people.map(p=>({...p,access_status:p.access_status||'ACCESS_READY',access_status_label:p.access_status_label||'Access assigned',access_message:p.access_message||'Approved roles are in place.'})),summary,assignments:[...roles.map(role_id=>({user_id:'actor',role_id,effective_flag:1,global_scope_flag:1})),{user_id:'owner',role_id:'BUSINESS_OWNER',effective_flag:1,global_scope_flag:0,scope_org_unit_id:'retail'},{user_id:'directory',role_id:'AUTHOR',effective_flag:1,global_scope_flag:1}]};
const catalogue=Object.entries({regulatory_domain:'Regulatory domain',regulator:'Regulator',instrument_type:'Instrument type',obligation_category:'Obligation category',frequency:'Frequency',organisational_unit:'Organisation unit'}).map(([key,label])=>({key,label,can_create:true,parent_field:key==='organisational_unit'?'parent_org_unit_id':null,fields:[{name:'code',label:'Code',kind:'text',required:true,immutable:true,max_length:30},{name:'name',label:'Name',kind:'text',required:true,max_length:250},...(key==='organisational_unit'?[{name:'parent_org_unit_id',label:'Parent organisation',kind:'reference',source:'organisational_unit'},{name:'unit_type',label:'Unit type',kind:'select',choices:['BANK','DEPARTMENT','BRANCH'],default:'DEPARTMENT',required:true}]:[]),{name:'active_flag',label:'Active',kind:'checkbox',default:1}]}));
const source={id:'source',code:'EXAMPLE-KYC-2026-001',title:'Customer identification and onboarding requirements',official_reference_number:'Example / KYC / 2026 / 001',short_title:'Customer identification',issue_date:'2026-10-01',effective_date:'2026-11-01',regulator_id:'rbi',regulator_name:'Reserve Bank of India',primary_domain_id:'kyc',domain_name:'Customer identification',instrument_type_id:'direction',regulatory_owner_unit_id:'compliance',interpretation_owner_user_id:'actor',confidentiality_class_id:'internal',materiality:'HIGH',regulatory_status:'CURRENT',approval_status:'APPROVED',current_version_id:'edition',current_version_number:1};
const version={id:'edition',instrument_id:'source',version_number:1,version_date:'2026-10-01',effective_from:'2026-11-01',approval_status:'APPROVED',current_version_flag:1,created_by:'actor',source_document_id:'document',source_url:'https://example.invalid/regulation'};
const clause={id:'clause',instrument_id:'source',instrument_version_id:'edition',code:'EXAMPLE-KYC-C001',source_clause_reference:'3.1',heading:'Verify customer identity',clause_text:'Verify the identity of a customer before opening an account. Retain the supporting verification record.',internal_interpretation:'Retail Banking completes and records identity verification before account activation.',approval_status:'APPROVED',parent_clause_id:null,sequence_number:1};
const detail={instrument:source,versions:[version],clauses:[clause],source_documents:{document:'Example source.pdf'},secondary_domains:[],linked_obligations:[],clause_relationships:[],clause_carry_forward:[],tasks:[],audit:[],history:[],comments:[],metadata_corrections:[]};
const tasks=[{id:'work',kind:'DRAFT',instrument_id:'source',version_id:'edition',title:'Complete the customer identification source',due_at:null},{id:'decision',kind:'DECISION',stage:'COMPLIANCE_REVIEW',instrument_id:'source',version_id:'edition',title:'Review the source edition',due_at:'2026-11-20T12:00:00'}];
const notifications=[{id:'notice',notification_type:'USER_ACCESS_UPDATED',source_title:'Your approved role assignments',message:'Your approved access is available.',access_status_label:'Access assigned',triggered_at:'2026-11-14T08:00:00',read_at:null,action_path:'tasks',action_label:'Open my work'}];
const familyMember={...source,deadline:{current:null},scopes:[],resolved_scopes:0,versions:[version],timing:'CURRENT',source_version_id:'edition'};
function paged(items){return {items,pagination:{total:items.length,page:1,page_size:25,total_pages:items.length?1:0,start:items.length?1:0,end:items.length}};}
function identity(restricted=false){return {user:actor,csrf_token:'synthetic',environment:'uat',roles:restricted?['BUSINESS_OWNER']:roles,grants:(restricted?['BUSINESS_OWNER']:roles).map(role_code=>({role_code,global_scope_flag:restricted?0:1,scope_org_unit_id:restricted?'retail':null})),menu:(restricted?['home','tasks','approvals','obligations','help']:menu).map(id=>({id,label:id}))};}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'){report.writes.push(req.method+' '+url.pathname);res.writeHead(405).end();return;}
  const p=url.pathname.slice(4),q=url.searchParams;let body,status=200;
  if(p==='/auth/me')body=identity(req.headers['x-app-role']==='restricted');
  else if(p==='/masters')body=masters;
  else if(p==='/masters/catalogue')body=catalogue;
  else if(p==='/tasks')body=tasks;
  else if(p==='/notifications')body=notifications;
  else if(p==='/admin/access-summary')body=summary;
  else if(p==='/admin/users')body=users;
  else if(p==='/admin/ldap-department-requests')body=[];
  else if(p==='/admin/ldap')body={source:'database',enabled:false,server_uri:'ldaps://directory.example.invalid:636',use_ssl:true,base_dn:'DC=example,DC=invalid',bind_dn:'',has_bind_password:false,user_search_filter:'(sAMAccountName={username})',user_dn_template:'',start_tls:false,ca_certificates:[],ca_certificate_source:'system',attr_full_name:'displayName',attr_email:'mail',attr_department_code:'department',attr_division:'division',attr_info:'info',demo:{enabled:false}};
  else if(p==='/instruments'){const rows=[source].filter(s=>!q.get('q')||(s.title+' '+s.code).toLowerCase().includes(q.get('q').toLowerCase()));body=q.has('page_size')?paged(rows):rows;}
  else if(p==='/instruments/source')body=detail;
  else if(p==='/assignees')body=people;
  else if(p==='/source-editions')body=[{...version,instrument_title:source.title,instrument_code:source.code,regulatory_owner_unit_id:'compliance'}];
  else if(p==='/clause-browser')body={items:[],pagination:paged([]).pagination};
  else if(p==='/clause-relationships')body={...paged([{id:'relation',source:{...clause,edition_id:'edition',edition_number:'1.0',edition_approval:'APPROVED',instrument_title:source.title},target:{...clause,id:'earlier',code:'EXAMPLE-KYC-C000',edition_id:'edition',edition_number:'1.0',edition_approval:'APPROVED',instrument_title:source.title},relationship_type:'RELATED_TO',effective_from:'2026-11-01',approval_status:'APPROVED',description:'Retained context for the earlier customer identification requirement.'}]),decision_tasks:[]};
  else if(p==='/notification-families')body={families:[{root:familyMember,amendments:0,overdue:false,upcoming:0}],authorised_instruments:1,pagination:paged([source]).pagination};
  else if(p==='/notification-families/source')body={root_id:'source',members:[familyMember],links:[],scopes:[],deadlines:[],assessments:[],proposals:[],tasks:[],obligations:{source:[]}};
  else if(p==='/migration')body={...paged([{id:'batch',code:'EXAMPLE-IMPORT-001',source_file:'Example regulatory register.xlsx',source_count:24,loaded_count:20,pending_count:4}]),summary:{source_count:24,loaded_count:20,pending_count:4,batches:1}};
  else if(p==='/applications')body=[{id:'qa',name:'Quality assurance portal',description:'Open the bank-approved quality assurance workspace.',active_flag:0,url:''},{id:'risk',name:'Risk management',description:'Approved risk registers and reporting.',active_flag:0,url:''},{id:'audit',name:'Audit workspace',description:'Independent audit records and follow-up.',active_flag:0,url:''}];
  else if(p==='/obligations')body=paged([]);
  else if(p==='/applicability'||p==='/accountability')body={...paged([]),summary:{},counts:{obligations:0,records:0}};
  else{report.unexpected_requests.push(req.method+' '+p);status=404;body={detail:'Unexpected synthetic endpoint.'};}
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(body));return;
 }
 const file=path.resolve(dist,url.pathname==='/'?'index.html':'.'+url.pathname.replace(/^\/assets/,''));
 if(!file.startsWith(dist+path.sep)){res.writeHead(403).end();return;}
 const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream'};
 if(focusedOrganisationImport&&url.pathname==='/')headers['Content-Security-Policy']="style-src 'self'";
 res.writeHead(200,headers).end(await fs.readFile(file));
}catch(e){report.unexpected_requests.push(e.message);res.writeHead(500).end('Synthetic preview failure.');}});
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled'});report.screenshots.push(name+'.png');}
(async()=>{
 await fs.mkdir(out,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const base='http://127.0.0.1:'+server.address().port;
 if(preview){console.log('Synthetic application preview: '+base+'/#repository');return;}
 let browser,lastPage;
 try{
  const {chromium}=require(process.argv[2]||'playwright');browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'}),page=await context.newPage();lastPage=page;page.setDefaultTimeout(12000);
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){report.unexpected_requests.push('External request');return route.abort();}return route.continue();});page.on('pageerror',e=>report.errors.push(e.message));
  let serial=0;async function visit(hash,heading){await page.goto(base+'/?check='+(++serial)+'#'+hash);await page.locator('.app-shell').waitFor();if(heading)await page.getByRole('heading',{name:heading,exact:true,level:1}).waitFor();assert.equal(await page.locator('.notice.error').count(),0,'Route error '+hash);}
  const orgPreviewRows=[
   {row:2,code:'PUNE-BRANCH',name:'Pune Main Branch',unit_type:'BRANCH',parent_code:'PUNE-ZONE',active_flag:true,effective_from:'2026-10-17',effective_to:null},
   {row:3,code:'OPERATIONS',name:'Operations',unit_type:'DEPARTMENT',parent_code:'BANK',active_flag:true,effective_from:'2026-10-17',effective_to:null},
   {row:4,code:'PUNE-ZONE',name:'Pune Zone',unit_type:'ZONE',parent_code:'OPERATIONS',active_flag:true,effective_from:'2026-10-17',effective_to:null},
   {row:5,code:'RETAIL-BRANCH',name:'Retail branch',unit_type:'BRANCH',parent_code:'RETAIL',active_flag:false,effective_from:'2026-10-24',effective_to:'2026-12-31'},
  ];
  let previewErrors=[];
  await page.route('**/api/admin/organisation-import/preview',route=>route.fulfill({json:{
   total:orgPreviewRows.length,ready:orgPreviewRows.length-previewErrors.length,imported:0,file_hash:'0'.repeat(64),
   rows:orgPreviewRows,errors:previewErrors,
  }}));
  await visit('masters?tab=organisation','Organisation hierarchy');
  const orgDialog=page.locator('#dialog');
  async function previewOrganisation(){
   await orgDialog.locator('input[type=file]').setInputFiles({name:'organisation-units.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('Synthetic workbook')});
   await orgDialog.getByRole('button',{name:'Preview import',exact:true}).click();
   await orgDialog.getByRole('heading',{name:'Organisation import preview',exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'Upload Excel',exact:true}).click();
  await previewOrganisation();
  const orgTree=orgDialog.getByRole('list',{name:'Proposed organisation hierarchy',exact:true});
  const orgRows=orgTree.getByRole('listitem');
  const unit=(code)=>orgTree.locator('[data-code="'+code+'"]');
  assert.deepEqual(await orgRows.evaluateAll(nodes=>nodes.map(node=>node.dataset.code)),['BANK','OPERATIONS','PUNE-ZONE','PUNE-BRANCH','RETAIL','RETAIL-BRANCH']);
  assert.equal(await unit('PUNE-BRANCH').getAttribute('data-parent-code'),'PUNE-ZONE');
  assert.equal(await unit('RETAIL-BRANCH').getAttribute('data-parent-code'),'RETAIL');
  assert.equal(await orgTree.getByText('Existing',{exact:true}).count(),2);
  for(const detail of ['Excel row 2','2026-10-24 → 2026-12-31','Inactive'])assert((await orgTree.innerText()).includes(detail));
  assert(await orgDialog.getByRole('button',{name:'Import 4 units',exact:true}).isVisible());
  for(const width of [1440,320]){
   await page.setViewportSize({width,height:width===320?840:1050});
   assert(await orgDialog.locator('.modal-body').evaluate(element=>element.scrollWidth<=element.clientWidth+1));
   const positions=[];
   for(const code of ['BANK','OPERATIONS','PUNE-ZONE','PUNE-BRANCH'])positions.push((await unit(code).boundingBox()).x);
   assert(positions.every((x,index)=>index===0||x>positions[index-1]),'Each branch level must indent at '+width+' px. Positions '+positions.join(', '));
   await shot(page,width===320?'organisation-import-hierarchy-phone':'organisation-import-hierarchy-desktop');
  }
  await orgDialog.getByRole('button',{name:'Choose another workbook',exact:true}).click();
  previewErrors=[{row:2,code:'PUNE-BRANCH',message:'Check the parent code.'}];
  await previewOrganisation();
  assert.equal(await orgTree.count(),0);
  assert(await orgDialog.getByText('Check the parent code.',{exact:true}).isVisible());
  assert.equal(await orgDialog.getByRole('button',{name:'Import 3 units',exact:true}).count(),0);
  await page.keyboard.press('Escape');
  await orgDialog.waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:1050});
  report.checks.push('Organisation import preview indents each level at desktop and phone widths, shows uploaded and existing parents in parent-first order, and keeps invalid worksheets in the findings view.');
  if (focusedOrganisationImport) {
    assert.deepEqual(report.errors,[]);
    assert.deepEqual(report.writes,[]);
    assert.deepEqual(report.unexpected_requests,[]);
    report.status='passed';
    console.log('Organisation import hierarchy passed desktop, phone and workbook findings checks.');
    return;
  }
  const screens=[['home','Welcome back, Example Workspace Manager'],['tasks','My tasks'],['approvals','My decisions'],['repository','Regulatory repository'],['repository/source','Customer identification'],['repository/new','Register a new instrument'],['notification-families','Notification families'],['notification-families/source','Customer identification and onboarding requirements'],['clauses','Find a clause'],['clause-relationships','Clause / Para relationships'],['users','Users & access'],['users?tab=LDAP','Users & access'],['masters','Master data'],['masters?tab=organisation','Organisation hierarchy'],['masters?tab=other','Master data'],['migration','Import existing regulatory records'],['ldap','LDAP / Active Directory settings'],['applications','Connected applications'],['notifications','Notifications'],['help','Help & workflow guide'],['obligations','Obligations'],['obligations?view=applicability','Applicability'],['obligations?view=accountability','Accountability']];
  for(const [hash,heading]of screens){await visit(hash,heading);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Desktop overflow '+hash);if(hash==='users')assert(await page.locator('.user-access-page th').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),'User headings fit their columns');report.screens.push(hash);if(['tasks','repository','repository/source','repository/new','notification-families','users','masters?tab=organisation','migration','ldap','applications','help'].includes(hash))await shot(page,hash.replaceAll('/','-').replaceAll('?','-').replaceAll('=','-')+'-desktop');}
  report.checks.push(screens.length+' routes render the production shell and relevant register, reader, wizard, account, directory, settings, import, work, notification and guidance surfaces with authorised synthetic data.');
  await visit('repository','Regulatory repository');const title=page.locator('.record-title').first(),code=page.locator('.record-code').first();assert((await title.boundingBox()).y<(await code.boundingBox()).y);assert.equal(await page.locator('.record-table [role=columnheader]').count(),6);
  await page.getByRole('searchbox',{name:'Search regulatory repository',exact:true}).fill('unmatched');await page.locator('#filters .search-submit').click();await page.waitForURL(u=>u.hash.includes('q=unmatched'));await page.getByRole('heading',{name:'No records match this view.',exact:true}).waitFor();
  report.checks.push('Shared tables retain native headers/roles, put record titles above references and preserve the existing filter URL and empty-state behavior.');
  await visit('masters?tab=other','Master data');await page.locator('[data-action=add-master]').click();await page.locator('#master-record').waitFor();assert.equal(await page.locator('#master-record [name=code]').getAttribute('required'),'');await page.locator('#master-record [name=code]').fill('EXAMPLE');await page.locator('#master-record [name=name]').fill('Example frequency');await shot(page,'master-dialog-desktop');await page.keyboard.press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});assert(await page.locator('[data-action=add-master]').evaluate(e=>e===document.activeElement));
  await visit('users','Users & access');await page.locator('[data-action=user][data-id=owner]').click();await page.locator('#user').waitFor();assert.equal(await page.locator('#user [name=username]').inputValue(),'example.owner');assert.equal(await page.locator('#user [name=username]').getAttribute('readonly'),'');await shot(page,'user-dialog-desktop');await page.keyboard.press('Escape');
  report.checks.push('Master-data and account dialogs retain required/readonly fields, entered/saved values, native Escape and opener focus; forms are inspected without submitting business writes.');
  await visit('tasks','My tasks');await page.getByRole('button',{name:'Search the workspace',exact:true}).click();await page.locator('#workspace-search').waitFor();await page.locator('#workspace-search [name=q]').fill('customer');await page.locator('#workspace-search button[type=submit]').click();await page.waitForURL(u=>u.hash.includes('q=customer'));await page.getByRole('heading',{name:'Regulatory repository',exact:true}).waitFor();assert.equal(await page.locator('#dialog').isVisible(),false);
  report.checks.push('Global search opens the styled native dialog and hands the entered query to the selected authorised register.');
  await visit('repository/new','Register a new instrument');const wizard=page.locator('#instrument');await page.locator('[data-action=wizard-next]').click();assert.equal(await wizard.getAttribute('data-wizard'),'0');assert(await wizard.locator('[name=title]').evaluate(e=>!e.validity.valid));await wizard.locator('[name=title]').fill('Example source registration');await page.locator('[data-action=wizard-next]').click();assert.equal(await wizard.getAttribute('data-wizard'),'1');
  for(const [name,value]of [['regulator_id','rbi'],['primary_domain_id','kyc'],['instrument_type_id','direction'],['confidentiality_class_id','internal']])await wizard.locator('select[name='+name+']').selectOption(value,{force:true});
  await page.locator('[data-action=wizard-next]').click();assert.equal(await wizard.getAttribute('data-wizard'),'2');await page.locator('[data-action=wizard-back]').click();await page.locator('[data-action=wizard-back]').click();assert.equal(await wizard.locator('[name=title]').inputValue(),'Example source registration');
  report.checks.push('Source registration still blocks missing required input, advances through classification/accountability and preserves the entered title on Back without uploading or creating a source.');
  const mobileScreens=[['tasks','My tasks'],['repository','Regulatory repository'],['repository/new','Register a new instrument'],['users','Users & access'],['users?tab=LDAP','Users & access'],['masters?tab=organisation','Organisation hierarchy'],['migration','Import existing regulatory records'],['ldap','LDAP / Active Directory settings'],['notification-families','Notification families'],['help','Help & workflow guide']];
  for(const width of [1280,1024,900,768,640,390,320]){
   await page.setViewportSize({width,height:1000});
   for(const [hash,heading]of mobileScreens){await visit(hash,heading);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow,'Document overflow '+hash+' '+width);report.responsive.push({route:hash,width});if(width===390&&['repository','users','ldap','repository/new'].includes(hash))await shot(page,hash.replaceAll('/','-')+'-phone');}
  }
  await page.setViewportSize({width:390,height:900});await visit('repository','Regulatory repository');const cells=page.locator('.record-table tbody tr').first().locator('td');assert.equal(await cells.count(),6);assert(await cells.evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).display==='block'&&n.dataset.label)));assert.equal(await page.locator('.record-table [role=columnheader]').count(),6);assert.equal(await page.locator('.record-table tbody tr').count(),1);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.sidebar.open').waitFor();assert.equal(await page.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'true');await page.locator('.sidebar a[href="#tasks"]').click();await page.getByRole('heading',{name:'My tasks',exact:true}).waitFor();assert.equal(await page.locator('.sidebar.open').count(),0);
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.locator('.sidebar.open').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('.sidebar.open').count(),0);
  report.checks.push('Ten representative routes fit seven tablet/phone/desktop widths (320–1280px); phone records expose every field without duplicating rows, and mobile navigation retains open/select/Escape behavior.');
  await visit('masters?tab=other','Master data');await page.locator('[data-action=add-master]').click();await page.locator('#master-record').waitFor();assert(await page.evaluate(()=>document.querySelector('#dialog').scrollWidth<=document.querySelector('#dialog').clientWidth+1));await shot(page,'master-dialog-phone');await page.keyboard.press('Escape');
  await visit('help','Help & workflow guide');await page.emulateMedia({media:'print'});assert.equal(await page.locator('.sidebar').evaluate(e=>getComputedStyle(e).display),'none');assert.equal(await page.locator('.workspace-page-header h1').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');await page.emulateMedia({media:'screen',reducedMotion:'reduce'});assert.equal(await page.locator('.workspace-page-header').evaluate(e=>getComputedStyle(e).animationName),'none');
  report.checks.push('Phone edit dialogs remain inside the viewport; reduced motion disables shared entrance effects and the printed guide removes navigation and uses a plain dark heading.');
  const restricted=await browser.newContext({viewport:{width:1440,height:1050},extraHTTPHeaders:{'X-App-Role':'restricted'},reducedMotion:'reduce'}),rp=await restricted.newPage();rp.on('pageerror',e=>report.errors.push(e.message));await rp.goto(base+'/#users');await rp.getByRole('heading',{name:'This area is outside your role scope',exact:true}).waitFor();assert.equal(await rp.locator('.sidebar a[href="#users"]').count(),0);await rp.goto(base+'/#obligations');await rp.getByRole('heading',{name:'Obligations',exact:true}).waitFor();assert.equal(await rp.locator('[data-action=obligation-export]').count(),0);await restricted.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.writes,[]);assert.deepEqual(report.unexpected_requests,[]);report.checks.push('Restricted roles retain the existing access boundary and hidden administration/export controls; no external requests, browser errors or business writes occurred.');report.status='passed';await context.close();
 }catch(e){report.status='failed';report.failure=e.stack;if(lastPage)await shot(lastPage,'failure').catch(()=>{});throw e;}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.writeFile(path.join(out,'validation.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify({status:report.status,groups:report.checks.length,screens:report.screens.length,responsive:report.responsive.length}));
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
