import {
  CashMovementSuspect,
  FreeAreaNote,
  HandwrittenSideTotals,
  LedgerPageKind,
  LedgerPageRegion,
  LedgerPageSide,
  RedMarkItem,
  RedMarkType,
  RedOtherItem,
  SalesSourceBucket,
  SideTotalsComparison,
} from '../types';
import { addDaysLocalIso, getTodayIso } from '../utils/numerals';
import { randomSuffix } from '../utils/ids';
import { computeSheetRowSeq } from '../utils/sourceBuckets';

export interface ExtractedLedgerRow {
  id: string;
  approved: boolean;
  type: 'buy' | 'sell';
  item: string;
  weightG: number;
  total: number;
  confidence: number;
  runningBalanceBefore?: number;
  runningBalanceAfter?: number;
  // H9: Running safe cash from Sales sheet
  bookRunningCash?: number;
  // H-C & H5: Two-block structure & full SourceRef coordinates
  blockIndex?: 1 | 2; // 1 = Right block (الكتلة اليمنى), 2 = Left block (الكتلة اليسرى)
  lineInBlock?: number; // 1-based line inside the block
  lineNo?: number;
  seq?: number; // Sequential order in sheet: Block 1 top-to-bottom, then Block 2 top-to-bottom
  yRatio?: number;
  yTop?: number;
  yBottom?: number;
  // H5 (البديل): Red circled number = number of pieces sold from Rayon
  pieces?: number;
  piecesConfidence?: number;
  // H7 & H-B & H8: Sales source bucket
  sourceBucket?: SalesSourceBucket;
  sourceHint?: string;
  sourceGuessed?: boolean;
  multiSourceWarning?: boolean;
  pageId: string;
  pageNumber: number;
  rowOrderInPage: number;
  altWeightG?: number;
  altTotal?: number;
  altItem?: string;
  hasPassDiscrepancy?: boolean;
  singlePassOnly?: boolean;
  bookMarks?: RedMarkItem[];
}

export interface ScannedLedgerPage {
  id: string;
  pageNumber: number; // 1-indexed in uploaded file
  fileName?: string;
  rawImageDataUrl: string;
  processedImageDataUrl?: string;
  colorImageDataUrl?: string;
  imageHash: string;
  rotationDeg: 0 | 90 | 180 | 270;
  isSidewaysTwoSheets?: boolean;
  regions: LedgerPageRegion[];
  kind: LedgerPageKind;
  manualKindOverride?: LedgerPageKind;
  manualAssignedDayId?: string;
  detectedDate: string | null;
  weekday: string | null;
  dayGoldPrice: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  // H9: Safe balance from Sales sheet
  bookOpeningCash?: number | null;
  bookClosingCash?: number | null;
  side: LedgerPageSide;
  // H-A: Double confirmation of sheet side
  printedHeaderSide?: LedgerPageSide | null;
  hasBalanceColumn?: boolean | null;
  layoutConsistencyWarning?: string | null;
  pageNumberHint: string | null;
  avgConfidence: number;
  rows: ExtractedLedgerRow[];
  totalsBySide: {
    sell: HandwrittenSideTotals | null;
    buy: HandwrittenSideTotals | null;
  };
  redMarks: RedMarkItem[];
  // H5 (البديل): Unattached red numbers
  redOther?: RedOtherItem[];
  // H-C.3: Handwritten notes/calculations in the free space at the end of the day
  freeAreaNotes?: FreeAreaNote[];
  // H9.1: Non-sale cash movement suspects on the Sales sheet
  cashMovementSuspects?: CashMovementSuspect[];
  // H8.1: Bucket weights written outside rows
  bucketWeights?: {
    bagBeforeG?: number | null;
    bagActualG?: number | null;
    oldGoldBeforeG?: number | null;
    oldGoldActualG?: number | null;
    rayonPiecesBefore?: number | null;
    rayonPiecesActual?: number | null;
  };
  readStatus: 'unread' | 'queued' | 'reading' | 'done' | 'failed';
  importStatus: 'pending' | 'added' | 'rejected';
  errorMsg?: string;
  enhancementPresetUsed?: 'standard' | 'low_quality_boost';
}

export interface SequenceAnomaly {
  type: 'gap' | 'duplicate_date' | 'future_date' | 'implausible_year' | 'orphan_continuation';
  message: string;
  suggestedDate?: string;
}

export interface SuspectRowRank {
  row: ExtractedLedgerRow;
  score: number;
  reasons: string[];
}

