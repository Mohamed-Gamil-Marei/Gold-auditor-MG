import { parseAmountInput, parseWeightInput } from '../../utils/numerals';

export interface DetectedTableStructure {
  headers: string[];
  dataRows: string[][];
  extractedTotalsRow: {
    rawText: string;
    totalWeightG?: number;
    totalAmount?: number;
  } | null;
  ignoredRowCount: number;
}

const HEADER_KEYWORDS = [
  'تاريخ',
  'يوم',
  'نوع',
  'حركة',
  'عيار',
  'وزن',
  'جرام',
  'ملي',
  'اجمالي',
  'إجمالي',
  'مبلغ',
  'سعر',
  'بيان',
  'صنف',
  'شخص',
  'عميل',
  'دفع',
  'date',
  'type',
  'kind',
  'karat',
  'weight',
  'total',
  'amount',
  'price',
  'item',
];

const TOTAL_ROW_KEYWORDS = [
  'الإجمالي',
  'الاجمالي',
  'إجمالي اليوم',
  'اجمالي اليوم',
  'المجموع',
  'جملة',
  'الرصيد المرحل',
  'رصيد مرحل',
  'total',
  'sum',
];

/**
 * G3.2 (Step 3) & G3.3: Detects header row, filters out repeated headers and empty lines,
 * and separates summary/totals rows (`الإجمالي` / `المجموع`) for comparison rather than importing them as operations.
 */
export function detectTableStructure(rawRows: string[][]): DetectedTableStructure {
  if (!rawRows || rawRows.length === 0) {
    return {
      headers: [],
      dataRows: [],
      extractedTotalsRow: null,
      ignoredRowCount: 0,
    };
  }

  // 1. Find the best header row in the first 12 rows
  let headerRowIdx = 0;
  let bestHeaderScore = -1;

  for (let i = 0; i < Math.min(12, rawRows.length); i++) {
    const row = rawRows[i];
    const nonEmptyCells = row.filter((c) => String(c || '').trim() !== '');
    if (nonEmptyCells.length < 2) continue;

    let keywordMatches = 0;
    for (const cell of nonEmptyCells) {
      const lower = cell.toLowerCase();
      if (HEADER_KEYWORDS.some((kw) => lower.includes(kw))) {
        keywordMatches += 2;
      }
    }
    const score = keywordMatches + nonEmptyCells.length * 0.25;
    if (score > bestHeaderScore) {
      bestHeaderScore = score;
      headerRowIdx = i;
    }
  }

  // If the first row has pure numbers in at least 2 cells and zero header keywords, synthesize headers
  const candidateHeader = rawRows[headerRowIdx] || [];
  const hasAnyKeyword = candidateHeader.some((c) =>
    HEADER_KEYWORDS.some((kw) => String(c || '').toLowerCase().includes(kw))
  );
  const numericCellCountInFirstRow = candidateHeader.filter((c) =>
    /^\d+([.,]\d+)?$/.test(String(c || '').trim())
  ).length;

  let headers: string[] = [];
  let startIdx = headerRowIdx + 1;

  if (!hasAnyKeyword && numericCellCountInFirstRow >= 2) {
    const maxCols = Math.max(...rawRows.map((r) => r.length));
    headers = Array.from({ length: maxCols }, (_, idx) => `عمود ${idx + 1}`);
    startIdx = 0;
  } else {
    const maxCols = Math.max(
      candidateHeader.length,
      ...rawRows.slice(headerRowIdx + 1, headerRowIdx + 30).map((r) => r.length)
    );
    headers = Array.from({ length: maxCols }, (_, idx) => {
      const h = String(candidateHeader[idx] || '').trim();
      return h || `عمود ${idx + 1}`;
    });
  }

  const dataRows: string[][] = [];
  let extractedTotalsRow: DetectedTableStructure['extractedTotalsRow'] = null;
  let ignoredRowCount = headerRowIdx;

  for (let rIdx = startIdx; rIdx < rawRows.length; rIdx++) {
    const row = rawRows[rIdx];
    const nonEmpty = row.map((c) => String(c ?? '').trim()).filter(Boolean);
    if (nonEmpty.length === 0) {
      ignoredRowCount++;
      continue;
    }

    const joined = nonEmpty.join(' ');
    const lowerJoined = joined.toLowerCase();

    // Check if it's a repeated header row
    const isRepeatedHeader =
      nonEmpty.length >= 2 &&
      nonEmpty.every((cell, idx) => cell === headers[idx]) &&
      hasAnyKeyword;
    if (isRepeatedHeader) {
      ignoredRowCount++;
      continue;
    }

    // Check if it's a Totals / Balance Carryover row
    const isTotalsRow = TOTAL_ROW_KEYWORDS.some((kw) => lowerJoined.includes(kw));
    if (isTotalsRow) {
      ignoredRowCount++;
      // Extract numbers from the totals row for comparison in preview
      const nums = nonEmpty
        .map((c) => parseAmountInput(c))
        .filter((n) => Number.isFinite(n) && n > 0);
      const weights = nonEmpty
        .map((c) => parseWeightInput(c))
        .filter((n) => Number.isFinite(n) && n > 0 && n < 10000);
      extractedTotalsRow = {
        rawText: joined,
        totalWeightG: weights.length > 0 ? weights[0] : undefined,
        totalAmount: nums.length > 0 ? Math.max(...nums) : undefined,
      };
      continue;
    }

    dataRows.push(row);
  }

  return {
    headers,
    dataRows,
    extractedTotalsRow,
    ignoredRowCount,
  };
}
