import {
  AuditSettings,
  DayInfo,
  GoldKarat,
  Operation,
  Person,
} from '../types';
import {
  formatNumber,
  formatWeight,
  getEffectiveKaratPrice,
  getTodayIso,
  normalizeArabicName,
} from './numerals';
import { computeDaySafeSummary } from './checks/checkDailySafe';

export type FixItCategory =
  | 'zero_typo_price'
  | 'zero_typo_weight'
  | 'swapped_weight_total'
  | 'wrong_year_date'
  | 'duplicate_person'
  | 'missing_karat'
  | 'missing_day_price'
  | 'safe_adjustment'
  | 'gold_adjustment';

export interface FixItSuggestion {
  id: string;
  category: FixItCategory;
  safeToAutoApply: boolean;
  date: string;
  isDayLocked: boolean;
  title: string;
  description: string;
  oldValueLabel: string;
  newValueLabel: string;
  // Payload for applying the fix
  operationId?: string;
  operationPatch?: Partial<Operation>;
  primaryPersonId?: string;
  duplicatePersonId?: string;
  dayPriceToSet?: number;
  adjustmentOperationToCreate?: Omit<
    Operation,
    'id' | 'createdAt' | 'updatedAt' | 'reviewedFlag' | 'note'
  > & { note: string; reviewedFlag: boolean };
}

export interface FastEntryInlineTypoHint {
  hasTypo: boolean;
  message: string;
  suggestedWeightG: number;
  suggestedTotal: number;
  suggestedGramPrice: number;
}

/**
 * G1.8: Inline Fast-Entry Typo Suggestion Detector
 * Triggered only when there is a high-probability typo (e.g., gram price > 5x or < 1/5th of daily price,
 * or weight and total are swapped).
 */
export function detectFastEntryInlineTypo(params: {
  kind: Operation['kind'];
  karat: GoldKarat;
  weightG: number;
  total: number;
  dayInfo: DayInfo;
}): FastEntryInlineTypoHint | null {
  const { kind, karat, weightG, total, dayInfo } = params;
  if (kind !== 'buy' && kind !== 'sell') return null;
  if (weightG <= 0 || total <= 0) return null;

  const refPrice = getEffectiveKaratPrice(dayInfo, karat) || dayInfo.goldPricePerGram || 0;
  if (refPrice <= 0) return null;

  const actualGramPrice = total / weightG;

  // Case 1: Swapped weight and total (e.g. weightG = 38000, total = 5)
  if (weightG > 1000 && total < 500) {
    const swappedGramPrice = weightG / total;
    if (swappedGramPrice > refPrice * 0.5 && swappedGramPrice < refPrice * 2.0) {
      return {
        hasTypo: true,
        message: `يبدو أن الوزن والمبلغ معكوسان! تقصد وزن ${formatWeight(total)} جرام ومبلغ ${formatNumber(
          weightG
        )} ج.م (سعر الجرام ${formatNumber(Math.round(swappedGramPrice))})؟ Enter للتصحيح، Esc للإبقاء`,
        suggestedWeightG: total,
        suggestedTotal: weightG,
        suggestedGramPrice: Math.round(swappedGramPrice),
      };
    }
  }

  // Case 2: Extra zero in total (gram price ~10x daily price, > 5x)
  if (actualGramPrice > refPrice * 5) {
    const div10Total = Math.round(total / 10);
    const div10GramPrice = div10Total / weightG;
    if (div10GramPrice >= refPrice * 0.65 && div10GramPrice <= refPrice * 1.45) {
      return {
        hasTypo: true,
        message: `سعر الجرام (${formatNumber(
          Math.round(actualGramPrice)
        )}) أعلى 10 أضعاف المعتاد! تقصد مبلغ ${formatNumber(
          div10Total
        )} ج.م (سعر الجرام ${formatNumber(Math.round(div10GramPrice))})؟ Enter للتصحيح، Esc للإبقاء`,
        suggestedWeightG: weightG,
        suggestedTotal: div10Total,
        suggestedGramPrice: Math.round(div10GramPrice),
      };
    }

    // Or missing decimal in weight (e.g. weight 1.25 entered as 0.125)
    const mul10Weight = Number((weightG * 10).toFixed(3));
    const mul10GramPrice = total / mul10Weight;
    if (mul10GramPrice >= refPrice * 0.65 && mul10GramPrice <= refPrice * 1.45) {
      return {
        hasTypo: true,
        message: `سعر الجرام (${formatNumber(
          Math.round(actualGramPrice)
        )}) مرتفع جداً! تقصد وزن ${formatWeight(mul10Weight)} جرام (سعر الجرام ${formatNumber(
          Math.round(mul10GramPrice)
        )})؟ Enter للتصحيح، Esc للإبقاء`,
        suggestedWeightG: mul10Weight,
        suggestedTotal: total,
        suggestedGramPrice: Math.round(mul10GramPrice),
      };
    }
  }

  // Case 3: Missing zero in total OR extra zero in weight (gram price < 1/5th of daily price)
  if (actualGramPrice < refPrice * 0.2) {
    // Check if weight had an extra zero (e.g. 120g instead of 12.0g)
    const div10Weight = Number((weightG / 10).toFixed(3));
    const div10WeightGramPrice = div10Weight > 0 ? total / div10Weight : 0;
    if (div10Weight >= 0.1 && div10WeightGramPrice >= refPrice * 0.65 && div10WeightGramPrice <= refPrice * 1.45) {
      return {
        hasTypo: true,
        message: `سعر الجرام (${formatNumber(
          Math.round(actualGramPrice)
        )}) منخفض جداً! تقصد وزن ${formatWeight(div10Weight)} جرام بدلاً من ${formatWeight(
          weightG
        )} (سعر الجرام ${formatNumber(Math.round(div10WeightGramPrice))})؟ Enter للتصحيح، Esc للإبقاء`,
        suggestedWeightG: div10Weight,
        suggestedTotal: total,
        suggestedGramPrice: Math.round(div10WeightGramPrice),
      };
    }

    // Or missing zero in total (e.g. 7500 instead of 75000)
    const mul10Total = Math.round(total * 10);
    const mul10GramPrice = mul10Total / weightG;
    if (mul10GramPrice >= refPrice * 0.65 && mul10GramPrice <= refPrice * 1.45) {
      return {
        hasTypo: true,
        message: `سعر الجرام (${formatNumber(
          Math.round(actualGramPrice)
        )}) أقل بـ 10 مرات من المعتاد! تقصد مبلغ ${formatNumber(
          mul10Total
        )} ج.م (سعر الجرام ${formatNumber(Math.round(mul10GramPrice))})؟ Enter للتصحيح، Esc للإبقاء`,
        suggestedWeightG: weightG,
        suggestedTotal: mul10Total,
        suggestedGramPrice: Math.round(mul10GramPrice),
      };
    }
  }

  return null;
}