export interface DiscoveredLedgerDay {
  id: string;
  date: string; // YYYY-MM-DD (or 'غير محدد' for unassigned orphan continuation)
  weekday: string | null;
  goldPricePerGram: number;
  openingBalance: number | null;
  closingBalance: number | null;
  bookOpeningCash?: number | null;
  bookClosingCash?: number | null;
  freeAreaNotes?: FreeAreaNote[];
  cashMovementSuspects?: CashMovementSuspect[];
  bucketWeights?: ScannedLedgerPage['bucketWeights'];
  pageIds: string[];
  pageNumbers: number[];
  isOrphanContinuation: boolean;
  rows: ExtractedLedgerRow[];
  sellRowsCount: number;
  buyRowsCount: number;
  sequenceWarnings: SequenceAnomaly[];
  totalsMatch: {
    sell: SideTotalsComparison;
    buy: SideTotalsComparison;
  };
  status: 'ok' | 'warn' | 'error';
  approvedForImport: boolean;
}

export interface GroupingOptions {
  excludeFridays?: boolean;
  todayIso?: string;
  smallDiffAmount?: number;
  largeDiffAmount?: number;
  weightToleranceG?: number;
  manualDayOverrides?: Record<
    string,
    {
      date?: string;
      goldPricePerGram?: number;
      approvedSellTotal?: number | null;
      approvedBuyTotal?: number | null;
      approvedSellWeightG?: number | null;
      approvedBuyWeightG?: number | null;
      auditorApprovedDiff?: boolean;
    }
  >;
}

const VALID_RED_MARK_TYPES: RedMarkType[] = [
  'circle',
  'tick',
  'underline',
  'strike',
  'number',
  'text',
  'other',
];

/**
 * Normalizes raw red_marks from Gemini (handles both structured H5 objects and legacy string arrays)
 */
export function normalizeRedMarks(rawMarks: any): RedMarkItem[] {
  if (!Array.isArray(rawMarks)) return [];
  const result: RedMarkItem[] = [];

  for (let i = 0; i < rawMarks.length; i++) {
    const m = rawMarks[i];
    if (!m) continue;
    if (typeof m === 'string') {
      const trimmed = m.trim();
      if (!trimmed) continue;
      const numericMatch = trimmed.replace(/[٠-٩]/g, (d) =>
        String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      );
      const parsedNum = Number(numericMatch.replace(/[^\d.]/g, ''));
      const isNum = Number.isFinite(parsedNum) && parsedNum > 0 && /^\d+(\.\d+)?$/.test(numericMatch.trim());
      result.push({
        id: `rm-${i}-${randomSuffix(3)}`,
        type: isNum ? 'number' : 'text',
        row_hint: null,
        text: trimmed,
        confidence: 0.8,
        ...(isNum ? { suggestedCorrectionValue: parsedNum } : {}),
      });
    } else if (typeof m === 'object') {
      const rawType = String(m.type || 'other').toLowerCase() as RedMarkType;
      const type: RedMarkType = VALID_RED_MARK_TYPES.includes(rawType) ? rawType : 'other';
      const text = String(m.text ?? '').trim();
      const normalizedDigits = text.replace(/[٠-٩]/g, (d) =>
        String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      );
      const numMatch = normalizedDigits.match(/\d+(?:\.\d+)?/);
      const suggestedVal =
        (type === 'number' || type === 'strike') && numMatch ? Number(numMatch[0]) : undefined;

      result.push({
        id: m.id || `rm-${i}-${randomSuffix(3)}`,
        type,
        row_hint: m.row_hint !== undefined && m.row_hint !== null ? Number(m.row_hint) : null,
        text,
        confidence: typeof m.confidence === 'number' ? m.confidence : 0.8,
        ...(suggestedVal && Number.isFinite(suggestedVal)
          ? { suggestedCorrectionValue: suggestedVal }
          : {}),
      });
    }
  }
  return result;
}

/**
 * H5.2: Attaches red marks to the nearest row on the page via row_hint (1-indexed)
 * without touching reviewedFlag.
 */
