import { Issue, Operation } from '../../types';
import { formatNumber } from '../numerals';

/**
 * Prompt 1 Check 6:
 * Frequent round numbers (multiples of 1000) or the exact same total repeating unusually often (low).
 */
export function checkRoundAndRepeatedNumbers(operations: Operation[]): Issue[] {
  const issues: Issue[] = [];
  const goldOps = operations.filter(
    (op) => (op.kind === 'buy' || op.kind === 'sell') && op.total > 0
  );

  if (goldOps.length === 0) return issues;

  const roundOps: Operation[] = [];
  const amountFreq = new Map<number, Operation[]>();

  for (const op of goldOps) {
    const roundedTotal = Math.round(op.total);
    if (roundedTotal >= 1000 && roundedTotal % 1000 === 0) {
      roundOps.push(op);
    }

    const list = amountFreq.get(roundedTotal) || [];
    list.push(op);
    amountFreq.set(roundedTotal, list);
  }

  // Flag round numbers if at least 3 round operations exist
  if (roundOps.length >= 3) {
    for (const op of roundOps) {
      issues.push({
        id: `round-num-${op.id}`,
        severity: 'low',
        checkType: 'round_or_repeated',
        checkTitle: 'أرقام مدورة أو متكررة',
        rowId: op.id,
        date: op.date,
        kind: op.kind,
        message: `المبلغ (${formatNumber(op.total)} ج.م) رقم مدوّر من مضاعفات 1,000 (يتكرر الأرقام المدورة ${roundOps.length} مرات في الدفتر).`,
        expected: 'مبلغ محسوب بالوزن × السعر',
        actual: `${formatNumber(op.total)} ج.م`,
      });
    }
  }

  // Flag exact same non-1000 amount repeated >= 4 times across different weights/days
  for (const [amount, list] of amountFreq.entries()) {
    if (list.length >= 4 && amount % 1000 !== 0) {
      const sample = list[0];
      issues.push({
        id: `repeated-amount-${amount}`,
        severity: 'low',
        checkType: 'round_or_repeated',
        checkTitle: 'أرقام مدورة أو متكررة',
        rowId: sample.id,
        date: sample.date,
        kind: sample.kind,
        message: `نفس المبلغ (${formatNumber(amount)} ج.م) تكرر ${list.length} مرات في العمليات.`,
        expected: 'تنوع طبيعي للمبالغ',
        actual: `تكرر ${list.length} مرات`,
      });
    }
  }

  return issues;
}
