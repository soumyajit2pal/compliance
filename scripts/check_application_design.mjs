/** Build and verify the application design without a live account/database. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const playwright=process.argv[2];
if(!playwright)throw new Error('Supply the absolute Playwright module path.');
const output=path.resolve(root,process.env.CBD_APPLICATION_REPORT_ROOT||'outputs/application-redesign-2026-11-14');
await fs.mkdir(output,{recursive:true});
async function run(script,args,log,extra={}){
 const handle=await fs.open(path.join(output,log),'w');
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script,...args],{cwd:root,env:{...process.env,...extra},stdio:['ignore',handle.fd,handle.fd]});
  child.once('error',reject);child.once('close',code=>resolve(code));
 });}finally{await handle.close();}
}
console.log('Building production assets and checking frontend units.');
if(await run('scripts/check_frontend.mjs',[],'frontend-checks.log')!==0)throw new Error('Frontend build/checks failed; inspect frontend-checks.log.');
const suites=[
 ['application','application-design.browser.cjs','CBD_APPLICATION_OUTPUT','browser'],
 ['home','home-redesign.browser.cjs','CBD_HOME_OUTPUT','home'],
 ['login','login-editorial.browser.cjs','CBD_LOGIN_DESIGN_OUTPUT','login'],
 ['profile','work-profile.browser.cjs','CBD_WORK_PROFILE_OUTPUT','profile'],
 ['clauses','clause-workspace.browser.cjs','CBD_CLAUSE_QA_OUTPUT','clauses'],
 ['source-preview','instrument-quick-view-rows.browser.cjs','CBD_QUICK_VIEW_ROWS_OUTPUT','source-preview'],
 ['register','obligation-register-redesign.browser.cjs','CBD_REGISTER_OUTPUT','register'],
 ['workspace','obligation-workspace.browser.cjs','CBD_WORKSPACE_OUTPUT','workspace'],
 ['obligation-preview','obligation-quick-view.browser.cjs','CBD_OBLIGATION_QUICK_VIEW_OUTPUT','obligation-preview'],
 ['exports','obligation-export.browser.cjs','CBD_EXPORT_OUTPUT','exports'],
];
const queue=[...suites],results=[];
async function worker(){while(queue.length){
 const [name,file,variable,directory]=queue.shift();console.log('Checking '+name+'…');
 const code=await run('frontend/tests/'+file,[playwright],name+'-checks.log',{[variable]:path.join(output,directory)});
 const reportFile=name==='clauses'?'browser-validation.json':'validation.json';
 let report;try{report=JSON.parse(await fs.readFile(path.join(output,directory,reportFile),'utf8'));}catch{}
 const passed=code===0&&Boolean(report?.checks?.length)&&(report?.passed===true||report?.status==='passed'||(name==='clauses'&&!report?.status));
 results.push({name,passed,exit_code:code,groups:report?.checks?.length||0,report:directory+'/'+reportFile,log:name+'-checks.log'});
 console.log((passed?'PASS ':'FAIL ')+name+' ('+(report?.checks?.length||0)+' groups)');
}}
await Promise.all([worker(),worker()]);
results.sort((a,b)=>suites.findIndex(s=>s[0]===a.name)-suites.findIndex(s=>s[0]===b.name));
await fs.writeFile(path.join(output,'suite-results.json'),JSON.stringify({status:results.every(r=>r.passed)?'passed':'failed',suites:results},null,2)+'\n');
if(results.some(r=>!r.passed))process.exitCode=1;