export function attachRedMarksToRows(
  rows: ExtractedLedgerRow[],
  redMarks: RedMarkItem[]
): ExtractedLedgerRow[] {
  if (!rows.length || !redMarks.length) return rows;
  const cloned = rows.map((r) => ({
    ...r,
    bookMarks: Array.isArray(r.bookMarks) ? [...r.bookMarks] : [],
  }));

  for (const mark of redMarks) {
    let targetIdx = -1;
    if (typeof mark.row_hint === 'number' && Number.isFinite(mark.row_hint)) {
      const oneBased = Math.round(mark.row_hint);
      if (oneBased >= 1 && oneBased <= cloned.length) {
        targetIdx = oneBased - 1;
      } else if (oneBased > cloned.length) {
        targetIdx = cloned.length - 1;
      }
    }
    // If no row_hint, try matching by proximity to a number in the mark
    if (targetIdx === -1 && mark.suggestedCorrectionValue && mark.suggestedCorrectionValue > 0) {
      let bestDist = Infinity;
      for (let i = 0; i < cloned.length; i++) {
        const diffTotal = Math.abs(cloned[i].total - mark.suggestedCorrectionValue);
        const diffWeight = Math.abs(cloned[i].weightG - mark.suggestedCorrectionValue);
        const d = Math.min(diffTotal / Math.max(100, cloned[i].total), diffWeight / Math.max(1, cloned[i].weightG));
        if (d < bestDist && d < 0.5) {
          bestDist = d;
          targetIdx = i;
        }
      }
    }

    if (targetIdx >= 0 && targetIdx < cloned.length) {
      const existing = cloned[targetIdx].bookMarks || [];
      if (!existing.some((em) => em.text === mark.text && em.type === mark.type)) {
        cloned[targetIdx].bookMarks = [...existing, mark];
      }
    }
  }

  return cloned;
}

/**
 * H5.3: Checks if a row has a red number mark that differs from the row's read total or weight
 */
export function hasDiscrepantRedNumber(row: {
  weightG: number;
  total: number;
  bookMarks?: RedMarkItem[];
}): { hasDiff: boolean; redValue?: number; field?: 'total' | 'weight' } {
  if (!row.bookMarks || row.bookMarks.length === 0) return { hasDiff: false };
  for (const m of row.bookMarks) {
    const val = m.suggestedCorrectionValue;
    if (val && val > 0) {
      if (val >= 100 && Math.abs(val - row.total) > 1) {
        return { hasDiff: true, redValue: val, field: 'total' };
      }
      if (val < 200 && Math.abs(val - row.weightG) > 0.005) {
        return { hasDiff: true, redValue: val, field: 'weight' };
      }
    }
  }
  return { hasDiff: false };
}

/**
 * H1.1: Infers page classification (`kind`) from OCR response and row structure
 */
export function classifyLedgerPageKind(rawOcrData: any, parsedRowsCount: number): LedgerPageKind {
  const explicitKind = String(rawOcrData?.kind || '').toLowerCase();
  if (explicitKind === 'cover') return 'cover';
  if (explicitKind === 'unreadable') return 'unreadable';
  if (parsedRowsCount === 0 && !rawOcrData?.date && !rawOcrData?.day_gold_price) {
    if (explicitKind === 'blank' || explicitKind === '') return 'blank';
  }
  if (explicitKind === 'blank' && parsedRowsCount === 0) return 'blank';

  const hasDate = Boolean(rawOcrData?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(rawOcrData.date)));
  const hasOpening =
    rawOcrData?.opening_balance !== undefined && rawOcrData?.opening_balance !== null;
  const hasGoldPrice =
    typeof rawOcrData?.day_gold_price === 'number' && rawOcrData.day_gold_price > 100;

  if (hasDate || (explicitKind === 'day_start' && (hasDate || hasOpening || hasGoldPrice))) {
    return 'day_start';
  }
  if (parsedRowsCount > 0 && !hasDate) {
    return 'continuation';
  }
  if (explicitKind === 'continuation' && parsedRowsCount > 0) {
    return 'continuation';
  }
  if (parsedRowsCount === 0) {
    return 'blank';
  }
  return 'day_start';
}

/**
 * H3.2 & H3.3: Computes side totals comparison between sum of read rows and handwritten total on the last page of the day
 */
