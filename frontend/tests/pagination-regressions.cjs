// Sequential: the Oracle browser fixture owns a single rollback transaction.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'outputs/shared-pagination-2026-10-31');
const suites=[
 ['combined-import.browser.cjs','CBD_COMBINED_IMPORT_QA_OUTPUT','imports'],
 ['pagination.browser.cjs',null,'browser'],
 ['business-scope-deferral.browser.cjs','CBD_SCOPE_DEFERRAL_QA_OUTPUT','scope-regression'],
 ['notification-families.browser.cjs','CBD_FAMILY_QA_OUTPUT','family-regression'],
];
fs.mkdirSync(output,{recursive:true});
for(const [script,variable,folder] of suites){
 const env={...process.env,...(variable?{[variable]:path.join(output,folder)}:{})};
 const result=spawnSync(process.execPath,[path.join(__dirname,script),...(process.argv[2]?[process.argv[2]]:[])],{cwd:root,env,encoding:'utf8',maxBuffer:20*1024*1024});
 fs.writeFileSync(path.join(output,folder+'-regression.log'),(result.stdout||'')+(result.stderr||''));
 console.log(script+': '+(result.status===0?'passed':'failed'));
 if(result.status!==0){process.exitCode=1;break;}
}
