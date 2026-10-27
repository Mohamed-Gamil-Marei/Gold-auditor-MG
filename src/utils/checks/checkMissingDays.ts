import { AuditSettings, Issue, Operation } from '../../types';

/**
 * Prompt 1 Check 7:
 * Days with zero activity between the first and last recorded dates (low, with option to exclude Fridays).
 */
export function checkMissingDays(
  operations: Operation[],
  settings: AuditSettings
): Issue[] {
  const issues: Issue[] = [];
  const validDates = Array.from(
    new Set(
      operations
        .map((op) => op.date)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    )
  ).sort();

  if (validDates.length < 2) return issues;

  const activeSet = new Set(validDates);
  const start = new Date(`${validDates[0]}T00:00:00Z`);
  const end = new Date(`${validDates[validDates.length - 1]}T00:00:00Z`);

  // Limit span scan to 180 days max to avoid excessive noise if someone has a typo year
  const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 1 || diffDays > 180) return issues;

  const cursor = new Date(start.getTime() + 86400000);
  while (cursor < end) {
    const iso = cursor.toISOString().slice(0, 10);
    const dayOfWeek = cursor.getUTCDay(); // 5 === Friday
    const isFriday = dayOfWeek === 5;

    if (!activeSet.has(iso)) {
      if (!(settings.excludeFridays && isFriday)) {
        issues.push({
          id: `missing-day-${iso}`,
          severity: 'low',
          checkType: 'missing_day',
          checkTitle: 'أيام بدون حركة',
          date: iso,
          message: `لا توجد أي عمليات مسجلة في يوم ${iso}${isFriday ? ' (يوم جمعة)' : ''} بين أول وآخر تاريخ في الدفتر.`,
          expected: 'حركة يومية مسجلة',
          actual: '0 عمليات',
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return issues;
}