export function computeSideTotalsComparison(params: {
  rows: ExtractedLedgerRow[];
  side: 'sell' | 'buy';
  lastPageHandwritten: HandwrittenSideTotals | null;
  approvedAmount?: number | null;
  approvedWeightG?: number | null;
  auditorApprovedDiff?: boolean;
  smallDiffAmount?: number;
  largeDiffAmount?: number;
  weightToleranceG?: number;
}): SideTotalsComparison {
  const {
    rows,
    side,
    lastPageHandwritten,
    approvedAmount,
    approvedWeightG,
    auditorApprovedDiff,
    smallDiffAmount = 50,
    largeDiffAmount = 200,
    weightToleranceG = 0.25,
  } = params;

  const sideRows = rows.filter((r) => r.approved && r.type === side);
  const readSumAmount = Math.round(sideRows.reduce((s, r) => s + (r.total || 0), 0));
  const readSumWeightG = Number(
    sideRows.reduce((s, r) => s + (r.weightG || 0), 0).toFixed(3)
  );

  const handwrittenAmount = lastPageHandwritten?.handwritten_total_amount ?? null;
  const handwrittenWeightG = lastPageHandwritten?.handwritten_total_weight_g ?? null;
  const candidates = lastPageHandwritten?.candidates || [];

  const refAmount =
    approvedAmount !== undefined && approvedAmount !== null ? approvedAmount : handwrittenAmount;
  const refWeightG =
    approvedWeightG !== undefined && approvedWeightG !== null
      ? approvedWeightG
      : handwrittenWeightG;

  if (refAmount === null && refWeightG === null) {
    return {
      readSumAmount,
      readSumWeightG,
      handwrittenAmount,
      handwrittenWeightG,
      approvedAmount,
      approvedWeightG,
      candidates,
      status: 'missing',
      diffAmount: 0,
      diffWeightG: 0,
      approvedByAuditor: Boolean(auditorApprovedDiff),
    };
  }

  const diffAmount = refAmount !== null ? readSumAmount - refAmount : 0;
  const diffWeightG =
    refWeightG !== null ? Number((readSumWeightG - refWeightG).toFixed(3)) : 0;

  const absAmountDiff = Math.abs(diffAmount);
  const absWeightDiff = Math.abs(diffWeightG);

  let status: SideTotalsComparison['status'] = 'match';
  if (
    (refAmount !== null && absAmountDiff > largeDiffAmount) ||
    (refWeightG !== null && absWeightDiff > weightToleranceG * 4)
  ) {
    status = 'large_diff';
  } else if (
    (refAmount !== null && absAmountDiff > smallDiffAmount) ||
    (refWeightG !== null && absWeightDiff > weightToleranceG)
  ) {
    status = 'small_diff';
  }

  return {
    readSumAmount,
    readSumWeightG,
    handwrittenAmount,
    handwrittenWeightG,
    approvedAmount,
    approvedWeightG,
    candidates,
    status,
    diffAmount,
    diffWeightG,
    approvedByAuditor: Boolean(auditorApprovedDiff),
  };
}

/**
 * H3.3: "أين الفرق؟" — Ranks rows in a day/side by likelihood of causing the total discrepancy
 */
export function rankSuspectRowsForDiff(
  rows: ExtractedLedgerRow[],
  side: 'sell' | 'buy',
  diffAmount: number,
  diffWeightG: number,
  dayGoldPrice: number
): SuspectRowRank[] {
  const sideRows = rows.filter((r) => r.type === side);
  const absDiffAmount = Math.abs(diffAmount);
  const absDiffWeight = Math.abs(diffWeightG);

  const ranked: SuspectRowRank[] = sideRows.map((row) => {
    let score = 0;
    const reasons: string[] = [];

    // 1. Low OCR confidence
    if (row.confidence < 0.7) {
      score += 45 + Math.round((0.7 - row.confidence) * 100);
      reasons.push(`ثقة قراءة منخفضة (${Math.round(row.confidence * 100)}%)`);
    } else if (row.confidence < 0.82) {
      score += 20;
      reasons.push(`ثقة قراءة متوسطة (${Math.round(row.confidence * 100)}%)`);
    }

    // 2. Row amount or weight matches the exact difference (duplicate or extra row)
    if (absDiffAmount > 0 && Math.abs(row.total - absDiffAmount) <= Math.max(20, absDiffAmount * 0.05)) {
      score += 60;
      reasons.push(`مبلغ الصف (${row.total}) يساوي تقريباً قيمة الفرق (${absDiffAmount})`);
    }
    if (absDiffWeight > 0.01 && Math.abs(row.weightG - absDiffWeight) <= 0.05) {
      score += 55;
      reasons.push(`وزن الصف (${row.weightG} ج) يطابق فرق الوزن (${absDiffWeight} ج)`);
    }

    // 3. Single digit confusion (e.g., 10x or digit swap difference equals diffAmount)
    if (absDiffAmount >= 100) {
      const tenthDiff = Math.abs(row.total - row.total / 10);
      const tenTimesDiff = Math.abs(row.total * 10 - row.total);
      if (Math.abs(tenthDiff - absDiffAmount) < 50 || Math.abs(tenTimesDiff - absDiffAmount) < 50) {
        score += 50;
        reasons.push('احتمال صفر زائد أو ناقص في المبلغ يفسر الفرق');
      }
    }

    // 4. Implied gram price far from daily gold price
    if (dayGoldPrice > 0 && row.weightG > 0 && row.total > 0) {
      const gramPrice = row.total / row.weightG;
      const pctDiff = Math.abs(gramPrice - dayGoldPrice) / dayGoldPrice;
      if (pctDiff > 0.15) {
        score += 35;
        reasons.push(
          `سعر الجرام الضمني (${Math.round(gramPrice)}) يبتعد ${Math.round(pctDiff * 100)}% عن سعر اليوم`
        );
      }
    }

    // 5. Dual-pass discrepancy or red correction mark
    if (row.hasPassDiscrepancy) {
      score += 40;
      reasons.push('اختلاف بين القراءة الأولى والثانية');
    }
    const redDiff = hasDiscrepantRedNumber(row);
    if (redDiff.hasDiff) {
      score += 45;
      reasons.push(`علامة تصحيح بالحبر الأحمر في الدفتر (${redDiff.redValue})`);
    }

    return { row, score, reasons };
  });

  return ranked
    .filter((item) => item.score > 0 || ranked.length <= 5)
    .sort((a, b) => b.score - a.score);
}

