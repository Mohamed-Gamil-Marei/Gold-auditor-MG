import { AuditSettings, Issue, Operation, Person } from '../../types';
import { formatNumber, formatWeight, getTodayIso } from '../numerals';

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface PersonLedgerRow {
  id: string;
  date: string;
  item: string;
  debitCash: number;
  creditCash: number;
  runningCash: number;
  debitGold: number;
  creditGold: number;
  runningGold: number;
}

export interface PersonComputedBalance {
  personId: string;
  person?: Person;
  cashBalance: number; // +ve = عليه لنا (he owes us), -ve = له علينا (we owe him)
  goldBalanceG: number; // +ve = عليه ذهب لنا, -ve = له ذهب علينا
  totalGivenCash: number;
  lastPaymentDate: string | null;
  firstDebtDate: string | null;
  lastGoldMoveDate: string | null;
  debtAgeDays: number;
  ageBucket: '0-30' | '31-60' | '61-90' | '90+';
  agreedDueDate?: string;
  agreedOverdueDays: number; // > 0 if past agreedDueDate while owing money/gold
  maxDebtCash?: number;
  maxDebtGoldG?: number;
  limitUsagePct: number; // % of maxDebtCash consumed
  exceededCashLimit: boolean;
  exceededGoldLimit: boolean;
  exceededAnyLimit: boolean;
  ledger: PersonLedgerRow[];
}

export interface PersonsReconciliationSummary {
  map: Map<string, PersonComputedBalance>;
  totalOwesUsCash: number;
  totalWeOweCash: number;
  totalOwesUsGoldG: number;
  totalWeOweGoldG: number;
  totalOverdueCash: number;
  netRegisteredPersonsCash: number;
  netAllOperationsCash: number;
  reconciliationDiffCash: number;
  netRegisteredPersonsGoldG: number;
  netAllOperationsGoldG: number;
  reconciliationDiffGoldG: number;
  orphanOperationIds: string[];
  agingBuckets: Record<
    '0-30' | '31-60' | '61-90' | '90+',
    { count: number; cashTotal: number; goldTotalG: number; items: PersonComputedBalance[] }
  >;
}

/**
 * F2: Authoritative calculation of person balances, aging buckets, limit usage,
 * agreed due date overdue days, and automatic reconciliation check.
 */
