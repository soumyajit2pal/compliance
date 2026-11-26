import {state} from '../core/state.ts';
import {api} from '../core/api.ts';
import {heading} from '../ui/layout.ts';
import { dateTime, esc,field,input,select,button,message} from '../ui/components.ts';
import {panel,note} from '../ui/widgets.ts';

export async function employeeSettingsPage(){
 const request=state.routeNumber,data=await api('/admin/employee-api');
 if(request!==state.routeNumber)return '';
 const numeric=(label,name,min,max)=>field(label,input(name,data[name],'number',`required min="${min}" max="${max}" step="1"`));
 return heading('Employee profile API','Refresh employee details at sign-in. An unavailable API does not block sign-in or change approved access.')+
 `<form id="employee-api-settings">${panel('Connection and retry settings',`<div class="form-grid">
 ${field('Enable employee lookups',`<input type="checkbox" name="enabled" ${data.enabled?'checked':''}>`)}
 ${field('Verify TLS certificate and hostname',`<input type="checkbox" name="verify_tls" ${data.verify_tls!==false?'checked':''}>`,'Enabled by default. Turning this off allows connections to servers whose identity cannot be verified.')}
 ${field('API endpoint',input('endpoint',data.endpoint,'url','required maxlength="1000"'),'HTTPS only. Server-approved hosts: '+data.allowed_hosts.join(', ')+'. The portal supplies pf_no.')}
 ${field('User ID prefix to remove',input('userid_prefix',data.userid_prefix,'text','required maxlength="10"'),'For example: b040786 → PF 40786. Only the leading prefix is removed.')}
 ${numeric('Total timeout (seconds)','timeout_seconds',1,10)}${numeric('First retry delay (seconds)','retry_seconds',30,3600)}${numeric('Maximum retry delay (seconds)','max_retry_seconds',30,86400)}
 </div><p class="small muted">Retries continue in the background, including after sign-out or an application restart. Repeated failures use a capped delay. Every eligible successful sign-in also tries again.</p>
 <p class="small muted">Every successful employee sign-in checks the separate LDAP department and calls the employee API. All employee-field changes require independent approval. During API outages, approved data is retained; a changed LDAP department or pending review still restricts access.</p>`)}
 <div class="mt24">${panel('API authentication',`<div class="form-grid">
 ${field('Authentication',select('auth_type',[{id:'NONE',name:'No credential'},{id:'BEARER',name:'Bearer token'},{id:'API_KEY',name:'API key'}],data.auth_type,'name','required'))}
 ${field('API key header',input('api_key_header',data.api_key_header,'text','required maxlength="80"'))}
 ${field('API credential',input('secret','','password','autocomplete="new-password" maxlength="4000"'),data.has_secret?'A credential is saved. Leave blank to retain it.':'No credential is saved.')}
 ${field('Remove saved credential',`<input type="checkbox" name="clear_secret">`)}
 </div><p class="small muted">Credentials are encrypted in the database.</p>` )}</div>
 <div class="mt24">${panel('Test without saving',field('Test PF number',input('test_pf_no','','text','inputmode="numeric" pattern="[0-9]{1,40}" maxlength="40" autocomplete="off"'))+button('employee-api-test','Test current settings')+'<p id="employee-api-test-result" role="status"></p>')}</div>
 <p class="inline-error" id="form-error" role="alert"></p><div class="wizard-footer"><span class="small muted">Employee details do not grant roles or approve department changes.</span><button class="btn primary" type="submit">Save API settings</button></div></form>
 <div class="mt24">${panel('Refresh health',`<p>Successful: ${esc(data.health.counts.SUCCESS||0)} · Incomplete: ${esc(data.health.counts.PARTIAL||0)} · Failed: ${esc(data.health.counts.FAILED||0)}</p><p class="small muted">Last attempt: ${esc(dateTime(data.health.last_attempt_at,'NA'))} · Last full success: ${esc(dateTime(data.health.last_success_at,'NA'))}</p>`+button('employee-api-retry','Retry pending lookups')+button('reload','Refresh status')+note('A failed lookup retains the last successful employee details. New profiles show NA for unavailable API fields. Historical department observations and approval history are retained. Existing access rules continue.'))}</div>`;
}
function payload(form:HTMLFormElement){
 const f=form.elements as any,v=Object.fromEntries(new FormData(form)) as any;
 delete v.test_pf_no;
 v.enabled=f.enabled.checked;v.clear_secret=f.clear_secret.checked;
 v.verify_tls=f.verify_tls.checked;
 for(const k of ['timeout_seconds','retry_seconds','max_retry_seconds'])v[k]=Number(v[k]);
 return v;
}
export function employeeSettingsHandlers({render}){return {
 actions:{
  'employee-api-test':async()=>{
   const form=document.querySelector<HTMLFormElement>('#employee-api-settings'),result=document.querySelector('#employee-api-test-result');
   const pf=(form.elements as any).test_pf_no.value.trim();if(!/^[0-9]{1,40}$/.test(pf))throw new Error('Enter a PF number to test.');
   result.textContent='Testing employee lookup…';
   try{const r=await api('/admin/employee-api/test','POST',{...payload(form),test_pf_no:pf});result.textContent=r.message+(r.guidance?' '+r.guidance:'')+(r.missing_fields?.length?' Some employee fields were not supplied.':'');}
   catch(error){result.textContent=error.message;throw error;}
  },
  'employee-api-retry':async()=>{const r=await api('/admin/employee-api/retry','POST',{});message(r.message);await render();},
 },
 forms:{'employee-api-settings':async(form)=>{const r=await api('/admin/employee-api','PUT',payload(form));message(r.message);await render();}},
};}
