import {
  AuditSettings,
  DayInfo,
  GoldKarat,
  Issue,
  KaratKey,
  Operation,
} from '../../types';
import {
  convertTo21KGrams,
  formatNumber,
  formatWeight,
  getEffectiveKaratPrice,
} from '../numerals';

export const KARAT_KEYS: { key: KaratKey; karat: GoldKarat; label: string }[] = [
  { key: '18', karat: 18, label: 'عيار 18' },
  { key: '21', karat: 21, label: 'عيار 21' },
  { key: '24', karat: 24, label: 'عيار 24' },
  { key: 'other', karat: 'other', label: 'عيار آخر' },
];

export interface KaratDayComputed {
  key: KaratKey;
  karat: GoldKarat;
  label: string;
  hasOpening: boolean;
  openingG: number;
  buyG: number;
  sellG: number;
  personInG: number; // received_from_him in grams
  personOutG: number; // gave_him in grams
  expectedClosingG: number;
  hasActualClosing: boolean;
  actualClosingG: number;
  diffG: number; // actualClosingG - expectedClosingG
  karatPrice: number;
  estimatedDiffValueEGP: number; // diffG * karatPrice
}

export interface DayGoldInventorySummary {
  date: string;
  byKarat: Record<KaratKey, KaratDayComputed>;
  // 21K-equivalent totals across all karats
  totalOpening21EqG: number;
  totalBuy21EqG: number;
  totalSell21EqG: number;
  totalPersonNet21EqG: number;
  totalExpected21EqG: number;
  totalActual21EqG: number;
  totalDiff21EqG: number;
  totalDiffValueEGP: number;
  hasAnyKaratData: boolean;
  // Combined legacy / single-number mode
  hasCombinedOpening: boolean;
  combinedOpeningG: number;
  combinedBuyG: number;
  combinedSellG: number;
  combinedPersonInG: number;
  combinedPersonOutG: number;
  combinedExpectedClosingG: number;
  hasCombinedClosing: boolean;
  combinedActualClosingG: number;
  combinedDiffG: number;
  combinedDiffValueEGP: number;
}

export function karatToKey(karat?: GoldKarat): KaratKey {
  if (karat === 18) return '18';
  if (karat === 24) return '24';
  if (karat === 'other') return 'other';
  return '21';
}

/**
 * F4: Computes per-karat and 21K-equivalent gold inventory for a single day:
 * Expected = Opening + Buy - Sell + PersonReceivedG - PersonGivenG
 */