/**
 * H1.4: Validates the sequence of discovered days (date gaps excluding Friday, duplicates, future dates, implausible year)
 */
export function validateDaysSequence(
  days: DiscoveredLedgerDay[],
  options?: { excludeFridays?: boolean; todayIso?: string }
): DiscoveredLedgerDay[] {
  const excludeFridays = options?.excludeFridays ?? true;
  const todayIso = options?.todayIso || getTodayIso();
  const currentYear = Number(todayIso.slice(0, 4)) || 2026;

  // Count date occurrences to detect duplicates
  const dateCounts: Record<string, number> = {};
  for (const d of days) {
    if (d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      dateCounts[d.date] = (dateCounts[d.date] || 0) + 1;
    }
  }

  // Determine dominant year across valid dates in the batch
  const years: number[] = [];
  for (const d of days) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      years.push(Number(d.date.slice(0, 4)));
    }
  }
  const dominantYear =
    years.length > 0
      ? years
          .slice()
          .sort(
            (a, b) =>
              years.filter((v) => v === b).length - years.filter((v) => v === a).length
          )[0]
      : currentYear;

  return days.map((day, idx) => {
    const warnings: SequenceAnomaly[] = [];

    if (day.isOrphanContinuation) {
      warnings.push({
        type: 'orphan_continuation',
        message:
          'صفحة تكملة يتيمة في بداية الملف بلا صفحة بداية يوم قبلها — اختر لها تاريخاً أو ادمجها بيوم.',
      });
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      const y = Number(day.date.slice(0, 4));
      const monthDay = day.date.slice(5);

      // Check implausible year (e.g. 2025 instead of 2026)
      if (Math.abs(y - dominantYear) >= 1 && years.length >= 2) {
        const suggested = `${dominantYear}-${monthDay}`;
        warnings.push({
          type: 'implausible_year',
          message: `السنة المقروءة (${y}) تبدو غير متسقة مع باقي الدفتر (${dominantYear}). هل تقصد ${suggested}؟`,
          suggestedDate: suggested,
        });
      } else if (y < 2020 || y > currentYear + 1) {
        const suggested = `${currentYear}-${monthDay}`;
        warnings.push({
          type: 'implausible_year',
          message: `السنة المقروءة (${y}) غير منطقية. المقترح: ${suggested}`,
          suggestedDate: suggested,
        });
      }

      // Check future date
      if (day.date > todayIso) {
        const prevDay = idx > 0 ? days[idx - 1] : null;
        const suggested =
          prevDay && /^\d{4}-\d{2}-\d{2}$/.test(prevDay.date)
            ? addDaysLocalIso(prevDay.date, 1)
            : todayIso;
        warnings.push({
          type: 'future_date',
          message: `التاريخ المقروء (${day.date}) يقع في المستقبل بعد تاريخ اليوم (${todayIso}).`,
          suggestedDate: suggested,
        });
      }

      // Check duplicate date
      if (dateCounts[day.date] > 1) {
        const prevDay = idx > 0 ? days[idx - 1] : null;
        const suggested =
          prevDay && /^\d{4}-\d{2}-\d{2}$/.test(prevDay.date)
            ? addDaysLocalIso(prevDay.date, 1)
            : undefined;
        warnings.push({
          type: 'duplicate_date',
          message: `التاريخ (${day.date}) مكرر في أكثر من يوم مكتشف داخل نفس الملف. يمكنك دمج اليومين أو تصحيح التاريخ.`,
          suggestedDate: suggested,
        });
      }

      // Check gap with previous discovered day
      if (idx > 0) {
        const prev = days[idx - 1];
        if (/^\d{4}-\d{2}-\d{2}$/.test(prev.date) && prev.date !== day.date) {
          const prevMs = new Date(`${prev.date}T00:00:00Z`).getTime();
          const currMs = new Date(`${day.date}T00:00:00Z`).getTime();
          const diffDays = Math.round((currMs - prevMs) / 86400000);

          if (diffDays > 1 && diffDays <= 14) {
            const missingDates: string[] = [];
            for (let step = 1; step < diffDays; step++) {
              const candidate = addDaysLocalIso(prev.date, step);
              const dow = new Date(`${candidate}T00:00:00Z`).getUTCDay(); // 5 = Friday
              if (excludeFridays && dow === 5) continue;
              missingDates.push(candidate);
            }
            if (missingDates.length > 0) {
              warnings.push({
                type: 'gap',
                message: `فجوة في تسلسل التواريخ بين ${prev.date} و ${day.date} — أيام غير موجودة: (${missingDates.join(
                  ' ، '
                )})`,
                suggestedDate: missingDates[0],
              });
            }
          } else if (diffDays < 0) {
            const suggested = addDaysLocalIso(prev.date, 1);
            warnings.push({
              type: 'gap',
              message: `التاريخ (${day.date}) أقدم من اليوم السابق له في الملف (${prev.date}). المقترح: ${suggested}`,
              suggestedDate: suggested,
            });
          }
        }
      }
    }

    const hasLargeUnapprovedDiff =
      (day.totalsMatch.sell.status === 'large_diff' && !day.totalsMatch.sell.approvedByAuditor) ||
      (day.totalsMatch.buy.status === 'large_diff' && !day.totalsMatch.buy.approvedByAuditor);

    let status: DiscoveredLedgerDay['status'] = 'ok';
    if (day.isOrphanContinuation || hasLargeUnapprovedDiff) {
      status = 'error';
    } else if (
      warnings.length > 0 ||
      day.totalsMatch.sell.status === 'small_diff' ||
      day.totalsMatch.buy.status === 'small_diff'
    ) {
      status = 'warn';
    }

    return {
      ...day,
      sequenceWarnings: warnings,
      status,
    };
  });
}

