// One endpoint setting for existing-record UAT browser checks. Fixture servers
// retain their own explicit HTTP base. Self-signed bypass is local QA only.
const endpoint=new URL(process.env.CBD_UAT_BASE_URL||'https://localhost:8010');
if(!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||!['https:','http:'].includes(endpoint.protocol))
 throw new Error('Live QA only permits an explicit local UAT URL.');
const base=endpoint.origin;
const uatContextOptions={ignoreHTTPSErrors:endpoint.protocol==='https:'};
module.exports={base,uatContextOptions};
