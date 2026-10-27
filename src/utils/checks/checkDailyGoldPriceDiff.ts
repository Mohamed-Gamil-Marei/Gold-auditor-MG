import { AuditSettings, DayInfo, Issue, Operation } from '../../types';
import { formatNumber, getEffectiveKaratPrice } from '../numerals';

/**
 * Fix A.1, A.2, A.3:
 * Real gold shop price check:
 * - Respects operation Karat (18 / 21 / 24 / other) against that karat's daily price.
 * - For SELL: Allowed range is [dailyPrice - sellMinBelowDaily, dailyPrice + sellMaxMakingCharge].
 *   Selling above dailyPrice within sellMaxMakingCharge is normal making charge (مصنعية) and NOT an issue.
 * - For BUY: Allowed range is [dailyPrice - buyMaxDiscount, dailyPrice].
 *   Buying below dailyPrice within buyMaxDiscount is normal scrap discount (خصم كسر) and NOT an issue.
 * - Merges Fixed Rules and % Deviation into a SINGLE Issue per row (highest severity wins, message states violated rule).
 */
export function evaluateSingleOpPriceAnomaly(
  op: Partial<Operation>,
  dayInfo: DayInfo | undefined,
  settings: AuditSettings
): {
  severity: 'high' | 'medium';
  message: string;
  expected: string;
  actual: string;
  difference: string;
} | null {
  if (op.kind !== 'buy' && op.kind !== 'sell') return null;
  if (!op.weightG || op.weightG <= 0 || !op.total || op.total <= 0) return null;

  const karat = op.karat || 21;
  const dailyPrice = getEffectiveKaratPrice(dayInfo, karat);
  if (!dailyPrice || dailyPrice <= 0) return null;

  const actualGramPrice = op.total / op.weightG;
  const karatLabel = karat === 'other' ? 'عيار خاص' : `عيار ${karat}`;
  const range = settings.allowedPriceRange || {
    sellMinBelowDaily: 0,
    sellMaxMakingCharge: 400,
    buyMaxDiscount: 300,
  };

  let fixedRuleViolated = false;
  let fixedRuleReason = '';

  if (settings.fixedRules.enabled) {
    if (
      op.kind === 'sell' &&
      dailyPrice - actualGramPrice >= settings.fixedRules.sellBelowDailyByAmount
    ) {
      fixedRuleViolated = true;
      fixedRuleReason = `قاعدة ثابتة: بيع أقل من سعر اليوم بـ ${formatNumber(
        dailyPrice - actualGramPrice,
        0
      )} ج.م/جرام (الحد ${settings.fixedRules.sellBelowDailyByAmount} ج.م)`;
    } else if (
      op.kind === 'buy' &&
      actualGramPrice - dailyPrice >= settings.fixedRules.buyAboveDailyByAmount
    ) {
      fixedRuleViolated = true;
      fixedRuleReason = `قاعدة ثابتة: شراء أعلى من سعر اليوم بـ ${formatNumber(
        actualGramPrice - dailyPrice,
        0
      )} ج.م/جرام (الحد ${settings.fixedRules.buyAboveDailyByAmount} ج.م)`;
    }
  }

  if (op.kind === 'sell') {
    const minAllowedSell = dailyPrice - (range.sellMinBelowDaily || 0);
    const maxAllowedSell = dailyPrice + (range.sellMaxMakingCharge || 0);

    // Case 1: Selling below allowed floor (dailyPrice - X)
    if (actualGramPrice < minAllowedSell || fixedRuleViolated) {
      const shortfallFromDaily = dailyPrice - actualGramPrice;
      const shortfallPct = (shortfallFromDaily / dailyPrice) * 100;

      if (!fixedRuleViolated && shortfallPct < settings.priceDiffMediumPct && actualGramPrice >= minAllowedSell) {
        return null;
      }

      const severity: 'high' | 'medium' =
        fixedRuleViolated || shortfallPct >= settings.priceDiffHighPct || actualGramPrice < minAllowedSell
          ? 'high'
          : 'medium';

      const ruleNote = fixedRuleViolated
        ? ` [${fixedRuleReason}]`
        : ` [أقل من الحد المسموح للبيع ${formatNumber(minAllowedSell, 0)}]`;

      return {
        severity,
        message: `بيع (${karatLabel}) بسعر جرام ${formatNumber(
          actualGramPrice,
          0
        )} أقل من سعر اليوم (${formatNumber(dailyPrice, 0)}) بمقدار ${formatNumber(
          shortfallFromDaily,
          0
        )} ج.م (${shortfallPct.toFixed(1)}%)${ruleNote}.`,
        expected: `${formatNumber(minAllowedSell, 0)} – ${formatNumber(maxAllowedSell, 0)}`,
        actual: formatNumber(actualGramPrice, 0),
        difference: `-${formatNumber(shortfallFromDaily, 0)} ج.م/جرام (${shortfallPct.toFixed(1)}%)`,
      };
    }

    // Case 2: Selling way above maximum making charge (dailyPrice + Y)
    if (actualGramPrice > maxAllowedSell) {
      const excessOverMax = actualGramPrice - maxAllowedSell;
      const excessPctOverMax = (excessOverMax / dailyPrice) * 100;
      if (excessPctOverMax >= settings.priceDiffMediumPct) {
        const severity: 'high' | 'medium' =
          excessPctOverMax >= settings.priceDiffHighPct ? 'high' : 'medium';
        return {
          severity,
          message: `بيع (${karatLabel}) بسعر جرام ${formatNumber(
            actualGramPrice,
            0
          )} يتجاوز الحد الأقصى للمصنعية (${formatNumber(
            maxAllowedSell,
            0
          )}) بمقدار ${formatNumber(excessOverMax, 0)} ج.م/جرام (+${excessPctOverMax.toFixed(1)}%).`,
          expected: `<= ${formatNumber(maxAllowedSell, 0)} ج.م`,
          actual: formatNumber(actualGramPrice, 0),
          difference: `+${formatNumber(excessOverMax, 0)} ج.م فوق سقف المصنعية`,
        };
      }
    }

    return null;
  }

  // op.kind === 'buy'
  const minAllowedBuy = dailyPrice - (range.buyMaxDiscount || 0);
  const maxAllowedBuy = dailyPrice;

  // Case 1: Buying above daily price
  if (actualGramPrice > maxAllowedBuy || fixedRuleViolated) {
    const excessOverDaily = actualGramPrice - dailyPrice;
    const excessPct = (excessOverDaily / dailyPrice) * 100;

    if (!fixedRuleViolated && excessPct < settings.priceDiffMediumPct) {
      return null;
    }

    const severity: 'high' | 'medium' =
      fixedRuleViolated || excessPct >= settings.priceDiffHighPct ? 'high' : 'medium';

    const ruleNote = fixedRuleViolated
      ? ` [${fixedRuleReason}]`
      : ' [شراء أعلى من سعر الذهب اليومي]';

    return {
      severity,
      message: `شراء (${karatLabel}) بسعر جرام ${formatNumber(
        actualGramPrice,
        0
      )} أعلى من سعر اليوم (${formatNumber(dailyPrice, 0)}) بمقدار ${formatNumber(
        excessOverDaily,
        0
      )} ج.م (+${excessPct.toFixed(1)}%)${ruleNote}.`,
      expected: `${formatNumber(minAllowedBuy, 0)} – ${formatNumber(maxAllowedBuy, 0)}`,
      actual: formatNumber(actualGramPrice, 0),
      difference: `+${formatNumber(excessOverDaily, 0)} ج.م/جرام (+${excessPct.toFixed(1)}%)`,
    };
  }

  // Case 2: Buying with discount much larger than allowed buyMaxDiscount (Z)
  if (actualGramPrice < minAllowedBuy) {
    const extraDiscount = minAllowedBuy - actualGramPrice;
    const extraDiscountPct = (extraDiscount / dailyPrice) * 100;
    if (extraDiscountPct >= settings.priceDiffMediumPct) {
      const severity: 'high' | 'medium' =
        extraDiscountPct >= settings.priceDiffHighPct ? 'high' : 'medium';
      return {
        severity,
        message: `شراء (${karatLabel}) بسعر جرام ${formatNumber(
          actualGramPrice,
          0
        )} بخصم يتجاوز الخصم الأقصى المسموح (${formatNumber(
          minAllowedBuy,
          0
        )}) بمقدار ${formatNumber(extraDiscount, 0)} ج.م/جرام (-${extraDiscountPct.toFixed(1)}%).`,
        expected: `>= ${formatNumber(minAllowedBuy, 0)} ج.م`,
        actual: formatNumber(actualGramPrice, 0),
        difference: `-${formatNumber(extraDiscount, 0)} ج.م تحت سقف الخصم`,
      };
    }
  }

  return null;
}

export function checkDailyGoldPriceDiff(
  operations: Operation[],
  daysMap: Record<string, DayInfo>,
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];

  for (const op of operations) {
    if (op.kind !== 'buy' && op.kind !== 'sell') continue;
    const dayInfo = daysMap[op.date];
    const evalRes = evaluateSingleOpPriceAnomaly(op, dayInfo, settings);
    if (evalRes) {
      issues.push({
        id: `price-diff-${op.id}`,
        severity: evalRes.severity,
        checkType: 'daily_price_diff',
        checkTitle: 'مخالفة نطاق سعر الذهب اليومي / القاعدة الثابتة',
        rowId: op.id,
        date: op.date,
        kind: op.kind,
        message: evalRes.message,
        expected: evalRes.expected,
        actual: evalRes.actual,
        difference: evalRes.difference,
      });
    }
  }

  return issues;
}
