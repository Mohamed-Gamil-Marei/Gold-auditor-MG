import { AuditSettings, DayInfo, Issue, Operation } from '../../types';
import { formatNumber } from '../numerals';

export function computeDaySafeSummary(
  date: string,
  operations: Operation[],
  dayInfo?: DayInfo
) {
  const hasOpening = dayInfo?.openingCash !== undefined && dayInfo?.openingCash !== null;
  const openingCash = dayInfo?.openingCash ?? 0;
  let cashSales = 0;
  let cashPurchases = 0;
  let expenses = 0;
  let advances = 0;
  let personGiven = 0;
  let personReceived = 0;

  for (const op of operations) {
    if (op.date !== date) continue;
    if (op.kind === 'sell' && op.payment === 'cash') {
      cashSales += op.total;
    } else if (op.kind === 'buy' && op.payment === 'cash') {
      cashPurchases += op.total;
    } else if (op.kind === 'expense') {
      expenses += op.total;
    } else if (op.kind === 'advance') {
      advances += op.total;
    } else if (op.kind === 'person') {
      if ((op.direction || 'gave_him') === 'gave_him') {
        personGiven += op.total;
      } else {
        personReceived += op.total;
      }
    }
  }

  const expectedCash =
    openingCash +
    cashSales -
    cashPurchases -
    expenses -
    advances -
    personGiven +
    personReceived;

  const hasActual = dayInfo?.actualCash !== undefined && dayInfo?.actualCash !== null;
  const actualCash = dayInfo?.actualCash ?? expectedCash;
  const difference = hasActual ? dayInfo!.actualCash! - expectedCash : 0;

  return {
    hasOpening,
    openingCash,
    cashSales,
    cashPurchases,
    expenses,
    advances,
    personGiven,
    personReceived,
    expectedCash,
    hasActual,
    actualCash,
    difference,
  };
}

/**
 * Fix B.4:
 * - Do NOT compute a high-severity safe deficit/surplus if the day has no recorded openingCash;
 *   instead emit a low-severity alert "رصيد أول اليوم غير مسجل" when actualCash is entered without openingCash.
 * - Continuity check compares with the nearest subsequent active day (skipping closed Fridays).
 */
export function checkDailySafe(
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
      (info.openingCash !== undefined ||
        info.actualCash !== undefined ||
        info.openingBalanceG !== undefined ||
        info.closingBalanceG !== undefined)
    ) {
      activeDatesSet.add(d);
    }
  }

  const allDates = Array.from(activeDatesSet).sort();

  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i];
    const info = daysMap[d];
    const summary = computeDaySafeSummary(d, operations, info);

    if (!summary.hasOpening && summary.hasActual) {
      issues.push({
        id: `safe-missing-opening-${d}`,
        severity: 'low',
        checkType: 'safe_discrepancy',
        checkTitle: 'تنبيه تسوية الخزنة',
        date: d,
        message: `رصيد أول اليوم غير مسجل في خزنة يوم ${d} رغم تسجيل جرد فعلي (${formatNumber(
          summary.actualCash
        )} ج.م) — سجّل رصيد أول اليوم لحساب الفرق بدقة.`,
        expected: 'رصيد أول اليوم مسجل',
        actual: 'غير مسجل',
      });
      continue;
    }

    if (!summary.hasOpening) {
      continue;
    }

    // Check negative safe balance when openingCash IS recorded
    if (summary.expectedCash < 0 || (summary.hasActual && summary.actualCash < 0)) {
      const negVal =
        summary.hasActual && summary.actualCash < 0
          ? summary.actualCash
          : summary.expectedCash;
      issues.push({
        id: `safe-negative-${d}`,
        severity: 'high',
        checkType: 'safe_discrepancy',
        checkTitle: 'عجز أو رصيد سالب في الخزنة',
        date: d,
        message: `رصيد الخزنة سالب في يوم ${d} (${formatNumber(
          negVal
        )} ج.م) — المدفوعات النقدية أكبر من النقدية المتاحة.`,
        expected: '>= 0 ج.م',
        actual: `${formatNumber(negVal)} ج.م`,
        difference: `${formatNumber(negVal)} ج.م`,
      });
    }

    // Check deficit/surplus between actualCash and expectedCash (only when both opening and actual exist)
    if (summary.hasActual && Math.abs(summary.difference) > settings.cashDiscrepancyThreshold) {
      const kindWord =
        summary.difference < 0 ? 'عجز نقدية في الخزنة' : 'زيادة نقدية في الخزنة';
      issues.push({
        id: `safe-diff-${d}`,
        severity: 'high',
        checkType: 'safe_discrepancy',
        checkTitle: 'عجز أو رصيد سالب في الخزنة',
        date: d,
        message: `${kindWord} يوم ${d} بمقدار ${formatNumber(
          Math.abs(summary.difference)
        )} ج.م (الرصيد المتوقع ${formatNumber(
          summary.expectedCash
        )} ج.م، والجرد الفعلي ${formatNumber(summary.actualCash)} ج.م).`,
        expected: `${formatNumber(summary.expectedCash)} ج.م`,
        actual: `${formatNumber(summary.actualCash)} ج.م`,
        difference: `${summary.difference > 0 ? '+' : ''}${formatNumber(
          summary.difference
        )} ج.م`,
      });
    }

    // Check continuity with nearest subsequent active day
    if (summary.hasActual && i + 1 < allDates.length) {
      const nextDate = allDates[i + 1];
      const nextInfo = daysMap[nextDate];
      if (nextInfo && nextInfo.openingCash !== undefined && nextInfo.openingCash !== null) {
        const carryDiff = nextInfo.openingCash - summary.actualCash;
        if (Math.abs(carryDiff) > settings.cashDiscrepancyThreshold) {
          issues.push({
            id: `safe-carryover-${nextDate}`,
            severity: 'high',
            checkType: 'safe_discrepancy',
            checkTitle: 'عجز أو رصيد سالب في الخزنة',
            date: nextDate,
            message: `رصيد أول الخزنة (${formatNumber(
              nextInfo.openingCash
            )} ج.م) في ${nextDate} لا يطابق الجرد الفعلي لآخر يوم عمل سابق ${d} (${formatNumber(
              summary.actualCash
            )} ج.م).`,
            expected: `${formatNumber(summary.actualCash)} ج.م`,
            actual: `${formatNumber(nextInfo.openingCash)} ج.م`,
            difference: `${carryDiff > 0 ? '+' : ''}${formatNumber(carryDiff)} ج.م`,
          });
        }
      }
    }
  }

  return issues;
}
