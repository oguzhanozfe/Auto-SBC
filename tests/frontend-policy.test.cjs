const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../frontend/policy.js');
const player = (id, extra = {}) => ({ id, definitionId: id + 1000, assetId: id + 2000, name: `Player ${id}`, rating: 80,
  isUntradeable: true, isSpecial: false, isLoan: false, possiblePositions: [14], ...extra });
const request = (players, formation = [14,14]) => ({ clubPlayers: players, sbcData: { formation, brickIndices: [] } });
test('duplicate status never bypasses hard locks, loans or rating limits', () => {
  const policy = P.normalizePolicy({ lockedItemIds: ['1'] });
  assert.match(P.blockedReason(player(1, {isDuplicate:true,isStorage:true}), policy), /Locked/);
  assert.match(P.blockedReason(player(2, {isDuplicate:true,isLoan:true}), policy), /Loan/);
  assert.match(P.blockedReason(player(2, {isDuplicate:true,rating:99}), policy), /rating/);
});
test('Paletools explicit and rule locks are parsed from public storage formats', () => {
  const settings = Buffer.from(JSON.stringify({sbc:{lockPlayers:{lockByTeamIds:[18],lockByRarityIds:[3]}}})).toString('base64');
  const locks = P.parsePaletools([['paletools:2026:account:lockedItems','[1001,"1002u"]'],['paletools:settings',settings]], text => Buffer.from(text,'base64').toString());
  assert.match(P.blockedReason(player(1), P.normalizePolicy(), locks), /Paletools/);
  assert.match(P.blockedReason(player(2, {isEvolution:true}), P.normalizePolicy({protectEvolutions:false}), locks), /Paletools/);
  assert.match(P.blockedReason(player(3, {teamId:18}), P.normalizePolicy(), locks), /Paletools/);
  assert.equal(P.blockedReason(player(4, {teamId:19}), P.normalizePolicy(), locks), null);
});
test('corrupt Paletools locks report a blocking warning', () => {
  assert.equal(P.parsePaletools([['paletools:2026:a:lockedItems','broken']]).warnings.length,1);
});
test('loan, concept, evo, special, storage and tradeability filters apply', () => {
  const policy = P.normalizePolicy({allowTradeable:false,onlyStorage:true});
  for (const extra of [{isLoan:true},{concept:true},{isEvolution:true},{isSpecial:true},{isUntradeable:false},{isStorage:false}]) {
    assert.ok(P.blockedReason(player(1, {isStorage:true,...extra}),policy));
  }
});
test('invalid numeric settings fail early and defaults preserve market weights', () => {
  assert.equal(P.normalizePolicy().weights.untradeable,.7);
  assert.throws(() => P.normalizePolicy({maxRating:100}), /rating/);
  assert.throws(() => P.normalizePolicy({weights:{concept:NaN}}), /weight/);
});
test('success assigns exact server positions and rejects unknown, duplicate and locked cards', () => {
  const players = [player(1),player(2)], input = request(players), policy = P.normalizePolicy();
  const good = {status_code:4,solution:[{id:2,squadPosition:1},{id:1,squadPosition:0}]};
  assert.deepEqual(P.validateSolution(good,input,policy).map(row=>row.id),[1,2]);
  assert.throws(()=>P.validateSolution({...good,solution:[{id:1,squadPosition:0},{id:1,squadPosition:1}]},input,policy),/repeats/);
  assert.throws(()=>P.validateSolution({...good,solution:[{id:3,squadPosition:0},{id:2,squadPosition:1}]},input,policy),/Unknown/);
  assert.throws(()=>P.validateSolution(good,input,P.normalizePolicy({lockedItemIds:[1]})),/Locked/);
});
test('brick slots and incomplete/duplicate placements are rejected', () => {
  const input = request([player(1),player(2)],[14,-1,14]); input.sbcData.brickIndices=[1];
  assert.throws(()=>P.validateSolution({status_code:4,solution:[{id:1,squadPosition:1},{id:2,squadPosition:2}]},input,P.normalizePolicy()),/position/);
  assert.throws(()=>P.validateSolution({status_code:4,solution:[{id:1,squadPosition:0}]},input,P.normalizePolicy()),/required/);
});
test('legacy JSON results map constrained positions first', () => {
  const input=request([player(1),player(2)],[14,25]);
  const rows=P.validateSolution({status_code:2,results:JSON.stringify([{id:1,Is_Pos:0,possiblePositions:0},{id:2,Is_Pos:1,possiblePositions:14}])},input,P.normalizePolicy());
  assert.deepEqual(rows.map(row=>row.id),[2,1]);
});
test('same athlete and omitted required inventory item are rejected', () => {
  const input=request([player(1),player(2,{assetId:2001})]);
  const response={status_code:4,solution:[{id:1,squadPosition:0},{id:2,squadPosition:1}]};
  assert.throws(()=>P.validateSolution(response,input,P.normalizePolicy()),/athlete/);
  assert.throws(()=>P.validateSolution(response,request([player(1),player(2)]),P.normalizePolicy({requiredItemIds:[3]})),/Required/);
});
test('backend errors and malformed solutions are actionable', () => {
  assert.equal(P.errorMessage({detail:[{msg:'Missing rating'}]},422),'Missing rating');
  assert.throws(()=>P.validateSolution({status_code:3,status:'Infeasible'},request([]),P.normalizePolicy()),/Infeasible/);
  assert.throws(()=>P.validateSolution({status_code:4,results:'bad JSON'},request([]),P.normalizePolicy()),/malformed/);
});
test('response market costs are checked against player and squad budgets', () => {
  const input=request([player(1),player(2)]), response={status_code:4,solution:[{id:1,squadPosition:0,marketPrice:1200},{id:2,squadPosition:1,marketPrice:500}]};
  assert.throws(()=>P.validateSolution(response,input,P.normalizePolicy({maxPlayerPrice:1000})),/player price/);
  assert.throws(()=>P.validateSolution(response,input,P.normalizePolicy({maxTotalPrice:1500})),/squad budget/);
  assert.equal(P.validateSolution(response,input,P.normalizePolicy({maxTotalPrice:1700})).length,2);
});
