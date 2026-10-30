import { normalizeArabicName } from '../utils/numerals';

export interface ItemNormalizationRule {
  id: string;
  rawVariant: string;
  canonicalName: string;
  count: number;
  updatedAt: number;
}

export interface DigitConfusionRule {
  id: string;
  fromDigit: string;
  toDigit: string;
  count: number;
  updatedAt: number;
}

export interface LocalCorrectionDictionary {
  items: ItemNormalizationRule[];
  digitConfusions: DigitConfusionRule[];
}

const DICTIONARY_STORAGE_KEY = 'gold_audit_ocr_correction_dict_v1';

const DEFAULT_ITEM_RULES: ItemNormalizationRule[] = [
  { id: 'def-1', rawVariant: 'غويشه', canonicalName: 'غويشة', count: 5, updatedAt: 1700000000000 },
  { id: 'def-2', rawVariant: 'غوايش', canonicalName: 'غويشة', count: 4, updatedAt: 1700000000000 },
  { id: 'def-3', rawVariant: 'دبله', canonicalName: 'دبلة', count: 5, updatedAt: 1700000000000 },
  { id: 'def-4', rawVariant: 'سبكه', canonicalName: 'سبيكة', count: 4, updatedAt: 1700000000000 },
  { id: 'def-5', rawVariant: 'سبيكه', canonicalName: 'سبيكة', count: 4, updatedAt: 1700000000000 },
  { id: 'def-6', rawVariant: 'سلسله', canonicalName: 'سلسلة', count: 4, updatedAt: 1700000000000 },
  { id: 'def-7', rawVariant: 'انسيال', canonicalName: 'إنسيال', count: 3, updatedAt: 1700000000000 },
  { id: 'def-8', rawVariant: 'لازوردى', canonicalName: 'لازوردي', count: 3, updatedAt: 1700000000000 },
];

const DEFAULT_DIGIT_CONFUSIONS: DigitConfusionRule[] = [
  { id: 'dig-3-7', fromDigit: '3', toDigit: '7', count: 3, updatedAt: 1700000000000 },
  { id: 'dig-4-9', fromDigit: '4', toDigit: '9', count: 3, updatedAt: 1700000000000 },
  { id: 'dig-0-5', fromDigit: '0', toDigit: '5', count: 3, updatedAt: 1700000000000 },
  { id: 'dig-2-3', fromDigit: '2', toDigit: '3', count: 2, updatedAt: 1700000000000 },
];

export function loadCorrectionDictionary(): LocalCorrectionDictionary {
  try {
    if (typeof localStorage === 'undefined') {
      return { items: DEFAULT_ITEM_RULES, digitConfusions: DEFAULT_DIGIT_CONFUSIONS };
    }
    const raw = localStorage.getItem(DICTIONARY_STORAGE_KEY);
    if (!raw) {
      return { items: DEFAULT_ITEM_RULES, digitConfusions: DEFAULT_DIGIT_CONFUSIONS };
    }
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : DEFAULT_ITEM_RULES,
      digitConfusions:
        Array.isArray(parsed.digitConfusions) && parsed.digitConfusions.length > 0
          ? parsed.digitConfusions
          : DEFAULT_DIGIT_CONFUSIONS,
    };
  } catch {
    return { items: DEFAULT_ITEM_RULES, digitConfusions: DEFAULT_DIGIT_CONFUSIONS };
  }
}

export function saveCorrectionDictionary(dict: LocalCorrectionDictionary): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(dict));
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Applies learned item normalization rules to a raw OCR item string
 */
export function applyDictionaryToItemName(
  rawItem: string,
  dict = loadCorrectionDictionary()
): string {
  const trimmed = (rawItem || '').trim();
  if (!trimmed) return '';

  const normInput = normalizeArabicName(trimmed);
  for (const rule of dict.items) {
    if (normalizeArabicName(rule.rawVariant) === normInput) {
      return rule.canonicalName;
    }
  }
  return trimmed;
}

/**
 * P3: Learns an item correction when the user edits an OCR-read item in preview
 */
