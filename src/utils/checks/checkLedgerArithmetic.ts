import { AuditSettings, DayInfo, Issue, Operation } from '../../types';
import { formatNumber, formatWeight } from '../numerals';

/**
 * H4 — فحص حسابات الدفتر نفسه (الرصيد المتتابع checkLedgerArithmetic)
 * و H3.6 — اشتباه "فرق مع إجمالي الدفتر" للأيام ذات الفرق الكبير غير المعتمد
 */
export function checkLedgerArithmetic(
  operations: Operation[],
  daysMap: Record<string, DayInfo>,
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const tpl = settings.ledgerArithmeticTemplate || {
    enabled: true,
    sellDirection: 'add',
    buyDirection: 'subtract',
    checkWeightAndCount: true,
  };

  // 1. H3.6: Check daysMap for unapproved large differences with handwritten ledger totals
  const allDates = Array.from(
    new Set([...Object.keys(daysMap), ...operations.map((o) => o.date)])
  )
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  for (const date of allDates) {
    const dayInfo = daysMap[date];
    const comp = dayInfo?.ledgerTotalsComparison;
    if (!comp) continue;

    for (const side of ['sell', 'buy'] as const) {
      const sideComp = comp[side];
      if (!sideComp) continue;
      const sideLabel = side === 'sell' ? 'المبيعات' : 'المشتريات';

      if (sideComp.status === 'large_diff' && !sideComp.approvedByAuditor) {
        const refAmount =
          sideComp.approvedAmount ?? sideComp.handwrittenAmount ?? 0;
        issues.push({
          id: `ledger-total-diff-${date}-${side}`,
          severity: 'high',
          checkType: 'ledger_totals_mismatch',
          checkTitle: 'فرق مع إجمالي الدفتر المكتوب',
          date,
          kind: side,
          expected: `${formatNumber(refAmount)} ج.م`,
          actual: `${formatNumber(sideComp.readSumAmount)} ج.م`,
          difference: `${formatNumber(Math.abs(sideComp.diffAmount))} ج.م`,
          message: `فرق كبير غير معتمد بين مجموع صفوف ${sideLabel} المقروءة (${formatNumber(
            sideComp.readSumAmount
          )} ج.م / ${formatWeight(
            sideComp.readSumWeightG
          )} ج) وإجمالي الدفتر المكتوب بخط اليد (${formatNumber(refAmount)} ج.م) في يوم ${date} بفارق ${formatNumber(
            Math.abs(sideComp.diffAmount)
          )} ج.م.`,
        });
      }
    }
  }

  if (!tpl.enabled) {
    return issues;
  }

  // 2. H4.3: Check operations with running_balance_before / running_balance_after
  const opsByDate = new Map<string, Operation[]>();
  for (const op of operations) {
    if (op.kind !== 'buy' && op.kind !== 'sell') continue;
    const list = opsByDate.get(op.date) || [];
    list.push(op);
    opsByDate.set(op.date, list);
  }

  let prevDayClosingBalance: { date: string; balance: number } | null = null;

  for (const date of allDates) {
    const dayInfo = daysMap[date];
    const dayOps = (opsByDate.get(date) || []).slice().sort((a, b) => {
      const pA = Number(a.pageNumberHint ?? a.sourcePageRef?.pageIndex ?? 1);
      const pB = Number(b.pageNumberHint ?? b.sourcePageRef?.pageIndex ?? 1);
      if (pA !== pB) return pA - pB;
      const rA = a.rowOrderInPage ?? 0;
      const rB = b.rowOrderInPage ?? 0;
      if (rA !== rB) return rA - rB;
      return a.createdAt - b.createdAt;
    });

    const opsWithRunning = dayOps.filter(
      (o) =>
        typeof o.runningBalanceBefore === 'number' ||
        typeof o.runningBalanceAfter === 'number'
    );

    // Day-to-day carryover check (H4.3 bullet 3)
    const dayOpening =
      dayInfo?.openingLedgerBalance ??
      (opsWithRunning.length > 0 ? opsWithRunning[0].runningBalanceBefore : undefined);

    if (
      prevDayClosingBalance &&
      typeof dayOpening === 'number' &&
      Number.isFinite(dayOpening)
    ) {
      const diff = dayOpening - prevDayClosingBalance.balance;
      if (Math.abs(diff) >= 1) {
        issues.push({
          id: `ledger-day-carryover-${date}`,
          severity: Math.abs(diff) >= 100 ? 'high' : 'medium',
          checkType: 'ledger_arithmetic',
          checkTitle: 'حسابات الدفتر (الرصيد المتتابع)',
          date,
          expected: `${formatNumber(prevDayClosingBalance.balance)} ج.م`,
          actual: `${formatNumber(dayOpening)} ج.م`,
          difference: `${formatNumber(Math.abs(diff))} ج.م`,
          message: `خطأ ترحيل بين يومين في الدفتر: الرصيد الافتتاحي ليوم ${date} (${formatNumber(
            dayOpening
          )} ج.م) لا يطابق الرصيد الختامي لليوم السابق ${prevDayClosingBalance.date} (${formatNumber(
            prevDayClosingBalance.balance
          )} ج.م) — الفرق: ${formatNumber(Math.abs(diff))} ج.م.`,
        });
      }
    }

    // Track within-row and row-to-row / page-to-continuation continuity
    for (let i = 0; i < dayOps.length; i++) {
      const op = dayOps[i];
      const pageLabel = op.pageNumberHint ?? op.sourcePageRef?.pageIndex ?? 1;
      const rowLabel = op.rowOrderInPage ?? i + 1;
      const conf = typeof op.ocrConfidence === 'number' ? op.ocrConfidence : 0.9;
      const isHighConfidence = conf >= 0.75;
      const certaintyTag = isHighConfidence
        ? 'خطأ حسابي أكيد في الدفتر'
        : 'قراءة غير مؤكدة (ثقة منخفضة)';

      // A) Within-row arithmetic: runningBalanceAfter = runningBalanceBefore ± total
      if (
        typeof op.runningBalanceBefore === 'number' &&
        typeof op.runningBalanceAfter === 'number'
      ) {
        const dir =
          op.kind === 'sell' ? tpl.sellDirection : tpl.buyDirection;
        const expectedAfterAdd = op.runningBalanceBefore + op.total;
        const expectedAfterSub = op.runningBalanceBefore - op.total;
        const primaryExpected =
          dir === 'add' ? expectedAfterAdd : expectedAfterSub;

        const diffPrimary = Math.abs(op.runningBalanceAfter - primaryExpected);
        const diffAlt = Math.abs(
          op.runningBalanceAfter - (dir === 'add' ? expectedAfterSub : expectedAfterAdd)
        );
        const minDiff = Math.min(diffPrimary, diffAlt);

        if (minDiff >= 1) {
          issues.push({
            id: `ledger-row-math-${op.id}`,
            severity: isHighConfidence ? 'high' : 'medium',
            checkType: 'ledger_arithmetic',
            checkTitle: 'حسابات الدفتر (الرصيد المتتابع)',
            rowId: op.id,
            date: op.date,
            kind: op.kind,
            expected: `${formatNumber(primaryExpected)} ج.م`,
            actual: `${formatNumber(op.runningBalanceAfter)} ج.م`,
            difference: `${formatNumber(diffPrimary)} ج.م`,
            message: `${certaintyTag} — خطأ جمع داخل الصف (يوم ${op.date}، ورقة ${pageLabel}، صف #${rowLabel}): الرصيد قبل (${formatNumber(
              op.runningBalanceBefore
            )}) ${dir === 'add' ? '+' : '-'} مبلغ الصف (${formatNumber(
              op.total
            )}) = المتوقع (${formatNumber(primaryExpected)}) لكن المكتوب في الدفتر (${formatNumber(
              op.runningBalanceAfter
            )}) بفارق ${formatNumber(diffPrimary)} ج.م.`,
          });
        }
      }

      // B) Row-to-row & Page-to-continuation continuity
      if (i > 0) {
        const prevOp = dayOps[i - 1];
        if (
          typeof prevOp.runningBalanceAfter === 'number' &&
          typeof op.runningBalanceBefore === 'number'
        ) {
          // Only compare continuity within same side or when running balance is unified
          if (prevOp.kind === op.kind || dayOps.every((x) => typeof x.runningBalanceAfter === 'number')) {
            const contDiff = op.runningBalanceBefore - prevOp.runningBalanceAfter;
            if (Math.abs(contDiff) >= 1) {
              const prevPage = prevOp.pageNumberHint ?? prevOp.sourcePageRef?.pageIndex ?? 1;
              const isPageContinuation = String(prevPage) !== String(pageLabel);

              issues.push({
                id: `ledger-continuity-${prevOp.id}-${op.id}`,
                severity: isHighConfidence ? 'high' : 'medium',
                checkType: 'ledger_arithmetic',
                checkTitle: 'حسابات الدفتر (الرصيد المتتابع)',
                rowId: op.id,
                date: op.date,
                kind: op.kind,
                expected: `${formatNumber(prevOp.runningBalanceAfter)} ج.م`,
                actual: `${formatNumber(op.runningBalanceBefore)} ج.م`,
                difference: `${formatNumber(Math.abs(contDiff))} ج.م`,
                message: isPageContinuation
                  ? `${certaintyTag} — خطأ ترحيل لورقة التكملة (يوم ${op.date}، انتقال من ورقة ${prevPage} إلى ورقة ${pageLabel}، صف #${rowLabel}): ورقة التكملة بدأت برصيد (${formatNumber(
                      op.runningBalanceBefore
                    )}) بينما آخر صف في الورقة السابقة انتهى عند (${formatNumber(
                      prevOp.runningBalanceAfter
                    )}) بفارق ${formatNumber(Math.abs(contDiff))} ج.م.`
                  : `${certaintyTag} — انقطاع في تتابع الرصيد بين الصفوف (يوم ${op.date}، ورقة ${pageLabel}، صف #${rowLabel}): الرصيد قبل الصف (${formatNumber(
                      op.runningBalanceBefore
                    )}) لا يساوي الرصيد بعد الصف السابق (${formatNumber(
                      prevOp.runningBalanceAfter
                    )}) بفارق ${formatNumber(Math.abs(contDiff))} ج.م.`,
              });
            }
          }
        }
      }
    }

    // Update prevDayClosingBalance for the next day in sequence
    const dayClosing =
      dayInfo?.closingLedgerBalance ??
      (opsWithRunning.length > 0
        ? opsWithRunning[opsWithRunning.length - 1].runningBalanceAfter
        : undefined);

    if (typeof dayClosing === 'number' && Number.isFinite(dayClosing)) {
      prevDayClosingBalance = { date, balance: dayClosing };
    }
  }

  return issues;
}
