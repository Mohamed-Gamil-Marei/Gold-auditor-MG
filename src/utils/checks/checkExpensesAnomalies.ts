import { AuditSettings, Issue, Operation } from '../../types';
import { formatNumber } from '../numerals';

/**
 * Prompt 3.6 Check 3:
 * - Expense > 3x average of the same category (medium).
 * - Duplicate same category + amount on the same day (medium).
 */
export function checkExpensesAnomalies(
  operations: Operation[],
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const expenses = operations.filter((op) => op.kind === 'expense' && op.total > 0);
  if (expenses.length === 0) return issues;

  const byCategory: Record<string, Operation[]> = {};
  const byDayCatAmount: Record<string, Operation[]> = {};

  for (const op of expenses) {
    const cat = (op.category || op.item || 'أخرى').trim();
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(op);

    const dKey = `${op.date}|${cat}|${Math.round(op.total)}`;
    if (!byDayCatAmount[dKey]) byDayCatAmount[dKey] = [];
    byDayCatAmount[dKey].push(op);
  }

  // 1. Expense > 3x average of the same category
  for (const [cat, list] of Object.entries(byCategory)) {
    if (list.length < 2) continue;
    const avg = list.reduce((s, o) => s + o.total, 0) / list.length;
    for (const op of list) {
      if (op.total > avg * settings.expenseSpikeMultiplier) {
        const ratio = op.total / avg;
        issues.push({
          id: `expense-spike-${op.id}`,
          severity: 'medium',
          checkType: 'expense_anomaly',
          checkTitle: 'شذوذ أو تكرار المصاريف',
          rowId: op.id,
          date: op.date,
          kind: 'expense',
          message: `مصروف بند "${cat}" بمبلغ ${formatNumber(op.total)} ج.م أكبر بـ ${ratio.toFixed(1)} أضعاف من متوسط نفس البند (${formatNumber(avg, 0)} ج.م).`,
          expected: `~${formatNumber(avg, 0)} ج.م`,
          actual: `${formatNumber(op.total)} ج.م`,
          difference: `+${formatNumber(op.total - avg, 0)} ج.م`,
        });
      }
    }
  }

  // 2. Duplicate same category and amount on the same day
  for (const list of Object.values(byDayCatAmount)) {
    if (list.length > 1) {
      for (let i = 1; i < list.length; i++) {
        const dup = list[i];
        const cat = (dup.category || dup.item || 'أخرى').trim();
        issues.push({
          id: `expense-dup-${dup.id}`,
          severity: 'medium',
          checkType: 'expense_anomaly',
          checkTitle: 'شذوذ أو تكرار المصاريف',
          rowId: dup.id,
          date: dup.date,
          kind: 'expense',
          message: `تكرار مصروف بند "${cat}" بنفس المبلغ (${formatNumber(dup.total)} ج.م) في نفس اليوم (${dup.date}).`,
          expected: 'صرف واحد للبند',
          actual: `تكرر ${list.length} مرات`,
        });
      }
    }
  }

  return issues;
}
