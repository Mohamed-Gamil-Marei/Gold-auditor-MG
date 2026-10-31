import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBucketText,
  classifySourceBucket,
  isScrapOrOldGoldPurchase,
  computeSheetRowSeq,
  formatSourceRef,
  verifyLedgerSheetSideConsistency,
  extractRowPiecesFromRedMarks,
  computeDayCloseReconciliation,
} from '../src/utils/sourceBuckets';
import { checkLedgerSourcesAndDayClose } from '../src/utils/checks/checkLedgerSourcesAndDayClose';
import { AuditSettings, DayInfo, Operation } from '../src/types';

const baseSettings: AuditSettings = {
  sensitivityPreset: 'medium',
  priceDiffMediumPct: 1.5,
  priceDiffHighPct: 3.0,
  allowedPriceRange: {
    sellMinBelowDaily: 0,
    sellMaxMakingCharge: 400,
    buyMaxDiscount: 300,
  },
  robustZThreshold: 3.5,
  maxReasonableWeightG: 500,
  goldBalanceToleranceG: 0.25,
  cashDiscrepancyThreshold: 200,
  workerAdvanceMediumPct: 50,
  workerAdvanceHighPct: 100,
  expenseSpikeMultiplier: 3,
  personOverdueMediumDays: 30,
  personOverdueHighDays: 90,
  goldDormantDays: 30,
  excludeFridays: true,
  dateFormatOrder: 'DMY',
  shortSpaceWeightMode: 'decimal',
  fixedRules: {
    enabled: false,
    sellBelowDailyByAmount: 30,
    buyAboveDailyByAmount: 50,
  },
  exceptions: {
    items: [],
    personIds: [],
    dates: [],
  },
  enableAiSummaryButton: false,
  shopName: '',
  auditorName: '',
  purchasesSafeBalanceImpact: 'deduct_end_of_day',
  autoAddScrapPurchasesToOldGoldInflow: true,
  includeStandaloneKasrForOldGold: false,
  goldAvailabilityRuleMode: 'with_opening',
};

test('H-C: Two-block sheet seq ordering and Arabic SourceRef formatting', () => {
  // Block 1 (Right) lines 1..25 -> seq 1..25; Block 2 (Left) lines 1..25 -> seq 26..50
  assert.equal(computeSheetRowSeq(1, 1).seq, 1);
  assert.equal(computeSheetRowSeq(1, 14).seq, 14);
  assert.equal(computeSheetRowSeq(2, 1).seq, 26);
  assert.equal(computeSheetRowSeq(2, 5).seq, 30);

  const refRight = formatSourceRef(
    {
      pageIndex: 2,
      sheetSide: 'sell',
      sheetIndexInDay: 2,
      blockIndex: 1,
      lineInBlock: 14,
    },
    'sell'
  );
  assert.ok(refRight.includes('مبيعات'));
  assert.ok(refRight.includes('ورقة 2'));
  assert.ok(refRight.includes('يمين'));
  assert.ok(refRight.includes('سطر 14'));

  const refLeft = formatSourceRef(
    {
      pageIndex: 1,
      sheetSide: 'buy',
      sheetIndexInDay: 1,
      blockIndex: 2,
      lineInBlock: 5,
    },
    'buy'
  );
  assert.ok(refLeft.includes('مشتريات'));
  assert.ok(refLeft.includes('يسار'));
  assert.ok(refLeft.includes('سطر 5'));
});

test('H-A: Sheet side consistency verification (Right = sell, Left = buy)', () => {
  const okSell = verifyLedgerSheetSideConsistency({
    positionSide: 'sell',
    printedHeaderSide: 'sell',
    hasBalanceColumnOrRow: true,
  });
  assert.equal(okSell.consistent, true);

  const mismatchHeader = verifyLedgerSheetSideConsistency({
    positionSide: 'sell',
    printedHeaderSide: 'buy',
    hasBalanceColumnOrRow: false,
  });
  assert.equal(mismatchHeader.consistent, false);
  assert.ok(mismatchHeader.warningMessage?.includes('جهة الورقة غير متسقة'));

  const mismatchBalanceCol = verifyLedgerSheetSideConsistency({
    positionSide: 'buy',
    printedHeaderSide: 'buy',
    hasBalanceColumnOrRow: true,
  });
  assert.equal(mismatchBalanceCol.consistent, false);
});

test('H5 (البديل): Red circled integer = piece count (pieces), never weight or review flag', () => {
  const p1 = extractRowPiecesFromRedMarks(3, undefined);
  assert.equal(p1, 3);

  const p2 = extractRowPiecesFromRedMarks(null, [
    { type: 'circle', text: '٤' },
  ]);
  assert.equal(p2, 4);
});

