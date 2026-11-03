/** Explain each citation as a full instrument, its exact edition, and a clause within it. */
import {esc,statusTag,title,versionLabel} from '../ui/components.ts';
import {panel,pagedCollection} from '../ui/widgets.ts';
import {icon} from '../ui/icons.ts';

const relationship=(type)=>type==='PRIMARY'?['Main clause','This is the main clause this obligation is based on.']:type==='SUPPORTING'?['Supporting clause','This clause provides additional context for the obligation.']:[title(type)||'Linked clause','A clause linked to this obligation.'];
const viewLink=(path,label,context)=>`<a class="btn small obligation-source-link" href="#${esc(path)}" aria-label="${esc(label+': '+context)}">${esc(label)}${icon('arrow')}</a>`;
function citationCard(row){
  const [label,explanation]=relationship(row.link_type);
  const header=`<header class="obligation-source-card-header"><div><h3>${esc(label)}</h3><p>${esc(explanation)}</p></div>${row.restricted?statusTag('Restricted access'):''}</header>`;
  if(row.restricted)return `<article class="obligation-source-card obligation-source-restricted">${header}<p>Access to this linked clause is restricted. Its instrument, edition and wording are unavailable to your account.</p></article>`;
  const {instrument,edition,clause}=row;
  const version=versionLabel(edition.version_number);
  const clauseRef=clause.source_clause_reference||'';
  const instrumentPath='repository/'+encodeURIComponent(instrument.id)+'?'+new URLSearchParams({version:edition.id});
  const clausePath='clauses?'+new URLSearchParams({instrument:instrument.id,edition:edition.id,clause:clause.id});
  const source=`<div class="obligation-source-location">
    <section class="obligation-source-instrument"><h4>Regulatory instrument</h4><p class="obligation-source-definition">The complete regulatory document</p><p class="obligation-source-name">${esc(instrument.title||'Title not recorded')}</p><dl><div><dt>Document version (edition)</dt><dd>${esc(version)}</dd></div></dl>${viewLink(instrumentPath,'View instrument',(instrument.title||'Regulatory instrument')+' · edition '+version)}<small>Opens this document version in the Regulatory Library.</small></section>
    <section class="obligation-source-clause"><h4>Clause</h4><p class="obligation-source-definition">The specific section within this document version</p><p class="obligation-source-name">${esc(clause.heading||'Heading not recorded')}</p><dl><div><dt>Clause reference in the document</dt><dd>${esc(clauseRef||'Not recorded')}</dd></div></dl>${viewLink(clausePath,'View clause',(clauseRef?clauseRef+' · ':'')+(clause.heading||'Linked clause')+' · edition '+version)}<small>Opens this clause from the document version shown here.</small></section>
  </div>`;
  const wording=`<div class="obligation-source-wording"><section><h4>Original clause wording</h4><p class="obligation-source-definition">The regulator’s wording</p><div class="source-wording">${esc(clause.clause_text||'Original wording not recorded.')}</div></section><section><h4>Bank’s interpretation</h4><p class="obligation-source-definition">How the bank understands this clause</p><div class="source-wording">${esc(clause.internal_interpretation||'Bank interpretation not recorded.')}</div></section></div>`;
  const references=`<details class="obligation-source-references"><summary>Reference IDs</summary><dl><div><dt>Instrument reference</dt><dd>${esc(instrument.code||'Not recorded')}</dd></div><div><dt>Internal clause reference</dt><dd>${esc(clause.code||'Not recorded')}</dd></div></dl></details>`;
  return `<article class="obligation-source-card" data-linked-clause="${esc(row.id||clause.id)}">${header}${source}${wording}${references}</article>`;
}
export function renderLinkedRegulatoryClauses(rows=[]){
  const ordered=[...rows].sort((a,b)=>Number(b.link_type==='PRIMARY')-Number(a.link_type==='PRIMARY'));
  const body=ordered.length?pagedCollection(ordered.map(citationCard),{pageKey:'obligation-citations',label:'linked clauses',className:'obligation-source-cards'}):'<p class="obligation-empty-state">No regulatory clauses linked.</p>';
  return panel('Linked regulatory clauses',body,{cls:'obligation-sources-panel',sub:'An instrument is the full regulatory document. An edition is a version of that document. A clause is a specific section within that edition.'});
}