export function computeDayGoldInventory(
  date: string,
  operations: Operation[],
  dayInfo?: DayInfo
): DayGoldInventorySummary {
  const dayOps = operations.filter((o) => o.date === date);

  const movements: Record<
    KaratKey,
    { buyG: number; sellG: number; personInG: number; personOutG: number }
  > = {
    '18': { buyG: 0, sellG: 0, personInG: 0, personOutG: 0 },
    '21': { buyG: 0, sellG: 0, personInG: 0, personOutG: 0 },
    '24': { buyG: 0, sellG: 0, personInG: 0, personOutG: 0 },
    other: { buyG: 0, sellG: 0, personInG: 0, personOutG: 0 },
  };

  let combinedBuyG = 0;
  let combinedSellG = 0;
  let combinedPersonInG = 0;
  let combinedPersonOutG = 0;

  for (const op of dayOps) {
    if (op.weightG <= 0) continue;
    const kKey = karatToKey(op.karat);
    if (op.kind === 'buy') {
      movements[kKey].buyG = Number((movements[kKey].buyG + op.weightG).toFixed(3));
      combinedBuyG = Number((combinedBuyG + op.weightG).toFixed(3));
    } else if (op.kind === 'sell') {
      movements[kKey].sellG = Number((movements[kKey].sellG + op.weightG).toFixed(3));
      combinedSellG = Number((combinedSellG + op.weightG).toFixed(3));
    } else if (op.kind === 'person') {
      if ((op.direction || 'gave_him') === 'received_from_him') {
        movements[kKey].personInG = Number(
          (movements[kKey].personInG + op.weightG).toFixed(3)
        );
        combinedPersonInG = Number((combinedPersonInG + op.weightG).toFixed(3));
      } else {
        movements[kKey].personOutG = Number(
          (movements[kKey].personOutG + op.weightG).toFixed(3)
        );
        combinedPersonOutG = Number((combinedPersonOutG + op.weightG).toFixed(3));
      }
    }
  }

  const byKarat = {} as Record<KaratKey, KaratDayComputed>;
  let totalOpening21EqG = 0;
  let totalBuy21EqG = 0;
  let totalSell21EqG = 0;
  let totalPersonNet21EqG = 0;
  let totalExpected21EqG = 0;
  let totalActual21EqG = 0;
  let totalDiff21EqG = 0;
  let totalDiffValueEGP = 0;
  let hasAnyKaratData = false;

  for (const { key, karat, label } of KARAT_KEYS) {
    const kb = dayInfo?.karatBalances?.[key];
    const hasOpening = kb?.openingG !== undefined && kb?.openingG !== null;
    const hasActualClosing = kb?.closingG !== undefined && kb?.closingG !== null;
    if (hasOpening || hasActualClosing) hasAnyKaratData = true;

    const openingG = kb?.openingG || 0;
    const mv = movements[key];
    const expectedClosingG = Number(
      (openingG + mv.buyG - mv.sellG + mv.personInG - mv.personOutG).toFixed(3)
    );
    const actualClosingG = kb?.closingG || 0;
    const diffG =
      hasOpening && hasActualClosing
        ? Number((actualClosingG - expectedClosingG).toFixed(3))
        : 0;
    const karatPrice = getEffectiveKaratPrice(dayInfo, karat);
    const estimatedDiffValueEGP = Math.round(diffG * karatPrice);

    byKarat[key] = {
      key,
      karat,
      label,
      hasOpening,
      openingG,
      buyG: mv.buyG,
      sellG: mv.sellG,
      personInG: mv.personInG,
      personOutG: mv.personOutG,
      expectedClosingG,
      hasActualClosing,
      actualClosingG,
      diffG,
      karatPrice,
      estimatedDiffValueEGP,
    };

    totalOpening21EqG = Number(
      (totalOpening21EqG + convertTo21KGrams(openingG, karat)).toFixed(3)
    );
    totalBuy21EqG = Number(
      (totalBuy21EqG + convertTo21KGrams(mv.buyG, karat)).toFixed(3)
    );
    totalSell21EqG = Number(
      (totalSell21EqG + convertTo21KGrams(mv.sellG, karat)).toFixed(3)
    );
    totalPersonNet21EqG = Number(
      (
        totalPersonNet21EqG +
        convertTo21KGrams(mv.personInG - mv.personOutG, karat)
      ).toFixed(3)
    );
    totalExpected21EqG = Number(
      (totalExpected21EqG + convertTo21KGrams(expectedClosingG, karat)).toFixed(3)
    );
    totalActual21EqG = Number(
      (totalActual21EqG + convertTo21KGrams(actualClosingG, karat)).toFixed(3)
    );
    if (hasOpening && hasActualClosing) {
      totalDiff21EqG = Number(
        (totalDiff21EqG + convertTo21KGrams(diffG, karat)).toFixed(3)
      );
      totalDiffValueEGP += estimatedDiffValueEGP;
    }
  }

  // Combined mode calculations
  const hasCombinedOpening =
    dayInfo?.openingBalanceG !== undefined && dayInfo?.openingBalanceG !== null;
  const hasCombinedClosing =
    dayInfo?.closingBalanceG !== undefined && dayInfo?.closingBalanceG !== null;
  const combinedOpeningG = dayInfo?.openingBalanceG || 0;
  const combinedExpectedClosingG = Number(
    (
      combinedOpeningG +
      combinedBuyG -
      combinedSellG +
      combinedPersonInG -
      combinedPersonOutG
    ).toFixed(3)
  );
  const combinedActualClosingG = dayInfo?.closingBalanceG || 0;
  const combinedDiffG =
    hasCombinedOpening && hasCombinedClosing
      ? Number((combinedActualClosingG - combinedExpectedClosingG).toFixed(3))
      : 0;
  const price21 = dayInfo?.goldPricePerGram || 0;
  const combinedDiffValueEGP = Math.round(combinedDiffG * price21);

  return {
    date,
    byKarat,
    totalOpening21EqG,
    totalBuy21EqG,
    totalSell21EqG,
    totalPersonNet21EqG,
    totalExpected21EqG,
    totalActual21EqG,
    totalDiff21EqG,
    totalDiffValueEGP,
    hasAnyKaratData,
    hasCombinedOpening,
    combinedOpeningG,
    combinedBuyG,
    combinedSellG,
    combinedPersonInG,
    combinedPersonOutG,
    combinedExpectedClosingG,
    hasCombinedClosing,
    combinedActualClosingG,
    combinedDiffG,
    combinedDiffValueEGP,
  };
}

/**
 * Fix B.4 + F4 (Karat-by-Karat Inventory Check) + F6 (>5% Daily Gold Price Jump Check):
 * - Checks per-karat inventory when karatBalances are used (and !settings.combinedGoldInventory).
 * - Checks combined inventory when openingBalanceG / closingBalanceG are used.
 * - Carryover comparison checks the nearest subsequent active/recorded day.
 * - F6: Checks if a day's 21K gold price differs by >5% from the previous recorded day's price.
 */
