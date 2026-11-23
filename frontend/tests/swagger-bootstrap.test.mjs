import test from 'node:test';
import assert from 'node:assert/strict';
import {createSwaggerRequestGuard,swaggerOptions} from '../core/swagger-request.ts';
const origin='https://localhost:8010';
function config(requestFetch=()=>{throw new Error('Unexpected fetch');},expired=()=>{}) {
 return swaggerOptions(createSwaggerRequestGuard(origin,requestFetch,expired));
}
test('bootstrap uses local schema with external validation and persisted auth disabled',()=>{
 const c=config();assert.equal(c.url,'/openapi.json');assert.equal(c.validatorUrl,null);
 assert.equal(c.queryConfigEnabled,false);assert.equal(c.persistAuthorization,false);
 assert.equal(c.withCredentials,true);assert.equal(c.showMutatedRequest,false);assert.equal(c.docExpansion,'list');
});
test('public schema and API reads use same-origin cookies without a CSRF preflight',async()=>{
 const c=config();for(const url of ['/openapi.json','/api/health']){
  const request=await c.requestInterceptor({url,method:'GET'});assert.equal(request.credentials,'same-origin');assert.equal(request.headers,undefined);
 }
});
test('each protected write gets current CSRF without altering body or other headers',async()=>{
 let calls=0;const c=config(async(url,options)=>{assert.equal(url,'/api/auth/me');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({csrf_token:'fixture-'+(++calls)})};});
 for(const method of ['POST','PUT','PATCH','DELETE']){const request=await c.requestInterceptor({url:'/api/example',method,body:'unchanged',headers:{Accept:'application/json'}});assert.equal(request.headers['X-CSRF-Token'],'fixture-'+calls);assert.equal(request.body,'unchanged');assert.equal(request.headers.Accept,'application/json');}assert.equal(calls,4);
});
test('encrypted login keeps its public protocol without CSRF or plaintext fallback',async()=>{
 const request=await config().requestInterceptor({url:'/api/auth/login',method:'POST',body:'encrypted envelope'});assert.equal(request.body,'encrypted envelope');assert.equal(request.headers,undefined);
});
test('expired or missing session CSRF clears identity and gives direct sign-in guidance',async()=>{
 let expired=0;
 await assert.rejects(config(async()=>({ok:false,status:401}),()=>expired++).requestInterceptor({url:'/api/example',method:'POST'}),/Sign in using the form above/);
 await assert.rejects(config(async()=>({ok:true,json:async()=>({})}),()=>expired++).requestInterceptor({url:'/api/example',method:'POST'}),/session is unavailable/);assert.equal(expired,2);
});
test('request guard rejects external origins and non-API targets before any fetch',async()=>{
 for(const url of ['https://external.invalid/api/example','//external.invalid/api/example','http://localhost:8010/api/example','/assets/private','/api/../.env'])await assert.rejects(config().requestInterceptor({url,method:'POST'}),/only this portal/);
});
