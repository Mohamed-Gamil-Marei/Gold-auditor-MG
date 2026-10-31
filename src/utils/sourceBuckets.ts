import {
  AuditSettings,
  BucketDailyReconciliation,
  DayInfo,
  FreeAreaNote,
  Operation,
  RedOtherItem,
  SalesSourceBucket,
  SourceBucketRuleConfig,
  SourcePageRef,
} from '../types';
import { formatNumber, formatWeight } from './numerals';
import { randomSuffix } from './ids';

export const SOURCE_BUCKET_LABELS: Record<SalesSourceBucket, string> = {
  rayon: 'الريون (المعروض)',
  bag: 'الكيس / العلب',
  old_gold: 'الذهب القديم',
  other: 'مصدر آخر',
};

export const DEFAULT_SOURCE_BUCKETS_CONFIG: Record<
  SalesSourceBucket,
  SourceBucketRuleConfig
> = {
  rayon: {
    id: 'rayon',
    name: 'الريون (المعروض)',
    trackingUnit: 'both',
    color: 'amber',
    keywords: ['ريون', 'معروض', 'فترينه', 'فترينة'],
    toleranceG: 0.25,
  },
  bag: {
    id: 'bag',
    name: 'الكيس / العلب',
    trackingUnit: 'weight',
    color: 'blue',
    keywords: ['كيس', 'علبه', 'علبة', 'علب'],
    toleranceG: 0.25,
  },
  old_gold: {
    id: 'old_gold',
    name: 'الذهب القديم',
    trackingUnit: 'weight',
    color: 'purple',
    keywords: ['قديم', 'من القديم', 'من الكسر', 'كسر اليوم'],
    toleranceG: 0.25,
  },
  other: {
    id: 'other',
    name: 'مصدر آخر',
    trackingUnit: 'weight',
    color: 'slate',
    keywords: [],
    toleranceG: 0.5,
  },
};

export const DEFAULT_ITEMS_EXPECTING_PIECES: string[] = [
  'خاتم',
  'دبلة',
  'دبله',
  'غويشة',
  'غويشه',
  'حلق',
  'سلسلة',
  'سلسله',
  'انسيال',
  'تعليقة',
  'تعليقه',
  'كوليه',
  'طقم',
  'محبس',
  'توينز',
];

/**
 * H-B.1: Normalizes Arabic text for source bucket keyword matching:
 * - Removes tashkeel (diacritics) and tatweel (ـ)
 * - Unifies أ/إ/آ -> ا, ة -> ه, ى -> ي, ؤ -> و, ئ -> ي
 * - Collapses extra whitespace
 */
export function normalizeBucketText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\u0621-\u064A0-9a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Computes Levenshtein edit distance between two strings (for H-B.1 1-char typo tolerance on words > 3 letters)
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

/**
 * Checks whether `normalizedText` matches `rawKeyword` either as a substring/phrase
 * or with 1-character typo tolerance for words > 3 characters (H-B.1).
 */
