import {
  AuditLogEntry,
  AuditSettings,
  DayInfo,
  Issue,
  Operation,
  Person,
  Worker,
} from '../../types';
import { formatNumber, formatWeight, normalizeArabicName } from '../numerals';
import { checkAuditLogAnomalies } from './checkAuditLogAnomalies';
import {
  checkDailyGoldPriceDiff,
  evaluateSingleOpPriceAnomaly,
} from './checkDailyGoldPriceDiff';
import { checkDailySafe } from './checkDailySafe';
import { checkDuplicates } from './checkDuplicates';
import { checkExpensesAnomalies } from './checkExpensesAnomalies';
import { checkGoldInventoryBalance } from './checkGoldInventoryBalance';
import { checkMissingDays } from './checkMissingDays';
import { checkMissingOrInvalid } from './checkMissingOrInvalid';
import { checkPersonBalances } from './checkPersonBalances';
import { checkRoundAndRepeatedNumbers } from './checkRoundAndRepeatedNumbers';
import { checkSellBelowBuyCost } from './checkSellBelowBuyCost';
import { checkStatisticalOutliers } from './checkStatisticalOutliers';
import { checkWorkerAdvances } from './checkWorkerAdvances';

export interface AuditRunResult {
  issues: Issue[];
  countsByCheck: Record<string, { title: string; count: number }>;
  warnings: string[];
  executionTimeMs: number;
}

const SEVERITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function runAllAuditChecks(
  operations: Operation[],
  daysMap: Record<string, DayInfo>,
  persons: Person[],
  workers: Worker[],
  auditLogs: AuditLogEntry[],
  settings: AuditSettings
): AuditRunResult {
  const startTime = performance.now();
  const rawIssues: Issue[] = [];
  const warnings: string[] = [];

  const exceptedDates = new Set(settings.exceptions.dates);
  const exceptedPersons = new Set(settings.exceptions.personIds);
  const exceptedItems = new Set(
    settings.exceptions.items.map((it) => normalizeArabicName(it))
  );

  const filteredOps = operations.filter((op) => {
    if (exceptedDates.has(op.date)) return false;
    if (op.personId && exceptedPersons.has(op.personId)) return false;
    if (op.item && exceptedItems.has(normalizeArabicName(op.item))) return false;
    return true;
  });

  const checkRunners: { name: string; fn: () => Issue[] }[] = [
    {
      name: 'بيانات ناقصة أو غير منطقية',
      fn: () => checkMissingOrInvalid(filteredOps, settings),
    },
    {
      name: 'مخالفة نطاق سعر الذهب اليومي / القاعدة الثابتة',
      fn: () => checkDailyGoldPriceDiff(filteredOps, daysMap, settings),
    },
    {
      name: 'القيم الشاذة إحصائياً (Median + MAD)',
      fn: () => checkStatisticalOutliers(filteredOps, settings),
    },
    {
      name: 'بيع أقل من تكلفة الشراء وهامش الربح',
      fn: () => checkSellBelowBuyCost(filteredOps),
    },
    {
      name: 'تكرار العمليات المتطابقة',
      fn: () => checkDuplicates(filteredOps),
    },
    {
      name: 'الأرقام المدورة والمتكررة',
      fn: () => checkRoundAndRepeatedNumbers(filteredOps),
    },
    {
      name: 'أيام بدون حركة',
      fn: () => checkMissingDays(filteredOps, settings),
    },
    {
      name: 'مطابقة جرد الذهب بالجرامات',
      fn: () => checkGoldInventoryBalance(filteredOps, daysMap, settings),
    },
    {
      name: 'سلف العمال والمرتبات',
      fn: () => checkWorkerAdvances(filteredOps, workers, settings),
    },
    {
      name: 'شذوذ وتكرار المصاريف',
      fn: () => checkExpensesAnomalies(filteredOps, settings),
    },
    {
      name: 'حسابات الأشخاص والعمليات الآجلة',
      fn: () => checkPersonBalances(filteredOps, persons, settings),
    },
    {
      name: 'تسوية خزنة اليوم النقدية',
      fn: () => checkDailySafe(filteredOps, daysMap, settings),
    },
    {
      name: 'سجل التعديلات والأيام المقفولة',
      fn: () => checkAuditLogAnomalies(auditLogs, daysMap),
    },
  ];

  for (const runner of checkRunners) {
    try {
      const res = runner.fn();
      rawIssues.push(...res);
    } catch (err: any) {
      const msg = `تعذر تشغيل فحص (${runner.name}): ${err?.message || 'خطأ غير متوقع'}`;
      warnings.push(msg);
      rawIssues.push({
        id: `check-error-${runner.name}`,
        severity: 'low',
        checkType: 'system_warning',
        checkTitle: 'تحذير فحص',
        date: '-',
        message: msg,
      });
    }
  }

  const finalIssues = rawIssues
    .filter((iss) => !exceptedDates.has(iss.date))
    .sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.date.localeCompare(a.date);
    });

  const countsByCheck: Record<string, { title: string; count: number }> = {};
  for (const iss of finalIssues) {
    if (!countsByCheck[iss.checkType]) {
      countsByCheck[iss.checkType] = { title: iss.checkTitle, count: 0 };
    }
    countsByCheck[iss.checkType].count += 1;
  }

  return {
    issues: finalIssues,
    countsByCheck,
    warnings,
    executionTimeMs: Math.round(performance.now() - startTime),
  };
}