/**
 * H1.2: Groups sequential scanned ledger pages into discovered days:
 * - Every `day_start` starts a new day.
 * - Every `continuation` attaches to the most recent preceding day (inheriting its date and gold price).
 * - If a `continuation` appears at the beginning of the file with no preceding `day_start`, it becomes an orphan continuation day (`isOrphanContinuation: true`).
 * - `blank` and `cover` pages are skipped from day operations.
 */
export function groupPagesIntoDays(
  pages: ScannedLedgerPage[],
  options?: GroupingOptions
): DiscoveredLedgerDay[] {
  const orderedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const rawGroups: {
    id: string;
    date: string;
    weekday: string | null;
    goldPricePerGram: number;
    openingBalance: number | null;
    closingBalance: number | null;
    isOrphanContinuation: boolean;
    pages: ScannedLedgerPage[];
  }[] = [];

  for (const page of orderedPages) {
    const effectiveKind = page.manualKindOverride || page.kind;
    if (effectiveKind === 'blank' || effectiveKind === 'cover') {
      continue;
    }

    // Check if user manually assigned this page to a specific day ID
    if (page.manualAssignedDayId) {
      const targetGroup = rawGroups.find((g) => g.id === page.manualAssignedDayId);
      if (targetGroup) {
        targetGroup.pages.push(page);
        if (page.closingBalance !== null && page.closingBalance !== undefined) {
          targetGroup.closingBalance = page.closingBalance;
        }
        continue;
      }
    }

    if (effectiveKind === 'day_start') {
      const dayId = `day-${page.pageNumber}-${ page.detectedDate || 'unassigned' }`;
      rawGroups.push({
        id: dayId,
        date: page.detectedDate || getTodayIso(),
        weekday: page.weekday,
        goldPricePerGram: page.dayGoldPrice || 0,
        openingBalance: page.openingBalance,
        closingBalance: page.closingBalance,
        isOrphanContinuation: false,
        pages: [page],
      });
    } else if (effectiveKind === 'continuation' || effectiveKind === 'unreadable') {
      if (rawGroups.length > 0 && !rawGroups[rawGroups.length - 1].isOrphanContinuation) {
        const currentGroup = rawGroups[rawGroups.length - 1];
        currentGroup.pages.push(page);
        if (!currentGroup.goldPricePerGram && page.dayGoldPrice) {
          currentGroup.goldPricePerGram = page.dayGoldPrice;
        }
        if (page.closingBalance !== null && page.closingBalance !== undefined) {
          currentGroup.closingBalance = page.closingBalance;
        }
      } else if (
        rawGroups.length > 0 &&
        rawGroups[rawGroups.length - 1].isOrphanContinuation &&
        effectiveKind === 'continuation'
      ) {
        rawGroups[rawGroups.length - 1].pages.push(page);
      } else if (effectiveKind === 'continuation') {
        // H1.6: Orphan continuation at the start of the file with no day before it
        const orphanId = `day-orphan-${page.pageNumber}`;
        rawGroups.push({
          id: orphanId,
          date: page.detectedDate || '',
          weekday: page.weekday,
          goldPricePerGram: page.dayGoldPrice || 0,
          openingBalance: page.openingBalance,
          closingBalance: page.closingBalance,
          isOrphanContinuation: !page.detectedDate,
          pages: [page],
        });
      }
    }
  }

  const builtDays: DiscoveredLedgerDay[] = rawGroups.map((group) => {
    const manualOverride = options?.manualDayOverrides?.[group.id] || {};
    const effectiveDate = manualOverride.date ?? group.date;
    const effectiveGoldPrice =
      manualOverride.goldPricePerGram !== undefined
        ? manualOverride.goldPricePerGram
        : group.goldPricePerGram;

    // Collect rows in page order and H-C two-block seq order (Block 1 Right top-to-bottom, then Block 2 Left top-to-bottom)
    const allRows: ExtractedLedgerRow[] = [];
    let lastSellHandwritten: HandwrittenSideTotals | null = null;
    let lastBuyHandwritten: HandwrittenSideTotals | null = null;
    let closingBal = group.closingBalance;
    let bookOpenCash: number | null = null;
    let bookCloseCash: number | null = null;
    const freeNotes: FreeAreaNote[] = [];
    const cashSuspects: CashMovementSuspect[] = [];
    let mergedBucketWeights: ScannedLedgerPage['bucketWeights'] = undefined;

    for (const p of group.pages) {
      const sortedPageRows = [...p.rows].sort((a, b) => {
        const seqA =
          a.seq ??
          computeSheetRowSeq(a.blockIndex, a.lineInBlock ?? a.lineNo, 25, a.rowOrderInPage).seq;
        const seqB =
          b.seq ??
          computeSheetRowSeq(b.blockIndex, b.lineInBlock ?? b.lineNo, 25, b.rowOrderInPage).seq;
        if (seqA !== seqB) return seqA - seqB;
        return a.rowOrderInPage - b.rowOrderInPage;
      });
      allRows.push(...sortedPageRows);
      if (p.totalsBySide.sell && (p.totalsBySide.sell.handwritten_total_amount !== null || p.totalsBySide.sell.handwritten_total_weight_g !== null)) {
        lastSellHandwritten = p.totalsBySide.sell;
      }
      if (p.totalsBySide.buy && (p.totalsBySide.buy.handwritten_total_amount !== null || p.totalsBySide.buy.handwritten_total_weight_g !== null)) {
        lastBuyHandwritten = p.totalsBySide.buy;
      }
      if (p.closingBalance !== null && p.closingBalance !== undefined) {
        closingBal = p.closingBalance;
      }
      if (bookOpenCash === null && typeof p.bookOpeningCash === 'number') {
        bookOpenCash = p.bookOpeningCash;
      }
      if (typeof p.bookClosingCash === 'number') {
        bookCloseCash = p.bookClosingCash;
      }
      if (Array.isArray(p.freeAreaNotes) && p.freeAreaNotes.length > 0) {
        freeNotes.push(...p.freeAreaNotes);
      }
      if (Array.isArray(p.cashMovementSuspects) && p.cashMovementSuspects.length > 0) {
        cashSuspects.push(...p.cashMovementSuspects);
      }
      if (p.bucketWeights) {
        mergedBucketWeights = { ...(mergedBucketWeights || {}), ...p.bucketWeights };
      }
    }

    const sellComparison = computeSideTotalsComparison({
      rows: allRows,
      side: 'sell',
      lastPageHandwritten: lastSellHandwritten,
      approvedAmount: manualOverride.approvedSellTotal,
      approvedWeightG: manualOverride.approvedSellWeightG,
      auditorApprovedDiff: manualOverride.auditorApprovedDiff,
      smallDiffAmount: options?.smallDiffAmount,
      largeDiffAmount: options?.largeDiffAmount,
      weightToleranceG: options?.weightToleranceG,
    });

    const buyComparison = computeSideTotalsComparison({
      rows: allRows,
      side: 'buy',
      lastPageHandwritten: lastBuyHandwritten,
      approvedAmount: manualOverride.approvedBuyTotal,
      approvedWeightG: manualOverride.approvedBuyWeightG,
      auditorApprovedDiff: manualOverride.auditorApprovedDiff,
      smallDiffAmount: options?.smallDiffAmount,
      largeDiffAmount: options?.largeDiffAmount,
      weightToleranceG: options?.weightToleranceG,
    });

    const sellRowsCount = allRows.filter((r) => r.type === 'sell').length;
    const buyRowsCount = allRows.filter((r) => r.type === 'buy').length;
    const isStillOrphan = group.isOrphanContinuation && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate);

    return {
      id: group.id,
      date: effectiveDate,
      weekday: group.weekday,
      goldPricePerGram: effectiveGoldPrice,
      openingBalance: group.openingBalance,
      closingBalance: closingBal,
      bookOpeningCash: bookOpenCash ?? group.openingBalance,
      bookClosingCash: bookCloseCash ?? closingBal,
      freeAreaNotes: freeNotes,
      cashMovementSuspects: cashSuspects,
      bucketWeights: mergedBucketWeights,
      pageIds: group.pages.map((p) => p.id),
      pageNumbers: group.pages.map((p) => p.pageNumber),
      isOrphanContinuation: isStillOrphan,
      rows: allRows,
      sellRowsCount,
      buyRowsCount,
      sequenceWarnings: [],
      totalsMatch: {
        sell: sellComparison,
        buy: buyComparison,
      },
      status: 'ok',
      approvedForImport: !isStillOrphan,
    };
  });

  return validateDaysSequence(builtDays, {
    excludeFridays: options?.excludeFridays,
    todayIso: options?.todayIso,
  });
}

