import assert from 'node:assert/strict';
import test from 'node:test';
import { Operation } from '../src/types';
import { checkSellBelowBuyCost } from '../src/utils/checks/checkSellBelowBuyCost';
import { addDaysLocalIso, toLocalIso } from '../src/utils/numerals';

const makeOp = (partial: Partial<Operation>): Operation => ({
  id: partial.id || 'op-1',
  date: partial.date || '2026-04-01',
  kind: partial.kind || 'sell',
  karat: partial.karat ?? 21,
  weightG: partial.weightG ?? 10,
  total: partial.total ?? 38000,
  payment: partial.payment || 'cash',
  reviewedFlag: false,
  note: partial.note ?? '',
  createdAt: 1,
  updatedAt: 1,
});

test('checkSellBelowBuyCost does not mix different karats (24K buy vs 18K sell)', () => {
  const ops: Operation[] = [
    makeOp({ id: 'b24', date: '2026-04-01', kind: 'buy', karat: 24, weightG: 10, total: 43000 }), // 4300/g
    makeOp({ id: 's18', date: '2026-04-01', kind: 'sell', karat: 18, weightG: 10, total: 33500 }), // 3350/g
  ];
  const issues = checkSellBelowBuyCost(ops);
  assert.equal(issues.length, 0);
});

test('checkSellBelowBuyCost flags sell below buy for the same karat (21K)', () => {
  const ops: Operation[] = [
    makeOp({ id: 'b21', date: '2026-04-01', kind: 'buy', karat: 21, weightG: 10, total: 38000 }), // 3800/g
    makeOp({ id: 's21', date: '2026-04-01', kind: 'sell', karat: 21, weightG: 10, total: 37000 }), // 3700/g
  ];
  const issues = checkSellBelowBuyCost(ops);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].checkType, 'sell_below_buy');
  assert.equal(issues[0].id, 'sell-below-buy-2026-04-01-k21');
});

test('checkSellBelowBuyCost ignores karat="other"', () => {
  const ops: Operation[] = [
    makeOp({ id: 'bo', date: '2026-04-01', kind: 'buy', karat: 'other', weightG: 8, total: 40000 }),
    makeOp({ id: 'so', date: '2026-04-01', kind: 'sell', karat: 'other', weightG: 8, total: 30000 }),
  ];
  assert.equal(checkSellBelowBuyCost(ops).length, 0);
});

test('addDaysLocalIso and toLocalIso preserve local calendar dates without UTC drift', () => {
  assert.equal(addDaysLocalIso('2026-04-10', -7), '2026-04-03');
  assert.equal(addDaysLocalIso('2026-04-01', -1), '2026-03-31');
  const localMidnight = new Date(2026, 3, 5, 0, 30, 0); // 2026-04-05 00:30 local
  assert.equal(toLocalIso(localMidnight), '2026-04-05');
});