export function matchesBucketKeyword(
  normalizedText: string,
  rawKeyword: string
): boolean {
  const normKw = normalizeBucketText(rawKeyword);
  if (!normKw || !normalizedText) return false;

  // Direct phrase or word boundary match
  if (normalizedText.includes(normKw)) {
    return true;
  }

  // Strip definite article "ال" for word-level comparison
  const stripAl = (w: string) => (w.startsWith('ال') && w.length > 4 ? w.slice(2) : w);
  const textWords = normalizedText.split(' ').filter(Boolean);
  const kwWords = normKw.split(' ').filter(Boolean);

  if (kwWords.length === 1) {
    const target = kwWords[0];
    const targetCore = stripAl(target);
    for (const w of textWords) {
      const wCore = stripAl(w);
      if (w === target || wCore === targetCore) return true;
      // 1-char typo tolerance only for words > 3 letters
      if (targetCore.length > 3 && wCore.length > 3) {
        if (levenshteinDistance(wCore, targetCore) <= 1) {
          return true;
        }
      }
    }
  } else if (kwWords.length > 1 && textWords.length >= kwWords.length) {
    for (let i = 0; i <= textWords.length - kwWords.length; i++) {
      let allMatch = true;
      for (let j = 0; j < kwWords.length; j++) {
        const tw = stripAl(textWords[i + j]);
        const kw = stripAl(kwWords[j]);
        const ok =
          tw === kw ||
          (kw.length > 3 && tw.length > 3 && levenshteinDistance(tw, kw) <= 1);
        if (!ok) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return true;
    }
  }

  return false;
}

export interface SourceBucketClassificationResult {
  bucket: SalesSourceBucket;
  matchedKeyword?: string;
  isGuessed: boolean;
  multiSourceWarning: boolean;
  matchedBuckets: SalesSourceBucket[];
}

/**
 * H7.2 & H-B.1–H-B.3: Classifies an operation's statement (`item`) into a SalesSourceBucket:
 * Priority when multiple keywords appear: old_gold -> bag -> other -> rayon (with multiSourceWarning = true).
 */
export function classifySourceBucket(
  itemText: string | undefined,
  settings?: Partial<AuditSettings>,
  ocrSourceHint?: string | null
): SourceBucketClassificationResult {
  const combinedText = `${itemText || ''} ${ocrSourceHint || ''}`.trim();
  const norm = normalizeBucketText(combinedText);

  if (!norm) {
    return {
      bucket: 'rayon',
      isGuessed: false,
      multiSourceWarning: false,
      matchedBuckets: [],
    };
  }

  const config = settings?.sourceBucketsConfig || DEFAULT_SOURCE_BUCKETS_CONFIG;
  const includeStandaloneKasr = Boolean(settings?.includeStandaloneKasrForOldGold);

  const oldGoldKeywords = [
    ...(config.old_gold?.keywords || DEFAULT_SOURCE_BUCKETS_CONFIG.old_gold.keywords),
    ...(includeStandaloneKasr ? ['كسر'] : []),
  ];
  const bagKeywords =
    config.bag?.keywords || DEFAULT_SOURCE_BUCKETS_CONFIG.bag.keywords;
  const otherKeywords = config.other?.keywords || [];
  const rayonKeywords =
    config.rayon?.keywords || DEFAULT_SOURCE_BUCKETS_CONFIG.rayon.keywords;

  const matchedBuckets: SalesSourceBucket[] = [];
  let matchedOldGoldKw: string | undefined;
  let matchedBagKw: string | undefined;
  let matchedOtherKw: string | undefined;
  let matchedRayonKw: string | undefined;

  for (const kw of oldGoldKeywords) {
    if (matchesBucketKeyword(norm, kw)) {
      matchedOldGoldKw = kw;
      matchedBuckets.push('old_gold');
      break;
    }
  }
  for (const kw of bagKeywords) {
    if (matchesBucketKeyword(norm, kw)) {
      matchedBagKw = kw;
      matchedBuckets.push('bag');
      break;
    }
  }
  for (const kw of otherKeywords) {
    if (matchesBucketKeyword(norm, kw)) {
      matchedOtherKw = kw;
      matchedBuckets.push('other');
      break;
    }
  }
  for (const kw of rayonKeywords) {
    if (matchesBucketKeyword(norm, kw)) {
      matchedRayonKw = kw;
      matchedBuckets.push('rayon');
      break;
    }
  }

  const multiSourceWarning = matchedBuckets.length > 1;

  // Priority: old_gold -> bag -> other -> rayon
  if (matchedOldGoldKw) {
    return {
      bucket: 'old_gold',
      matchedKeyword: matchedOldGoldKw,
      isGuessed: true,
      multiSourceWarning,
      matchedBuckets,
    };
  }
  if (matchedBagKw) {
    return {
      bucket: 'bag',
      matchedKeyword: matchedBagKw,
      isGuessed: true,
      multiSourceWarning,
      matchedBuckets,
    };
  }
  if (matchedOtherKw) {
    return {
      bucket: 'other',
      matchedKeyword: matchedOtherKw,
      isGuessed: true,
      multiSourceWarning,
      matchedBuckets,
    };
  }
  if (matchedRayonKw) {
    return {
      bucket: 'rayon',
      matchedKeyword: matchedRayonKw,
      isGuessed: false,
      multiSourceWarning,
      matchedBuckets,
    };
  }

  return {
    bucket: 'rayon',
    matchedKeyword: ocrSourceHint || undefined,
    isGuessed: false,
    multiSourceWarning: false,
    matchedBuckets: [],
  };
}

/**
 * H-B.4: Checks if a purchase (`kind === 'buy'`) represents scrap/old gold that should automatically
 * flow into `old_gold` inflow when `autoAddScrapPurchasesToOldGoldInflow` is enabled.
 */
export function isScrapOrOldGoldPurchase(itemText: string | undefined): boolean {
  const norm = normalizeBucketText(itemText || '');
  if (!norm) return false;
  const scrapBuyKeywords = ['كسر', 'قديم', 'من القديم', 'من الكسر', 'كسر اليوم', 'مستعمل'];
  return scrapBuyKeywords.some((kw) => matchesBucketKeyword(norm, kw));
}

// H-B.6: Local learning tracker for manual sourceBucket overrides (suggests keyword after 3 occurrences)
const SOURCE_LEARNING_STORAGE_KEY = 'gold_audit_source_bucket_learning_v1';

interface LearnedBucketCounts {
  [normText: string]: Partial<Record<SalesSourceBucket, number>>;
}

export function recordManualSourceBucketOverride(
  itemText: string,
  chosenBucket: SalesSourceBucket
): { suggestKeyword: boolean; normalizedPhrase: string; count: number } {
  const norm = normalizeBucketText(itemText);
  if (!norm || norm.length < 2) {
    return { suggestKeyword: false, normalizedPhrase: norm, count: 0 };
  }
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(SOURCE_LEARNING_STORAGE_KEY)
        : null;
    const map: LearnedBucketCounts = raw ? JSON.parse(raw) : {};
    if (!map[norm]) map[norm] = {};
    const nextCount = (map[norm][chosenBucket] || 0) + 1;
    map[norm][chosenBucket] = nextCount;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SOURCE_LEARNING_STORAGE_KEY, JSON.stringify(map));
    }
    return {
      suggestKeyword: nextCount >= 3 && chosenBucket !== 'rayon',
      normalizedPhrase: norm,
      count: nextCount,
    };
  } catch {
    return { suggestKeyword: false, normalizedPhrase: norm, count: 1 };
  }
}

export function getSuggestedBucketKeywords(): Array<{
  phrase: string;
  bucket: SalesSourceBucket;
  count: number;
}> {
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(SOURCE_LEARNING_STORAGE_KEY)
        : null;
    if (!raw) return [];
    const map: LearnedBucketCounts = JSON.parse(raw);
    const suggestions: Array<{
      phrase: string;
      bucket: SalesSourceBucket;
      count: number;
    }> = [];
    for (const [phrase, bucketMap] of Object.entries(map)) {
      for (const [b, cnt] of Object.entries(bucketMap)) {
        if ((cnt || 0) >= 3 && b !== 'rayon') {
          suggestions.push({
            phrase,
            bucket: b as SalesSourceBucket,
            count: cnt || 0,
          });
        }
      }
    }
    return suggestions;
  } catch {
    return [];
  }
}