test('H7 & H-B: Arabic normalization, 1-char typo tolerance, and priority resolution', () => {
  assert.equal(normalizeBucketText('مِنَ القَدِيمِ — كِيس'), 'من القديم كيس');

  // Default when no source keyword -> rayon (isGuessed: false)
  const rDefault = classifySourceBucket('غويشة سادة عيار 21', baseSettings);
  assert.equal(rDefault.bucket, 'rayon');
  assert.equal(rDefault.isGuessed, false);

  // Bag keywords ("كيس", "علبة", "من العلبة")
  const rBag = classifySourceBucket('خاتم من العلبة', baseSettings);
  assert.equal(rBag.bucket, 'bag');
  assert.equal(rBag.isGuessed, true);

  // Old gold keywords ("قديم", "من الكسر")
  const rOld = classifySourceBucket('سلسلة من القديم', baseSettings);
  assert.equal(rOld.bucket, 'old_gold');
  assert.equal(rOld.isGuessed, true);

  // Multi-source conflict: old_gold + bag -> priority old_gold + multiSourceWarning = true
  const rConflict = classifySourceBucket('غويشة قديم من الكيس', baseSettings);
  assert.equal(rConflict.bucket, 'old_gold');
  assert.equal(rConflict.multiSourceWarning, true);

  // Scrap purchase auto-detection (H-B.4)
  assert.equal(isScrapOrOldGoldPurchase('شراء كسر عيار 21'), true);
  assert.equal(isScrapOrOldGoldPurchase('شراء غويشة جديدة'), false);
});

test('H9 & H10: Day Close reconciliation, safe 3-way compare, bucket reconciliation, and running gold negative row detection', () => {
  const date = '2026-04-15';
  const ops: Operation[] = [
    {
      id: 'buy-1',
      date,
      kind: 'buy',
      karat: 21,
      weightG: 10,
      total: 35000,
      item: 'شراء كسر قديم',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      createdAt: 1,
      updatedAt: 1,
      sourcePageRef: {
        pageIndex: 1,
        sheetSide: 'buy',
        sheetIndexInDay: 1,
        blockIndex: 1,
        lineInBlock: 1,
        seq: 1,
      },
    },
    {
      id: 'sell-1',
      date,
      kind: 'sell',
      karat: 21,
      weightG: 8,
      total: 30000,
      item: 'خاتم ودبلة',
      pieces: 2,
      sourceBucket: 'rayon',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      createdAt: 2,
      updatedAt: 2,
      sourcePageRef: {
        pageIndex: 1,
        sheetSide: 'sell',
        sheetIndexInDay: 1,
        blockIndex: 1,
        lineInBlock: 1,
        seq: 1,
      },
    },
    {
      id: 'sell-2',
      date,
      kind: 'sell',
      karat: 21,
      weightG: 15,
      total: 55000,
      item: 'غوايش من القديم',
      pieces: 3,
      sourceBucket: 'old_gold',
      payment: 'cash',
      reviewedFlag: false,
      note: '',
      createdAt: 3,
      updatedAt: 3,
      sourcePageRef: {
        pageIndex: 1,
        sheetSide: 'sell',
        sheetIndexInDay: 1,
        blockIndex: 2,
        lineInBlock: 4,
        seq: 29,
      },
    },
  ];

  const daysMap: Record<string, DayInfo> = {
    [date]: {
      date,
      locked: false,
      goldPricePerGram: 3600,
      openingCash: 100000,
      actualCash: 150000,
      bookOpeningCash: 100000,
      bookClosingCash: 150000,
      openingBalanceG: 10, // Total available = 10 opening + 10 buy = 20g, while total sold = 23g -> deficit 3g!
      bucketReconciliation: {
        rayon: {
          beforeG: 10,
          manualInflowG: 0,
          actualG: 2,
          piecesBefore: 5,
          piecesInflow: 0,
          piecesActual: 3,
        },
        old_gold: {
          beforeG: 0,
          manualInflowG: 0,
          actualG: 0,
        },
      },
    },
  };

  const summary = computeDayCloseReconciliation({
    date,
    operations: ops,
    daysMap,
    settings: baseSettings,
  });

  // Net cash: sell 85,000 - buy 35,000 = +50,000
  assert.equal(summary.sellCashAmount, 85000);
  assert.equal(summary.buyCashAmount, 35000);
  assert.equal(summary.netCashFlow, 50000);
  assert.equal(summary.expectedAppSafeCash, 150000);

  // Net weight: sell 23g - buy 10g = +13g ("باع أكتر من اشترى بـ 13 جرام")
  assert.equal(summary.netWeightDiffG, 13);
  assert.ok(summary.netWeightDirectionText.includes('باع أكتر من اشترى'));

  // "الذهب لا ينفع يُباع أكثر من المتاح": old_gold had 10g auto-inflow from scrap buy, sold 15g -> exceeded!
  assert.equal(summary.exceededTotalAvailable, true);
  assert.ok(summary.exceededBuckets.includes('old_gold'));
  assert.ok(summary.firstNegativeRow);
  assert.equal(summary.firstNegativeRow?.op.id, 'sell-2');
  assert.ok(summary.firstNegativeRow?.sourceRefText.includes('يسار سطر 4'));

  // Audit check generation (H5.2, H7.4, H9.3, H10.4)
  const findings = checkLedgerSourcesAndDayClose(ops, daysMap, baseSettings);
  assert.ok(findings.some((f) => f.id.includes('exceeds-available')));
});
