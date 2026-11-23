import test from 'node:test';
import assert from 'node:assert/strict';
import {renderLinkedRegulatoryClauses} from '../features/obligation-sources.ts';
const citation=(id='main',extra={})=>({id,link_type:'PRIMARY',instrument:{id:'instrument-a',title:'Know Your Customer Direction',code:'RULE-A'},edition:{id:'edition-a',version_number:'1.0'},clause:{id:'clause-a',heading:'Document verification requirements',source_clause_reference:'14.1',code:'RULE-A-C003',clause_text:'Verify the identification documents.\nRetain the result.',internal_interpretation:'Check identity before opening an account.'},...extra});

test('instrument, edition and clause are explicitly labelled, with main clause first without mutating input',()=>{
 const rows=[citation('support',{link_type:'SUPPORTING'}),citation()],html=renderLinkedRegulatoryClauses(rows);assert(html.indexOf('data-linked-clause="main"')<html.indexOf('data-linked-clause="support"'));assert.equal(rows[0].id,'support');for(const label of ['Regulatory instrument','The complete regulatory document','Document version (edition)','Clause reference in the document','Main clause','Supporting clause'])assert(html.includes(label));assert(!html.includes('Document / edition / clause'));assert(!html.includes('<table'));
});
test('separate instrument and clause actions retain each citation’s own exact edition and destination',()=>{
 const r=citation('support',{link_type:'SUPPORTING',instrument:{id:'other-instrument',title:'Other rule'},edition:{id:'older-edition',version_number:'2.1'},clause:{id:'other-clause',heading:'Record retention',source_clause_reference:'8.2'}}),html=renderLinkedRegulatoryClauses([citation(),r]);assert(html.includes('href="#repository/other-instrument?version=older-edition"'));assert(html.includes('href="#clauses?instrument=other-instrument&amp;edition=older-edition&amp;clause=other-clause"'));assert(html.includes('View instrument: Other rule · edition 2.1'));assert(html.includes('View clause: 8.2 · Record retention · edition 2.1'));assert(html.includes('href="#repository/instrument-a?version=edition-a"'));
});
test('restricted citations never disclose instrument/clause details or provide navigation links',()=>{
 const html=renderLinkedRegulatoryClauses([citation('secret',{restricted:true,instrument:{title:'Hidden instrument'},clause:{heading:'Hidden clause',clause_text:'Hidden wording'}})]);assert(html.includes('Restricted access'));assert(html.includes('Main clause'));assert(!html.includes('Hidden'));assert(!html.includes('View instrument'));assert(!html.includes('View clause'));assert(!html.includes('href='));
});
test('published clause references and internal reference IDs are never conflated',()=>{
 const r=citation();r.clause.source_clause_reference=null;const html=renderLinkedRegulatoryClauses([r]);assert(html.includes('<dt>Clause reference in the document</dt><dd>Not recorded</dd>'));assert(html.includes('<dt>Internal clause reference</dt><dd>RULE-A-C003</dd>'));assert(html.includes('<summary>Reference IDs</summary>'));assert(!/<details[^>]*obligation-source-references[^>]*open/.test(html));
});
test('regulatory wording, bank interpretation and titles remain distinct escaped source data',()=>{
 const r=citation();r.instrument.title='<script>instrument</script>';r.clause.clause_text='Original <tag>\nSecond line';r.clause.internal_interpretation='Bank <meaning>';const html=renderLinkedRegulatoryClauses([r]);assert(html.includes('&lt;script&gt;instrument&lt;/script&gt;'));assert(html.includes('Original &lt;tag&gt;\nSecond line'));assert(html.includes('Bank &lt;meaning&gt;'));assert(!html.includes('<script>'));assert(html.includes('Original clause wording'));assert(html.includes('Bank’s interpretation'));
});
test('empty and missing source text have explicit placeholders without inventing source content',()=>{
 const empty=renderLinkedRegulatoryClauses([]);assert(empty.includes('No regulatory clauses linked.'));assert(!empty.includes('View clause'));const r=citation();r.clause={id:'clause-a'};const html=renderLinkedRegulatoryClauses([r]);assert(html.includes('Heading not recorded'));assert(html.includes('Original wording not recorded.'));assert(html.includes('Bank interpretation not recorded.'));
});
test('clause cards keep independent shared pagination and context-specific accessible navigation names',()=>{
 const html=renderLinkedRegulatoryClauses([citation()]);assert(html.includes('data-page-key="obligation-citations"'));assert(html.includes('data-page-label="linked clauses"'));assert(html.includes('aria-label="View clause: 14.1 · Document verification requirements · edition 1.0"'));assert(html.includes('class="btn small obligation-source-link"'));
});
