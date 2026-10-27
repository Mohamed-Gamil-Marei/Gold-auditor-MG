import { AuditSettings, Issue, Operation } from '../../types';
import { formatNumber, formatWeight } from '../numerals';

export function checkMissingOrInvalid(
  operations: Operation[],
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];

  for (const op of operations) {
    if (!op.date || !/^\d{4}-\d{2}-\d{2}$/.test(op.date)) {
      issues.push({
        id: `invalid-date-${op.id}`,
        severity: 'high',
        checkType: 'missing_or_invalid',
        checkTitle: 'بيانات ناقصة أو غير منطقية',
        rowId: op.id,
        date: op.date || 'غير محدد',
        kind: op.kind,
        message: 'تاريخ العملية مفقود أو بصيغة غير صحيحة.',
        expected: 'YYYY-MM-DD',
        actual: op.date || 'فارغ',
      });
    }

    if (op.kind === 'buy' || op.kind === 'sell') {
      if (op.weightG === undefined || op.weightG === null || op.weightG <= 0) {
        issues.push({
          id: `invalid-weight-${op.id}`,
          severity: 'high',
          checkType: 'missing_or_invalid',
          checkTitle: 'بيانات ناقصة أو غير منطقية',
          rowId: op.id,
          date: op.date,
          kind: op.kind,
          message: `الوزن صفر أو سالب (${formatWeight(op.weightG)} جرام) في عملية ${op.kind === 'buy' ? 'شراء' : 'بيع'}.`,
          expected: '> 0 جرام',
          actual: `${formatWeight(op.weightG)} جرام`,
        });
      } else if (op.weightG > settings.maxReasonableWeightG) {
        issues.push({
          id: `extreme-weight-${op.id}`,
          severity: 'high',
          checkType: 'missing_or_invalid',
          checkTitle: 'بيانات ناقصة أو غير منطقية',
          rowId: op.id,
          date: op.date,
          kind: op.kind,
          message: `وزن غير معقول للعملية الواحدة (${formatWeight(op.weightG)} جرام يتجاوز الحد ${settings.maxReasonableWeightG} جرام).`,
          expected: `<= ${settings.maxReasonableWeightG} جرام`,
          actual: `${formatWeight(op.weightG)} جرام`,
          difference: `${formatWeight(op.weightG - settings.maxReasonableWeightG)} جرام`,
        });
      }
    }

    if (op.total === undefined || op.total === null || op.total <= 0) {
      // Allow total === 0 only if it's a pure gold movement for a person with weightG > 0
      const isPersonGoldOnly = op.kind === 'person' && op.weightG > 0 && op.total === 0;
      if (!isPersonGoldOnly) {
        issues.push({
          id: `invalid-total-${op.id}`,
          severity: 'high',
          checkType: 'missing_or_invalid',
          checkTitle: 'بيانات ناقصة أو غير منطقية',
          rowId: op.id,
          date: op.date,
          kind: op.kind,
          message: `المبلغ الإجمالي صفر أو سالب (${formatNumber(op.total)} ج.م).`,
          expected: '> 0 ج.م',
          actual: `${formatNumber(op.total)} ج.م`,
        });
      }
    }
  }

  return issues;
}
