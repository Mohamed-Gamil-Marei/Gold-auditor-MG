import {
  AuditSettings,
  DayInfo,
  Issue,
  Operation,
  SalesSourceBucket,
} from '../../types';
import { formatNumber, formatWeight, normalizeArabicName } from '../numerals';
import {
  computeDayCloseReconciliation,
  DEFAULT_ITEMS_EXPECTING_PIECES,
  DEFAULT_SOURCE_BUCKETS_CONFIG,
  formatSourceRef,
  matchesBucketKeyword,
  normalizeBucketText,
  sortOperationsByLedgerOrder,
} from '../sourceBuckets';

/**
 * Implements all audit checks for:
 * - H5 (البديل): Piece count (`pieces`) average weight outliers & missing piece counts
 * - H7 & H-B: Sales source buckets (Rayon / Bag / Old Gold) reconciliation, carryover, and negative balance
 * - H9: Sales sheet safe balance (`bookOpeningCash`, `bookRunningCash`, `bookClosingCash`) vs App safe & Actual cash
 * - H10: "الذهب ما ينفعش يتباع أكتر من المتاح" — pinpointing the first row (`SourceRef`) where inventory drops below zero
 */
export function checkLedgerSourcesAndDayClose(
  operations: Operation[],
  daysMap: Record<string, DayInfo>,
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const linesPerBlock = settings.ledgerLinesPerBlock || 25;
  const bucketsConfig = settings.sourceBucketsConfig || DEFAULT_SOURCE_BUCKETS_CONFIG;

  // ---------------------------------------------------------------------------
  // 1. H5.2: Average piece weight (`weightG / pieces`) outlier by robust Z-score
  // ---------------------------------------------------------------------------
  const pieceGroups = new Map<
    string,
    Array<{ op: Operation; avgPieceWeight: number }>
  >();

  const expectPiecesKeywords =
    settings.itemsExpectingPieces && settings.itemsExpectingPieces.length > 0
      ? settings.itemsExpectingPieces
      : DEFAULT_ITEMS_EXPECTING_PIECES;

  for (const op of operations) {
    if (op.kind !== 'sell' && op.kind !== 'buy') continue;
    const refLabel = op.sourcePageRef
      ? ` (${formatSourceRef(op.sourcePageRef, op.kind, op.date)})`
      : '';

    if (typeof op.pieces === 'number' && op.pieces > 0 && op.weightG > 0) {
      const normItem = normalizeArabicName(op.item || 'عام');
      if (normItem.length >= 2) {
        const key = `${normItem}__${op.karat || 21}`;
        const list = pieceGroups.get(key) || [];
        list.push({ op, avgPieceWeight: op.weightG / op.pieces });
        pieceGroups.set(key, list);
      }
    } else if (
      op.kind === 'sell' &&
      (op.sourceBucket || 'rayon') === 'rayon' &&
      (op.sourcePageRef || op.sourceType === 'ocr') &&
      (!op.pieces || op.pieces <= 0)
    ) {
      const normText = normalizeBucketText(op.item || '');
      const expectsPieces = expectPiecesKeywords.some((kw) =>
        matchesBucketKeyword(normText, kw)
      );
      if (expectsPieces) {
        issues.push({
          id: `missing-pieces-${op.id}`,
          severity: 'low',
          checkType: 'ledger_pieces_check',
          checkTitle: 'فحص عدد القطع (الأعداد الحمراء)',
          rowId: op.id,
          date: op.date,
          kind: op.kind,
          expected: '≥ 1 قطعة',
          actual: 'بلا عدد قطع',
          message: `بيع صنف من الريون (${op.item || 'بدون بيان'} — ${formatWeight(
            op.weightG
          )} ج)${refLabel} بدون عدد قطع مسجل (الرقم الأحمر داخل دائرة).`,
        });
      }
    }
  }

  const zThreshold = settings.robustZThreshold || 3.5;
  for (const [, entries] of pieceGroups.entries()) {
    if (entries.length < 4) continue;
    const weights = entries.map((e) => e.avgPieceWeight).sort((a, b) => a - b);
    const mid = Math.floor(weights.length / 2);
    const median =
      weights.length % 2 !== 0
        ? weights[mid]
        : (weights[mid - 1] + weights[mid]) / 2;
    if (median <= 0) continue;

    const absDevs = weights
      .map((w) => Math.abs(w - median))
      .sort((a, b) => a - b);
    const mad =
      absDevs.length % 2 !== 0
        ? absDevs[mid]
        : (absDevs[mid - 1] + absDevs[mid]) / 2;
    const effectiveScale = Math.max(mad * 1.4826, median * 0.15, 0.25);

    for (const { op, avgPieceWeight } of entries) {
      const robustZ = Math.abs(avgPieceWeight - median) / effectiveScale;
      if (robustZ >= zThreshold && Math.abs(avgPieceWeight - median) >= 1.0) {
        const refLabel = op.sourcePageRef
          ? ` (${formatSourceRef(op.sourcePageRef, op.kind, op.date)})`
          : '';
        issues.push({
          id: `piece-weight-outlier-${op.id}`,
          severity: robustZ >= zThreshold * 1.5 ? 'high' : 'medium',
          checkType: 'ledger_pieces_check',
          checkTitle: 'فحص عدد القطع (الأعداد الحمراء)',
          rowId: op.id,
          date: op.date,
          kind: op.kind,
          expected: `~${formatWeight(median)} ج/قطعة`,
          actual: `${formatWeight(avgPieceWeight)} ج/قطعة (${op.pieces} قطع)`,
          difference: `${formatWeight(Math.abs(avgPieceWeight - median))} ج/قطعة`,
          message: `شذوذ في متوسط وزن القطعة الواحدة للصنف "${
            op.item || 'عام'
          }"${refLabel}: الوزن (${formatWeight(op.weightG)} ج) ÷ العدد (${
            op.pieces
          }) = ${formatWeight(
            avgPieceWeight
          )} ج/قطعة، بينما المعتاد لنفس الصنف ~${formatWeight(
            median
          )} ج/قطعة — راجع الرقم الأحمر أو الوزن.`,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Per-Day Checks: H7, H-B, H9, H10
  // ---------------------------------------------------------------------------
  const allDates = Array.from(
    new Set([...Object.keys(daysMap), ...operations.map((o) => o.date)])
  )
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  let prevBookClosing: { date: string; cash: number } | null = null;
  const prevBucketActualG: Partial<
    Record<SalesSourceBucket, { date: string; actualG: number }>
  > = {};

  for (const date of allDates) {
    const dayInfo = daysMap[date];
    const dayOps = sortOperationsByLedgerOrder(
      operations.filter((o) => o.date === date),
      linesPerBlock
    );

    const summary = computeDayCloseReconciliation({
      date,
      operations,
      daysMap,
      settings,
    });

    // A) H7.4: Unconfirmed guessed source buckets (low)
    if (summary.unconfirmedSourceRowsCount > 0) {
      issues.push({
        id: `unconfirmed-source-buckets-${date}`,
        severity: 'low',
        checkType: 'source_bucket_reconciliation',
        checkTitle: 'مطابقة مصادر البيع (الريون / الكيس / القديم)',
        date,
        expected: 'تأكيد المصدر',
        actual: `${summary.unconfirmedSourceRowsCount} صف بتخمين تلقائي`,
        message: `يوجد ${summary.unconfirmedSourceRowsCount} صف في يوم ${date} تحدّد مصدر بيعه (كيس / قديم) بالتخمين التلقائي ولم يُؤكَّد يدوياً بعد.`,
      });
    }

    // B) H10.4: "الذهب ما ينفعش يتباع أكتر من المتاح" (Total day availability)
    if (summary.exceededTotalAvailable) {
      const availG = Number(
        (
          (settings.goldAvailabilityRuleMode === 'strict_daily'
            ? 0
            : summary.openingTotalGoldG) + summary.buyWeightG
        ).toFixed(3)
      );
      const excessG = Number((summary.sellWeightG - availG).toFixed(3));
      const firstRowInfo = summary.firstNegativeRow
        ? ` — أول صف نزل عنده المخزون تحت الصفر: (${summary.firstNegativeRow.sourceRefText})`
        : '';

      issues.push({
        id: `gold-exceeds-available-${date}`,
        severity: 'high',
        checkType: 'day_close_reconciliation',
        checkTitle: 'قفل اليوم ومطابقة النقدية والوزن',
        rowId: summary.firstNegativeRow?.op.id,
        date,
        kind: 'sell',
        expected: `≤ ${formatWeight(availG)} ج`,
        actual: `${formatWeight(summary.sellWeightG)} ج`,
        difference: `${formatWeight(excessG)} ج`,
        message: `مخالفة قاعدة "الذهب لا يُباع أكثر من المتاح" في يوم ${date}: إجمالي وزن المبيعات (${formatWeight(
          summary.sellWeightG
        )} ج) أكبر من المتاح (${formatWeight(availG)} ج) بفارق ${formatWeight(
          excessG
        )} ج${firstRowInfo}.`,
      });
    }

    // C) H7.4 & H-B.5: Per-bucket checks (negative balance, carryover, reconciliation diff)
    for (const bKey of ['rayon', 'bag', 'old_gold', 'other'] as SalesSourceBucket[]) {
      const b = summary.buckets[bKey];
      const bCfg = bucketsConfig[bKey] || DEFAULT_SOURCE_BUCKETS_CONFIG[bKey];
      const savedRec = dayInfo?.bucketReconciliation?.[bKey];

      // 1) Carryover check between consecutive days
      const prevRec = prevBucketActualG[bKey];
      if (
        prevRec &&
        savedRec?.beforeG !== undefined &&
        Math.abs(savedRec.beforeG - prevRec.actualG) > 0.01
      ) {
        const diffCarry = Number(
          Math.abs(savedRec.beforeG - prevRec.actualG).toFixed(3)
        );
        issues.push({
          id: `bucket-carryover-${date}-${bKey}`,
          severity: 'high',
          checkType: 'source_bucket_reconciliation',
          checkTitle: 'مطابقة مصادر البيع (الريون / الكيس / القديم)',
          date,
          expected: `${formatWeight(prevRec.actualG)} ج`,
          actual: `${formatWeight(savedRec.beforeG)} ج`,
          difference: `${formatWeight(diffCarry)} ج`,
          message: `انقطاع ترحيل مخزون (${bCfg.name}) في يوم ${date}: الوزن قبل (${formatWeight(
            savedRec.beforeG
          )} ج) لا يساوي الوزن الحالي لليوم السابق ${prevRec.date} (${formatWeight(
            prevRec.actualG
          )} ج) بفارق ${formatWeight(diffCarry)} ج.`,
        });
      }

      // 2) Selling more than available from Old Gold or Bag (H7.4 & H-B.5)
      if (
        (bKey === 'old_gold' || bKey === 'bag') &&
        b.soldG > b.beforeG + b.totalInflowG + 0.005
      ) {
        const availB = Number((b.beforeG + b.totalInflowG).toFixed(3));
        const deficitB = Number((b.soldG - availB).toFixed(3));
        const firstNegRef =
          summary.firstNegativeRow && summary.firstNegativeRow.bucket === bKey
            ? ` — أول صف تجاوز الرصيد: (${summary.firstNegativeRow.sourceRefText})`
            : '';
        issues.push({
          id: `bucket-negative-${date}-${bKey}`,
          severity: 'high',
          checkType: 'source_bucket_reconciliation',
          checkTitle: 'مطابقة مصادر البيع (الريون / الكيس / القديم)',
          rowId:
            summary.firstNegativeRow?.bucket === bKey
              ? summary.firstNegativeRow.op.id
              : undefined,
          date,
          kind: 'sell',
          expected: `≤ ${formatWeight(availB)} ج`,
          actual: `${formatWeight(b.soldG)} ج`,
          difference: `${formatWeight(deficitB)} ج`,
          message: `بيع من (${bCfg.name}) بوزن أكبر من رصيده المتاح في يوم ${date}: المباع (${formatWeight(
            b.soldG
          )} ج) بينما المتاح (قبل ${formatWeight(b.beforeG)} + وارد ${formatWeight(
            b.totalInflowG
          )} = ${formatWeight(availB)} ج) — رصيد سالب بمقدار ${formatWeight(
            deficitB
          )} ج${firstNegRef}.`,
        });
      }

      // 3) End-of-day reconciliation diff > tolerance (H7.4)
      if (b.status === 'large_diff' || b.status === 'small_diff') {
        issues.push({
          id: `bucket-diff-${date}-${bKey}`,
          severity: 'high',
          checkType: 'source_bucket_reconciliation',
          checkTitle: 'مطابقة مصادر البيع (الريون / الكيس / القديم)',
          date,
          expected: `${formatWeight(b.expectedG)} ج`,
          actual: `${formatWeight(b.actualG || 0)} ج`,
          difference: `${formatWeight(Math.abs(b.diffG))} ج (${formatNumber(
            b.diffValueEgp
          )} ج.م)`,
          message: `فرق مطابقة مخزون (${bCfg.name}) في نهاية يوم ${date}: المتوقع (${formatWeight(
            b.expectedG
          )} ج) مقابل الجرد الفعلي (${formatWeight(
            b.actualG || 0
          )} ج) — الفرق: ${formatWeight(b.diffG)} ج (قيمته التقديرية ~${formatNumber(
            b.diffValueEgp
          )} ج.م).`,
        });
      }

      if (typeof savedRec?.actualG === 'number') {
        prevBucketActualG[bKey] = { date, actualG: savedRec.actualG };
      }
    }

    // D) H9.3: Sales sheet safe balance (`bookOpeningCash`, `bookRunningCash`, `bookClosingCash`)
    const bookOpen = dayInfo?.bookOpeningCash;
    const bookClose = dayInfo?.bookClosingCash;

    // H9.3 (ج): Day-to-day carryover of book safe balance
    if (
      prevBookClosing &&
      typeof bookOpen === 'number' &&
      Math.abs(bookOpen - prevBookClosing.cash) >= 1
    ) {
      const diffBookCarry = Math.abs(bookOpen - prevBookClosing.cash);
      issues.push({
        id: `safe-book-carryover-${date}`,
        severity: 'high',
        checkType: 'safe_ledger_reconciliation',
        checkTitle: 'مطابقة رصيد الخزنة في الدفتر (H9)',
        date,
        expected: `${formatNumber(prevBookClosing.cash)} ج.م`,
        actual: `${formatNumber(bookOpen)} ج.م`,
        difference: `${formatNumber(diffBookCarry)} ج.م`,
        message: `خطأ ترحيل رصيد الخزنة في الدفتر ليوم ${date}: الرصيد السابق المكتوب أعلى ورقة المبيعات (${formatNumber(
          bookOpen
        )} ج.م) لا يساوي الرصيد الختامي لآخر يوم مسجل قبله ${
          prevBookClosing.date
        } (${formatNumber(prevBookClosing.cash)} ج.م) بفارق ${formatNumber(
          diffBookCarry
        )} ج.م.`,
      });
    }

    // H9.3 (أ & ب): Within-row and sheet-to-sheet `bookRunningCash` arithmetic
    const sellOpsWithBookRunning = dayOps.filter(
      (o) => o.kind === 'sell' && typeof o.bookRunningCash === 'number'
    );
    let prevRunningCash =
      typeof bookOpen === 'number' ? bookOpen : undefined;
    let prevRunningSheet: number | undefined;

    for (const op of sellOpsWithBookRunning) {
      const currRun = op.bookRunningCash!;
      const currSheet =
        op.sourcePageRef?.sheetIndexInDay ?? op.sourcePageRef?.pageIndex ?? 1;
      const refStr = formatSourceRef(op.sourcePageRef, op.kind, op.date, true);

      if (typeof prevRunningCash === 'number') {
        const expectedRun = Math.round(prevRunningCash + op.total);
        const diffRun = Math.abs(currRun - expectedRun);
        if (diffRun >= 1) {
          const conf = typeof op.ocrConfidence === 'number' ? op.ocrConfidence : 0.9;
          const isLowConf = conf < 0.72;
          const isSheetTransition =
            prevRunningSheet !== undefined && prevRunningSheet !== currSheet;
          issues.push({
            id: `safe-book-running-${op.id}`,
            severity: isLowConf ? 'low' : 'high',
            checkType: 'safe_ledger_reconciliation',
            checkTitle: 'مطابقة رصيد الخزنة في الدفتر (H9)',
            rowId: op.id,
            date: op.date,
            kind: 'sell',
            expected: `${formatNumber(expectedRun)} ج.م`,
            actual: `${formatNumber(currRun)} ج.م`,
            difference: `${formatNumber(diffRun)} ج.م`,
            message: isLowConf
              ? `تحذير قراءة غير مؤكدة لرصيد الخزنة المتتابع (${refStr}): المتوقع (${formatNumber(
                  expectedRun
                )}) والمقروء (${formatNumber(currRun)}) بفارق ${formatNumber(
                  diffRun
                )} ج.م.`
              : isSheetTransition
              ? `خطأ ترحيل رصيد الخزنة لورقة التكملة (${refStr}): الرصيد بعد الصف (${formatNumber(
                  currRun
                )}) لا يساوي آخر رصيد في الورقة السابقة (${formatNumber(
                  prevRunningCash
                )}) + مبلغ البيع (${formatNumber(op.total)}) = (${formatNumber(
                  expectedRun
                )}) بفارق ${formatNumber(diffRun)} ج.م.`
              : `خطأ جمع في رصيد الخزنة بالدفتر (${refStr}): الرصيد السابق (${formatNumber(
                  prevRunningCash
                )}) + مبلغ البيع (${formatNumber(op.total)}) = (${formatNumber(
                  expectedRun
                )}) لكن المكتوب في الدفتر (${formatNumber(
                  currRun
                )}) بفارق ${formatNumber(diffRun)} ج.م.`,
          });
        }
      }
      prevRunningCash = currRun;
      prevRunningSheet = currSheet;
    }

    // H9.3 (د & هـ): Compare `bookClosingCash` against App expected safe cash and Actual cash
    if (typeof bookClose === 'number') {
      const cashTol = settings.cashDiscrepancyThreshold || 200;
      const diffVsApp = Math.abs(bookClose - summary.expectedAppSafeCash);
      if (diffVsApp > cashTol) {
        issues.push({
          id: `safe-book-vs-app-${date}`,
          severity: diffVsApp > cashTol * 2 ? 'high' : 'medium',
          checkType: 'safe_ledger_reconciliation',
          checkTitle: 'مطابقة رصيد الخزنة في الدفتر (H9)',
          date,
          expected: `${formatNumber(summary.expectedAppSafeCash)} ج.م (البرنامج)`,
          actual: `${formatNumber(bookClose)} ج.م (الدفتر)`,
          difference: `${formatNumber(diffVsApp)} ج.م`,
          message: `فرق بين رصيد الخزنة الختامي المكتوب في الدفتر (${formatNumber(
            bookClose
          )} ج.م) والرصيد الختامي المتوقع في البرنامج (${formatNumber(
            summary.expectedAppSafeCash
          )} ج.م) ليوم ${date} بفارق ${formatNumber(diffVsApp)} ج.م.`,
        });
      }

      if (typeof dayInfo?.actualCash === 'number') {
        const diffVsActual = Math.abs(dayInfo.actualCash - bookClose);
        if (diffVsActual > cashTol) {
          issues.push({
            id: `safe-book-vs-actual-${date}`,
            severity: diffVsActual > cashTol * 2 ? 'high' : 'medium',
            checkType: 'safe_ledger_reconciliation',
            checkTitle: 'مطابقة رصيد الخزنة في الدفتر (H9)',
            date,
            expected: `${formatNumber(bookClose)} ج.م (الدفتر)`,
            actual: `${formatNumber(dayInfo.actualCash)} ج.م (الجرد الفعلي)`,
            difference: `${formatNumber(diffVsActual)} ج.م`,
            message: `فرق بين رصيد الخزنة الختامي في الدفتر (${formatNumber(
              bookClose
            )} ج.م) والجرد النقدي الفعلي (${formatNumber(
              dayInfo.actualCash
            )} ج.م) ليوم ${date} بفارق ${formatNumber(diffVsActual)} ج.م.`,
          });
        }
      }

      prevBookClosing = { date, cash: bookClose };
    }
  }

  return issues;
}
