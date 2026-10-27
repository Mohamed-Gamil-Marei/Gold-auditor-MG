import { Issue, Operation } from '../../types';
import { formatNumber, formatWeight } from '../numerals';

/**
 * Prompt 1 Check 5:
 * Exact duplicate: same date + kind + weightG + total in more than one row (medium).
 */
export function checkDuplicates(operations: Operation[]): Issue[] {
  const issues: Issue[] = [];
  const seenMap = new Map<string, Operation[]>();

  for (const op of operations) {
    if (op.kind !== 'buy' && op.kind !== 'sell') continue;
    if (op.weightG <= 0 || op.total <= 0) continue;

    const key = `${op.date}|${op.kind}|${op.weightG.toFixed(3)}|${Math.round(op.total)}`;
    const list = seenMap.get(key) || [];
    list.push(op);
    seenMap.set(key, list);
  }

  for (const [, list] of seenMap.entries()) {
    if (list.length > 1) {
      for (let i = 1; i < list.length; i++) {
        const dup = list[i];
        const kindAr = dup.kind === 'buy' ? 'شراء' : 'بيع';
        issues.push({
          id: `dup-row-${dup.id}`,
          severity: 'medium',
          checkType: 'duplicate_row',
          checkTitle: 'تكرار عملية متطابقة',
          rowId: dup.id,
          date: dup.date,
          kind: dup.kind,
          message: `تكرار عملية ${kindAr} بنفس التاريخ والوزن (${formatWeight(dup.weightG)} جرام) والمبلغ (${formatNumber(dup.total)} ج.م) — تكررت ${list.length} مرات.`,
          expected: 'عملية واحدة غير مكررة',
          actual: `${list.length} صفوف متطابقة`,
          difference: `${formatNumber(dup.total)} ج.م`,
        });
      }
    }
  }

  return issues;
}