export function learnItemCorrection(rawReadItem: string, correctedItem: string): LocalCorrectionDictionary {
  const dict = loadCorrectionDictionary();
  const a = (rawReadItem || '').trim();
  const b = (correctedItem || '').trim();
  if (!a || !b || a === b || a.length > 35 || b.length > 35) return dict;

  const existingIdx = dict.items.findIndex(
    (r) => normalizeArabicName(r.rawVariant) === normalizeArabicName(a)
  );
  if (existingIdx >= 0) {
    dict.items[existingIdx] = {
      ...dict.items[existingIdx],
      canonicalName: b,
      count: dict.items[existingIdx].count + 1,
      updatedAt: Date.now(),
    };
  } else {
    dict.items.unshift({
      id: `item-${Date.now()}`,
      rawVariant: a,
      canonicalName: b,
      count: 1,
      updatedAt: Date.now(),
    });
  }
  saveCorrectionDictionary(dict);
  return dict;
}

/**
 * P3: Learns single-digit confusion when the user edits a number in preview
 */
export function learnDigitCorrection(oldVal: number, newVal: number): LocalCorrectionDictionary {
  const dict = loadCorrectionDictionary();
  const s1 = String(oldVal || '');
  const s2 = String(newVal || '');
  if (s1.length !== s2.length || s1 === s2) return dict;

  let diffCount = 0;
  let fromD = '';
  let toD = '';
  for (let i = 0; i < s1.length; i++) {
    if (s1[i] !== s2[i]) {
      diffCount++;
      fromD = s1[i];
      toD = s2[i];
    }
  }

  if (diffCount === 1 && /\d/.test(fromD) && /\d/.test(toD)) {
    const existingIdx = dict.digitConfusions.findIndex(
      (d) => d.fromDigit === fromD && d.toDigit === toD
    );
    if (existingIdx >= 0) {
      dict.digitConfusions[existingIdx].count += 1;
      dict.digitConfusions[existingIdx].updatedAt = Date.now();
    } else {
      dict.digitConfusions.unshift({
        id: `dig-${fromD}-${toD}-${Date.now()}`,
        fromDigit: fromD,
        toDigit: toD,
        count: 1,
        updatedAt: Date.now(),
      });
    }
    saveCorrectionDictionary(dict);
  }
  return dict;
}

/**
 * P3: Suggests alternative number based on recurring digit confusions if implied price is closer to daily gold price
 */
export function suggestDigitConfusionFix(
  readTotal: number,
  weightG: number,
  dayGoldPrice: number,
  dict = loadCorrectionDictionary()
): { suggestedTotal: number; reason: string } | null {
  if (readTotal <= 0 || weightG <= 0 || dayGoldPrice <= 0) return null;
  const expectedTotal = weightG * dayGoldPrice;
  const currentErr = Math.abs(readTotal - expectedTotal) / expectedTotal;
  if (currentErr < 0.08) return null; // already reasonable

  const strTotal = String(Math.round(readTotal));
  const activeConfusions = dict.digitConfusions.filter((c) => c.count >= 2);

  for (const conf of activeConfusions) {
    for (let i = 0; i < strTotal.length; i++) {
      if (strTotal[i] === conf.fromDigit) {
        const candidateStr =
          strTotal.slice(0, i) + conf.toDigit + strTotal.slice(i + 1);
        const candidateNum = Number(candidateStr);
        if (candidateNum > 0) {
          const newErr = Math.abs(candidateNum - expectedTotal) / expectedTotal;
          if (newErr < 0.05 && newErr < currentErr * 0.4) {
            return {
              suggestedTotal: candidateNum,
              reason: `تصحيح مقترح من قاموس الأرقام المتشابهة (استبدال ${conf.fromDigit} بـ ${conf.toDigit})`,
            };
          }
        }
      }
    }
  }
  return null;
}

/**
 * P3: Builds privacy-safe few-shot instructions for Gemini OCR prompt
 * (NEVER includes person names, dates, or financial amounts)
 */
export function buildDictionaryPromptHints(dict = loadCorrectionDictionary()): string {
  const topItems = dict.items
    .slice(0, 15)
    .map((r) => `"${r.rawVariant}" ← اكتبها "${r.canonicalName}"`)
    .join(' ، ');

  const topDigits = dict.digitConfusions
    .filter((d) => d.count >= 2)
    .slice(0, 6)
    .map((d) => `انتبه من خلط الرقم (${d.fromDigit}) مع (${d.toDigit}) في خط اليد`)
    .join(' ؛ ');

  const lines: string[] = [];
  if (topItems) {
    lines.push(`- توحيد مسميات الأصناف الشائعة: ${topItems}.`);
  }
  if (topDigits) {
    lines.push(`- تنبيهات أرقام متكررة في خط هذا الدفتر: ${topDigits}.`);
  }
  return lines.join('\n');
}
