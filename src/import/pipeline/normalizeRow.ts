import { GoldKarat, OperationKind, PaymentType, ShortSpaceWeightMode } from '../../types';
import {
  normalizeDigits,
  parseAmountInput,
  parseFlexibleDate,
  parseWeightInput,
} from '../../utils/numerals';
import { ImportColumnMapping } from './mapColumns';

export interface NormalizedImportRow {
  rowIndex: number;
  rawCells: string[];
  date: string;
  kind: OperationKind;
  item: string;
  karat: GoldKarat;
  weightG: number;
  pricePerGram: number;
  total: number;
  payment: PaymentType;
  personName: string;
  dailyGoldPrice?: number;
  note: string;
  normalizationNotes: string[];
}

export function normalizeArabicDigitsAndSymbols(input: string): string {
  if (!input) return '';
  return normalizeDigits(String(input))
    .replace(/٬/g, ',')
    .replace(/\u200f|\u200e/g, '')
    .trim();
}

export function parseOperationKindFromText(
  raw: string,
  fallbackKind: OperationKind = 'sell'
): OperationKind {
  const s = normalizeArabicDigitsAndSymbols(raw).toLowerCase();
  if (!s) return fallbackKind;
  if (/(بيع|مبيعات|منصرف|صادر|خارجة|sale|sell)/.test(s)) return 'sell';
  if (/(شراء|مشتريات|وارد|كسر|شرا|buy|purchase)/.test(s)) return 'buy';
  if (/(مصروف|مصاريف|نفقة|ايجار|إيجار|كهرباء|expense)/.test(s)) return 'expense';
  if (/(سلفة|سلف|عامل|يومية|راتب|advance|worker|salary)/.test(s)) return 'advance';
  if (/(شخص|عميل|مورد|مديون|آجل|اجل|دين|سداد|عربون|دفعة|person|debt|credit)/.test(s)) {
    return 'person';
  }
  return fallbackKind;
}

export function parseGoldKaratFromText(
  raw: string,
  fallbackKarat: GoldKarat = 21
): GoldKarat {
  const s = normalizeArabicDigitsAndSymbols(raw);
  if (!s) return fallbackKarat;
  if (s.includes('24')) return 24;
  if (s.includes('18')) return 18;
  if (s.includes('21')) return 21;
  if (s.includes('22') || s.includes('14') || s.includes('آخر') || s.includes('اخر')) {
    return 'other';
  }
  return fallbackKarat;
}

export function parsePaymentTypeFromText(raw: string): PaymentType {
  const s = normalizeArabicDigitsAndSymbols(raw).toLowerCase();
  if (/(آجل|اجل|ذمم|دين|مديونية|متبقي|credit)/.test(s)) return 'credit';
  return 'cash';
}

export function normalizeDataRows(
  dataRows: string[][],
  colMap: ImportColumnMapping,
  options: {
    defaultDate: string;
    defaultKarat: GoldKarat;
    defaultKind: OperationKind;
    explicitKind?: 'buy' | 'sell' | '';
    dateFormatOrder?: 'DMY' | 'MDY';
    shortSpaceWeightMode?: ShortSpaceWeightMode;
  }
): NormalizedImportRow[] {
  const getCell = (row: string[], colIdx: number): string => {
    if (colIdx < 0 || colIdx >= row.length) return '';
    return String(row[colIdx] ?? '').trim();
  };

  return dataRows.map((row, idx) => {
    const notesList: string[] = [];

    // 1. Date
    const rawDate = getCell(row, colMap.dateCol);
    let resolvedDate = options.defaultDate;
    if (rawDate) {
      const parsed = parseFlexibleDate(rawDate, options.dateFormatOrder || 'DMY');
      if (parsed) {
        resolvedDate = parsed;
      } else {
        notesList.push(`تعذر تفسير التاريخ (${rawDate}) — استُخدم ${options.defaultDate}`);
      }
    }

    // 2. Kind
    const rawKind = getCell(row, colMap.kindCol);
    const kind: OperationKind =
      options.explicitKind === 'buy' || options.explicitKind === 'sell'
        ? options.explicitKind
        : parseOperationKindFromText(rawKind, options.defaultKind);

    // 3. Karat
    const rawKarat = getCell(row, colMap.karatCol);
    const karat = parseGoldKaratFromText(rawKarat, options.defaultKarat);

    // 4. Weight (either separate weightCol + milliCol or single weightCol)
    const rawWeight = getCell(row, colMap.weightCol);
    const rawMilli = getCell(row, colMap.milliCol);
    let weightG = 0;

    if (colMap.milliCol >= 0 && rawMilli) {
      const g = Math.max(0, Math.floor(parseAmountInput(rawWeight)));
      const m = Math.max(0, Math.floor(parseAmountInput(rawMilli)));
      weightG = Number((g + m / 1000).toFixed(3));
      notesList.push(`تم دمج عمودي الجرام (${g}) والملي (${m}) = ${weightG}`);
    } else if (rawWeight) {
      weightG = Math.max(
        0,
        parseWeightInput(rawWeight, options.shortSpaceWeightMode || 'decimal')
      );
    }

    // 5. Total & Gram Price
    const rawTotal = getCell(row, colMap.totalCol);
    const rawGramPrice = getCell(row, colMap.gramPriceCol);
    let total = Math.max(0, Math.round(parseAmountInput(rawTotal)));
    let pricePerGram = Math.max(0, Math.round(parseAmountInput(rawGramPrice)));

    if ((kind === 'buy' || kind === 'sell') && weightG > 0) {
      if (total === 0 && pricePerGram > 0) {
        total = Math.round(weightG * pricePerGram);
        notesList.push(`حُسب الإجمالي تلقائياً (${total})`);
      } else if (pricePerGram === 0 && total > 0) {
        pricePerGram = Math.round(total / weightG);
      }
    }

    // 6. Daily Gold Price (optional column)
    const rawDailyPrice = getCell(row, colMap.dailyGoldPriceCol);
    const dailyGoldPrice = rawDailyPrice
      ? Math.max(0, Math.round(parseAmountInput(rawDailyPrice)))
      : undefined;

    // 7. Payment, Item, Person, Note
    const rawPayment = getCell(row, colMap.paymentCol);
    const payment = rawPayment ? parsePaymentTypeFromText(rawPayment) : 'cash';
    const item = normalizeArabicDigitsAndSymbols(getCell(row, colMap.itemCol));
    const personName = normalizeArabicDigitsAndSymbols(getCell(row, colMap.personCol));
    const note = normalizeArabicDigitsAndSymbols(getCell(row, colMap.noteCol));

    return {
      rowIndex: idx,
      rawCells: row,
      date: resolvedDate,
      kind,
      item,
      karat,
      weightG,
      pricePerGram,
      total,
      payment,
      personName,
      dailyGoldPrice: dailyGoldPrice && dailyGoldPrice > 0 ? dailyGoldPrice : undefined,
      note,
      normalizationNotes: notesList,
    };
  });
}
