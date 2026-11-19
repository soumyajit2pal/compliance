/** Present only the authorised links returned with this exact work assignment. */
import {esc,ref,link,badge} from '../ui/components.ts';

export function workRelationshipIntro(){
 return '<aside class="work-relationship" aria-label="Checks, work and evidence explained"><p><strong>Checks and procedures</strong> describe the bank’s reusable checks. <strong>Compliance work</strong> assigns a person a task and a due date. <strong>Evidence</strong> records what was done and supports independent review.</p></aside>';
}

export function workContext(d){
 const a=d.action,o=d.obligation,checks=d.controls||[];
 const evidence=[...new Map<string,any>((d.evidence||[]).map(e=>[e.id,e])).values()];
 const checkLinks=checks.slice(0,3).map(x=>`<li>${link('controls/'+encodeURIComponent(x.control.id),x.control.code+' · '+x.control.title)}<small>${x.control.version_number?'Check revision '+esc(x.control.version_number)+' · ':''}${link('control-mappings/'+encodeURIComponent(x.mapping.id),'View obligation link')}${x.mapping.coverage_type?' · '+badge(x.mapping.coverage_type):''}</small></li>`).join('');
 const evidenceLinks=evidence.slice(0,3).map(e=>`<li>${link('evidence/'+encodeURIComponent(e.id),e.code+' · '+e.title)}<small>${badge(e.evidence_status)}</small></li>`).join('');
 const noChecks=a.control_scope_reason?`<p>No check execution is assigned to this work.</p><p class="work-context-reason"><strong>Scope explanation:</strong> ${esc(a.control_scope_reason)}</p>`:'<p>No check link was recorded on this assignment. Check coverage needs assessment.</p>';
 return `<section class="work-context" aria-labelledby="work-context-title"><header><h2 id="work-context-title">How this work connects</h2><p>Follow the requirement, the applicable checks and the evidence for this work item.</p></header><div class="work-context-grid">
  <article class="work-context-card" data-work-context="obligation"><span class="work-context-label">Linked obligation</span><h3>Why is this work required?</h3>${link('obligations/'+encodeURIComponent(o.id),o.code+' · '+(o.title||'Open obligation'))}<p>${esc(o.statement)}</p></article>
  <article class="work-context-card" data-work-context="checks"><span class="work-context-label">Checks and procedures</span><h3>Which checks apply?</h3>${checks.length?`<p>These are the exact check revisions assigned for this period.</p><ul>${checkLinks}</ul>${checks.length>3?`<p class="muted">${checks.length-3} more linked checks are listed in the results section below.</p>`:''}`:noChecks}</article>
  <article class="work-context-card" data-work-context="evidence"><span class="work-context-label">Supporting evidence</span><h3>What evidence is needed?</h3><p>${esc(a.evidence_requirement||'The evidence standard has not been recorded. This work needs assessment before submission.')}</p>${a.evidence_type_id?`<p><strong>Evidence type:</strong> ${esc(ref('evidence_type',a.evidence_type_id))}</p>`:''}${evidence.length?`<p>${evidence.length} visible linked item${evidence.length===1?'':'s'}</p><ul>${evidenceLinks}</ul>${evidence.length>3?`<p class="muted">${evidence.length-3} more visible items are listed below.</p>`:''}`:'<p class="muted">No evidence is available in your view yet.</p>'}</article>
 </div><p class="work-context-review">${a.record_status==='COMPLETED'?'Independent review decisions are retained with this completed work.':'Evidence and any assigned check results require independent review before completion.'} Completing this work does not establish overall compliance.</p></section>`;
}