export function computePersonBalancesSummary(
  operations: Operation[],
  persons: Person[],
  referenceDateStr?: string
): PersonsReconciliationSummary {
  const allDates = operations
    .map((o) => o.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const refDate =
    referenceDateStr || (allDates.length > 0 ? allDates[allDates.length - 1] : getTodayIso());
  const refTime = new Date(`${refDate}T00:00:00Z`).getTime();

  const personsById = new Map<string, Person>();
  const map = new Map<string, PersonComputedBalance>();

  for (const p of persons) {
    personsById.set(p.id, p);
    map.set(p.id, {
      personId: p.id,
      person: p,
      cashBalance: 0,
      goldBalanceG: 0,
      totalGivenCash: 0,
      lastPaymentDate: null,
      firstDebtDate: null,
      lastGoldMoveDate: null,
      debtAgeDays: 0,
      ageBucket: '0-30',
      agreedDueDate: p.agreedDueDate,
      agreedOverdueDays: 0,
      maxDebtCash: p.maxDebtCash,
      maxDebtGoldG: p.maxDebtGoldG,
      limitUsagePct: 0,
      exceededCashLimit: false,
      exceededGoldLimit: false,
      exceededAnyLimit: false,
      ledger: [],
    });
  }

  let netAllOperationsCash = 0;
  let netAllOperationsGoldG = 0;
  const orphanOperationIds: string[] = [];

  const sortedOps = [...operations].sort((a, b) => a.date.localeCompare(b.date));

  for (const op of sortedOps) {
    let debitCash = 0;
    let creditCash = 0;
    let debitGold = 0;
    let creditGold = 0;
    let desc = op.item || '';
    let isPersonAffecting = false;

    if (op.kind === 'sell' && op.payment === 'credit') {
      isPersonAffecting = true;
      debitCash = op.total;
      desc = `بيع آجل (${formatWeight(op.weightG)} جرام${op.karat ? ` عيار ${op.karat}` : ''})${
        op.item ? ` - ${op.item}` : ''
      }`;
    } else if (op.kind === 'buy' && op.payment === 'credit') {
      isPersonAffecting = true;
      creditCash = op.total;
      desc = `شراء آجل (${formatWeight(op.weightG)} جرام${op.karat ? ` عيار ${op.karat}` : ''})${
        op.item ? ` - ${op.item}` : ''
      }`;
    } else if (op.kind === 'person') {
      isPersonAffecting = true;
      if ((op.direction || 'gave_him') === 'gave_him') {
        debitCash = op.total;
        debitGold = op.weightG || 0;
        desc = op.item || 'أعطيناه نقدية / سددنا له';
      } else {
        creditCash = op.total;
        creditGold = op.weightG || 0;
        desc = op.item || 'استلمنا منه دفعة / أمانة';
      }
    }

    if (!isPersonAffecting) continue;

    netAllOperationsCash += debitCash - creditCash;
    netAllOperationsGoldG = Number(
      (netAllOperationsGoldG + debitGold - creditGold).toFixed(3)
    );

    if (!op.personId || !map.has(op.personId)) {
      orphanOperationIds.push(op.id);
      continue;
    }

    const entry = map.get(op.personId)!;
    entry.cashBalance += debitCash - creditCash;
    entry.goldBalanceG = Number((entry.goldBalanceG + debitGold - creditGold).toFixed(3));
    if (debitCash > 0) {
      entry.totalGivenCash += debitCash;
      if (!entry.firstDebtDate || op.date < entry.firstDebtDate) {
        entry.firstDebtDate = op.date;
      }
    }
    if (creditCash > 0) {
      if (!entry.lastPaymentDate || op.date > entry.lastPaymentDate) {
        entry.lastPaymentDate = op.date;
      }
    }
    if (debitGold > 0 || creditGold > 0) {
      if (!entry.lastGoldMoveDate || op.date > entry.lastGoldMoveDate) {
        entry.lastGoldMoveDate = op.date;
      }
    }

    entry.ledger.push({
      id: op.id,
      date: op.date,
      item: desc,
      debitCash,
      creditCash,
      runningCash: entry.cashBalance,
      debitGold,
      creditGold,
      runningGold: entry.goldBalanceG,
    });
  }

  let totalOwesUsCash = 0;
  let totalWeOweCash = 0;
  let totalOwesUsGoldG = 0;
  let totalWeOweGoldG = 0;
  let totalOverdueCash = 0;
  let netRegisteredPersonsCash = 0;
  let netRegisteredPersonsGoldG = 0;

  const agingBuckets: PersonsReconciliationSummary['agingBuckets'] = {
    '0-30': { count: 0, cashTotal: 0, goldTotalG: 0, items: [] },
    '31-60': { count: 0, cashTotal: 0, goldTotalG: 0, items: [] },
    '61-90': { count: 0, cashTotal: 0, goldTotalG: 0, items: [] },
    '90+': { count: 0, cashTotal: 0, goldTotalG: 0, items: [] },
  };

  for (const entry of map.values()) {
    netRegisteredPersonsCash += entry.cashBalance;
    netRegisteredPersonsGoldG = Number(
      (netRegisteredPersonsGoldG + entry.goldBalanceG).toFixed(3)
    );

    if (entry.cashBalance > 0) totalOwesUsCash += entry.cashBalance;
    else if (entry.cashBalance < 0) totalWeOweCash += Math.abs(entry.cashBalance);

    if (entry.goldBalanceG > 0) totalOwesUsGoldG += entry.goldBalanceG;
    else if (entry.goldBalanceG < 0) totalWeOweGoldG += Math.abs(entry.goldBalanceG);

    const anchor = entry.lastPaymentDate || entry.firstDebtDate;
    if (anchor && (entry.cashBalance > 0 || entry.goldBalanceG > 0)) {
      const anchorTime = new Date(`${anchor}T00:00:00Z`).getTime();
      entry.debtAgeDays = Math.max(0, Math.floor((refTime - anchorTime) / 86400000));
    }

    if (entry.debtAgeDays <= 30) entry.ageBucket = '0-30';
    else if (entry.debtAgeDays <= 60) entry.ageBucket = '31-60';
    else if (entry.debtAgeDays <= 90) entry.ageBucket = '61-90';
    else entry.ageBucket = '90+';

    // Agreed due date check (F2.2)
    if (
      entry.agreedDueDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.agreedDueDate) &&
      (entry.cashBalance > 0.5 || entry.goldBalanceG > 0.005)
    ) {
      const dueTime = new Date(`${entry.agreedDueDate}T00:00:00Z`).getTime();
      const diffDays = Math.floor((refTime - dueTime) / 86400000);
      if (diffDays >= 1) {
        entry.agreedOverdueDays = diffDays;
      }
    }

    // Overdue total (either past agreedDueDate or debtAgeDays >= 30)
    if (entry.cashBalance > 0 && (entry.agreedOverdueDays >= 1 || entry.debtAgeDays >= 30)) {
      totalOverdueCash += entry.cashBalance;
    }

    // Max debt limit check (F2.1)
    if (entry.maxDebtCash && entry.maxDebtCash > 0) {
      entry.limitUsagePct = Math.max(
        0,
        Math.round((Math.max(0, entry.cashBalance) / entry.maxDebtCash) * 100)
      );
      if (entry.cashBalance > entry.maxDebtCash) {
        entry.exceededCashLimit = true;
      }
    }
    if (entry.maxDebtGoldG && entry.maxDebtGoldG > 0 && entry.goldBalanceG > entry.maxDebtGoldG) {
      entry.exceededGoldLimit = true;
    }
    entry.exceededAnyLimit = entry.exceededCashLimit || entry.exceededGoldLimit;

    if (entry.cashBalance > 0.5 || entry.goldBalanceG > 0.005) {
      const bucket = agingBuckets[entry.ageBucket];
      bucket.count += 1;
      bucket.cashTotal += Math.max(0, entry.cashBalance);
      bucket.goldTotalG = Number(
        (bucket.goldTotalG + Math.max(0, entry.goldBalanceG)).toFixed(3)
      );
      bucket.items.push(entry);
    }
  }

  return {
    map,
    totalOwesUsCash,
    totalWeOweCash,
    totalOwesUsGoldG,
    totalWeOweGoldG,
    totalOverdueCash,
    netRegisteredPersonsCash,
    netAllOperationsCash,
    reconciliationDiffCash: Math.round((netAllOperationsCash - netRegisteredPersonsCash) * 100) / 100,
    netRegisteredPersonsGoldG,
    netAllOperationsGoldG,
    reconciliationDiffGoldG: Number(
      (netAllOperationsGoldG - netRegisteredPersonsGoldG).toFixed(3)
    ),
    orphanOperationIds,
    agingBuckets,
  };
}

