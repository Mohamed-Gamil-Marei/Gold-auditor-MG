import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLedgerArithmetic } from '../src/utils/checks/checkLedgerArithmetic';
import { DEFAULT_SETTINGS } from '../src/store/useAuditStore';
import { DayInfo, Operation } from '../src/types';

test('H4.7 (1): detects a small 10 EGP within-row math error (runningBalanceBefore + total !== runningBalanceAfter)', () => {
  const ops: Operation[] = [
    {
      id: 'op-1',
      date: '2026-04-11',
      kind: 'sell',
      weightG: 5,
      total: 19000,
      category: '',
      item: 'غويشة',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
      runningBalanceBefore: 10000,
      // Expected after = 10000 + 19000 = 29000, actual = 29010 (10 EGP error)
      runningBalanceAfter: 29010,
    },
  ];
  const daysMap: Record<string, DayInfo> = {
    '2026-04-11': {
      date: '2026-04-11',
      goldPricePerGram: 3800,
      locked: false,
    },
  };

  const issues = checkLedgerArithmetic(ops, daysMap, DEFAULT_SETTINGS);
  assert.ok(issues.some((i) => i.id.includes('ledger-row-math-op-1')));
  assert.equal(issues[0].checkType, 'ledger_arithmetic');
});

test('H4.7 (2): detects continuation page starting from wrong balance', () => {
  const ops: Operation[] = [
    {
      id: 'op-p1',
      date: '2026-04-11',
      kind: 'sell',
      weightG: 5,
      total: 19000,
      item: 'خاتم',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      pageNumberHint: 1,
      rowOrderInPage: 1,
      runningBalanceBefore: 26000,
      runningBalanceAfter: 45000,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'op-p2',
      date: '2026-04-11',
      kind: 'sell',
      weightG: 5,
      total: 15500,
      item: 'دبلة',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      pageNumberHint: 2,
      rowOrderInPage: 1,
      runningBalanceBefore: 44500, // 500 EGP carryover error from page 1!
      runningBalanceAfter: 60000,
      createdAt: 2000,
      updatedAt: 2000,
    },
  ];
  const daysMap: Record<string, DayInfo> = {
    '2026-04-11': {
      date: '2026-04-11',
      goldPricePerGram: 3800,
      locked: false,
    },
  };

  const issues = checkLedgerArithmetic(ops, daysMap, DEFAULT_SETTINGS);
  assert.ok(issues.some((i) => i.id.includes('ledger-continuity-op-p1-op-p2')));
});

test('H4.7 (3): detects day-to-day carryover error between consecutive days', () => {
  const daysMap: Record<string, DayInfo> = {
    '2026-04-11': {
      date: '2026-04-11',
      goldPricePerGram: 3800,
      locked: false,
      openingLedgerBalance: 10000,
      closingLedgerBalance: 50000,
    },
    '2026-04-12': {
      date: '2026-04-12',
      goldPricePerGram: 3800,
      locked: false,
      openingLedgerBalance: 49000, // 1000 EGP carryover discrepancy!
      closingLedgerBalance: 70000,
    },
  };

  const issues = checkLedgerArithmetic([], daysMap, DEFAULT_SETTINGS);
  assert.ok(issues.some((i) => i.id.includes('ledger-day-carryover-2026-04-12')));
});

test('H3.6: raises high-severity issue when day has unapproved large diff with handwritten total', () => {
  const daysMap: Record<string, DayInfo> = {
    '2026-04-15': {
      date: '2026-04-15',
      goldPricePerGram: 3800,
      locked: false,
      ledgerTotalsComparison: {
        sell: {
          readSumAmount: 100000,
          readSumWeightG: 25,
          handwrittenAmount: 95000,
          handwrittenWeightG: 25,
          diffAmount: 5000,
          diffWeightG: 0,
          status: 'large_diff',
          approvedByAuditor: false,
        },
      },
    },
  };

  const issues = checkLedgerArithmetic([], daysMap, DEFAULT_SETTINGS);
  assert.ok(issues.some((i) => i.checkType === 'ledger_totals_mismatch'));
});