/**
 * Fix A.1, A.2, A.3, A.4 + F2.1:
 * Fast live row status evaluation:
 * - If dayInfo has no confirmed goldPricePerGram (> 0 and priceConfirmed !== false), returns 'neutral' (⚪ محايد)
 *   so rows are not falsely flagged before recording today's gold price.
 * - Uses evaluateSingleOpPriceAnomaly (karat-aware, making-charge-aware, scrap-discount-aware, single merged alert).
 * - F2.1: Checks if a credit sell or person 'gave_him' operation causes the person to exceed their maxDebtCash or maxDebtGoldG.
 */
export function evaluateLiveRowStatus(
  op: Partial<Operation>,
  dayInfo: DayInfo | undefined,
  dayOps: Operation[],
  settings: AuditSettings,
  persons?: Person[],
  allOperations?: Operation[]
): { status: 'neutral' | 'ok' | 'warn' | 'danger'; reasons: string[] } {
  const reasons: string[] = [];
  let level = 'ok' as 'neutral' | 'ok' | 'warn' | 'danger';

  const escalate = (newLevel: 'warn' | 'danger', reason: string) => {
    reasons.push(reason);
    if (newLevel === 'danger') level = 'danger';
    else if (newLevel === 'warn' && level !== 'danger') level = 'warn';
  };

  const kind = op.kind || 'sell';
  const weightG = op.weightG || 0;
  const total = op.total || 0;

  // F2.1: Check if person debt limit is exceeded by this operation
  if (
    op.personId &&
    persons &&
    ((kind === 'sell' && op.payment === 'credit') ||
      (kind === 'person' && (op.direction || 'gave_him') === 'gave_him'))
  ) {
    const person = persons.find((p) => p.id === op.personId);
    if (person && ((person.maxDebtCash && person.maxDebtCash > 0) || (person.maxDebtGoldG && person.maxDebtGoldG > 0))) {
      const opsToScan = allOperations || dayOps;
      let cashBal = 0;
      let goldBal = 0;
      let includedSelf = false;

      for (const existing of opsToScan) {
        if (existing.personId !== op.personId) continue;
        if (op.id && existing.id === op.id) {
          includedSelf = true;
          if (kind === 'sell' && op.payment === 'credit') cashBal += total;
          else if (kind === 'person' && (op.direction || 'gave_him') === 'gave_him') {
            cashBal += total;
            goldBal += weightG;
          }
          continue;
        }
        if (existing.kind === 'sell' && existing.payment === 'credit') {
          cashBal += existing.total;
        } else if (existing.kind === 'buy' && existing.payment === 'credit') {
          cashBal -= existing.total;
        } else if (existing.kind === 'person') {
          if ((existing.direction || 'gave_him') === 'gave_him') {
            cashBal += existing.total;
            goldBal += existing.weightG || 0;
          } else {
            cashBal -= existing.total;
            goldBal -= existing.weightG || 0;
          }
        }
      }

      if (!includedSelf) {
        if (kind === 'sell' && op.payment === 'credit') cashBal += total;
        else if (kind === 'person' && (op.direction || 'gave_him') === 'gave_him') {
          cashBal += total;
          goldBal += weightG;
        }
      }

      if (person.maxDebtCash && person.maxDebtCash > 0 && cashBal > person.maxDebtCash) {
        escalate(
          'danger',
          `تجاوز حد الدين الأقصى لـ "${person.name}" (${formatNumber(
            person.maxDebtCash
          )} ج.م) — الرصيد سيصبح ${formatNumber(cashBal)} ج.م`
        );
      }
      if (person.maxDebtGoldG && person.maxDebtGoldG > 0 && goldBal > person.maxDebtGoldG) {
        escalate(
          'danger',
          `تجاوز حد دين الذهب لـ "${person.name}" (${formatWeight(
            person.maxDebtGoldG
          )} ج) — الرصيد سيصبح ${formatWeight(goldBal)} ج`
        );
      }
    }
  }

  if (kind === 'buy' || kind === 'sell') {
    if (!dayInfo || !dayInfo.goldPricePerGram || dayInfo.goldPricePerGram <= 0 || dayInfo.priceConfirmed === false) {
      if (level === 'danger') {
        return { status: 'danger', reasons };
      }
      return {
        status: 'neutral',
        reasons: ['سجّل أو أكّد سعر الذهب اليوم أولاً لتفعيل المراجعة الحية'],
      };
    }

    if (weightG <= 0 || total <= 0) {
      return { status: 'neutral', reasons: ['بانتظار إكمال الوزن والسعر'] };
    }

    if (weightG > settings.maxReasonableWeightG) {
      escalate(
        'danger',
        `الوزن (${weightG} جرام) أكبر من الحد المعقول (${settings.maxReasonableWeightG} جرام)`
      );
    }

    const priceAnomaly = evaluateSingleOpPriceAnomaly(op, dayInfo, settings);
    if (priceAnomaly) {
      escalate(
        priceAnomaly.severity === 'high' ? 'danger' : 'warn',
        priceAnomaly.message
      );
    }

    if (op.payment === 'credit' && !op.personId) {
      escalate('danger', 'عملية آجلة بدون تحديد اسم الشخص');
    }

    const dupCount = dayOps.filter(
      (existing) =>
        existing.id !== op.id &&
        existing.kind === kind &&
        (existing.karat || 21) === (op.karat || 21) &&
        Math.abs(existing.weightG - weightG) < 0.001 &&
        Math.round(existing.total) === Math.round(total)
    ).length;

    if (dupCount > 0) {
      escalate('warn', 'صف مكرر بنفس الوزن والسعر في هذا اليوم');
    }

    if (total >= 1000 && Math.round(total) % 1000 === 0) {
      escalate('warn', 'مبلغ مدوّر من مضاعفات 1,000');
    }
  } else if (kind === 'expense') {
    if (total <= 0) return { status: 'neutral', reasons: ['أدخل مبلغ المصروف'] };
    const dupExp = dayOps.filter(
      (existing) =>
        existing.id !== op.id &&
        existing.kind === 'expense' &&
        (existing.category || existing.item) === (op.category || op.item) &&
        Math.round(existing.total) === Math.round(total)
    ).length;
    if (dupExp > 0) {
      escalate('warn', 'مصروف مكرر بنفس البند والمبلغ اليوم');
    }
  } else if (kind === 'advance') {
    if (total <= 0) return { status: 'neutral', reasons: ['أدخل مبلغ السلفة'] };
    const sameDayAdv = dayOps.filter(
      (existing) =>
        existing.id !== op.id &&
        existing.kind === 'advance' &&
        existing.workerId &&
        existing.workerId === op.workerId
    ).length;
    if (sameDayAdv > 0) {
      escalate('warn', 'سلفة ثانية لنفس العامل في نفس اليوم');
    }
  } else if (kind === 'person') {
    if (total <= 0 && weightG <= 0) {
      return { status: 'neutral', reasons: ['أدخل مبلغ أو وزن حركة الشخص'] };
    }
  }

  if (reasons.length === 0) {
    reasons.push('سليم — ضمن النطاق المسموح');
  }

  return { status: level, reasons };
}
