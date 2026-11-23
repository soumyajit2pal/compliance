import test from 'node:test';
import assert from 'node:assert/strict';
import {table} from '../ui/widgets.ts';

test('responsive records expose every header label and one copy of each cell', () => {
  const html=table(['Record','State',''],[['Unique requirement','Approved','Open record']],{pageKey:'example'});
  assert(html.includes('record-table'));
  assert(html.includes('role="table"'));
  assert(html.includes('scope="col" role="columnheader">Record'));
  assert(html.includes('role="cell" data-label="Record">Unique requirement'));
  assert(html.includes('data-label="Actions">Open record'));
  assert.equal(html.split('Unique requirement').length-1,1);
});

test('card field labels escape header text and empty results keep a single spanning cell', () => {
  const html=table(['A "quoted" <label>'],[['Value']]);
  assert(html.includes('data-label="A &quot;quoted&quot; &lt;label&gt;"'));
  const empty=table(['Record','State'],[]);
  assert(empty.includes('data-empty-row'));
  assert(empty.includes('colspan="2"'));
  assert(!empty.includes('data-label='));
});

test('wide matrices and complete hierarchies retain the scrollable native table', () => {
  for(const html of [
    table(Array.from({length:8},(_,i)=>'Column '+i),[Array(8).fill('Value')]),
    table(['Parent','Child'],[['Bank','Department']],{cardLayout:false}),
  ]){
    assert(!html.includes('record-table'));
    assert(!html.includes('data-label='));
    assert(html.includes('scope="col"'));
  }
});
