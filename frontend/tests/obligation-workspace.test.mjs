import test from 'node:test';
import assert from 'node:assert/strict';
import {obligationView,workspacePath,workspaceTabPath,workspaceAlias,obligationBackLabel} from '../core/obligation-workspace.ts';
import {obligationReturnPath} from '../core/obligation-detail.ts';

test('workspace views do not collide with obligation detail tabs or register Exceptions',()=>{
  assert.equal(obligationView(new URLSearchParams('tab=applicability')),'register');
  assert.equal(obligationView(new URLSearchParams('tab=reports')),'register');
  assert.equal(obligationView(new URLSearchParams('view=accountability')),'accountability');
  assert.equal(obligationView(new URLSearchParams('view=unknown')),'register');
});
test('retained navigation maps to a focused view and preserves exact filters and paging',()=>{
  const query=new URLSearchParams('department=retail&approval=REVIEWED&page.applicability=2&size.applicability=10');
  const alias=workspaceAlias('applicability',query);
  assert.equal(alias,'obligations?'+query+'&view=applicability');
  assert.equal(workspaceAlias('accountability',new URLSearchParams()),'obligations?view=accountability');
  assert.equal(workspaceAlias('repository',query),'');
  assert.equal(query.has('view'),false);
});
test('register links keep their own filters and focused return paths remain validated',()=>{
  assert.equal(workspacePath('register',new URLSearchParams('view=accountability&tab=reports')),'obligations?tab=reports');
  const path=workspacePath('accountability',new URLSearchParams('role=BUSINESS&page.accountability=3'));
  assert.equal(obligationReturnPath(path),path);
  assert.equal(obligationReturnPath('obligations/person?view=applicability'),'');
  assert.equal(obligationReturnPath('https://outside.example/obligations'),'');
});
test('detail Back labels identify the originating workspace view, including legacy links',()=>{
  assert.equal(obligationBackLabel('obligations?view=applicability&q=test'),'← Applicability');
  assert.equal(obligationBackLabel('obligations?view=accountability'),'← Accountability');
  assert.equal(obligationBackLabel('accountability?page.accountability=2'),'← Accountability');
  assert.equal(obligationBackLabel('obligations?tab=reports'),'← Obligation register');
});

test('Register tab leaves exception-report mode while preserving direct report return links',()=>{
 const query=new URLSearchParams('view=applicability&tab=reports&department=retail');
 assert.equal(workspaceTabPath('register',query),'obligations?department=retail');
 assert.equal(workspacePath('register',query),'obligations?tab=reports&department=retail');
 assert.equal(query.get('tab'),'reports');
 assert.equal(workspaceTabPath('accountability',new URLSearchParams('role=BUSINESS')),'obligations?role=BUSINESS&view=accountability');
});