/**
 * G1.7: Scans the entire dataset for common human entry mistakes and generates previewable Fix-It suggestions.
 */
export function scanForFixItSuggestions(params: {
  operations: Operation[];
  daysMap: Record<string, DayInfo>;
  persons: Person[];
  settings: AuditSettings;
}): FixItSuggestion[] {
  const { operations, daysMap, persons, settings } = params;
  const suggestions: FixItSuggestion[] = [];

  // Determine dominant year across operations (e.g., 2026)
  const yearCounts = new Map<string, number>();
  for (const op of operations) {
    const yr = op.date?.slice(0, 4);
    if (/^\d{4}$/.test(yr)) {
      yearCounts.set(yr, (yearCounts.get(yr) || 0) + 1);
    }
  }
  let dominantYear = new Date().getFullYear().toString();
  let maxYrCount = 0;
  for (const [yr, cnt] of yearCounts.entries()) {
    if (cnt > maxYrCount) {
      maxYrCount = cnt;
      dominantYear = yr;
    }
  }

  // Helper to find nearest confirmed gold price
  const sortedPricedDates = Object.keys(daysMap)
    .filter((d) => daysMap[d]?.goldPricePerGram > 0)
    .sort();

  const getNearestPriceForDate = (targetDate: string): number => {
    if (daysMap[targetDate]?.goldPricePerGram > 0) {
      return daysMap[targetDate].goldPricePerGram;
    }
    if (sortedPricedDates.length === 0) return 3800;
    const prior = sortedPricedDates.filter((d) => d <= targetDate);
    const best =
      prior.length > 0 ? prior[prior.length - 1] : sortedPricedDates[0];
    return daysMap[best]?.goldPricePerGram || 3800;
  };

  // 1. Check Days Missing Daily Gold Price
  const tradeDates = new Set<string>();
  for (const op of operations) {
    if (op.kind === 'buy' || op.kind === 'sell') {
      tradeDates.add(op.date);
    }
  }

  for (const dt of Array.from(tradeDates).sort()) {
    const dInfo = daysMap[dt];
    if (!dInfo || !dInfo.goldPricePerGram || dInfo.goldPricePerGram <= 0) {
      const nearestPrice = getNearestPriceForDate(dt);
      if (nearestPrice > 0) {
        suggestions.push({
          id: `fix-dayprice-${dt}`,
          category: 'missing_day_price',
          safeToAutoApply: true,
          date: dt,
          isDayLocked: Boolean(dInfo?.locked),
          title: `يوم ${dt} بدون سعر ذهب مسجل`,
          description: `توجد عمليات بيع/شراء في يوم ${dt} بدون سعر ذهب يومي. نقترح نسخ أقرب سعر معروف (${formatNumber(
            nearestPrice
          )} ج.م/جرام).`,
          oldValueLabel: 'غير مسجل (0 ج.م)',
          newValueLabel: `${formatNumber(nearestPrice)} ج.م/جرام`,
          dayPriceToSet: nearestPrice,
        });
      }
    }
  }

  // 2. Scan Operations for Typos (Extra/Missing Zero, Swapped Weight/Total, Wrong Year, Missing Karat)
  for (const op of operations) {
    const dayInfo = daysMap[op.date] || {
      date: op.date,
      goldPricePerGram: getNearestPriceForDate(op.date),
      locked: false,
    };
    const isLocked = Boolean(dayInfo.locked);

    // 2a. Missing Karat on buy/sell
    if ((op.kind === 'buy' || op.kind === 'sell') && !op.karat) {
      suggestions.push({
        id: `fix-karat-${op.id}`,
        category: 'missing_karat',
        safeToAutoApply: true,
        date: op.date,
        isDayLocked: isLocked,
        title: `عملية بدون عيار محدد (${op.date})`,
        description: `عملية ${op.kind === 'sell' ? 'بيع' : 'شراء'} (${
          op.item || 'بدون بيان'
        }) لم يُحدد لها العيار؛ نقترح ضبطها على العيار الافتراضي 21.`,
        oldValueLabel: 'غير محدد',
        newValueLabel: 'عيار 21',
        operationId: op.id,
        operationPatch: { karat: 21 },
      });
    }

    // 2b. Wrong Year in Date (e.g. 2025 instead of 2026 when >85% of ops are in dominantYear)
    const opYear = op.date?.slice(0, 4);
    if (
      operations.length >= 5 &&
      maxYrCount >= operations.length * 0.7 &&
      opYear &&
      opYear !== dominantYear &&
      Math.abs(Number(opYear) - Number(dominantYear)) >= 1
    ) {
      const correctedDate = `${dominantYear}${op.date.slice(4)}`;
      suggestions.push({
        id: `fix-year-${op.id}`,
        category: 'wrong_year_date',
        safeToAutoApply: false,
        date: op.date,
        isDayLocked: isLocked || Boolean(daysMap[correctedDate]?.locked),
        title: `سنة التاريخ غير معتادة (${op.date})`,
        description: `أغلب عمليات الدفتر في سنة ${dominantYear} بينما هذه العملية مسجلة في سنة ${opYear}. هل تقصد ${correctedDate}؟`,
        oldValueLabel: op.date,
        newValueLabel: correctedDate,
        operationId: op.id,
        operationPatch: { date: correctedDate },
      });
    }

    // 2c. Weight / Price Zero Typos & Swapped Weight/Price
    if (op.kind === 'buy' || op.kind === 'sell') {
      const typo = detectFastEntryInlineTypo({
        kind: op.kind,
        karat: op.karat || 21,
        weightG: op.weightG,
        total: op.total,
        dayInfo,
      });

      if (typo && typo.hasTypo) {
        const curGram = op.weightG > 0 ? Math.round(op.total / op.weightG) : 0;
        const isWeightChange = Math.abs(typo.suggestedWeightG - op.weightG) > 0.001;
        const isTotalChange = Math.abs(typo.suggestedTotal - op.total) > 0.5;

        let category: FixItCategory = 'zero_typo_price';
        if (isWeightChange && isTotalChange) category = 'swapped_weight_total';
        else if (isWeightChange) category = 'zero_typo_weight';

        suggestions.push({
          id: `fix-typo-${op.id}`,
          category,
          safeToAutoApply: true,
          date: op.date,
          isDayLocked: isLocked,
          title:
            category === 'swapped_weight_total'
              ? `انعكاس الوزن والمبلغ في عملية (${op.date})`
              : category === 'zero_typo_weight'
              ? `خطأ محتمل في العلامة العشرية للوزن (${op.date})`
              : `صفر زائد أو ناقص في المبلغ (${op.date})`,
          description: `سعر الجرام المسجل (${formatNumber(
            curGram
          )} ج.م) بعيد بنحو 10 أضعاف عن المعتاد، تقصد سعر جرام ${formatNumber(
            typo.suggestedGramPrice
          )} ج.م؟ (${op.item || 'بدون بيان'})`,
          oldValueLabel: `وزن ${formatWeight(op.weightG)} ج — مبلغ ${formatNumber(
            op.total
          )} ج.م (${formatNumber(curGram)}/ج)`,
          newValueLabel: `وزن ${formatWeight(
            typo.suggestedWeightG
          )} ج — مبلغ ${formatNumber(typo.suggestedTotal)} ج.م (${formatNumber(
            typo.suggestedGramPrice
          )}/ج)`,
          operationId: op.id,
          operationPatch: {
            weightG: typo.suggestedWeightG,
            total: typo.suggestedTotal,
          },
        });
      }
    }
  }

  // 3. Duplicate Person Names with Minor Spelling Differences
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const p1 = persons[i];
      const p2 = persons[j];
      const n1 = normalizeArabicName(p1.name);
      const n2 = normalizeArabicName(p2.name);
      if (
        n1 &&
        n2 &&
        (n1 === n2 ||
          (n1.length >= 5 && n2.length >= 5 && (n1.includes(n2) || n2.includes(n1))))
      ) {
        suggestions.push({
          id: `fix-dup-person-${p1.id}-${p2.id}`,
          category: 'duplicate_person',
          safeToAutoApply: false,
          date: getTodayIso(),
          isDayLocked: false,
          title: `اشتباه تكرار اسم شخص: "${p1.name}" و "${p2.name}"`,
          description: `الاسمان متطابقان إملائياً بعد توحيد الهمزات والتاء المربوطة. يمكنك دمجهما في حساب واحد مع نقل كافة العمليات.`,
          oldValueLabel: `حسابان منفصلان (${p1.name} + ${p2.name})`,
          newValueLabel: `حساب موحد باسم "${p1.name}"`,
          primaryPersonId: p1.id,
          duplicatePersonId: p2.id,
        });
      }
    }
  }

  // 4. Small Safe Cash Discrepancies Resolvable via Documented Adjustment Entry (تسوية)
  for (const [dt, dInfo] of Object.entries(daysMap)) {
    const safeSum = computeDaySafeSummary(dt, operations, dInfo);
    if (
      safeSum.hasOpening &&
      safeSum.hasActual &&
      Math.abs(safeSum.difference) > 0 &&
      Math.abs(safeSum.difference) <= Math.max(500, settings.cashDiscrepancyThreshold * 2)
    ) {
      // Only suggest if there isn't already an adjustment entry on this day
      const alreadyAdjusted = operations.some(
        (o) => o.date === dt && o.note?.includes('قيد تسوية فروق خزنة')
      );
      if (!alreadyAdjusted && safeSum.difference < 0) {
        const deficitAmount = Math.abs(safeSum.difference);
        suggestions.push({
          id: `fix-safe-adj-${dt}`,
          category: 'safe_adjustment',
          safeToAutoApply: false,
          date: dt,
          isDayLocked: Boolean(dInfo.locked),
          title: `تسوية فرق بسيط في خزنة يوم ${dt}`,
          description: `يوجد فرق نقدي بسيط (${formatNumber(
            deficitAmount
          )} ج.م عجز) في خزنة يوم ${dt}. يمكن معالجته بإضافة قيد مصروف "تسوية فروق خزنة" موثق بدون تعديل أو حذف أي عملية أصلية.`,
          oldValueLabel: `عجز خزنة ${formatNumber(deficitAmount)} ج.م`,
          newValueLabel: `إضافة قيد تسوية بمبلغ ${formatNumber(deficitAmount)} ج.م (تتطابق الخزنة 0 فرق)`,
          adjustmentOperationToCreate: {
            date: dt,
            kind: 'expense',
            category: 'أخرى',
            item: `تسوية فروق خزنة يومية (${dt})`,
            weightG: 0,
            total: deficitAmount,
            payment: 'cash',
            reviewedFlag: true,
            note: 'قيد تسوية فروق خزنة موثق عبر أداة تصحيح الأخطاء الشائعة',
          },
        });
      }
    }
  }

  return suggestions;
}