/**
 * H-C.2: Calculates sequential index `seq` inside a two-block ledger sheet:
 * Reading order: Block 1 (Right / الكتلة اليمنى) top-to-bottom, then Block 2 (Left / الكتلة اليسرى) top-to-bottom.
 */
export function computeSheetRowSeq(
  blockIndex: 1 | 2 | undefined,
  lineInBlock: number | undefined,
  linesPerBlock = 25,
  fallbackOrder = 1
): { blockIndex: 1 | 2; lineInBlock: number; seq: number } {
  const blk: 1 | 2 = blockIndex === 2 ? 2 : 1;
  const line =
    typeof lineInBlock === 'number' && Number.isFinite(lineInBlock) && lineInBlock >= 1
      ? Math.round(lineInBlock)
      : fallbackOrder;
  const seq = blk === 1 ? line : linesPerBlock + line;
  return { blockIndex: blk, lineInBlock: line, seq };
}

/**
 * H-C.2 & H5.1: Formats a human-readable Arabic source reference:
 * e.g. "مبيعات — ورقة 2 — يمين سطر 14" or "مشتريات — ورقة 1 — يسار سطر 5"
 */
export function formatSourceRef(
  ref?: SourcePageRef | null,
  fallbackKind?: 'buy' | 'sell' | string,
  date?: string,
  includeDate = false
): string {
  if (!ref) return '—';
  const side = ref.sheetSide || ref.side || (fallbackKind === 'buy' ? 'buy' : 'sell');
  const sideLabel = side === 'buy' ? 'مشتريات' : 'مبيعات';
  const sheetNo = ref.sheetIndexInDay || ref.pageIndex || ref.pdfPage || 1;
  const blockLabel =
    ref.blockIndex === 2 ? 'يسار' : ref.blockIndex === 1 ? 'يمين' : '';
  const lineNo = ref.lineInBlock || ref.lineNo || 1;

  const core = blockLabel
    ? `${sideLabel} — ورقة ${sheetNo} — ${blockLabel} سطر ${lineNo}`
    : `${sideLabel} — سطر ${lineNo} — ورقة ${sheetNo}`;

  if (includeDate && date) {
    return `${core} — ${date}`;
  }
  return core;
}

/**
 * H-C.2: Validates that `seq` values within a sheet (for each side) are strictly ascending and non-duplicate.
 */
