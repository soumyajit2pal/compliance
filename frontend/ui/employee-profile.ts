import {esc,title} from './components.ts';
import {detailFields,note,panel} from './widgets.ts';
const labels={pf_no:'PF number',employee_name:'Employee name',designation:'Designation',branch_code:'Branch code',branch_name:'Branch name (for branch code)',current_branch_code:'Current branch code',zone_code:'Zone code',zone_name:'Zone name',department_code:'Employee department code',department_name:'Employee department name',employee_status:'Employee status'};
export function employeeWarning(profile){
 return profile?.warning?`<aside class="mt16 mb16" role="status" aria-label="Employee profile refresh">${note(esc(profile.warning)+(profile.last_success_at?' Last successful details are retained.':' Details not yet available are shown as NA.'),'warn')}</aside>`:'';
}
export function employeeDetails(profile){
 if(!profile)return '';
 return panel('Signed-in employee details',
  `<p class="small muted">Employee API metadata for your signed-in account. Approved access and LDAP verification remain separate.</p>`+
  detailFields(Object.entries(labels).map(([key,label])=>[label,esc(profile[key]||'NA')]))+
  `<p class="small muted">Refresh: ${esc(title(profile.sync_status))}${profile.stale?' · Some details may be unavailable or from an earlier lookup.':''}<br>Last successful refresh: ${esc(profile.last_success_at?profile.last_success_at.replace('T',' ')+' UTC':'NA')}${!profile.retry_enabled?' · Automatic refresh is disabled by the administrator.':''}</p>`+
  (profile.missing_fields?.length?`<p class="small muted">Not supplied in the latest response: ${esc(profile.missing_fields.map(k=>labels[k]||title(k)).join(', '))}.</p>`:''));
}
