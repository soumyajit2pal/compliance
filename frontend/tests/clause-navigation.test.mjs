import test from 'node:test';
import assert from 'node:assert/strict';
import {clauseWorkspacePath,instrumentWorkspacePath} from '../core/source-navigation.ts';

test('clause links select the exact clause with All defaults',()=>{
 const query=new URLSearchParams(clauseWorkspacePath('child-5.1.1').split('?')[1]);
 assert.equal(query.get('clause'),'child-5.1.1');
 assert.equal(query.get('instrument'),'all');assert.equal(query.get('edition'),'all');
});
test('source links preserve exact instrument/edition and avoid mutating context',()=>{
 const context=new URLSearchParams({instrument:'instrument-a',edition:'edition-two',view:'register',version:'old',q:'5 & 6'});
 const query=new URLSearchParams(clauseWorkspacePath('clause & 3',context).split('?')[1]);
 assert.equal(query.get('clause'),'clause & 3');assert.equal(query.get('instrument'),'instrument-a');
 assert.equal(query.get('edition'),'edition-two');assert.equal(query.get('q'),'5 & 6');
 assert(!query.has('view'));assert(!query.has('version'));assert.equal(context.get('view'),'register');
});
test('instrument links retain the imported Draft edition and requested tab',()=>{
 const path=instrumentWorkspacePath('instrument-a','draft-two',new URLSearchParams({tab:'clauses'}));
 assert.equal(path.split('?')[0],'repository/instrument-a');
 const query=new URLSearchParams(path.split('?')[1]);
 assert.equal(query.get('version'),'draft-two');assert.equal(query.get('tab'),'clauses');
 assert.equal(instrumentWorkspacePath('legacy-instrument'),'repository/legacy-instrument');
});
