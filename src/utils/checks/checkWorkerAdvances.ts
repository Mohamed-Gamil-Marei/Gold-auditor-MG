import { AuditSettings, Issue, Operation, Worker } from '../../types';
import { formatNumber } from '../numerals';

/**
 * Prompt 3.6 Checks 1, 2, 8:
 * - Worker advance > 50% of monthly salary in a month (medium) or > 100% of salary (high).
 * - More than one advance for the same worker on the same day, or repeated identical advance amount (low).
 * - Worker has advances without a recorded salary (low).
 */
export function checkWorkerAdvances(
  operations: Operation[],
  workers: Worker[],
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const advances = operations.filter((op) => op.kind === 'advance' && op.total > 0);
  if (advances.length === 0) return issues;

  const workersMap = new Map<string, Worker>();
  for (const w of workers) workersMap.set(w.id, w);

  // Group by worker + month (YYYY-MM)
  const monthlyByWorker: Record<string, { workerId: string; month: string; total: number; ops: Operation[] }> = {};
  // Group by worker + day
  const dailyByWorker: Record<string, Operation[]> = {};
  // Group by worker + exact amount
  const amountFreqByWorker: Record<string, Operation[]> = {};

  for (const op of advances) {
    const workerId = op.workerId || op.personId || 'unknown';
    const month = op.date.slice(0, 7);
    const mKey = `${workerId}|${month}`;
    if (!monthlyByWorker[mKey]) {
      monthlyByWorker[mKey] = { workerId, month, total: 0, ops: [] };
    }
    monthlyByWorker[mKey].total += op.total;
    monthlyByWorker[mKey].ops.push(op);

    const dKey = `${workerId}|${op.date}`;
    if (!dailyByWorker[dKey]) dailyByWorker[dKey] = [];
    dailyByWorker[dKey].push(op);

    const aKey = `${workerId}|${Math.round(op.total)}`;
    if (!amountFreqByWorker[aKey]) amountFreqByWorker[aKey] = [];
    amountFreqByWorker[aKey].push(op);
  }

  // Check 1 & 8: Monthly advances vs salary, and missing salary
  const missingSalaryChecked = new Set<string>();
  for (const group of Object.values(monthlyByWorker)) {
    const worker = workersMap.get(group.workerId);
    const workerName = worker?.name || group.ops[0]?.item || 'عامل غير محدد';
    const salary = worker?.monthlySalary || 0;

    if (salary <= 0) {
      if (!missingSalaryChecked.has(group.workerId)) {
        missingSalaryChecked.add(group.workerId);
        issues.push({
          id: `worker-no-salary-${group.workerId}`,
          severity: 'low',
          checkType: 'worker_no_salary',
          checkTitle: 'عامل بدون مرتب مسجل',
          workerId: group.workerId,
          date: group.ops[group.ops.length - 1].date,
          kind: 'advance',
          message: `العامل "${workerName}" مسجل له سلف بإجمالي ${formatNumber(group.total)} ج.م بدون تسجيل مرتب شهري له.`,
          expected: 'مرتب شهري > 0',
          actual: 'غير مسجل (0 ج.م)',
        });
      }
      continue;
    }

    const pct = (group.total / salary) * 100;
    if (pct > settings.workerAdvanceHighPct) {
      issues.push({
        id: `worker-adv-high-${group.workerId}-${group.month}`,
        severity: 'high',
        checkType: 'worker_advance_limit',
        checkTitle: 'تجاوز سلف العمال للحد',
        workerId: group.workerId,
        date: group.ops[group.ops.length - 1].date,
        kind: 'advance',
        message: `إجمالي سلف العامل "${workerName}" في شهر ${group.month} (${formatNumber(group.total)} ج.م) تجاوز مرتبه الشهري (${formatNumber(salary)} ج.م) بنسبة ${pct.toFixed(0)}%.`,
        expected: `<= ${formatNumber(salary)} ج.م`,
        actual: `${formatNumber(group.total)} ج.م`,
        difference: `+${formatNumber(group.total - salary)} ج.م`,
      });
    } else if (pct > settings.workerAdvanceMediumPct) {
      issues.push({
        id: `worker-adv-med-${group.workerId}-${group.month}`,
        severity: 'medium',
        checkType: 'worker_advance_limit',
        checkTitle: 'تجاوز سلف العمال للحد',
        workerId: group.workerId,
        date: group.ops[group.ops.length - 1].date,
        kind: 'advance',
        message: `إجمالي سلف العامل "${workerName}" في شهر ${group.month} (${formatNumber(group.total)} ج.م) وصل إلى ${pct.toFixed(0)}% من مرتبه الشهري (${formatNumber(salary)} ج.م).`,
        expected: `<= ${settings.workerAdvanceMediumPct}% من المرتب`,
        actual: `${pct.toFixed(0)}% (${formatNumber(group.total)} ج.م)`,
      });
    }
  }

  // Check 2a: Multiple advances for same worker on same day
  for (const ops of Object.values(dailyByWorker)) {
    if (ops.length > 1) {
      const sample = ops[ops.length - 1];
      const workerId = sample.workerId || sample.personId || 'unknown';
      const workerName = workersMap.get(workerId)?.name || sample.item || 'عامل';
      const sum = ops.reduce((s, o) => s + o.total, 0);
      issues.push({
        id: `worker-multi-day-${workerId}-${sample.date}`,
        severity: 'low',
        checkType: 'worker_repeated_advance',
        checkTitle: 'تكرار سلف العامل',
        rowId: sample.id,
        workerId,
        date: sample.date,
        kind: 'advance',
        message: `أكثر من سلفة (${ops.length} سلف) لنفس العامل "${workerName}" في نفس اليوم (${sample.date}) بإجمالي ${formatNumber(sum)} ج.م.`,
        expected: 'سلفة واحدة كحد أقصى يومياً',
        actual: `${ops.length} سلف في يوم واحد`,
      });
    }
  }

  // Check 2b: Repeated exact advance amount >= 3 times for same worker
  for (const ops of Object.values(amountFreqByWorker)) {
    if (ops.length >= 3) {
      const sample = ops[ops.length - 1];
      const workerId = sample.workerId || sample.personId || 'unknown';
      const workerName = workersMap.get(workerId)?.name || sample.item || 'عامل';
      issues.push({
        id: `worker-rep-amt-${workerId}-${Math.round(sample.total)}`,
        severity: 'low',
        checkType: 'worker_repeated_advance',
        checkTitle: 'تكرار سلف العامل',
        rowId: sample.id,
        workerId,
        date: sample.date,
        kind: 'advance',
        message: `تكرار نفس مبلغ السلفة (${formatNumber(sample.total)} ج.م) للعامل "${workerName}" عدد ${ops.length} مرات.`,
        expected: 'مبالغ سلف متفاوتة',
        actual: `تكرر ${ops.length} مرات`,
      });
    }
  }

  return issues;
}
