import { DayInfo, GoldKarat, Person, ShortSpaceWeightMode } from '../types';

const ARABIC_HINDI_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export function normalizeDigits(input: string): string {
  if (!input) return '';
  let out = '';
  for (const ch of String(input)) {
    if (ARABIC_HINDI_DIGITS[ch] !== undefined) {
      out += ARABIC_HINDI_DIGITS[ch];
    } else if (ch === '٫' || ch === ',') {
      out += '.';
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Fix C.13: Checks if a space-separated weight input has an ambiguous short second part (< 3 digits)
 * like "12 5" or "12 50" where the user might mean 12.500 (decimal) or 12.005 (milligrams).
 */
export function inspectAmbiguousSpaceWeight(raw: string): {
  isAmbiguous: boolean;
  decimalVal: number;
  milliVal: number;
  decimalOption: number;
  milliOption: number;
} | null {
  const cleaned = normalizeDigits(raw).trim();
  const spaceParts = cleaned.split(/\s+/);
  if (spaceParts.length === 2) {
    const grams = parseFloat(spaceParts[0]);
    const milliStr = spaceParts[1].replace(/\D/g, '');
    if (!isNaN(grams) && milliStr.length > 0 && milliStr.length < 3) {
      const sign = grams < 0 ? -1 : 1;
      const decVal = parseFloat(`0.${milliStr}`);
      const milVal = parseFloat(milliStr) / 1000;
      const decimalOption = Number((grams + sign * decVal).toFixed(3));
      const milliOption = Number((grams + sign * milVal).toFixed(3));
      if (Math.abs(decimalOption - milliOption) > 0.0005) {
        return {
          isAmbiguous: true,
          decimalVal: decimalOption,
          milliVal: milliOption,
          decimalOption,
          milliOption,
        };
      }
    }
  }
  return null;
}

/**
 * Parses weight input:
 * - Accepts Arabic/English digits
 * - Accepts decimal point or comma ("12.350" or "12,350")
 * - Accepts two numbers separated by space:
 *   If 3 digits after space ("12 350") -> 12.350.
 *   If < 3 digits after space ("12 5"), uses `shortSpaceMode` ('decimal' -> 12.5, 'milli' -> 12.005).
 */
export function parseWeightInput(
  raw: string,
  shortSpaceMode: ShortSpaceWeightMode = 'decimal'
): number {
  const cleaned = normalizeDigits(raw).trim();
  if (!cleaned) return 0;

  const spaceParts = cleaned.split(/\s+/);
  if (spaceParts.length === 2) {
    const grams = parseFloat(spaceParts[0]);
    const milliStr = spaceParts[1].replace(/\D/g, '');
    const milli = parseFloat(milliStr);
    if (!isNaN(grams) && !isNaN(milli) && milliStr.length > 0) {
      const sign = grams < 0 ? -1 : 1;
      if (milliStr.length < 3 && shortSpaceMode !== 'milli') {
        // Treat "12 5" as 12.5 (decimal) unless explicitly configured as 'milli'
        const decFraction = parseFloat(`0.${milliStr}`);
        return Number((grams + sign * decFraction).toFixed(3));
      }
      const fraction = milli >= 1000 ? (milli % 1000) / 1000 : milli / 1000;
      return Number((grams + sign * fraction).toFixed(3));
    }
  }

  const single = parseFloat(cleaned.replace(/[^0-9.-]/g, ''));
  if (isNaN(single)) return 0;
  return Number(single.toFixed(3));
}

/**
 * Returns the effective daily gold price per gram for a given karat (Fix A.1).
 * 21K is mandatory base; 18K and 24K default to proportional calculation if not manually overridden.
 */
export function getEffectiveKaratPrice(
  dayInfo: DayInfo | undefined,
  karat: GoldKarat = 21
): number {
  if (!dayInfo || !dayInfo.goldPricePerGram || dayInfo.goldPricePerGram <= 0) {
    return 0;
  }
  const base21 = dayInfo.goldPricePerGram;
  if (karat === 21) return base21;
  if (karat === 18) {
    return dayInfo.goldPrice18 && dayInfo.goldPrice18 > 0
      ? dayInfo.goldPrice18
      : Math.round((base21 * 18) / 21);
  }
  if (karat === 24) {
    return dayInfo.goldPrice24 && dayInfo.goldPrice24 > 0
      ? dayInfo.goldPrice24
      : Math.round((base21 * 24) / 21);
  }
  return dayInfo.goldPriceOther && dayInfo.goldPriceOther > 0
    ? dayInfo.goldPriceOther
    : base21;
}

/**
 * F4: Converts weight of any karat into 21K-equivalent grams for unified inventory comparison.
 */
export function convertTo21KGrams(weightG: number, karat: GoldKarat = 21): number {
  if (!weightG || isNaN(weightG)) return 0;
  if (karat === 21 || karat === 'other') return weightG;
  if (karat === 18) return Number(((weightG * 18) / 21).toFixed(3));
  if (karat === 24) return Number(((weightG * 24) / 21).toFixed(3));
  return weightG;
}


/**
 * Parses monetary amount input (supports Arabic digits, commas, decimals).
 */
export function parseAmountInput(raw: string): number {
  if (!raw) return 0;
  let out = '';
  for (const ch of String(raw)) {
    if (ARABIC_HINDI_DIGITS[ch] !== undefined) {
      out += ARABIC_HINDI_DIGITS[ch];
    } else if (ch === '٫') {
      out += '.';
    } else {
      out += ch;
    }
  }
  const trimmed = out.trim().replace(/\s+/g, '');
  const normalized = trimmed.replace(/,/g, '.');
  const parts = normalized.split('.');
  let finalStr = normalized;
  if (parts.length > 2) {
    const dec = parts.pop();
    finalStr = parts.join('') + '.' + dec;
  } else if (
    parts.length === 2 &&
    parts[1].length === 3 &&
    Number(parts[0]) >= 1 &&
    !String(raw).includes('.')
  ) {
    finalStr = parts[0] + parts[1];
  }
  const num = parseFloat(finalStr.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
}

export function normalizeArabicName(text: string): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function stringSimilarityDistance(a: string, b: string): number {
  const s1 = normalizeArabicName(a);
  const s2 = normalizeArabicName(b);
  if (s1 === s2) return 0;
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function findSimilarPerson(name: string, persons: Person[]): Person | null {
  const norm = normalizeArabicName(name);
  if (!norm || norm.length < 3) return null;

  for (const p of persons) {
    const pNorm = normalizeArabicName(p.name);
    if (pNorm === norm) return p;
    const dist = stringSimilarityDistance(norm, pNorm);
    if (dist <= 1 || (norm.length >= 6 && dist <= 2)) {
      return p;
    }
  }
  return null;
}

export function isCompoundItem(item?: string): boolean {
  if (!item) return false;
  return item.includes('+') || /\s+و\s+/.test(item) || item.includes('،') || item.includes('&');
}

export function normalizeItemCategory(item?: string): string {
  if (!item || !item.trim()) return '__NO_ITEM__';
  const norm = normalizeArabicName(item);
  if (isCompoundItem(item)) {
    return `COMPOUND:${norm}`;
  }
  return norm;
}

export function parseFlexibleDate(
  raw: unknown,
  order: 'DMY' | 'MDY' = 'DMY'
): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' && raw > 25000 && raw < 70000) {
    const utcDays = Math.floor(raw - 25569);
    const dateObj = new Date(utcDays * 86400 * 1000);
    return dateObj.toISOString().slice(0, 10);
  }

  const str = normalizeDigits(String(raw)).trim();
  if (!str) return null;

  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str, 10);
    if (serial > 25000 && serial < 70000) {
      const utcDays = Math.floor(serial - 25569);
      const dateObj = new Date(utcDays * 86400 * 1000);
      return dateObj.toISOString().slice(0, 10);
    }
  }

  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    const p1 = parseInt(dmyMatch[1], 10);
    const p2 = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += 2000;

    let d = order === 'DMY' ? p1 : p2;
    let m = order === 'DMY' ? p2 : p1;
    if (m > 12 && d <= 12) {
      const tmp = d;
      d = m;
      m = tmp;
    }
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

export function formatNumber(val: number | undefined | null, decimals = 0): string {
  if (val === undefined || val === null || isNaN(val)) return '0';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatWeight(val: number | undefined | null): string {
  if (val === undefined || val === null || isNaN(val)) return '0.000';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function toLocalIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDaysLocalIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalIso(d);
}

export function getTodayIso(): string {
  return toLocalIso(new Date());
}
