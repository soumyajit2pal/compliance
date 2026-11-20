/** Verify authored TypeScript and production bundles, excluding dependency internals. */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const tests=fs.readdirSync(new URL('../frontend/tests/',import.meta.url))
  .filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'frontend/tests/'+name);
for(const [command,args] of [['npm',['--prefix','frontend','run','build']],[process.execPath,['--test',...tests]]]){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