export function checkGoldInventoryBalance(
  operations: Operation[],
  daysMap: Record<string, DayInfo>,
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const activeDatesSet = new Set<string>();
  for (const op of operations) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(op.date)) activeDatesSet.add(op.date);
  }
  for (const [d, info] of Object.entries(daysMap)) {
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      (info.openingBalanceG !== undefined ||
        info.closingBalanceG !== undefined ||
        info.karatBalances !== undefined ||
        info.openingCash !== undefined ||
        info.actualCash !== undefined ||
        info.goldPricePerGram > 0)
    ) {
      activeDatesSet.add(d);
    }
  }

  const allDates = Array.from(activeDatesSet).sort();

  // F6: Check if day's goldPricePerGram differs by > 5% from previous recorded price
  const priceDates = allDates.filter(
    (d) => daysMap[d]?.goldPricePerGram > 0 && daysMap[d]?.priceConfirmed !== false
  );
  for (let i = 1; i < priceDates.length; i++) {
    const prevD = priceDates[i - 1];
    const currD = priceDates[i];
    const prevP = daysMap[prevD].goldPricePerGram;
    const currP = daysMap[currD].goldPricePerGram;
    if (prevP > 0 && currP > 0) {
      const pctDiff = (Math.abs(currP - prevP) / prevP) * 100;
      if (pctDiff > 5) {
        issues.push({
          id: `gold-price-jump-${currD}`,
          severity: pctDiff > 12 ? 'high' : 'medium',
          checkType: 'daily_gold_price_jump',
          checkTitle: 'قفزة غير معتادة (>5%) في سعر الذهب اليومي',
          date: currD,
          message: `سعر الذهب عيار 21 في يوم ${currD} (${formatNumber(
            currP
          )} ج.م) يختلف عن اليوم المسجل السابق ${prevD} (${formatNumber(
            prevP
          )} ج.م) بنسبة ${pctDiff.toFixed(1)}% — تحقق من عدم وجود خطأ كتابة.`,
          expected: `~${formatNumber(prevP)} ج.م (±5%)`,
          actual: `${formatNumber(currP)} ج.م`,
          difference: `${currP > prevP ? '+' : ''}${formatNumber(currP - prevP)} ج.م (${pctDiff.toFixed(1)}%)`,
        });
      }
    }
  }

  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i];
    const info = daysMap[d];
    if (!info) continue;

    const summary = computeDayGoldInventory(d, operations, info);

    // 1. Per-Karat Checks (F4) if karatBalances are recorded and not forced to combined-only
    if (!settings.combinedGoldInventory && summary.hasAnyKaratData) {
      for (const { key, label } of KARAT_KEYS) {
        const kStat = summary.byKarat[key];
        const tol =
          settings.karatToleranceG?.[key] ?? settings.goldBalanceToleranceG ?? 0.5;

        if (!kStat.hasOpening && kStat.hasActualClosing) {
          issues.push({
            id: `gold-missing-opening-${d}-${key}`,
            severity: 'low',
            checkType: 'gold_inventory_mismatch',
            checkTitle: 'تنبيه جرد الذهب بالعيار',
            date: d,
            message: `رصيد أول اليوم (${label}) غير مسجل ليوم ${d} رغم تسجيل جرد فعلي بآخر اليوم (${formatWeight(
              kStat.actualClosingG
            )} جرام).`,
            expected: 'تسجيل رصيد أول اليوم',
            actual: 'غير مسجل',
          });
        }

        if (kStat.hasOpening && kStat.hasActualClosing) {
          if (Math.abs(kStat.diffG) > tol) {
            const absVal = Math.abs(kStat.estimatedDiffValueEGP);
            const statusWord = kStat.diffG < 0 ? 'عجز جرد ذهب' : 'زيادة جرد ذهب';
            issues.push({
              id: `gold-balance-mismatch-${d}-${key}`,
              severity: 'high',
              checkType: 'gold_inventory_mismatch',
              checkTitle: 'عدم تطابق جرد الذهب بالعيار',
              date: d,
              message: `${statusWord} (${label}) بمقدار ${formatWeight(
                Math.abs(kStat.diffG)
              )} جرام (المتوقع ${formatWeight(
                kStat.expectedClosingG
              )} جرام، والفعلي ${formatWeight(kStat.actualClosingG)} جرام)${
                absVal > 0 ? ` — قيمته المقدرة ${formatNumber(absVal, 0)} ج.م` : ''
              }.`,
              expected: `${formatWeight(kStat.expectedClosingG)} جرام`,
              actual: `${formatWeight(kStat.actualClosingG)} جرام`,
              difference: `${kStat.diffG > 0 ? '+' : ''}${formatWeight(kStat.diffG)} جرام`,
            });
          }
        }

        // Continuity with nearest subsequent active day for this karat
        if (kStat.hasActualClosing && i + 1 < allDates.length) {
          const nextDate = allDates[i + 1];
          const nextKb = daysMap[nextDate]?.karatBalances?.[key];
          if (nextKb && nextKb.openingG !== undefined && nextKb.openingG !== null) {
            const carryDiff = nextKb.openingG - kStat.actualClosingG;
            if (Math.abs(carryDiff) > tol) {
              issues.push({
                id: `gold-carryover-mismatch-${nextDate}-${key}`,
                severity: 'high',
                checkType: 'gold_inventory_mismatch',
                checkTitle: 'عدم تطابق ترحيل جرد الذهب بالعيار',
                date: nextDate,
                message: `رصيد أول اليوم (${label}: ${formatWeight(
                  nextKb.openingG
                )} جرام) في ${nextDate} لا يطابق الرصيد الختامي لآخر يوم عمل سابق ${d} (${formatWeight(
                  kStat.actualClosingG
                )} جرام) — فرق ${formatWeight(Math.abs(carryDiff))} جرام.`,
                expected: `${formatWeight(kStat.actualClosingG)} جرام`,
                actual: `${formatWeight(nextKb.openingG)} جرام`,
                difference: `${carryDiff > 0 ? '+' : ''}${formatWeight(carryDiff)} جرام`,
              });
            }
          }
        }
      }
    }

    // 2. Combined Balance Check (always runs if openingBalanceG or closingBalanceG is set)
    const hasOpening = summary.hasCombinedOpening;
    const hasClosing = summary.hasCombinedClosing;

    if (!hasOpening && hasClosing) {
      issues.push({
        id: `gold-missing-opening-${d}`,
        severity: 'low',
        checkType: 'gold_inventory_mismatch',
        checkTitle: 'تنبيه جرد الذهب بالجرام',
        date: d,
        message: `رصيد أول اليوم بالجرام غير مسجل ليوم ${d} رغم تسجيل جرد فعلي بآخر اليوم (${formatWeight(
          info?.closingBalanceG
        )} جرام).`,
        expected: 'تسجيل رصيد أول اليوم بالجرام',
        actual: 'غير مسجل',
      });
    }

    if (hasOpening && hasClosing) {
      const expectedClosing = summary.combinedExpectedClosingG;
      const actualClosing = summary.combinedActualClosingG;
      const diff = summary.combinedDiffG;

      if (Math.abs(diff) > settings.goldBalanceToleranceG) {
        const estimatedValue = Math.abs(summary.combinedDiffValueEGP);
        const statusWord = diff < 0 ? 'عجز جرد ذهب' : 'زيادة جرد ذهب';
        issues.push({
          id: `gold-balance-mismatch-${d}`,
          severity: 'high',
          checkType: 'gold_inventory_mismatch',
          checkTitle: 'عدم تطابق جرد الذهب بالجرام',
          date: d,
          message: `${statusWord} بمقدار ${formatWeight(
            Math.abs(diff)
          )} جرام (المتوقع ${formatWeight(expectedClosing)} جرام، والفعلي ${formatWeight(
            actualClosing
          )} جرام)${
            estimatedValue > 0 ? ` — قيمته المقدرة ${formatNumber(estimatedValue, 0)} ج.م` : ''
          }.`,
          expected: `${formatWeight(expectedClosing)} جرام`,
          actual: `${formatWeight(actualClosing)} جرام`,
          difference: `${diff > 0 ? '+' : ''}${formatWeight(diff)} جرام`,
        });
      }
    }

    // Check continuity with nearest subsequent active day (combined)
    if (hasClosing && i + 1 < allDates.length) {
      const nextDate = allDates[i + 1];
      const nextInfo = daysMap[nextDate];
      if (
        nextInfo &&
        nextInfo.openingBalanceG !== undefined &&
        nextInfo.openingBalanceG !== null
      ) {
        const closingToday = info.closingBalanceG || 0;
        const openingNext = nextInfo.openingBalanceG || 0;
        const carryDiff = openingNext - closingToday;
        if (Math.abs(carryDiff) > settings.goldBalanceToleranceG) {
          issues.push({
            id: `gold-carryover-mismatch-${nextDate}`,
            severity: 'high',
            checkType: 'gold_inventory_mismatch',
            checkTitle: 'عدم تطابق جرد الذهب بالجرام',
            date: nextDate,
            message: `رصيد أول اليوم (${formatWeight(
              openingNext
            )} جرام) في ${nextDate} لا يطابق الرصيد الختامي لآخر يوم عمل سابق ${d} (${formatWeight(
              closingToday
            )} جرام) — فرق ${formatWeight(Math.abs(carryDiff))} جرام.`,
            expected: `${formatWeight(closingToday)} جرام`,
            actual: `${formatWeight(openingNext)} جرام`,
            difference: `${carryDiff > 0 ? '+' : ''}${formatWeight(carryDiff)} جرام`,
          });
        }
      }
    }
  }

  return issues;
}