/**
 * Prompt 3.6 Checks 4, 5, 7 + Patch 6 + F2 (Debt limit, Agreed due date, Auto reconciliation):
 * - Credit operation without a person name (high).
 * - Person exceeded maxDebtCash or maxDebtGoldG (high).
 * - Person overdue past agreedDueDate: medium after 1 day, high after 14 days.
 * - Person owes money without payment for > 30 days (medium) or > 90 days (high).
 * - Person took unusually large amounts compared to others (robust z > threshold) (medium).
 * - Person gold gram balance hasn't moved for > 30 days (medium).
 * - Reconciliation mismatch between sum of person balances and sum of credit/person operations (high).
 */
export function checkPersonBalances(
  operations: Operation[],
  persons: Person[],
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const personsMap = new Map<string, Person>();
  for (const p of persons) personsMap.set(p.id, p);

  const allDates = operations
    .map((o) => o.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const refDateStr = allDates.length > 0 ? allDates[allDates.length - 1] : getTodayIso();
  const refTime = new Date(`${refDateStr}T00:00:00Z`).getTime();

  // Check 7: Credit operation without personId
  for (const op of operations) {
    if ((op.kind === 'buy' || op.kind === 'sell') && op.payment === 'credit' && !op.personId) {
      issues.push({
        id: `credit-no-person-${op.id}`,
        severity: 'high',
        checkType: 'credit_without_person',
        checkTitle: 'عملية آجلة بدون اسم شخص',
        rowId: op.id,
        date: op.date,
        kind: op.kind,
        message: `عملية ${op.kind === 'sell' ? 'بيع' : 'شراء'} بالآجل بمبلغ ${formatNumber(
          op.total
        )} ج.م بدون تحديد اسم الشخص.`,
        expected: 'اسم شخص مسجل',
        actual: 'بدون اسم',
      });
    }
  }

  const summary = computePersonBalancesSummary(operations, persons, refDateStr);

  // F2.6: Automatic reconciliation check
  if (
    Math.abs(summary.reconciliationDiffCash) > 1 ||
    Math.abs(summary.reconciliationDiffGoldG) > 0.01
  ) {
    issues.push({
      id: 'person-reconciliation-mismatch',
      severity: 'high',
      checkType: 'person_reconciliation_mismatch',
      checkTitle: 'فرق مطابقة أرصدة الأشخاص مع العمليات الآجلة',
      date: refDateStr,
      kind: 'person',
      message: `مجموع أرصدة الأشخاص المسجلين (${formatNumber(
        summary.netRegisteredPersonsCash
      )} ج.م) لا يساوي صافي العمليات الآجلة والتحصيل والسداد (${formatNumber(
        summary.netAllOperationsCash
      )} ج.م) — يوجد فرق ${formatNumber(Math.abs(summary.reconciliationDiffCash))} ج.م (${
        summary.orphanOperationIds.length
      } عملية غير مربوطة بشخص مسجل).`,
      expected: `${formatNumber(summary.netAllOperationsCash)} ج.م`,
      actual: `${formatNumber(summary.netRegisteredPersonsCash)} ج.م`,
      difference: `${formatNumber(summary.reconciliationDiffCash)} ج.م`,
    });
  }

  for (const st of summary.map.values()) {
    const person = st.person || personsMap.get(st.personId);
    const personName = person?.name || 'شخص غير معروف';

    // F2.1: Exceeded Max Debt Limit (high)
    if (st.exceededCashLimit && st.maxDebtCash) {
      const excess = st.cashBalance - st.maxDebtCash;
      issues.push({
        id: `person-limit-cash-${st.personId}`,
        severity: 'high',
        checkType: 'person_exceeded_limit',
        checkTitle: 'تجاوز حد الدين الأقصى لشخص',
        personId: st.personId,
        date: st.lastPaymentDate || st.firstDebtDate || refDateStr,
        kind: 'person',
        message: `"${personName}" تجاوز حد الدين الأقصى المسموح (${formatNumber(
          st.maxDebtCash
        )} ج.م) — الرصيد الحالي عليه ${formatNumber(st.cashBalance)} ج.م (بزيادة ${formatNumber(
          excess
        )} ج.م، استهلاك ${st.limitUsagePct}%).`,
        expected: `<= ${formatNumber(st.maxDebtCash)} ج.م`,
        actual: `${formatNumber(st.cashBalance)} ج.م`,
        difference: `+${formatNumber(excess)} ج.م فوق الحد`,
      });
    }

    if (st.exceededGoldLimit && st.maxDebtGoldG) {
      const excessG = st.goldBalanceG - st.maxDebtGoldG;
      issues.push({
        id: `person-limit-gold-${st.personId}`,
        severity: 'high',
        checkType: 'person_exceeded_limit',
        checkTitle: 'تجاوز حد الدين الأقصى لشخص',
        personId: st.personId,
        date: st.lastGoldMoveDate || refDateStr,
        kind: 'person',
        message: `"${personName}" تجاوز حد دين الذهب الأقصى (${formatWeight(
          st.maxDebtGoldG
        )} جرام) — الرصيد الحالي عليه ${formatWeight(st.goldBalanceG)} جرام.`,
        expected: `<= ${formatWeight(st.maxDebtGoldG)} جرام`,
        actual: `${formatWeight(st.goldBalanceG)} جرام`,
        difference: `+${formatWeight(excessG)} جرام`,
      });
    }

    // F2.2: Agreed Repayment Due Date Overdue (medium after 1 day, high after 14 days)
    if (st.agreedDueDate && st.agreedOverdueDays >= 1) {
      const sev: 'high' | 'medium' = st.agreedOverdueDays >= 14 ? 'high' : 'medium';
      issues.push({
        id: `person-agreed-due-${st.personId}`,
        severity: sev,
        checkType: 'person_agreed_due_overdue',
        checkTitle: 'تأخر عن موعد السداد المتفق عليه',
        personId: st.personId,
        date: st.agreedDueDate,
        kind: 'person',
        message: `"${personName}" متأخر عن موعد السداد المتفق عليه (${st.agreedDueDate}) منذ ${
          st.agreedOverdueDays
        } يوماً — الرصيد المتبقي عليه ${formatNumber(st.cashBalance)} ج.م${
          st.goldBalanceG > 0 ? ` + ${formatWeight(st.goldBalanceG)} جرام` : ''
        }.`,
        expected: `سداد في ${st.agreedDueDate}`,
        actual: `متأخر ${st.agreedOverdueDays} يوم`,
        difference: `${formatNumber(st.cashBalance)} ج.م`,
      });
    }

    // Check 4: Overdue cash debt (>30d medium, >90d high)
    if (st.cashBalance > 50) {
      const anchorDate = st.lastPaymentDate || st.firstDebtDate;
      if (anchorDate && st.debtAgeDays >= settings.personOverdueMediumDays) {
        const severity = st.debtAgeDays >= settings.personOverdueHighDays ? 'high' : 'medium';
        issues.push({
          id: `person-overdue-${st.personId}`,
          severity,
          checkType: 'person_overdue_debt',
          checkTitle: 'تأخر سداد مديونية أشخاص',
          personId: st.personId,
          date: anchorDate,
          kind: 'person',
          message: `"${personName}" عليه مبلغ ${formatNumber(
            st.cashBalance
          )} ج.م بدون سداد منذ ${st.debtAgeDays} يوماً (آخر حركة سداد/بداية دين: ${anchorDate}).`,
          expected: `سداد خلال ${settings.personOverdueMediumDays} يوماً`,
          actual: `${st.debtAgeDays} يوماً (${formatNumber(st.cashBalance)} ج.م)`,
          difference: `${st.debtAgeDays} يوم`,
        });
      }
    }

    // Patch 6: Gold balance hasn't moved in 30 days
    if (Math.abs(st.goldBalanceG) > 0.05 && st.lastGoldMoveDate) {
      const goldTime = new Date(`${st.lastGoldMoveDate}T00:00:00Z`).getTime();
      const goldDays = Math.floor((refTime - goldTime) / 86400000);
      if (goldDays >= settings.goldDormantDays) {
        const dirWord = st.goldBalanceG > 0 ? 'عليه لنا' : 'له علينا';
        issues.push({
          id: `person-gold-dormant-${st.personId}`,
          severity: 'medium',
          checkType: 'person_gold_dormant',
          checkTitle: 'رصيد ذهب راكد عند شخص',
          personId: st.personId,
          date: st.lastGoldMoveDate,
          kind: 'person',
          message: `رصيد ذهب (${formatWeight(
            Math.abs(st.goldBalanceG)
          )} جرام ${dirWord}) لحساب "${personName}" لم يتحرك منذ ${goldDays} يوماً.`,
          expected: `حركة خلال ${settings.goldDormantDays} يوماً`,
          actual: `${goldDays} يوماً بدون حركة`,
        });
      }
    }
  }

  // Check 5: Person took unusually large amounts compared to others (robust z > threshold)
  const debtors = Array.from(summary.map.values()).filter((s) => s.totalGivenCash > 0);
  if (debtors.length >= 4) {
    const amounts = debtors.map((d) => d.totalGivenCash);
    const med = computeMedian(amounts);
    const mad = computeMedian(amounts.map((a) => Math.abs(a - med)));
    if (mad > 0) {
      for (const d of debtors) {
        const z = (0.6745 * (d.totalGivenCash - med)) / mad;
        if (z > settings.robustZThreshold) {
          const personName = personsMap.get(d.personId)?.name || 'شخص';
          issues.push({
            id: `person-large-debt-${d.personId}`,
            severity: 'medium',
            checkType: 'person_large_amount',
            checkTitle: 'تركّز مبالغ كبيرة لدى شخص',
            personId: d.personId,
            date: d.firstDebtDate || refDateStr,
            kind: 'person',
            message: `"${personName}" أخذ مبالغ إجمالية (${formatNumber(
              d.totalGivenCash
            )} ج.م) كبيرة بشكل شاذ مقارنة بباقي الأشخاص (وسيط المبالغ ${formatNumber(
              med,
              0
            )} ج.م — Z=${z.toFixed(1)}).`,
            expected: `~${formatNumber(med, 0)} ج.م`,
            actual: `${formatNumber(d.totalGivenCash)} ج.م`,
            difference: `Z = ${z.toFixed(1)}`,
          });
        }
      }
    }
  }

  return issues;
}
