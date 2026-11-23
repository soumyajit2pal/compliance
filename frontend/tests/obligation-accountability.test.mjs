import test from 'node:test';
import assert from 'node:assert/strict';
import {splitBusinessAccountability,primaryBusinessOwnerError} from '../core/obligation-accountability.ts';

test('one primary Business assignment is separate from regulatory primaries and other departments',()=>{
 const primary={owner_role:'BUSINESS',primary_owner_flag:true,org_unit_id:'retail',user_id:'retail-owner'};
 const additional=[{owner_role:'REGULATORY',primary_owner_flag:true},{owner_role:'BUSINESS',primary_owner_flag:false,org_unit_id:'operations'},{owner_role:'CONTROL',primary_owner_flag:false}];
 const reviewer={owner_role:'COMPLIANCE_REVIEWER'};
 const source=[additional[0],primary,additional[1],reviewer,additional[2]];
 assert.deepEqual(splitBusinessAccountability(source),{primary,additional});assert.equal(source.length,5);
});
test('an ordinary Business assignment is never silently promoted to primary',()=>{
 const business={owner_role:'BUSINESS',primary_owner_flag:false,user_id:'u'};
 assert.deepEqual(splitBusinessAccountability([business]),{primary:null,additional:[business]});
});
test('drafts can leave the primary person empty; selected people need the exact assignment department and eligibility',()=>{
 assert.equal(primaryBusinessOwnerError('retail','retail','',[]),'');
 assert.equal(primaryBusinessOwnerError('retail','retail','owner',['owner']),'');
 assert.match(primaryBusinessOwnerError('retail','operations','owner',['owner']),/accountable business department/);
 assert.match(primaryBusinessOwnerError('retail','retail','old-owner',['new-owner']),/no longer an eligible Business owner/);
});
test('unexpected duplicate primary rows are retained for validation rather than discarded',()=>{
 const first={owner_role:'BUSINESS',primary_owner_flag:true,user_id:'first'},second={owner_role:'BUSINESS',primary_owner_flag:true,user_id:'second'};
 const result=splitBusinessAccountability([first,second]);assert.equal(result.primary,first);assert.deepEqual(result.additional,[second]);
});