/**
 * H1.3: Interactive tool — Marks a page as continuation (or any other kind) to merge/split days
 */
export function updatePageClassification(
  pages: ScannedLedgerPage[],
  pageId: string,
  newKind: LedgerPageKind,
  newDetectedDate?: string
): ScannedLedgerPage[] {
  return pages.map((p) => {
    if (p.id !== pageId) return p;
    return {
      ...p,
      kind: newKind,
      manualKindOverride: newKind,
      manualAssignedDayId: undefined,
      ...(newDetectedDate !== undefined ? { detectedDate: newDetectedDate } : {}),
    };
  });
}

/**
 * H1.3: Merges two discovered days by converting the second day's start page into a continuation of the first day
 */
export function mergeTwoDiscoveredDays(
  pages: ScannedLedgerPage[],
  targetDayPageIds: string[],
  sourceDayPageIds: string[]
): ScannedLedgerPage[] {
  if (targetDayPageIds.length === 0 || sourceDayPageIds.length === 0) return pages;
  const sourceSet = new Set(sourceDayPageIds);
  return pages.map((p) => {
    if (sourceSet.has(p.id)) {
      return {
        ...p,
        kind: 'continuation',
        manualKindOverride: 'continuation',
        manualAssignedDayId: undefined,
      };
    }
    return p;
  });
}

/**
 * H1.3: Splits a day starting from a specific continuation page into a new day_start
 */
export function splitDayFromPage(
  pages: ScannedLedgerPage[],
  splitPageId: string,
  newDate: string
): ScannedLedgerPage[] {
  return pages.map((p) => {
    if (p.id !== splitPageId) return p;
    return {
      ...p,
      kind: 'day_start',
      manualKindOverride: 'day_start',
      detectedDate: newDate,
      manualAssignedDayId: undefined,
    };
  });
}