export function validateSheetBlockSequences(
  rows: Array<{
    id: string;
    type: 'buy' | 'sell';
    blockIndex?: 1 | 2;
    lineInBlock?: number;
    seq?: number;
  }>,
  linesPerBlock = 25
): { valid: boolean; warnings: string[]; duplicateOrOutOfOrderIds: string[] } {
  const warnings: string[] = [];
  const badIds = new Set<string>();

  for (const side of ['sell', 'buy'] as const) {
    const sideRows = rows.filter((r) => r.type === side);
    if (sideRows.length <= 1) continue;
    const sideLabel = side === 'sell' ? 'المبيعات' : 'المشتريات';

    const seenSeq = new Set<number>();
    let prevSeq = -1;

    for (let i = 0; i < sideRows.length; i++) {
      const r = sideRows[i];
      const { seq } = computeSheetRowSeq(
        r.blockIndex,
        r.lineInBlock,
        linesPerBlock,
        i + 1
      );
      if (seenSeq.has(seq)) {
        badIds.add(r.id);
        warnings.push(
          `تكرار في رقم السطر المتسلسل (seq=${seq}) داخل ورقة ${sideLabel}.`
        );
      }
      if (seq < prevSeq) {
        badIds.add(r.id);
        warnings.push(
          `ترتيب غير متصاعد للسطور في ورقة ${sideLabel} عند الانتقال للسطر (seq=${seq} بعد ${prevSeq}).`
        );
      }
      seenSeq.add(seq);
      prevSeq = seq;
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
    duplicateOrOutOfOrderIds: Array.from(badIds),
  };
}

/**
 * H-A.1–H-A.4: Verifies consistency between sheet position (Right = sell, Left = buy),
 * printed header ("المبيعات" / "المشتريات"), and balance column presence ("الرصيد السابق").
 */
export function verifyLedgerSheetSideConsistency(params: {
  positionSide?: 'sell' | 'buy' | 'both' | null;
  printedHeaderSide?: 'sell' | 'buy' | 'both' | null;
  hasBalanceColumnOrRow?: boolean | null;
  reverseLayout?: boolean;
}): {
  consistent: boolean;
  resolvedSide: 'sell' | 'buy' | 'both';
  warningMessage?: string;
} {
  const {
    positionSide,
    printedHeaderSide,
    hasBalanceColumnOrRow,
    reverseLayout = false,
  } = params;

  // By default (reverseLayout=false): Right sheet is 'sell', Left sheet is 'buy'
  let expectedFromPos = positionSide || 'both';
  if (reverseLayout && (expectedFromPos === 'sell' || expectedFromPos === 'buy')) {
    expectedFromPos = expectedFromPos === 'sell' ? 'buy' : 'sell';
  }

  const reasons: string[] = [];

  if (
    printedHeaderSide &&
    printedHeaderSide !== 'both' &&
    expectedFromPos !== 'both' &&
    printedHeaderSide !== expectedFromPos
  ) {
    const posAr = expectedFromPos === 'sell' ? 'المبيعات (يمين)' : 'المشتريات (يسار)';
    const hdrAr = printedHeaderSide === 'sell' ? 'المبيعات' : 'المشتريات';
    reasons.push(
      `موضع الورقة يشير إلى (${posAr}) لكن العنوان المطبوع المقروء هو (${hdrAr})`
    );
  }

  // Balance column / opening balance row is a hallmark of the Sales sheet
  if (hasBalanceColumnOrRow === true && expectedFromPos === 'buy') {
    reasons.push(
      'تم رصد صف/أعمدة "الرصيد السابق" (وهي علامة ورقة المبيعات) في الورقة المصنفة كمشتريات'
    );
  } else if (
    hasBalanceColumnOrRow === false &&
    printedHeaderSide === 'buy' &&
    expectedFromPos === 'sell'
  ) {
    reasons.push(
      'الورقة لا تحتوي على أعمدة الرصيد وعنوانها المطبوع "المشتريات" رغم وقوعها في موضع المبيعات'
    );
  }

  if (reasons.length > 0) {
    return {
      consistent: false,
      resolvedSide: expectedFromPos,
      warningMessage: `جهة الورقة غير متسقة: ${reasons.join(' — ')}. يمكنك قلب جهة الورقة أو تعديل التدوير بزر واحد.`,
    };
  }

  // Single sheet fallback (when positionSide is not split)
  if (expectedFromPos === 'both' && printedHeaderSide && printedHeaderSide !== 'both') {
    return {
      consistent: true,
      resolvedSide: printedHeaderSide,
    };
  }
  if (expectedFromPos === 'both' && hasBalanceColumnOrRow === true) {
    return {
      consistent: true,
      resolvedSide: 'sell',
    };
  }

  return {
    consistent: true,
    resolvedSide: expectedFromPos,
  };
}

/**
 * H5 (البديل): Extracts piece counts (`pieces`) from row-level OCR fields or circled red numbers
 * without ever treating a red number as weight, amount, or review flag.
 */
export function extractRowPiecesFromRedMarks(
  explicitPieces: number | null | undefined,
  bookMarks?: Array<{ type: string; text?: string; suggestedCorrectionValue?: number }>
): number | undefined {
  if (
    typeof explicitPieces === 'number' &&
    Number.isFinite(explicitPieces) &&
    explicitPieces > 0 &&
    explicitPieces <= 500
  ) {
    return Math.round(explicitPieces);
  }
  if (!Array.isArray(bookMarks)) return undefined;
  for (const m of bookMarks) {
    if (m.type === 'circle' || m.type === 'number') {
      const txt = String(m.text || '')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .trim();
      const match = txt.match(/^\d+$/);
      const val = match ? Number(match[0]) : m.suggestedCorrectionValue;
      // Piece counts in a gold showcase row are small integers (typically 1..99)
      if (
        typeof val === 'number' &&
        Number.isInteger(val) &&
        val >= 1 &&
        val <= 99
      ) {
        return val;
      }
    }
  }
  return undefined;
}

export interface RunningGoldStep {
  op: Operation;
  sourceRefText: string;
  runningTotalGoldG: number;
  runningBucketGoldG: Record<SalesSourceBucket, number>;
  droppedBelowZero: boolean;
  bucketDroppedBelowZero?: SalesSourceBucket;
}

export interface DayCloseReconciliationSummary {
  date: string;
  // 1. Sales & Purchases aggregation (H10.1)
  sellCashAmount: number;
  sellCreditAmount: number;
  sellTotalAmount: number;
  sellWeightG: number;
  sellPiecesTotal: number;
  buyCashAmount: number;
  buyCreditAmount: number;
  buyTotalAmount: number;
  buyWeightG: number;
  // Net Weight & Net Cash (H10.1)
  netWeightDiffG: number; // sellWeightG - buyWeightG
  netWeightDirectionText: string; // "باع أكتر من اشترى بـ X جرام" | "اشترى أكتر من باع بـ X جرام" | "تعادل بين البيع والشراء"
  netCashFlow: number; // sellCashAmount - buyCashAmount
  // 2. Safe Reconciliation (H9 & H10.2)
  openingSafeCash: number;
  expensesCash: number;
  advancesCash: number;
  personReceivedCash: number;
  personGaveCash: number;
  expectedAppSafeCash: number;
  actualSafeCash?: number;
  bookOpeningCash?: number;
  bookClosingCash?: number;
  expectedBookSafeCash?: number;
  safeAppVsActualDiff: number; // actual - expectedApp
  safeBookVsAppDiff?: number; // bookClosing - expectedApp
  safeBookVsActualDiff?: number; // actual - bookClosing
  safeStatus: 'match' | 'small_diff' | 'large_diff' | 'missing';
  // 3. Weight & Source Buckets Reconciliation (H7.3 & H10.3)
  openingTotalGoldG: number;
  expectedClosingGoldG: number;
  actualClosingGoldG?: number;
  totalGoldDiffG: number;
  goldStatus: 'match' | 'small_diff' | 'large_diff' | 'missing';
  buckets: Record<
    SalesSourceBucket,
    {
      bucket: SalesSourceBucket;
      name: string;
      beforeG: number;
      autoInflowG: number;
      manualInflowG: number;
      totalInflowG: number;
      soldG: number;
      expectedG: number;
      actualG?: number;
      diffG: number;
      diffValueEgp: number;
      status: 'match' | 'small_diff' | 'large_diff' | 'missing';
      piecesBefore: number;
      piecesInflow: number;
      piecesSold: number;
      piecesExpected: number;
      piecesActual?: number;
      piecesDiff: number;
    }
  >;
  // 4. "ما ينفعش يبيع أكتر من المتاح" (H10.4)
  exceededTotalAvailable: boolean;
  exceededBuckets: SalesSourceBucket[];
  inventoryDrawdownG: number; // > 0 when sellWeightG > buyWeightG but covered by opening balance ("سحب من المخزون")
  firstNegativeRow?: {
    op: Operation;
    sourceRefText: string;
    deficitG: number;
    bucket?: SalesSourceBucket;
  };
  // 5. Free Area Notes Comparison (H-C.3)
  matchedFreeAreaNotes: FreeAreaNote[];
  // 6. Readiness for Day Lock (H10.5 & H10.6)
  hasUnapprovedLedgerTotalDiff: boolean;
  unconfirmedSourceRowsCount: number;
  requiresLockReason: boolean;
}

/**
 * Sorts a day's operations in chronological paper ledger order (H-C.2):
 * Sheet index ascending -> Block 1 (Right) top-to-bottom -> Block 2 (Left) top-to-bottom -> createdAt
 */
export function sortOperationsByLedgerOrder(
  ops: Operation[],
  linesPerBlock = 25
): Operation[] {
  return ops.slice().sort((a, b) => {
    const sheetA = Number(
      a.sourcePageRef?.sheetIndexInDay ??
        a.sourcePageRef?.pageIndex ??
        a.pageNumberHint ??
        1
    );
    const sheetB = Number(
      b.sourcePageRef?.sheetIndexInDay ??
        b.sourcePageRef?.pageIndex ??
        b.pageNumberHint ??
        1
    );
    if (sheetA !== sheetB) return sheetA - sheetB;

    const seqA =
      a.sourcePageRef?.seq ??
      computeSheetRowSeq(
        a.sourcePageRef?.blockIndex,
        a.sourcePageRef?.lineInBlock ?? a.sourcePageRef?.lineNo ?? a.rowOrderInPage,
        linesPerBlock,
        a.rowOrderInPage ?? 1
      ).seq;
    const seqB =
      b.sourcePageRef?.seq ??
      computeSheetRowSeq(
        b.sourcePageRef?.blockIndex,
        b.sourcePageRef?.lineInBlock ?? b.sourcePageRef?.lineNo ?? b.rowOrderInPage,
        linesPerBlock,
        b.rowOrderInPage ?? 1
      ).seq;
    if (seqA !== seqB) return seqA - seqB;

    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/**
 * H7, H9, H10, H-C.3: Computes the complete End-of-Day Close & Reconciliation summary for a given date.
 */
export function computeDayCloseReconciliation(params: {
  date: string;
  operations: Operation[];
  daysMap: Record<string, DayInfo>;
  settings: AuditSettings;
}): DayCloseReconciliationSummary {
  const { date, operations, daysMap, settings } = params;
  const dayInfo = daysMap[date];
  const dayGoldPrice = dayInfo?.goldPricePerGram || 0;
  const linesPerBlock = settings.ledgerLinesPerBlock || 25;
  const ruleMode = settings.goldAvailabilityRuleMode || 'with_opening';
  const bucketsConfig = settings.sourceBucketsConfig || DEFAULT_SOURCE_BUCKETS_CONFIG;
  const autoScrapToOldGold = settings.autoAddScrapPurchasesToOldGoldInflow !== false;

  // Find previous recorded day (skipping empty days & Fridays automatically)
  const allRecordedDates = Array.from(
    new Set([...Object.keys(daysMap), ...operations.map((o) => o.date)])
  )
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < date)
    .sort();
  const prevDate =
    allRecordedDates.length > 0
      ? allRecordedDates[allRecordedDates.length - 1]
      : null;
  const prevDayInfo = prevDate ? daysMap[prevDate] : undefined;

  const dayOps = sortOperationsByLedgerOrder(
    operations.filter((o) => o.date === date),
    linesPerBlock
  );

  let sellCashAmount = 0;
  let sellCreditAmount = 0;
  let sellWeightG = 0;
  let sellPiecesTotal = 0;

  let buyCashAmount = 0;
  let buyCreditAmount = 0;
  let buyWeightG = 0;

  let expensesCash = 0;
  let advancesCash = 0;
  let personReceivedCash = 0;
  let personGaveCash = 0;

  let autoOldGoldInflowFromPurchasesG = 0;

  const soldByBucketG: Record<SalesSourceBucket, number> = {
    rayon: 0,
    bag: 0,
    old_gold: 0,
    other: 0,
  };
  const soldPiecesByBucket: Record<SalesSourceBucket, number> = {
    rayon: 0,
    bag: 0,
    old_gold: 0,
    other: 0,
  };

  let unconfirmedSourceRowsCount = 0;

  for (const op of dayOps) {
    if (op.kind === 'sell') {
      if (op.payment === 'credit') sellCreditAmount += op.total;
      else sellCashAmount += op.total;
      sellWeightG = Number((sellWeightG + (op.weightG || 0)).toFixed(3));

      const bucket: SalesSourceBucket = op.sourceBucket || 'rayon';
      soldByBucketG[bucket] = Number(
        (soldByBucketG[bucket] + (op.weightG || 0)).toFixed(3)
      );
      if (op.pieces && op.pieces > 0) {
        sellPiecesTotal += op.pieces;
        soldPiecesByBucket[bucket] += op.pieces;
      }
      if (op.sourceGuessed) {
        unconfirmedSourceRowsCount++;
      }
    } else if (op.kind === 'buy') {
      if (op.payment === 'credit') buyCreditAmount += op.total;
      else buyCashAmount += op.total;
      buyWeightG = Number((buyWeightG + (op.weightG || 0)).toFixed(3));

      if (autoScrapToOldGold && isScrapOrOldGoldPurchase(op.item)) {
        autoOldGoldInflowFromPurchasesG = Number(
          (autoOldGoldInflowFromPurchasesG + (op.weightG || 0)).toFixed(3)
        );
      }
    } else if (op.kind === 'expense') {
      expensesCash += op.total;
    } else if (op.kind === 'advance') {
      advancesCash += op.total;
    } else if (op.kind === 'person') {
      if ((op.direction || 'gave_him') === 'received_from_him') {
        personReceivedCash += op.total;
      } else {
        personGaveCash += op.total;
      }
    }
  }

  const sellTotalAmount = sellCashAmount + sellCreditAmount;
  const buyTotalAmount = buyCashAmount + buyCreditAmount;
  const netWeightDiffG = Number((sellWeightG - buyWeightG).toFixed(3));
  const netCashFlow = Math.round(sellCashAmount - buyCashAmount);

  let netWeightDirectionText = 'تعادل بين وزن المبيعات والمشتريات (٠ جرام)';
  if (netWeightDiffG > 0.001) {
    netWeightDirectionText = `باع أكتر من اشترى بـ ${formatWeight(netWeightDiffG)} جرام`;
  } else if (netWeightDiffG < -0.001) {
    netWeightDirectionText = `اشترى أكتر من باع بـ ${formatWeight(Math.abs(netWeightDiffG))} جرام`;
  }

  // Safe Reconciliation (H9 & H10.2)
  const openingSafeCash =
    dayInfo?.openingCash !== undefined
      ? dayInfo.openingCash
      : prevDayInfo?.actualCash ?? dayInfo?.bookOpeningCash ?? 0;

  const expectedAppSafeCash = Math.round(
    openingSafeCash +
      netCashFlow -
      expensesCash -
      advancesCash -
      personGaveCash +
      personReceivedCash
  );

  const actualSafeCash = dayInfo?.actualCash;
  const bookOpeningCash = dayInfo?.bookOpeningCash ?? dayInfo?.openingLedgerBalance;
  const bookClosingCash = dayInfo?.bookClosingCash ?? dayInfo?.closingLedgerBalance;

  const purchaseImpactMode =
    settings.purchasesSafeBalanceImpact || 'deduct_end_of_day';
  let expectedBookSafeCash: number | undefined;
  if (typeof bookOpeningCash === 'number') {
    if (purchaseImpactMode === 'no_impact') {
      expectedBookSafeCash = Math.round(bookOpeningCash + sellCashAmount);
    } else {
      expectedBookSafeCash = Math.round(bookOpeningCash + sellCashAmount - buyCashAmount);
    }
  }

  const safeAppVsActualDiff =
    typeof actualSafeCash === 'number'
      ? Math.round(actualSafeCash - expectedAppSafeCash)
      : 0;
  const safeBookVsAppDiff =
    typeof bookClosingCash === 'number'
      ? Math.round(bookClosingCash - expectedAppSafeCash)
      : undefined;
  const safeBookVsActualDiff =
    typeof actualSafeCash === 'number' && typeof bookClosingCash === 'number'
      ? Math.round(actualSafeCash - bookClosingCash)
      : undefined;

  const cashTol = settings.cashDiscrepancyThreshold || 200;
  let safeStatus: DayCloseReconciliationSummary['safeStatus'] = 'missing';
  if (typeof actualSafeCash === 'number') {
    const absD = Math.abs(safeAppVsActualDiff);
    if (absD <= Math.min(50, cashTol / 4)) safeStatus = 'match';
    else if (absD <= cashTol) safeStatus = 'small_diff';
    else safeStatus = 'large_diff';
  }

  // Bucket Reconciliation (H7.3 & H10.3)
  const bucketsResult = {} as DayCloseReconciliationSummary['buckets'];
  for (const bKey of ['rayon', 'bag', 'old_gold', 'other'] as SalesSourceBucket[]) {
    const bCfg = bucketsConfig[bKey] || DEFAULT_SOURCE_BUCKETS_CONFIG[bKey];
    const savedRec: BucketDailyReconciliation =
      dayInfo?.bucketReconciliation?.[bKey] || {};
    const prevRec = prevDayInfo?.bucketReconciliation?.[bKey];

    const beforeG =
      savedRec.beforeG !== undefined
        ? savedRec.beforeG
        : prevRec?.actualG !== undefined
        ? prevRec.actualG
        : bKey === 'rayon' && dayInfo?.openingBalanceG !== undefined
        ? dayInfo.openingBalanceG
        : 0;

    const autoInflowG =
      bKey === 'old_gold'
        ? savedRec.autoInflowG !== undefined
          ? savedRec.autoInflowG
          : autoOldGoldInflowFromPurchasesG
        : bKey === 'rayon'
        ? Number((buyWeightG - autoOldGoldInflowFromPurchasesG).toFixed(3))
        : 0;

    const manualInflowG = savedRec.manualInflowG || 0;
    const totalInflowG = Number((autoInflowG + manualInflowG).toFixed(3));
    const soldG = soldByBucketG[bKey] || 0;
    const expectedG = Number((beforeG + totalInflowG - soldG).toFixed(3));
    const actualG = savedRec.actualG;
    const diffG =
      typeof actualG === 'number' ? Number((actualG - expectedG).toFixed(3)) : 0;
    const diffValueEgp = Math.round(Math.abs(diffG) * dayGoldPrice);

    const tolG = bCfg.toleranceG || settings.goldBalanceToleranceG || 0.25;
    let bStatus: 'match' | 'small_diff' | 'large_diff' | 'missing' = 'missing';
    if (typeof actualG === 'number') {
      const absW = Math.abs(diffG);
      if (absW <= tolG) bStatus = 'match';
      else if (absW <= tolG * 3) bStatus = 'small_diff';
      else bStatus = 'large_diff';
    }

    const piecesBefore =
      savedRec.piecesBefore !== undefined
        ? savedRec.piecesBefore
        : prevRec?.piecesActual || 0;
    const piecesInflow = savedRec.piecesInflow || 0;
    const piecesSold = soldPiecesByBucket[bKey] || 0;
    const piecesExpected = piecesBefore + piecesInflow - piecesSold;
    const piecesActual = savedRec.piecesActual;
    const piecesDiff =
      typeof piecesActual === 'number' ? piecesActual - piecesExpected : 0;

    bucketsResult[bKey] = {
      bucket: bKey,
      name: bCfg.name,
      beforeG,
      autoInflowG,
      manualInflowG,
      totalInflowG,
      soldG,
      expectedG,
      actualG,
      diffG,
      diffValueEgp,
      status: bStatus,
      piecesBefore,
      piecesInflow,
      piecesSold,
      piecesExpected,
      piecesActual,
      piecesDiff,
    };
  }

  // Overall Gold Weight Reconciliation (H10.3)
  const openingTotalGoldG =
    dayInfo?.openingBalanceG !== undefined
      ? dayInfo.openingBalanceG
      : prevDayInfo?.closingBalanceG !== undefined
      ? prevDayInfo.closingBalanceG
      : Number(
          (
            bucketsResult.rayon.beforeG +
            bucketsResult.bag.beforeG +
            bucketsResult.old_gold.beforeG +
            bucketsResult.other.beforeG
          ).toFixed(3)
        );

  const expectedClosingGoldG = Number(
    (openingTotalGoldG + buyWeightG - sellWeightG).toFixed(3)
  );
  const actualClosingGoldG = dayInfo?.closingBalanceG;
  const totalGoldDiffG =
    typeof actualClosingGoldG === 'number'
      ? Number((actualClosingGoldG - expectedClosingGoldG).toFixed(3))
      : 0;

  const goldTol = settings.goldBalanceToleranceG || 0.5;
  let goldStatus: DayCloseReconciliationSummary['goldStatus'] = 'missing';
  if (typeof actualClosingGoldG === 'number') {
    const absG = Math.abs(totalGoldDiffG);
    if (absG <= goldTol) goldStatus = 'match';
    else if (absG <= goldTol * 2.5) goldStatus = 'small_diff';
    else goldStatus = 'large_diff';
  }

  // H10.4: "الذهب ما ينفعش يتباع أكتر من المتاح" — Check total & per-bucket availability and running balance
  const effectiveOpeningForRule =
    ruleMode === 'strict_daily' ? 0 : openingTotalGoldG;
  const totalAvailableForDay = Number(
    (effectiveOpeningForRule + buyWeightG).toFixed(3)
  );
  const exceededTotalAvailable = sellWeightG > totalAvailableForDay + 0.005;

  const exceededBuckets: SalesSourceBucket[] = [];
  for (const bKey of ['old_gold', 'bag', 'rayon'] as SalesSourceBucket[]) {
    const b = bucketsResult[bKey];
    const bOpen = ruleMode === 'strict_daily' ? 0 : b.beforeG;
    const bAvail = bOpen + b.totalInflowG;
    // Flag negative bucket balance when bucket is tracked (or for old_gold/bag whenever soldG > available)
    if (
      b.soldG > bAvail + 0.005 &&
      (bKey === 'old_gold' || bKey === 'bag' || bOpen > 0 || ruleMode === 'strict_daily')
    ) {
      exceededBuckets.push(bKey);
    }
  }

  // Inventory drawdown when sellWeightG > buyWeightG but covered by openingTotalGoldG
  const inventoryDrawdownG =
    sellWeightG > buyWeightG && !exceededTotalAvailable
      ? Number((sellWeightG - buyWeightG).toFixed(3))
      : 0;

  // Running intraday simulation to find the EXACT FIRST ROW where inventory dropped below zero (H10.4 & H-C.2)
  let runningTotalG = effectiveOpeningForRule;
  const runningBucketG: Record<SalesSourceBucket, number> = {
    rayon: ruleMode === 'strict_daily' ? 0 : bucketsResult.rayon.beforeG + bucketsResult.rayon.manualInflowG,
    bag: ruleMode === 'strict_daily' ? 0 : bucketsResult.bag.beforeG + bucketsResult.bag.manualInflowG,
    old_gold: ruleMode === 'strict_daily' ? 0 : bucketsResult.old_gold.beforeG + bucketsResult.old_gold.manualInflowG,
    other: ruleMode === 'strict_daily' ? 0 : bucketsResult.other.beforeG + bucketsResult.other.manualInflowG,
  };

  let firstNegativeRow: DayCloseReconciliationSummary['firstNegativeRow'];

  // If total available for day is exceeded or a bucket is exceeded, scan in chronological sheet & block order
  for (const op of dayOps) {
    if (op.kind === 'buy') {
      runningTotalG = Number((runningTotalG + (op.weightG || 0)).toFixed(3));
      if (autoScrapToOldGold && isScrapOrOldGoldPurchase(op.item)) {
        runningBucketG.old_gold = Number(
          (runningBucketG.old_gold + (op.weightG || 0)).toFixed(3)
        );
      } else {
        runningBucketG.rayon = Number(
          (runningBucketG.rayon + (op.weightG || 0)).toFixed(3)
        );
      }
    } else if (op.kind === 'sell') {
      const bKey: SalesSourceBucket = op.sourceBucket || 'rayon';
      runningTotalG = Number((runningTotalG - (op.weightG || 0)).toFixed(3));
      runningBucketG[bKey] = Number(
        (runningBucketG[bKey] - (op.weightG || 0)).toFixed(3)
      );

      if (!firstNegativeRow) {
        const refText = formatSourceRef(op.sourcePageRef, op.kind, op.date, true);
        if (runningTotalG < -0.005) {
          firstNegativeRow = {
            op,
            sourceRefText: refText,
            deficitG: Math.abs(runningTotalG),
          };
        } else if (
          (bKey === 'old_gold' || bKey === 'bag') &&
          runningBucketG[bKey] < -0.005
        ) {
          firstNegativeRow = {
            op,
            sourceRefText: refText,
            deficitG: Math.abs(runningBucketG[bKey]),
            bucket: bKey,
          };
        }
      }
    }
  }

  // H-C.3: Match freeAreaNotes against Day Close numbers
  const rawFreeNotes = dayInfo?.freeAreaNotes || [];
  const matchedFreeAreaNotes: FreeAreaNote[] = rawFreeNotes.map((note) => {
    const val = note.numericValue;
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return { ...note, matchedField: null };
    }
    const candidates: Array<{
      field: NonNullable<FreeAreaNote['matchedField']>;
      target: number;
      tol: number;
    }> = [
      { field: 'sell_total', target: sellTotalAmount, tol: 50 },
      { field: 'buy_total', target: buyTotalAmount, tol: 50 },
      { field: 'net_cash', target: Math.abs(netCashFlow), tol: 50 },
      { field: 'safe_balance', target: expectedAppSafeCash, tol: 100 },
      { field: 'sell_weight', target: sellWeightG, tol: 0.25 },
      { field: 'buy_weight', target: buyWeightG, tol: 0.25 },
      { field: 'net_weight', target: Math.abs(netWeightDiffG), tol: 0.25 },
    ];
    for (const c of candidates) {
      if (c.target > 0 && Math.abs(val - c.target) <= c.tol) {
        return { ...note, matchedField: c.field };
      }
    }
    return { ...note, matchedField: null };
  });

  const comp = dayInfo?.ledgerTotalsComparison;
  const hasUnapprovedLedgerTotalDiff = Boolean(
    (comp?.sell?.status === 'large_diff' && !comp.sell.approvedByAuditor) ||
      (comp?.buy?.status === 'large_diff' && !comp.buy.approvedByAuditor)
  );

  const requiresLockReason =
    safeStatus === 'large_diff' ||
    goldStatus === 'large_diff' ||
    exceededTotalAvailable ||
    exceededBuckets.length > 0 ||
    Object.values(bucketsResult).some((b) => b.status === 'large_diff');

  return {
    date,
    sellCashAmount,
    sellCreditAmount,
    sellTotalAmount,
    sellWeightG,
    sellPiecesTotal,
    buyCashAmount,
    buyCreditAmount,
    buyTotalAmount,
    buyWeightG,
    netWeightDiffG,
    netWeightDirectionText,
    netCashFlow,
    openingSafeCash,
    expensesCash,
    advancesCash,
    personReceivedCash,
    personGaveCash,
    expectedAppSafeCash,
    actualSafeCash,
    bookOpeningCash,
    bookClosingCash,
    expectedBookSafeCash,
    safeAppVsActualDiff,
    safeBookVsAppDiff,
    safeBookVsActualDiff,
    safeStatus,
    openingTotalGoldG,
    expectedClosingGoldG,
    actualClosingGoldG,
    totalGoldDiffG,
    goldStatus,
    buckets: bucketsResult,
    exceededTotalAvailable,
    exceededBuckets,
    inventoryDrawdownG,
    firstNegativeRow,
    matchedFreeAreaNotes,
    hasUnapprovedLedgerTotalDiff,
    unconfirmedSourceRowsCount,
    requiresLockReason,
  };
}

/**
 * Helper to normalize raw `free_area_notes` returned from Gemini OCR (H-C.3)
 */
export function normalizeFreeAreaNotes(rawNotes: any): FreeAreaNote[] {
  if (!Array.isArray(rawNotes)) return [];
  const out: FreeAreaNote[] = [];
  for (let i = 0; i < rawNotes.length; i++) {
    const item = rawNotes[i];
    if (!item) continue;
    const text = String(typeof item === 'string' ? item : item.text || '').trim();
    if (!text) continue;
    const normDigits = text.replace(/[٠-٩]/g, (d) =>
      String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    );
    const numMatch = normDigits.match(/-?\d+(?:\.\d+)?/);
    const numericValue =
      typeof item.numeric_value === 'number'
        ? item.numeric_value
        : numMatch
        ? Number(numMatch[0])
        : null;
    const rawCat = String(item.suggested_category || item.category || 'note').toLowerCase();
    const suggestedCategory: FreeAreaNote['suggestedCategory'] =
      rawCat === 'sum' || rawCat === 'subtract' || rawCat === 'balance'
        ? rawCat
        : text.includes('+') || text.includes('جمع') || text.includes('إجمالي')
        ? 'sum'
        : text.includes('-') || text.includes('طرح') || text.includes('صافي')
        ? 'subtract'
        : text.includes('رصيد') || text.includes('خزنة')
        ? 'balance'
        : 'note';

    out.push({
      id: item.id || `fan-${i}-${randomSuffix(3)}`,
      text,
      numericValue,
      suggestedCategory,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
      locationHint: item.location_hint || item.locationHint || 'أسفل الصفحة',
    });
  }
  return out;
}

/**
 * Helper to normalize `red_other` items returned from Gemini OCR (H5 البديل)
 */
export function normalizeRedOtherItems(rawItems: any): RedOtherItem[] {
  if (!Array.isArray(rawItems)) return [];
  const out: RedOtherItem[] = [];
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item) continue;
    const text = String(typeof item === 'string' ? item : item.text || '').trim();
    if (!text) continue;
    const normDigits = text.replace(/[٠-٩]/g, (d) =>
      String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    );
    const numMatch = normDigits.match(/-?\d+(?:\.\d+)?/);
    const numericValue =
      typeof item.numeric_value === 'number'
        ? item.numeric_value
        : numMatch
        ? Number(numMatch[0])
        : null;
    const rawCat = String(item.category || 'unclassified').toLowerCase();
    const category: RedOtherItem['category'] =
      rawCat === 'total' || rawCat === 'correction' || rawCat === 'note'
        ? rawCat
        : 'unclassified';

    out.push({
      id: item.id || `ro-${i}-${randomSuffix(3)}`,
      text,
      numericValue,
      category,
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
      locationHint: item.location_hint || item.locationHint || undefined,
    });
  }
  return out;
}
